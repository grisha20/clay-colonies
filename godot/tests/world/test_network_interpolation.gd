extends SceneTree

## Automated Headless Unit Tests for M2 Network Interpolation and Stride Synchronization.
## Verifies:
## 1. Speed scales (0x, 1x, 5x, 20x, 50x)
## 2. Pause freezes position and pose
## 3. Stride frequency tied strictly to ground speed
## 4. Network stall/disconnect halts movement (no infinite walking)
## 5. Teleport (> 8m) snaps position without sliding

func _init() -> void:
	print("=== RUNNING M2 NETWORK INTERPOLATION TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_pause_holds_position_and_pose():
		passed += 1

	total += 1
	if test_speed_scales_0_1_5_20_50():
		passed += 1

	total += 1
	if test_stride_frequency_tied_to_ground_speed():
		passed += 1

	total += 1
	if test_network_stall_stops_infinite_walking():
		passed += 1

	total += 1
	if test_large_teleport_snaps_without_sliding():
		passed += 1

	print("=== NETWORK INTERPOLATION RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL NETWORK INTERPOLATION TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME NETWORK INTERPOLATION TESTS FAILED!")
		quit(1)

func test_pause_holds_position_and_pose():
	var res = NetworkResident.new()
	var root = Node3D.new()
	root.add_child(res)

	# Initial placement
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 100.0, "y": 200.0}}, 0.1, 1.0)
	var initial_pos = res.position

	# Send update but with speed = 0 (pause)
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 105.0, "y": 200.0}}, 0.1, 0.0)

	# Simulate 10 frames
	for _i in range(10):
		res._process(0.016)

	# Position must remain stationary on pause
	if res.position.distance_to(initial_pos) > 0.001:
		push_error("Actor moved while simulation was paused!")
		return false

	if res.anim_player and res.anim_player.speed_scale > 0.0:
		push_error("Animation speed must be 0 on pause!")
		return false

	print("  PASS: test_pause_holds_position_and_pose")
	return true

func test_speed_scales_0_1_5_20_50():
	var test_speeds = [0.0, 1.0, 5.0, 20.0, 50.0]
	for spd in test_speeds:
		var res = NetworkResident.new()
		var root = Node3D.new()
		root.add_child(res)

		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.1, spd)

		# Send small step update (e.g. 0.2m)
		var tick_dt = 0.1 / max(1.0, spd)
		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.2, "y": 0.0}}, tick_dt, spd)

		if spd > 0.0:
			# Advance time by tick_dt
			res._process(tick_dt)
			# Actor must have reached target
			if res.position.distance_to(Vector3(0.2, 0.0, 0.0)) > 0.01:
				push_error("Speed %f failed to complete interpolation in tick_dt!" % spd)
				return false
		else:
			res._process(0.1)
			if res.position.distance_to(Vector3.ZERO) > 0.001:
				push_error("Speed 0 moved!")
				return false

	print("  PASS: test_speed_scales_0_1_5_20_50")
	return true

func test_stride_frequency_tied_to_ground_speed():
	var res = NetworkResident.new()
	var root = Node3D.new()
	root.add_child(res)

	# 1. Stationary test: speed = 0 -> idle
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 10.0, "y": 10.0}}, 0.1, 1.0)
	res._process(0.1)
	if res.current_anim_state != NetworkResident.AnimState.IDLE:
		push_error("Expected IDLE for stationary actor, got %d" % res.current_anim_state)
		return false

	# 2. Moving test: moving 0.048m in 0.1s -> speed 0.48 m/s -> walk
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 10.048, "y": 10.0}}, 0.1, 1.0)
	res._process(0.05)
	if res.current_anim_state != NetworkResident.AnimState.WALK:
		push_error("Expected WALK for moving actor, got %d" % res.current_anim_state)
		return false

	# 3. Carrying test: carrying > 0 -> carry_walk
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 10.1, "y": 10.0}, "carrying": 1, "state": "carry"}, 0.1, 1.0)
	res._process(0.05)
	if res.current_anim_state != NetworkResident.AnimState.CARRY_WALK:
		push_error("Expected CARRY_WALK for carrying actor, got %d" % res.current_anim_state)
		return false

	if not res.cargo_prop or not res.cargo_prop.visible:
		push_error("Cargo prop must be visible when carrying!")
		return false

	print("  PASS: test_stride_frequency_tied_to_ground_speed")
	return true

func test_network_stall_stops_infinite_walking():
	var res = NetworkResident.new()
	var root = Node3D.new()
	root.add_child(res)

	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.1, 1.0)
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 5.0, "y": 0.0}}, 0.1, 1.0)

	# Simulate 1 frame
	res._process(0.016)
	var pos_before_stall = res.position

	# Network stalls (disconnect or packet loss)
	res.on_network_stalled()

	# Simulate 10 frames
	for _i in range(10):
		res._process(0.016)

	# Must NOT continue walking into distance
	if res.position.distance_to(pos_before_stall) > 0.001:
		push_error("Actor continued walking after network stalled!")
		return false

	print("  PASS: test_network_stall_stops_infinite_walking")
	return true

func test_large_teleport_snaps_without_sliding():
	var res = NetworkResident.new()
	var root = Node3D.new()
	root.add_child(res)

	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.1, 1.0)
	res._process(0.1)

	# Send 50m jump (e.g. entrance spawn or teleport)
	var target_jump = Vector3(50.0, 0.0, 0.0)
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 50.0, "y": 0.0}}, 0.1, 1.0)

	# Must immediately snap position without requiring 50m of lerping
	if res.position.distance_to(target_jump) > 0.001:
		push_error("Large teleport (>8m) did not snap immediately!")
		return false

	print("  PASS: test_large_teleport_snaps_without_sliding")
	return true
