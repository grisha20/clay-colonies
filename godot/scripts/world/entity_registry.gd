class_name EntityRegistry
extends Node3D

## Manages all active NetworkResident actors by stable server ID ("ant-1", "ant-2", etc.).
## Handles dynamic spawning, updating, despawning, and zero-duplicate state cleaning
## across reconnects and party transitions.

signal resident_spawned(resident: NetworkResident)
signal resident_despawned(ant_id: String)
signal population_updated(colony_1_count: int, colony_2_count: int)

## Time per snapshot for route detours around obstacles (SurfaceNavigation).
const DETOUR_BUDGET_MS := 3.0
var residents: Dictionary = {} # ant_id: String -> NetworkResident
var last_snapshot_tick: int = -1
var last_snapshot_timestamp: float = 0.0
var current_sim_speed: float = 1.0
## Resource/building ids someone is working on this snapshot -> work kind
## ("chop", "mine", "dig", "build"). WorldView shakes them and throws chips.
var worked_targets: Dictionary = {}

# Parent node holding resident instances (defaults to self)
var residents_container: Node3D = null

func _get_container() -> Node3D:
	if residents_container != null:
		return residents_container
	return self

var smoothed_interval: float = 0.100

func update_from_snapshot(snapshot: Dictionary) -> void:
	var tick = int(snapshot.get("tick", -1))
	var session = snapshot.get("session", {})
	var sim_status = str(session.get("status", "playing"))
	current_sim_speed = float(session.get("speed", 1.0))
	if sim_status != "playing":
		current_sim_speed = 0.0

	var surface = snapshot.get("surface", {})
	var buildings: Array = surface.get("buildings", []) if typeof(surface) == TYPE_DICTIONARY else []
	var entrances: Array = surface.get("entrances", []) if typeof(surface) == TYPE_DICTIONARY else []
	var ants = snapshot.get("ants", [])

	var is_tick_regression = (last_snapshot_tick >= 0 and tick < last_snapshot_tick)
	if is_tick_regression:
		for res in residents.values():
			res.is_first_update = true

	var now = Time.get_ticks_msec() / 1000.0
	var packet_dt = 0.100
	if last_snapshot_timestamp > 0.0:
		var measured = now - last_snapshot_timestamp
		# Handle normal delivery jitter (20ms to 350ms)
		if measured >= 0.02 and measured <= 0.35:
			smoothed_interval = lerpf(smoothed_interval, measured, 0.25)
			packet_dt = smoothed_interval
		elif measured > 0.35:
			# Gap/stall detected, fall back to nominal 100ms broadcast
			packet_dt = 0.100
	last_snapshot_timestamp = now
	last_snapshot_tick = tick

	SurfaceNavigation.begin_detour_budget(DETOUR_BUDGET_MS)
	var tp = Time.get_ticks_usec()
	var index = build_work_index(snapshot)
	FramePerf.add("reg.work_index", tp)
	worked_targets = {}
	var seen_ids: Dictionary = {}
	var col1_count = 0
	var col2_count = 0

	for ant_data in ants:
		if typeof(ant_data) != TYPE_DICTIONARY:
			continue

		var id = str(ant_data.get("id", ""))
		if id.is_empty():
			continue

		seen_ids[id] = true
		var col_id = str(ant_data.get("colonyId", ""))
		if col_id == "colony-1" or col_id == "0":
			col1_count += 1
		else:
			col2_count += 1

		var resident: NetworkResident
		if residents.has(id):
			resident = residents[id]
		else:
			resident = _spawn_resident(id, ant_data)
			residents[id] = resident
			resident_spawned.emit(resident)

		if not ant_data.has("tick"):
			ant_data["tick"] = tick

		tp = Time.get_ticks_usec()
		resident.update_from_ant_data(ant_data, packet_dt, current_sim_speed, sim_status, buildings, entrances)
		FramePerf.add("reg.resident_update", tp)
		tp = Time.get_ticks_usec()
		var work = work_for(ant_data, index)
		resident.set_work(work)
		FramePerf.add("reg.set_work", tp)
		if not work.is_empty() and work.has("target_id"):
			worked_targets[work.target_id] = work.kind

	SurfaceNavigation.end_detour_budget()
	# Despawn entities that died, went underground, or left
	var to_remove: Array[String] = []
	for id in residents.keys():
		if not seen_ids.has(id):
			to_remove.append(id)

	for id in to_remove:
		var res_node = residents[id]
		residents.erase(id)
		if is_instance_valid(res_node):
			res_node.queue_free()
		resident_despawned.emit(id)

	population_updated.emit(col1_count, col2_count)

func _spawn_resident(id: String, initial_data: Dictionary) -> NetworkResident:
	var resident = NetworkResident.new()
	resident.name = "Resident_" + id
	resident.ant_id = id
	resident.colony_id = str(initial_data.get("colonyId", "default"))

	var pos_dict = initial_data.get("pos", {})
	var init_x = float(pos_dict.get("x", 0.0))
	var init_y = float(pos_dict.get("y", 0.0))
	resident.position = Vector3(init_x, 0.0, init_y)

	_get_container().add_child(resident)
	return resident

func on_network_stalled() -> void:
	for resident in residents.values():
		if is_instance_valid(resident):
			resident.on_network_stalled()

func on_network_resumed() -> void:
	for resident in residents.values():
		if is_instance_valid(resident):
			resident.on_network_resumed()

func clear_all() -> void:
	for resident in residents.values():
		if is_instance_valid(resident):
			resident.queue_free()
	residents.clear()
	last_snapshot_tick = -1
	last_snapshot_timestamp = 0.0
	population_updated.emit(0, 0)

func get_resident(ant_id: String) -> NetworkResident:
	return residents.get(ant_id, null)

func get_resident_count() -> int:
	return residents.size()


## Lookup tables for work detection, built once per snapshot.
static func build_work_index(snapshot: Dictionary) -> Dictionary:
	var nodes: Dictionary = {}
	var sites: Dictionary = {}
	var alarms: Dictionary = {}
	var surface = snapshot.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		for n in surface.get("resourceNodes", []):
			if typeof(n) == TYPE_DICTIONARY:
				nodes[str(n.get("id", ""))] = n
		for b in surface.get("buildings", []):
			if typeof(b) == TYPE_DICTIONARY:
				sites[str(b.get("id", ""))] = b
	for c in snapshot.get("colonies", []):
		if typeof(c) == TYPE_DICTIONARY and typeof(c.get("colony")) == TYPE_DICTIONARY:
			alarms[str(c.get("id", ""))] = bool(c.colony.get("alarm", false))
	var weather = snapshot.get("weather", {})
	var clear = typeof(weather) != TYPE_DICTIONARY or str(weather.get("state", "clear")) == "clear"
	return {"nodes": nodes, "sites": sites, "alarms": alarms, "clear": clear}

static func _pos2(d: Variant) -> Vector2:
	if typeof(d) != TYPE_DICTIONARY:
		return Vector2.INF
	return Vector2(float(d.get("x", 0.0)), float(d.get("y", 0.0)))

## What a resident is visibly doing right now, mirroring the 2D client's
## canWork (client/src/render/surface/motion.ts) plus fishing:
## {kind: "chop"|"mine"|"dig"|"gather"|"build"|"fish", target: Vector3, target_id?} or {}.
static func work_for(ant: Dictionary, index: Dictionary) -> Dictionary:
	if float(ant.get("carrying", 0)) > 0.0 or ant.get("capturedBy") != null:
		return {}
	if not bool(index.get("clear", true)) or float(ant.get("waterExposure", 0.0)) > 0.0:
		return {}
	if bool(index.alarms.get(str(ant.get("colonyId", "")), false)):
		return {}
	var pos = _pos2(ant.get("pos"))
	var state = str(ant.get("state", ""))
	match str(ant.get("job", "")):
		"harvest":
			var node = index.nodes.get(str(ant.get("harvestNodeId", "")))
			if node == null or float(node.get("amount", 0.0)) <= 0.0 or state != "idle" or float(ant.get("harvestHits", 0)) <= 0.0:
				return {}
			var np = _pos2(node.get("pos"))
			if pos.distance_to(np) > 1.6:
				return {}
			# Tools follow resourceNodeTool (shared/types.ts): axe for trees, pick for
			# rock; sticks, pebbles and clay are gathered by hand.
			var kind = "gather"
			match str(node.get("kind", "")):
				"tree":
					kind = "chop"
				"stone":
					kind = "mine"
				"clay":
					kind = "dig"
			# Quarry work sites are drawn by their deposit: shake that instead.
			var target_id = str(node.get("depositId", "")) if str(node.get("depositId", "")) != "" else str(node.get("id", ""))
			return {"kind": kind, "target": Vector3(np.x, 0.0, np.y), "target_id": target_id}
		"build":
			var site = index.sites.get(str(ant.get("buildTargetId", "")))
			if site == null or str(site.get("stage", "")) != "inProgress" or state != "idle":
				return {}
			var sp = _pos2(site.get("pos"))
			if pos.distance_to(sp) > 2.6:
				return {}
			return {"kind": "build", "target": Vector3(sp.x, 0.0, sp.y), "target_id": str(site.get("id", ""))}
		"fish":
			var lure = _pos2(ant.get("fishingLurePos"))
			if lure == Vector2.INF or int(ant.get("fishingTicks", 0)) <= 0:
				return {}
			return {"kind": "fish", "target": Vector3(lure.x, 0.0, lure.y)}
	return {}
