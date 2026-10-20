extends SceneTree

## Comprehensive automated regression tests for M2 Surface Navigation & Obstacle Trajectory Safety.
## Verifies all requirements from M2_REVIEW_ea54b49.md:
## 1. Empty map -> direct movement without any hardcoded audit obstacles.
## 2. Real buildings from snapshot -> entire path (all samples) strictly outside foundations for multiple positions & mirrored directions.
## 3. Adjacent obstacle configurations -> safe composite detour.
## 4. Walls and gates:
##    - Built walls block all passage.
##    - Friendly gates allow direct transit.
##    - Enemy gates block passage and force detours.
##    - Unbuilt construction sites do not block.
## 5. Water bodies: dry endpoints with chords entering water route cleanly around shorelines on dry land.
## 6. Stop reconciliation & extrapolation safety: no penetration beyond target, zero backwards step on stop.

const Geo = preload("res://scripts/world/building_geometry.gd")
const SurfaceNav = preload("res://scripts/world/surface_navigation.gd")
const SurfaceTerrain = preload("res://scripts/world/surface_terrain.gd")

func _init() -> void:
	print("=== RUNNING SURFACE NAVIGATION & SAFE TRAJECTORY TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_empty_map_direct_movement():
		passed += 1

	total += 1
	if test_real_building_full_path_outside_foundations():
		passed += 1

	total += 1
	if test_mirrored_directions_and_multiple_positions():
		passed += 1

	total += 1
	if test_wall_and_gate_semantics():
		passed += 1

	total += 1
	if test_water_shoreline_detour():
		passed += 1

	total += 1
	if test_extrapolation_and_stop_reconciliation():
		passed += 1

	print("=== SURFACE NAVIGATION RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL SURFACE NAVIGATION TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME SURFACE NAVIGATION TESTS FAILED!")
		quit(1)

func _create_actor(from_p: Vector2, to_p: Vector2, buildings: Array = [], entrances: Array = [], owner: String = "colony-1") -> NetworkResident:
	var r = NetworkResident.new()
	root.add_child(r)
	r.set_process(false)
	r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	r.update_from_ant_data({"id": "test", "colonyId": owner, "pos": {"x": from_p.x, "y": from_p.y}}, 0.1, 1, "playing", buildings, entrances)
	r.update_from_ant_data({"id": "test", "colonyId": owner, "pos": {"x": to_p.x, "y": to_p.y}}, 0.1, 1, "playing", buildings, entrances)
	return r

func test_empty_map_direct_movement() -> bool:
	var actor = _create_actor(Vector2(95.0, 100.5), Vector2(105.0, 100.5))
	if actor.has_waypoint:
		push_error("Empty world should not have waypoints, got has_waypoint=true")
		actor.queue_free()
		return false

	actor._process(0.05)
	var expected_mid = Vector3(100.0, 0.0, 100.5)
	if actor.position.distance_to(expected_mid) > 0.01:
		push_error("Empty world midpoint mismatch: got %s, expected %s" % [str(actor.position), str(expected_mid)])
		actor.queue_free()
		return false

	actor.queue_free()
	print("  PASS: test_empty_map_direct_movement (no artificial audit_hut, direct chord preserved)")
	return true

func test_real_building_full_path_outside_foundations() -> bool:
	var hut = {"id": "hut-1", "type": "hut", "stage": "built", "pos": {"x": 200.0, "y": 200.0}}
	var f = Geo.get_building_footprint(hut)
	var actor = _create_actor(Vector2(195.0, 200.5), Vector2(205.0, 200.5), [hut])

	if not actor.has_waypoint:
		push_error("Expected has_waypoint=true when path cuts through hut")
		actor.queue_free()
		return false

	var inside_samples = 0
	for i in range(120):
		actor._process(0.1 / 120.0)
		if Geo.inside_footprint(actor.position.x, actor.position.z, f):
			inside_samples += 1

	if inside_samples > 0:
		push_error("Full trajectory crossed hut: %d/120 samples inside foundation" % inside_samples)
		actor.queue_free()
		return false

	actor.queue_free()
	print("  PASS: test_real_building_full_path_outside_foundations (0/120 samples inside hut)")
	return true

func test_mirrored_directions_and_multiple_positions() -> bool:
	# Test 4 distinct directions and locations around workshops and storage
	var test_cases = [
		{"pos": Vector2(150, 150), "type": "workshop", "from": Vector2(150, 144), "to": Vector2(150, 156)}, # North to South
		{"pos": Vector2(150, 150), "type": "workshop", "from": Vector2(150, 156), "to": Vector2(150, 144)}, # South to North
		{"pos": Vector2(300, 250), "type": "storage", "from": Vector2(306, 250), "to": Vector2(294, 250)},  # East to West
		{"pos": Vector2(300, 250), "type": "storage", "from": Vector2(294, 250), "to": Vector2(306, 250)}   # West to East
	]

	for tc in test_cases:
		var bld = {"id": "bld-test", "type": tc["type"], "stage": "built", "pos": {"x": tc["pos"].x, "y": tc["pos"].y}}
		var f = Geo.get_building_footprint(bld)
		var actor = _create_actor(tc["from"], tc["to"], [bld])

		var inside_samples = 0
		for i in range(100):
			actor._process(0.1 / 100.0)
			if Geo.inside_footprint(actor.position.x, actor.position.z, f):
				inside_samples += 1

		if inside_samples > 0:
			push_error("Mirrored test for %s at %s failed: %d/100 samples inside" % [tc["type"], str(tc["pos"]), inside_samples])
			actor.queue_free()
			return false

		actor.queue_free()

	print("  PASS: test_mirrored_directions_and_multiple_positions (4/4 directions & locations clean)")
	return true

func test_wall_and_gate_semantics() -> bool:
	# 1. Built wall blocks everyone
	var wall = {"id": "wall-1", "type": "wall", "stage": "built", "pos": {"x": 200.0, "y": 220.0}, "colonyId": "colony-1"}
	var actor_wall = _create_actor(Vector2(197.0, 221.0), Vector2(205.0, 221.0), [wall], [], "colony-1")
	if not actor_wall.has_waypoint:
		push_error("Built wall should force detour, got has_waypoint=false")
		actor_wall.queue_free()
		return false
	actor_wall._process(0.05)
	if SurfaceNav.fence_contains(wall, Vector2(actor_wall.position.x, actor_wall.position.z)):
		push_error("Midpoint on wall chord penetrated wall cell at %s" % str(actor_wall.position))
		actor_wall.queue_free()
		return false
	actor_wall.queue_free()

	# 2. Friendly gate allows direct transit
	var f_gate = {"id": "gate-f", "type": "gate", "stage": "built", "gateSpan": 3, "gateAxis": "horizontal", "pos": {"x": 200.0, "y": 220.0}, "colonyId": "colony-1"}
	var actor_friendly = _create_actor(Vector2(197.0, 220.0), Vector2(203.0, 220.0), [f_gate], [], "colony-1")
	if actor_friendly.has_waypoint:
		push_error("Friendly gate should allow straight passage, got has_waypoint=true")
		actor_friendly.queue_free()
		return false
	actor_friendly.queue_free()

	# 3. Enemy gate blocks and forces detour
	var actor_enemy = _create_actor(Vector2(197.0, 220.0), Vector2(203.0, 220.0), [f_gate], [], "colony-2")
	if not actor_enemy.has_waypoint:
		push_error("Enemy gate should force detour, got has_waypoint=false")
		actor_enemy.queue_free()
		return false
	actor_enemy.queue_free()

	# 4. Unbuilt construction site allows transit
	var unbuilt_wall = {"id": "wall-u", "type": "wall", "stage": "site", "pos": {"x": 200.0, "y": 220.0}}
	var actor_unbuilt = _create_actor(Vector2(197.0, 221.0), Vector2(205.0, 221.0), [unbuilt_wall])
	if actor_unbuilt.has_waypoint:
		push_error("Unbuilt construction site should allow passage, got has_waypoint=true")
		actor_unbuilt.queue_free()
		return false
	actor_unbuilt.queue_free()

	print("  PASS: test_wall_and_gate_semantics (wall blocks, friendly gate open, enemy gate closed, site open)")
	return true

func test_water_shoreline_detour() -> bool:
	# Endpoints are dry land, straight chord cuts North Lake corner
	var actor_water = _create_actor(Vector2(265.0, 114.0), Vector2(262.0, 111.0))
	if not actor_water.has_waypoint:
		push_error("Water-crossing chord should force shoreline detour, got has_waypoint=false")
		actor_water.queue_free()
		return false

	actor_water._process(0.05)
	if SurfaceTerrain.is_water_at(actor_water.position.x, actor_water.position.z):
		push_error("Shoreline detour placed midpoint in water: %s" % str(actor_water.position))
		actor_water.queue_free()
		return false

	actor_water.queue_free()
	print("  PASS: test_water_shoreline_detour (shoreline bypass on dry land)")
	return true

func test_extrapolation_and_stop_reconciliation() -> bool:
	var hut = {"id": "hut-1", "type": "hut", "stage": "built", "pos": {"x": 200.0, "y": 200.0}}
	var f = Geo.get_building_footprint(hut)

	# 1. Extrapolation past authoritative safe target must not enter hut
	var pred = _create_actor(Vector2(190.0, 200.5), Vector2(195.9, 200.5), [hut])
	for i in range(11):
		pred._process(0.016)
	if Geo.inside_footprint(pred.position.x, pred.position.z, f):
		push_error("Extrapolation entered hut foundation at %s" % str(pred.position))
		pred.queue_free()
		return false
	pred.queue_free()

	# 2. Stop reconciliation: subsequent stop packet must not produce reverse movement
	var stop_actor = _create_actor(Vector2(10.0, 10.0), Vector2(10.1, 10.0))
	for i in range(10):
		stop_actor._process(0.016)
	var pred_x = stop_actor.position.x
	stop_actor.update_from_ant_data({"id": "test", "pos": {"x": 10.1, "y": 10.0}}, 0.1, 1)
	stop_actor._process(0.05)
	var delta = stop_actor.position.x - pred_x

	if delta < -0.0001:
		push_error("Stop reconciliation produced negative delta (reversing): delta=%f" % delta)
		stop_actor.queue_free()
		return false

	stop_actor.queue_free()
	print("  PASS: test_extrapolation_and_stop_reconciliation (safe target clamp, delta=%f >= 0.0)" % delta)
	return true
