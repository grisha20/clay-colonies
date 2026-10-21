extends SceneTree

## Automated playtest of one full match through the production Godot client
## against an isolated QA server. A simple "player" uses the same tools a human
## has (build tools, work priorities, defence post, alarm) and plays tribe A to
## the end; everything notable goes to a log (JSON lines) and screenshots.
##   godot --path godot --script res://tests/playtest/full_match.gd -- --server-port 8799 --out <dir> [--speed 20]

var scene: WorldObserver
var out := "user://playtest"
var log_file: FileAccess
var speed := 20
var seen_events: Dictionary = {}
var shots_taken: Dictionary = {}
var start_real := 0
var frame_deltas: Array[float] = []
var last_frame_us := 0
var decisions: Array[String] = []
var stuck_samples: Dictionary = {}

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n):
		await process_frame
		_track_frame()

func _track_frame() -> void:
	var now = Time.get_ticks_usec()
	if last_frame_us > 0:
		frame_deltas.append(float(now - last_frame_us) / 1000.0)
	last_frame_us = now

func write(kind: String, data: Dictionary) -> void:
	data["kind"] = kind
	data["tick"] = int(snap().get("tick", 0))
	data["real_s"] = int((Time.get_ticks_msec() - start_real) / 1000)
	log_file.store_line(JSON.stringify(data))
	log_file.flush()
	print("PLAYTEST ", JSON.stringify(data))

func snap() -> Dictionary:
	return scene.world_view.last_snapshot if scene else {}

func colony(i: int = 0) -> Dictionary:
	var cs = snap().get("colonies", [])
	return cs[i].get("colony", {}) if typeof(cs) == TYPE_ARRAY and i < cs.size() else {}

func surface() -> Dictionary:
	return snap().get("surface", {})

func own(type: String, built_only := false) -> Array:
	return surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-1" and b.type == type and (not built_only or b.stage == "built"))

func pop(colony_id := "colony-1") -> int:
	return snap().get("ants", []).filter(func(a): return a.colonyId == colony_id).size()

func shot(name: String) -> void:
	if shots_taken.has(name):
		return
	shots_taken[name] = true
	await frames(20)
	root.get_viewport().get_texture().get_image().save_png(out.path_join("%s.png" % name))
	write("shot", {"name": name})

func decide(text: String) -> void:
	decisions.append(text)
	write("decision", {"text": text})

func camp() -> Vector2:
	var e = surface().get("entrances", [{"x": 120, "y": 240}])[0]
	return Vector2(float(e.x), float(e.y))

## A free spot for a point building near camp, preferring the side away from map edges.
func spot_for(type: String, radius_min := 14.0, radius_max := 40.0) -> Vector2:
	var c = camp()
	for r in range(int(radius_min), int(radius_max), 2):
		for k in range(24):
			var p = c + Vector2(cos(k * TAU / 24.0), sin(k * TAU / 24.0)) * r
			if BuildRules.point_building_placement(surface(), "colony-1", type, p) == "":
				return p
	return Vector2.INF

func place(type: String) -> bool:
	var p = spot_for(type)
	if p == Vector2.INF:
		write("problem", {"text": "no place for %s near camp" % type})
		return false
	scene.build.set_tool(type)
	scene.build._place_point(p, false)
	decide("place %s at %d,%d" % [type, int(p.x), int(p.y)])
	return true

func pending_sites() -> int:
	return surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-1" and b.stage != "built").size()

func set_priorities() -> void:
	var p = pop()
	var c = colony()
	var unit = maxi(1, int(p / 8))
	var pr = {"clay": 2 * unit, "wood": 2 * unit, "stone": unit, "build": unit + (1 if pending_sites() > 0 else 0), "guard": unit, "fish": mini(int(c.get("rods", 0)), unit)}
	var raid = snap().get("session", {}).get("raid", {})
	if str(raid.get("phase", "")) != "peace":
		pr.guard = 2 * unit + 1
	var total = 0
	for v in pr.values():
		total += v
	# Leave hands for food: never assign more than 70% of the tribe.
	while total > int(p * 0.7) and total > 0:
		for k in ["fish", "stone", "build", "wood", "clay", "guard"]:
			if pr[k] > 0 and total > int(p * 0.7):
				pr[k] -= 1
				total -= 1
	var current = c.get("priorities", {})
	var changed = false
	for k in pr.keys():
		if int(current.get(k, -1)) != pr[k]:
			changed = true
	if changed:
		scene.priority_panel.priorities_requested.emit(pr)
		decide("priorities %s" % JSON.stringify(pr))

func policy() -> void:
	var c = colony()
	var clay = float(c.get("clay", 0))
	var wood = float(c.get("wood", 0))
	var stone = float(c.get("stone", 0))
	set_priorities()
	var huts = own("hut").size()
	if pending_sites() == 0:
		if own("workshop").is_empty() and wood >= 4:
			place("workshop")
		elif huts < 3 + int(pop() / 6) and clay >= 8 and wood >= 5 and huts < 8:
			place("hut")
		elif not own("workshop", true).is_empty() and own("idol").is_empty() and clay >= 25 and stone >= 5:
			place("idol")
		elif own("storage").size() < 2 and wood >= 6 and stone >= 4:
			place("storage")
	# Defence post on the camp side facing the map centre.
	if c.get("defensePost") == null or not shots_taken.has("post_set"):
		var toward = (Vector2(240, 240) - camp()).normalized()
		var p = camp() + toward * 14.0
		if BuildRules.post_placement(surface(), "colony-1", p) == "":
			scene.ws_client.send_command({"type": "setDefensePost", "x": p.x, "y": p.y, "colony": 0})
			shots_taken["post_set"] = true
			decide("defence post toward centre")
	var raid = snap().get("session", {}).get("raid", {})
	var alarm = bool(c.get("alarm", false))
	if str(raid.get("phase", "")) == "attack" and not alarm:
		scene.hud.alarm_requested.emit(true)
		decide("alarm ON during raid")
	elif str(raid.get("phase", "")) != "attack" and alarm:
		scene.hud.alarm_requested.emit(false)
		decide("alarm OFF after raid")

func record_state() -> void:
	var c = colony()
	var c2 = colony(1)
	var s = snap().get("session", {})
	var objectives = snap().get("objectives", []).map(func(o): return "%s%s %d/%d" % ["✓" if o.done else "", o.text, int(o.progress), int(o.target)])
	var motion: Dictionary = {}
	for a in snap().get("ants", []):
		if a.colonyId != "colony-1":
			continue
		var tm = a.get("taskMotion")
		if typeof(tm) == TYPE_DICTIONARY:
			motion[tm.state] = int(motion.get(tm.state, 0)) + 1
	write("state", {
		"pop_a": pop(), "pop_b": pop("colony-2"),
		"clay": int(c.get("clay", 0)), "wood": int(c.get("wood", 0)), "stone": int(c.get("stone", 0)), "food": int(c.get("food", 0)),
		"fire": snappedf(float(c.get("fire", 0)), 0.01), "axes": int(c.get("axes", 0)), "picks": int(c.get("picks", 0)),
		"huts": own("hut", true).size(), "sites": pending_sites(), "workshop": own("workshop", true).size(), "idol": own("idol", true).size(),
		"b_buildings": surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-2" and b.stage == "built").size(),
		"weather": str(snap().get("weather", {}).get("state", "")), "raid": str(s.get("raid", {}).get("phase", "")),
		"idol_progress": int(s.get("idolProgress", 0)), "enemies": snap().get("enemies", []).size(),
		"motion": motion, "objectives": objectives, "status": str(s.get("status", "")),
	})

func record_events() -> void:
	for e in snap().get("session", {}).get("events", []):
		var key = "%d|%s" % [int(e.get("tick", 0)), str(e.get("text", ""))]
		if not seen_events.has(key):
			seen_events[key] = true
			write("event", {"text": str(e.get("text", "")), "at": int(e.get("tick", 0))})

func frame_report(label: String) -> void:
	if frame_deltas.is_empty():
		return
	var d = frame_deltas.duplicate()
	d.sort()
	var avg = d.reduce(func(a, b): return a + b, 0.0) / d.size()
	write("frames", {"label": label, "avg_ms": snappedf(avg, 0.01), "p99_ms": snappedf(d[int(d.size() * 0.99)], 0.01), "max_ms": snappedf(d[-1], 0.01), "over50": d.filter(func(x): return x > 50.0).size(), "count": d.size()})
	frame_deltas.clear()

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out = args[i + 1]
		elif args[i] == "--speed" and i + 1 < args.size():
			speed = int(args[i + 1])
	DirAccess.make_dir_recursive_absolute(out)
	log_file = FileAccess.open(out.path_join("playtest.jsonl"), FileAccess.WRITE)
	start_real = Time.get_ticks_msec()
	scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	while scene.entity_registry.residents.is_empty():
		await frames(1)
	var terrain = surface().get("terrain", {})
	write("start", {"seed": int(terrain.get("seed", 0)), "lakes": terrain.get("lakes", []).size(), "mountains": terrain.get("mountains", []).size(), "camp_a": [camp().x, camp().y]})
	scene.world_view.focus_on_colony(0)
	scene.world_view.target_camera_distance = 40.0
	await shot("t000_start")
	scene.ws_client.send_command({"type": "setSpeed", "value": speed})
	var last_state_tick = -99999
	var last_policy_tick = -99999
	var last_frames_tick = 0
	var camera_mode = 0
	while true:
		await frames(1)
		var tick = int(snap().get("tick", 0))
		var status = str(snap().get("session", {}).get("status", "playing"))
		record_events()
		if tick - last_policy_tick >= 300:
			last_policy_tick = tick
			policy()
		if tick - last_state_tick >= 3000:
			last_state_tick = tick
			record_state()
			# Wander the camera between camp, the work sites and the overview.
			camera_mode = (camera_mode + 1) % 3
			if camera_mode == 0:
				scene.world_view.focus_on_colony(0)
				scene.world_view.target_camera_distance = 30.0
			elif camera_mode == 1:
				scene.world_view.focus_on_colony(1)
				scene.world_view.target_camera_distance = 30.0
			else:
				scene.world_view.camera_pivot.position = Vector3(240, 0, 240)
				scene.world_view.target_camera_distance = 80.0
		if tick - last_frames_tick >= 12000:
			last_frames_tick = tick
			frame_report("to_tick_%d" % tick)
		# Milestone screenshots.
		var c = colony()
		if own("hut", true).size() >= 3:
			scene.world_view.focus_on_colony(0)
			await shot("m1_first_new_hut")
		if scene.world_view.atmosphere.darkness > 0.95:
			await shot("m2_first_night")
		if str(snap().get("weather", {}).get("state", "")) == "rain":
			await shot("m3_first_rain")
		if str(snap().get("session", {}).get("raid", {}).get("phase", "")) == "attack":
			scene.world_view.focus_on_colony(0)
			scene.world_view.target_camera_distance = 30.0
			await shot("m4_raid")
		if not own("idol", true).is_empty():
			await shot("m5_idol")
		if status != "playing":
			record_state()
			scene.world_view.focus_on_colony(0)
			scene.world_view.target_camera_distance = 34.0
			await shot("z_end")
			write("end", {"status": status, "reason": str(snap().get("session", {}).get("reason", "")), "stats": snap().get("session", {}).get("stats", {})})
			break
		if Time.get_ticks_msec() - start_real > 40 * 60 * 1000:
			write("end", {"status": "timeout", "reason": "40 real minutes"})
			break
	frame_report("final")
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	await frames(5)
	scene.ws_client.disconnect_from_server()
	await frames(2)
	log_file.close()
	quit(0)
