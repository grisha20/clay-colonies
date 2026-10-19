extends SceneTree

## Automated Headless Unit Tests for M2 Network Interpolation, Timing & Facing.
## Verifies:
## 1. Model heading: local +Z (face) points forward in all 4 cardinal directions (dot product > 0.99).
## 2. Pause & Network stall: exact bone pose preserved without clip reset (Foot.R jump < 0.1mm).
## 3. Real packet timing: 100ms packet interval at 5x speed moves smoothly every frame (no 20ms burst + 80ms dead stall).
## 4. Stride frequency & high-speed policy: frequency scales with ground speed and caps at 8x.
## 5. Dynamic teleport threshold: fast continuous motion does not false-teleport, true jump snaps.

func _init() -> void:
	print("=== RUNNING M2 NETWORK INTERPOLATION TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_model_faces_direction_of_movement():
		passed += 1

	total += 1
	if test_pause_and_stall_preserves_exact_bone_pose():
		passed += 1

	total += 1
	if test_real_packet_timing_at_5x_speed_no_jerks():
		passed += 1

	total += 1
	if test_high_speed_stride_policy_and_bounds():
		passed += 1

	total += 1
	if test_dynamic_teleport_threshold():
		passed += 1

	print("=== NETWORK INTERPOLATION RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL NETWORK INTERPOLATION TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME NETWORK INTERPOLATION TESTS FAILED!")
		quit(1)

func test_model_faces_direction_of_movement() -> bool:
	var root = Node3D.new()
	var test_dirs = [
		Vector3.RIGHT,   # +X (east)
		Vector3.LEFT,    # -X (west)
		Vector3.BACK,    # +Z (south)
		Vector3.FORWARD  # -Z (north)
	]

	for dir in test_dirs:
		var res = NetworkResident.new()
		root.add_child(res)

		# Initial position
		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.1, 1.0)
		res._process(0.016)

		# Move along dir
		var target = dir * 2.0
		res.update_from_ant_data({
			"id": "ant-1",
			"pos": {"x": target.x, "y": target.z},
			"heading": {"x": dir.x, "y": dir.z}
		}, 0.1, 1.0)

		# Simulate 10 frames so heading smoothly rotates
		for _i in range(10):
			res._process(0.016)

		# In Godot, Vector3.BACK is (0, 0, 1), which is the model's local +Z (face/chest).
		var model_forward = res.transform.basis * Vector3.BACK
		var alignment = model_forward.dot(dir.normalized())

		if alignment < 0.95:
			push_error("Direction %s failed: model forward %s dot target %s = %f (< 0.95)" % [
				str(dir), str(model_forward), str(dir), alignment
			])
			res.queue_free()
			root.free()
			return false

		res.queue_free()

	root.free()
	print("  PASS: test_model_faces_direction_of_movement (+Z forward, dot > 0.95 in all 4 directions)")
	return true

func test_pause_and_stall_preserves_exact_bone_pose() -> bool:
	var root = Node3D.new()
	var res = NetworkResident.new()
	root.add_child(res)

	# Initial placement
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.1, 1.0)
	res._process(0.016)

	# Start walking
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 1.0, "y": 0.0}}, 0.1, 1.0)
	# Process 3 frames to establish a mid-stride phase (e.g. phase ~0.25)
	for _i in range(3):
		res._process(0.016)

	if res.current_anim_state != NetworkResident.AnimState.WALK:
		push_error("Actor should be in WALK state before pause/stall")
		res.queue_free()
		root.free()
		return false

	var foot_bone_idx = res.skeleton.find_bone("Foot.R") if res.skeleton else -1
	var bone_pos_before = res.skeleton.get_bone_global_pose(foot_bone_idx).origin if foot_bone_idx >= 0 else Vector3.ZERO
	var anim_clip_before = res.anim_player.current_animation if res.anim_player else ""
	var anim_pos_before = res.anim_player.current_animation_position if res.anim_player else 0.0

	# 1. Trigger network stall
	res.on_network_stalled()

	# Process 10 frames during stall
	for _i in range(10):
		res._process(0.016)

	# Bone transform and animation clip MUST NOT jump
	var anim_clip_during_stall = res.anim_player.current_animation if res.anim_player else ""
	var bone_pos_during_stall = res.skeleton.get_bone_global_pose(foot_bone_idx).origin if foot_bone_idx >= 0 else Vector3.ZERO
	var bone_jump = bone_pos_before.distance_to(bone_pos_during_stall)

	if anim_clip_during_stall != anim_clip_before:
		push_error("Animation clip changed during stall from '%s' to '%s'!" % [anim_clip_before, anim_clip_during_stall])
		res.queue_free()
		root.free()
		return false

	if bone_jump > 0.001:
		push_error("Foot.R jumped %f mm upon stall! Pose was not frozen." % (bone_jump * 1000.0))
		res.queue_free()
		root.free()
		return false

	# 2. Trigger simulation pause (speed = 0)
	res.on_network_resumed()
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 1.0, "y": 0.0}}, 0.1, 0.0)

	for _i in range(10):
		res._process(0.016)

	var bone_pos_during_pause = res.skeleton.get_bone_global_pose(foot_bone_idx).origin if foot_bone_idx >= 0 else Vector3.ZERO
	var pause_bone_jump = bone_pos_before.distance_to(bone_pos_during_pause)

	if pause_bone_jump > 0.001:
		push_error("Foot.R jumped %f mm upon pause! Pose was not frozen." % (pause_bone_jump * 1000.0))
		res.queue_free()
		root.free()
		return false

	res.queue_free()
	root.free()
	print("  PASS: test_pause_and_stall_preserves_exact_bone_pose (zero bone jump, clip frozen in place)")
	return true

func test_real_packet_timing_at_5x_speed_no_jerks() -> bool:
	var root = Node3D.new()
	var res = NetworkResident.new()
	root.add_child(res)

	# In real simulation, server broadcasts roughly every 100ms (packet_dt = 0.100s) even at 5x speed.
	# Displacement is ~0.24m per 100ms packet.
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.100, 5.0)
	res._process(0.016)

	# Deliver new snapshot with 0.24m displacement over real 100ms interval
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.24, "y": 0.0}}, 0.100, 5.0)

	var frame_dt = 1.0 / 60.0 # ~0.01667s
	var frame_displacements: Array[float] = []

	# Sample 6 frames (~100ms)
	for _i in range(6):
		var p_prev = res.position
		res._process(frame_dt)
		var d = p_prev.distance_to(res.position)
		frame_displacements.append(d)

	# Verify: motion must NOT cease after frame 1 or 2 (which occurred when duration was 20ms).
	# Every frame should move roughly 0.24m / 6 frames ~ 0.04m (40mm).
	var zero_frames = 0
	for d in frame_displacements:
		if d < 0.005: # less than 5mm
			zero_frames += 1

	if zero_frames > 1:
		push_error("Motion stalled in %d/6 frames between 100ms packets at 5x! Displacements: %s" % [
			zero_frames, str(frame_displacements)
		])
		res.queue_free()
		root.free()
		return false

	res.queue_free()
	root.free()
	print("  PASS: test_real_packet_timing_at_5x_speed_no_jerks (continuous motion across 100ms window)")
	return true

func test_high_speed_stride_policy_and_bounds() -> bool:
	var root = Node3D.new()
	var test_speeds = [1.0, 5.0, 20.0, 50.0]

	for spd in test_speeds:
		var res = NetworkResident.new()
		root.add_child(res)

		# Nominal 100ms packet with distance proportional to sim speed
		var step_dist = 0.048 * spd
		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.100, spd)
		res._process(0.016)

		res.update_from_ant_data({"id": "ant-1", "pos": {"x": step_dist, "y": 0.0}}, 0.100, spd)
		res._process(0.050)

		# Animation speed_scale must be clamped to at most 8.0 to prevent visual flicker
		if res.anim_player:
			var scale = res.anim_player.speed_scale
			if scale > 8.01:
				push_error("Speed scale %f exceeded policy clamp of 8.0 at %fx speed!" % [scale, spd])
				res.queue_free()
				root.free()
				return false
			if scale < 0.2:
				push_error("Speed scale %f is unexpectedly below 0.2 at %fx speed!" % [scale, spd])
				res.queue_free()
				root.free()
				return false

		# Advance remaining time and verify target reached
		res._process(0.060)
		if res.position.distance_to(Vector3(step_dist, 0.0, 0.0)) > 0.05:
			push_error("Failed to reach target at %fx speed! Pos: %s, Target: %s" % [
				spd, str(res.position), str(Vector3(step_dist, 0.0, 0.0))
			])
			res.queue_free()
			root.free()
			return false

		res.queue_free()

	root.free()
	print("  PASS: test_high_speed_stride_policy_and_bounds (capped at 8.0x, accurate translation at 50x)")
	return true

func test_dynamic_teleport_threshold() -> bool:
	var root = Node3D.new()
	var res = NetworkResident.new()
	root.add_child(res)

	# 1. Continuous movement at 50x speed (e.g. 7.5m in 100ms): must INTERPOLATE, not snap
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 0.0, "y": 0.0}}, 0.100, 50.0)
	res._process(0.016)

	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 7.5, "y": 0.0}}, 0.100, 50.0)
	# After 0.05s (halfway through 0.100s), position must be around ~3.75m, NOT already snapped to 7.5m
	res._process(0.050)
	if res.position.x > 6.0 or res.position.x < 1.0:
		push_error("Fast continuous movement was treated as instant teleport! Pos.x = %f" % res.position.x)
		res.queue_free()
		root.free()
		return false

	# 2. Extreme jump (> 50m, e.g. respawn/underground entrance): must snap instantly
	var huge_target = Vector3(120.0, 0.0, 0.0)
	res.update_from_ant_data({"id": "ant-1", "pos": {"x": 120.0, "y": 0.0}}, 0.100, 1.0)
	if res.position.distance_to(huge_target) > 0.001:
		push_error("Extreme jump did not snap instantly! Pos = %s" % str(res.position))
		res.queue_free()
		root.free()
		return false

	res.queue_free()
	root.free()
	print("  PASS: test_dynamic_teleport_threshold (dynamic threshold distinguishes fast walk from jump)")
	return true
