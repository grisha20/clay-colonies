extends SceneTree

## Automated Headless Unit Tests for M2 EntityRegistry.
## Verifies entity spawning by stable ID, update in place, despawning,
## and zero-duplicate clearing on reconnect.

func _init() -> void:
	print("=== RUNNING M2 ENTITY REGISTRY TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_spawn_and_population_tracking():
		passed += 1

	total += 1
	if test_update_in_place_without_node_recreation():
		passed += 1

	total += 1
	if test_despawn_missing_entities():
		passed += 1

	total += 1
	if test_clean_reconnect_zero_duplicates():
		passed += 1

	print("=== ENTITY REGISTRY RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL ENTITY REGISTRY TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME ENTITY REGISTRY TESTS FAILED!")
		quit(1)

func test_spawn_and_population_tracking() -> bool:
	var registry = EntityRegistry.new()
	var root = Node3D.new()
	root.add_child(registry)

	var snapshot = {
		"tick": 100,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}, "state": "idle"},
			{"id": "ant-2", "colonyId": "colony-1", "pos": {"x": 122.0, "y": 242.0}, "state": "search"},
			{"id": "ant-3", "colonyId": "colony-2", "pos": {"x": 360.0, "y": 240.0}, "state": "idle"}
		]
	}

	registry.update_from_snapshot(snapshot)

	if registry.get_resident_count() != 3:
		push_error("Expected 3 residents, got %d" % registry.get_resident_count())
		return false

	var r1 = registry.get_resident("ant-1")
	if not r1 or r1.ant_id != "ant-1" or r1.colony_id != "colony-1":
		push_error("Resident ant-1 data incorrect")
		return false

	var r3 = registry.get_resident("ant-3")
	var ok = (r1 != null and r3 != null)
	registry.clear_all()
	root.free()
	if not ok:
		return false

	print("  PASS: test_spawn_and_population_tracking")
	return true

func test_update_in_place_without_node_recreation() -> bool:
	var registry = EntityRegistry.new()
	var root = Node3D.new()
	root.add_child(registry)

	var snap1 = {
		"tick": 100,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}, "state": "idle", "carrying": 0}
		]
	}
	registry.update_from_snapshot(snap1)
	var node1_ref = registry.get_resident("ant-1")

	# Update snapshot with ant-1 moving and carrying cargo
	var snap2 = {
		"tick": 101,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 121.5, "y": 240.5}, "state": "carry", "carrying": 1, "carryKind": "clay"}
		]
	}
	registry.update_from_snapshot(snap2)
	var node2_ref = registry.get_resident("ant-1")

	var ok = (node1_ref == node2_ref and node2_ref.state_name == "carry" and node2_ref.carrying_amount == 1)
	registry.clear_all()
	root.free()
	if not ok:
		return false

	print("  PASS: test_update_in_place_without_node_recreation")
	return true

func test_despawn_missing_entities() -> bool:
	var registry = EntityRegistry.new()
	var root = Node3D.new()
	root.add_child(registry)

	var snap1 = {
		"tick": 100,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}},
			{"id": "ant-2", "colonyId": "colony-1", "pos": {"x": 122.0, "y": 242.0}}
		]
	}
	registry.update_from_snapshot(snap1)
	if registry.get_resident_count() != 2:
		registry.clear_all()
		root.free()
		return false

	# Next snapshot ant-2 dies or goes underground (missing from surface ants)
	var snap2 = {
		"tick": 101,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.5, "y": 240.0}}
		]
	}
	registry.update_from_snapshot(snap2)

	var ok = (registry.get_resident_count() == 1 and registry.get_resident("ant-2") == null)
	registry.clear_all()
	root.free()
	if not ok:
		push_error("ant-2 must have been despawned!")
		return false

	print("  PASS: test_despawn_missing_entities")
	return true

func test_clean_reconnect_zero_duplicates() -> bool:
	var registry = EntityRegistry.new()
	var root = Node3D.new()
	root.add_child(registry)

	var snap1 = {
		"tick": 100,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}},
			{"id": "ant-2", "colonyId": "colony-1", "pos": {"x": 122.0, "y": 242.0}}
		]
	}
	registry.update_from_snapshot(snap1)
	if registry.get_resident_count() != 2:
		registry.clear_all()
		root.free()
		return false

	# Simulate reconnect / new game transition
	registry.clear_all()
	if registry.get_resident_count() != 0:
		push_error("clear_all did not zero residents!")
		registry.clear_all()
		root.free()
		return false

	# Reconnected to new world with different IDs
	var snap_new_game = {
		"tick": 0,
		"session": {"speed": 1.0},
		"ants": [
			{"id": "ant-99", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}}
		]
	}
	registry.update_from_snapshot(snap_new_game)

	var ok = (registry.get_resident_count() == 1 and registry.get_resident("ant-1") == null and registry.get_resident("ant-99") != null)
	registry.clear_all()
	root.free()
	if not ok:
		push_error("Reconnect entity verification failed!")
		return false

	print("  PASS: test_clean_reconnect_zero_duplicates")
	return true
