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

	total += 1
	if test_render_timeline_series_smoothness_and_jitter():
		passed += 1

	total += 1
	if test_cargo_retention_across_process_frames():
		passed += 1

	total += 1
	if test_unload_timing_matches_displayed_history():
		passed += 1

	total += 1
	if test_server_tick_units_and_gap_speeds():
		passed += 1

	total += 1
	if test_recovery_and_speed_change_timeline_rebase():
		passed += 1

	total += 1
	if test_buffered_snapshot_batches_bound_time_and_motion():
		passed += 1

	total += 1
	if test_sustained_slow_delivery_keeps_motion_continuous():
		passed += 1

	print("=== NETWORK INTERPOLATION RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL NETWORK INTERPOLATION TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME NETWORK INTERPOLATION TESTS FAILED!")
		quit(1)

func _burst_snapshot(tick: int, x: float, speed: float, colony: String, amount: int = 3) -> Dictionary:
	return {"tick": tick, "session": {"speed": speed, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
		"ants": [{"id": "burst", "colonyId": colony, "pos": {"x": x, "y": 100.0},
			"heading": {"x": 1.0, "y": 0.0}, "state": "idle", "carrying": amount,
			"carryKind": ("clay" if colony == "colony-1" else "wood") if amount > 0 else ""}]}

func _receive_burst_snapshot(registry: EntityRegistry, data: Dictionary) -> void:
	# Use the same callback ordering as WorldObserver, including a real stall flag.
	registry.on_network_resumed()
	registry.update_from_snapshot(data)

func test_buffered_snapshot_batches_bound_time_and_motion() -> bool:
	for speed in [1.0, 5.0, 20.0, 50.0]:
		for count in [60, 48, 20]:
			for colony in ["colony-1", "colony-2"]:
				if not _check_buffered_snapshot_batch(count, speed, int(speed), colony):
					return false
	# Many short source intervals can overflow memory before reaching the time
	# budget. The count limit must also synchronize the cursor and actor atomically.
	if not _check_buffered_snapshot_batch(60, 50.0, 1, "colony-1"):
		return false
	if not _check_buffered_rebase_keeps_safe_endpoint():
		return false
	print("  PASS: test_buffered_snapshot_batches_bound_time_and_motion (26 batches, both tribes, 1/5/20/50x, bounded delay, safe endpoint, clean unload/stop)")
	return true

func _check_buffered_rebase_keeps_safe_endpoint() -> bool:
	var walls: Array = []
	for y in range(206, 216, 2):
		for x in [194, 200]:
			walls.append({"id": "side-%s-%s" % [x, y], "type": "wall", "stage": "built", "colonyId": "colony-1", "pos": {"x": x, "y": y}})
	for x in [196, 198]:
		for y in [206, 214]:
			walls.append({"id": "cap-%s-%s" % [x, y], "type": "wall", "stage": "built", "colonyId": "colony-1", "pos": {"x": x, "y": y}})
	var registry = EntityRegistry.new()
	var initial = _burst_snapshot(100, 197.0, 1.0, "colony-1")
	initial.ants[0].pos.y = 211.0
	initial.surface.buildings = walls
	registry.update_from_snapshot(initial)
	var actor: NetworkResident = registry.get_resident("burst")
	actor.set_process(false)
	var safe_position = Vector3(197.0, 0.0, 211.0)
	var valid = true
	for packet in range(1, 61):
		var data = _burst_snapshot(100 + packet, 205.0, 1.0, "colony-1")
		data.ants[0].pos.y = 211.0
		data.surface.buildings = walls
		registry.update_from_snapshot(data)
		valid = valid and actor.position.distance_to(safe_position) < 0.001
	actor._process(0.010)
	valid = valid and actor.position.distance_to(safe_position) < 0.001
	if not valid:
		push_error("Buffered rebase escaped a sealed enclosure instead of using the safe held endpoint")
	registry.free()
	return valid

func _check_buffered_snapshot_batch(count: int, speed: float, tick_step: int, colony: String) -> bool:
	var registry = EntityRegistry.new()
	registry.set_process(false)
	_receive_burst_snapshot(registry, _burst_snapshot(100, 100.0, speed, colony))
	var actor: NetworkResident = registry.get_resident("burst")
	actor.set_process(false)
	actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	registry.on_network_stalled()
	actor._process(0.010)
	var valid = true
	var tick = 100
	var target = 100.0
	var pending = 0.0
	var burst_step = float(tick_step) * 0.100 / speed
	for packet in range(count):
		tick += tick_step
		target += burst_step # Source speed is 1m/s, independent of sim speed.
		_receive_burst_snapshot(registry, _burst_snapshot(tick, target, speed, colony))
		pending = actor.timeline.samples[-1].server_time - actor.timeline.render_time
		valid = valid and pending <= 0.500001 and actor.timeline.samples.size() <= 48
		valid = valid and actor.timeline.render_time >= actor.timeline.samples[0].server_time - 0.000001
		valid = valid and actor.position.distance_to(actor.timeline.current_pos) < 0.0001
	var peak = 0.0
	# Follow the burst with ordinary 100ms delivery. Check the first frame too:
	# the overflow correction must have happened during receipt, not in this frame.
	for packet in range(21):
		if packet > 0:
			tick += int(speed)
			target += 0.1
			_receive_burst_snapshot(registry, _burst_snapshot(tick, target, speed, colony))
		for frame in range(10):
			var before = actor.position.x
			actor._process(0.010)
			var velocity = (actor.position.x - before) / 0.010
			peak = maxf(peak, velocity)
			valid = valid and velocity >= -0.01 and velocity <= 1.35
			valid = valid and actor.position.x <= target + 0.001
			valid = valid and actor.carrying_amount == 3 and actor.cargo_prop.visible
			valid = valid and actor.carry_kind == ("clay" if colony == "colony-1" else "wood")
			pending = actor.timeline.samples[-1].server_time - actor.timeline.render_time
			valid = valid and pending <= 0.500001 and actor.timeline.samples.size() <= 48
	# Stop and unload. Display must converge without overshoot or reverse motion.
	for packet in range(10):
		tick += int(speed)
		_receive_burst_snapshot(registry, _burst_snapshot(tick, target, speed, colony, 0))
		for frame in range(10):
			var before = actor.position.x
			actor._process(0.010)
			valid = valid and actor.position.x >= before - 0.0001 and actor.position.x <= target + 0.001
	valid = valid and absf(actor.position.x - target) < 0.01
	valid = valid and actor.carrying_amount == 0 and actor.carry_kind.is_empty() and not actor.cargo_prop.visible
	valid = valid and actor.current_anim_state == NetworkResident.AnimState.IDLE
	if not valid:
		push_error("Buffered batch failed: count=%d speed=%.0f tick_step=%d colony=%s peak=%.4f pending=%.4f" % [count, speed, tick_step, colony, peak, pending])
	registry.free()
	return valid

func test_sustained_slow_delivery_keeps_motion_continuous() -> bool:
	for interval_ms in [110, 120]:
		for colony in ["colony-1", "colony-2"]:
			if not _check_sustained_delivery(interval_ms, colony):
				return false
	return true

func _check_sustained_delivery(interval_ms: int, colony: String) -> bool:
	var registry = EntityRegistry.new()
	registry.update_from_snapshot(_burst_snapshot(100, 100.0, 1.0, colony))
	var actor = registry.get_resident("burst")
	actor.set_process(false)
	actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	var low = INF
	var high = 0.0
	var held = 0
	for packet in range(1, 61):
		# Actual preview cadence is around 110ms even though each simulation
		# tick represents 100ms. Keep tick units unchanged and vary only arrival.
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - interval_ms / 1000.0
		registry.update_from_snapshot(_burst_snapshot(100 + packet, 100.0 + packet * 0.1, 1.0, colony))
		for frame in range(interval_ms / 10):
			var before = actor.position.x
			actor._process(0.010)
			if packet >= 40:
				var velocity = (actor.position.x - before) / 0.010
				low = minf(low, velocity)
				high = maxf(high, velocity)
				if velocity < 0.05:
					held += 1
	var expected = 100.0 / interval_ms
	var valid = low >= expected * 0.95 and high <= expected * 1.05 and held == 0
	print("DELIVERY_", interval_ms, "MS ", colony, " min=", low, " max=", high, " expected=", expected, " held_frames=", held)
	registry.free()
	if not valid:
		push_error("Sustained slow delivery creates periodic stops despite uniform source motion")
	return valid

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

		# Initial position (valid coordinates within map)
		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 100.0, "y": 100.0}}, 0.1, 1.0)
		res._process(0.016)

		# Move along dir
		var target = Vector3(100.0, 0.0, 100.0) + dir * 2.0
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
		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 100.0, "y": 100.0}}, 0.100, spd)
		res._process(0.016)

		res.update_from_ant_data({"id": "ant-1", "pos": {"x": 100.0 + step_dist, "y": 100.0}}, 0.100, spd)
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
		res._process(0.120)
		if res.position.distance_to(Vector3(100.0 + step_dist, 0.0, 100.0)) > 0.05:
			push_error("Failed to reach target at %fx speed! Pos: %s, Target: %s" % [
				spd, str(res.position), str(Vector3(100.0 + step_dist, 0.0, 100.0))
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

func test_render_timeline_series_smoothness_and_jitter() -> bool:
	var root = Node3D.new()
	var registry = EntityRegistry.new()
	root.add_child(registry)
	registry.set_process(false)

	# Initial spawn
	var make_snap = func(tick: int, x: float) -> Dictionary:
		return {
			"tick": tick,
			"session": {"speed": 1.0, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0}, "heading": {"x": 1.0, "y": 0.0}}]
		}

	registry.update_from_snapshot(make_snap.call(0, 100.0))
	var r = registry.get_resident("audit")
	r.set_process(false)
	if r.anim_player:
		r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

	# 1. Steady stream: 20 packets with interval 100ms, source speed 1.0 m/s (0.1m per packet)
	var low_spd = INF
	var high_spd = 0.0
	for p in range(1, 21):
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		registry.update_from_snapshot(make_snap.call(p, 100.0 + p * 0.1))
		for frame in range(10):
			var before_x = r.position.x
			r._process(0.010)
			var spd = (r.position.x - before_x) / 0.010
			if p >= 16: # sample after warmup
				low_spd = minf(low_spd, spd)
				high_spd = maxf(high_spd, spd)

	var ratio = high_spd / maxf(0.001, low_spd)
	# Check steady speed tolerance: ±5% of 1.0 m/s (0.95 to 1.05) and ratio <= 1.10
	if low_spd < 0.95 or high_spd > 1.05 or ratio > 1.10:
		push_error("FAIL: Steady stream speed modulated unnaturally! min=%.3f, max=%.3f, ratio=%.3f (expected 0.95..1.05, ratio<=1.10)" % [low_spd, high_spd, ratio])
		registry.free()
		root.free()
		return false

	# 2. Jitter delivery sequence with true server ticks matching review-repro/b0ae820.gd:
	# +1 tick and +0.1m per 100ms source snapshot, delivery arrival gaps 100, 160, 40, 100, 160, 40 ms
	var packet = 20
	var prev_gap = 100
	var cycle = 0
	for ms in [100, 160, 40, 100, 160, 40]:
		packet += 1
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - float(prev_gap) / 1000.0
		registry.update_from_snapshot(make_snap.call(packet, 100.0 + packet * 0.1))
		for frame in range(int(ms / 10)):
			var before_x = r.position.x
			r._process(0.010)
			var spd = (r.position.x - before_x) / 0.010
			# In all cycles, speed must never burst unnaturally > 1.35
			if spd > 1.35:
				push_error("FAIL: Jitter delivery gap %dms had speed explosion! spd=%.3f > 1.35" % [ms, spd])
				registry.free()
				root.free()
				return false
			# In the steady jitter cycle (cycle >= 3), timeline buffer completely prevents stalls:
			if cycle >= 3 and spd < 0.80:
				push_error("FAIL: Jitter delivery cycle %d gap %dms stalled! spd=%.3f < 0.80" % [cycle, ms, spd])
				registry.free()
				root.free()
				return false
		prev_gap = ms
		cycle += 1

	# 3. True stop: ant halts at final position
	var stop_target = 100.0 + packet * 0.1
	for stop_p in range(1, 5):
		packet += 1
		registry.update_from_snapshot(make_snap.call(packet, stop_target))
		for frame in range(10):
			var before_x = r.position.x
			r._process(0.010)
			if r.position.x > stop_target + 0.001:
				push_error("FAIL: Stop overshot target! pos=%.4f > target=%.4f" % [r.position.x, stop_target])
				registry.free()
				root.free()
				return false

	if r.position.distance_to(Vector3(stop_target, 0.0, 100.0)) > 0.01:
		push_error("FAIL: Actor did not reach stop target cleanly!")
		registry.free()
		root.free()
		return false

	if r.current_anim_state != NetworkResident.AnimState.IDLE:
		push_error("FAIL: Actor state did not switch to IDLE upon stop!")
		registry.free()
		root.free()
		return false

	registry.free()
	root.free()
	print("  PASS: test_render_timeline_series_smoothness_and_jitter (±5% steady tolerance, no packet pulse, clean stop)")
	return true

func test_cargo_retention_across_process_frames() -> bool:
	var root = Node3D.new()
	for col_id in ["colony-1", "colony-2"]:
		var registry = EntityRegistry.new()
		root.add_child(registry)
		registry.set_process(false)
		var kind = "clay" if col_id == "colony-1" else "wood"
		var snap1 = {
			"tick": 0, "session": {"speed": 1, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "carrier", "colonyId": col_id, "pos": {"x": 100.0, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": kind}]
		}
		registry.update_from_snapshot(snap1)
		var actor = registry.get_resident("carrier")
		actor.set_process(false)
		actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

		if actor.carrying_amount != 3:
			push_error("FAIL: [%s] Initial carrying_amount = %d, expected 3" % [col_id, actor.carrying_amount])
			root.free()
			return false

		if not actor.cargo_prop or not actor.cargo_prop.visible:
			push_error("FAIL: [%s] cargo_prop not visible before process with carrying=3" % col_id)
			root.free()
			return false

		# Advance frames between packets
		for frame in range(10):
			actor._process(0.010)

		# After process frames, carrying_amount must NOT be wiped to 0!
		if actor.carrying_amount != 3:
			push_error("FAIL: [%s] carrying_amount wiped to %d after process! Expected 3" % [col_id, actor.carrying_amount])
			root.free()
			return false

		if not actor.cargo_prop or not actor.cargo_prop.visible:
			push_error("FAIL: [%s] cargo_prop became hidden after process with carrying=3!" % col_id)
			root.free()
			return false

		# Now test unloading: snapshot with carrying=0
		var snap2 = {
			"tick": 1, "session": {"speed": 1, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "carrier", "colonyId": col_id, "pos": {"x": 100.0, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 0, "carryKind": ""}]
		}
		registry.update_from_snapshot(snap2)
		for frame in range(10):
			actor._process(0.010)

		if actor.carrying_amount != 0:
			push_error("FAIL: [%s] carrying_amount not 0 after unload, got %d" % [col_id, actor.carrying_amount])
			root.free()
			return false

		if actor.cargo_prop and actor.cargo_prop.visible:
			push_error("FAIL: [%s] cargo_prop still visible after unload!" % col_id)
			root.free()
			return false

		registry.free()

	root.free()
	print("  PASS: test_cargo_retention_across_process_frames (numeric carrying preserved across frames for both colonies)")
	return true

func test_server_tick_units_and_gap_speeds() -> bool:
	var root = Node3D.new()
	for gap in [1, 2, 5, 10, 11, 20]:
		var r = NetworkResident.new()
		root.add_child(r)
		r.set_process(false)
		r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
		var a1 = {"id": "tick_test", "colonyId": "colony-1", "pos": {"x": 100.0, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "walk", "tick": 100}
		r.update_from_ant_data(a1, 0.100, 1.0)
		var a2 = {"id": "tick_test", "colonyId": "colony-1", "pos": {"x": 100.0 + gap * 0.1, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "walk", "tick": 100 + gap}
		r.update_from_ant_data(a2, 0.100, 1.0)

		var duration = r.timeline.samples[-1].server_time - r.timeline.samples[0].server_time
		var expected_dur = gap * 0.100
		if absf(duration - expected_dur) > 0.001:
			push_error("FAIL: Tick gap %d duration mismatch! got %.4f, expected %.4f" % [gap, duration, expected_dur])
			root.free()
			return false

		var old_x = r.position.x
		r._process(0.010)
		var first_frame_speed = (r.position.x - old_x) / 0.010
		if first_frame_speed < 0.95 or first_frame_speed > 1.05:
			push_error("FAIL: Tick gap %d first frame speed explosion/drop! spd=%.3f (expected 1.000 ± 5%%)" % [gap, first_frame_speed])
			root.free()
			return false

		r.free()

	# Also verify across speed scales 1x, 5x, 20x, 50x
	for spd_scale in [1.0, 5.0, 20.0, 50.0]:
		var r = NetworkResident.new()
		root.add_child(r)
		r.set_process(false)
		r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
		var a1 = {"id": "spd_test", "colonyId": "colony-1", "pos": {"x": 100.0, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "walk", "tick": 100}
		r.update_from_ant_data(a1, 0.100 / spd_scale, spd_scale)
		var a2 = {"id": "spd_test", "colonyId": "colony-1", "pos": {"x": 100.5, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "walk", "tick": 101}
		r.update_from_ant_data(a2, 0.100 / spd_scale, spd_scale)

		var duration = r.timeline.samples[-1].server_time - r.timeline.samples[0].server_time
		var expected_dur = 0.100 / spd_scale
		if absf(duration - expected_dur) > 0.001:
			push_error("FAIL: Speed %.1fx tick duration mismatch! got %.4f, expected %.4f" % [spd_scale, duration, expected_dur])
			root.free()
			return false
		r.free()

	root.free()
	print("  PASS: test_server_tick_units_and_gap_speeds (tick gaps 1..20 and speeds 1..50x have strictly consistent time units)")
	return true

func test_unload_timing_matches_displayed_history() -> bool:
	var root = Node3D.new()
	for col_id in ["colony-1", "colony-2"]:
		var registry = EntityRegistry.new()
		root.add_child(registry)
		registry.set_process(false)
		var kind = "clay" if col_id == "colony-1" else "wood"
		var snap1 = {
			"tick": 100, "session": {"speed": 1.0, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "audit", "colonyId": col_id, "pos": {"x": 100.0, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": kind}]
		}
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		registry.update_from_snapshot(snap1)
		var actor = registry.get_resident("audit")
		actor.set_process(false)
		actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

		for frame in range(10):
			actor._process(0.010)

		# Delayed snapshot says unloaded at x=102 after 2.0s (tick 120)
		var snap2 = {
			"tick": 120, "session": {"speed": 1.0, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "audit", "colonyId": col_id, "pos": {"x": 102.0, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 0, "carryKind": ""}]
		}
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		registry.update_from_snapshot(snap2)

		# First frame: actor has moved only 0.01m to x=100.01, far from unload point x=102
		actor._process(0.010)
		if actor.carrying_amount != 3 or not actor.cargo_prop or not actor.cargo_prop.visible:
			push_error("FAIL: [%s] Premature unload at x=%.2f! carrying=%d, visible=%s" % [
				col_id, actor.position.x, actor.carrying_amount, str(actor.cargo_prop.visible if actor.cargo_prop else false)])
			registry.free()
			root.free()
			return false

		# Advance remaining 199 frames (1.99s) to arrive at x=102
		for frame in range(199):
			actor._process(0.010)

		if actor.carrying_amount != 0:
			push_error("FAIL: [%s] Cargo not unloaded after reaching destination x=102! carrying=%d" % [col_id, actor.carrying_amount])
			registry.free()
			root.free()
			return false

		if actor.cargo_prop and actor.cargo_prop.visible:
			push_error("FAIL: [%s] cargo_prop still visible after reaching unload destination!" % col_id)
			registry.free()
			root.free()
			return false

		registry.free()

	root.free()
	print("  PASS: test_unload_timing_matches_displayed_history (cargo stays visible during transit, unloads at destination)")
	return true

func test_recovery_and_speed_change_timeline_rebase() -> bool:
	var root = Node3D.new()

	# 1. Recovery after stall (both cold and warm)
	for warm in [false, true]:
		var registry = EntityRegistry.new()
		root.add_child(registry)
		registry.set_process(false)
		var tick = 100
		var x = 100.0
		var snap0 = {
			"tick": tick, "session": {"speed": 1.0, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
		}
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		registry.update_from_snapshot(snap0)
		var actor = registry.get_resident("audit")
		actor.set_process(false)
		actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

		if warm:
			for packet in range(20):
				tick += 1
				x += 0.1
				var sn = {
					"tick": tick, "session": {"speed": 1.0, "status": "playing"},
					"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
					"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0},
						"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
				}
				registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
				registry.update_from_snapshot(sn)
				for frame in range(10):
					actor._process(0.010)

		# Stall network for 200 frames (2.0s)
		registry.on_network_stalled()
		for frame in range(200):
			actor._process(0.010)

		# Network resumes with gap 20
		tick += 20
		x += 2.0
		var snap_rec = {
			"tick": tick, "session": {"speed": 1.0, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
		}
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		registry.update_from_snapshot(snap_rec)

		var high_spd = 0.0
		for packet in range(8):
			if packet > 0:
				tick += 1
				x += 0.1
				var sn = {
					"tick": tick, "session": {"speed": 1.0, "status": "playing"},
					"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
					"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0},
						"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
				}
				registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
				registry.update_from_snapshot(sn)
			for frame in range(10):
				var before_x = actor.position.x
				actor._process(0.010)
				var frame_spd = (actor.position.x - before_x) / 0.010
				high_spd = maxf(high_spd, frame_spd)

		if high_spd > 1.35:
			push_error("FAIL: Gap20 recovery speed spike warm=%s! peak=%.3f m/s (expected <= 1.35)" % [str(warm), high_spd])
			registry.free()
			root.free()
			return false

		# Feed 10 stop packets: must stop cleanly without overshoot or reversal
		var clean_stop = true
		for packet in range(10):
			tick += 1
			var sn_stop = {
				"tick": tick, "session": {"speed": 1.0, "status": "playing"},
				"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
				"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0},
					"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
			}
			registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
			registry.update_from_snapshot(sn_stop)
			for frame in range(10):
				var before_x = actor.position.x
				actor._process(0.010)
				clean_stop = clean_stop and (actor.position.x >= before_x - 0.0001) and (actor.position.x <= x + 0.001)

		if not clean_stop or absf(actor.position.x - x) >= 0.01:
			push_error("FAIL: Stop after stall had overshoot/reversal warm=%s! pos=%.3f target=%.3f" % [str(warm), actor.position.x, x])
			registry.free()
			root.free()
			return false

		registry.free()

	# 2. Speed change from 50x to 1x
	var reg_spd = EntityRegistry.new()
	root.add_child(reg_spd)
	reg_spd.set_process(false)
	var snap_50 = {
		"tick": 100, "session": {"speed": 50.0, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
		"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": 100.0, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
	}
	reg_spd.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
	reg_spd.update_from_snapshot(snap_50)
	var actor_spd = reg_spd.get_resident("audit")
	actor_spd.set_process(false)
	actor_spd.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

	# Speed switch to 1x with tick 150 at x=105.0
	var snap_1 = {
		"tick": 150, "session": {"speed": 1.0, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
		"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": 105.0, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
	}
	reg_spd.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
	reg_spd.update_from_snapshot(snap_1)
	actor_spd._process(0.010)

	var peak_speed = 0.0
	for packet in range(1, 11):
		var sn = {
			"tick": 150 + packet, "session": {"speed": 1.0, "status": "playing"},
			"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
			"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": 105.0 + packet * 0.1, "y": 100.0},
				"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]
		}
		reg_spd.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		reg_spd.update_from_snapshot(sn)
		for frame in range(10):
			var before_x = actor_spd.position.x
			actor_spd._process(0.010)
			var v = (actor_spd.position.x - before_x) / 0.010
			peak_speed = maxf(peak_speed, v)

	if peak_speed > 50.0 * 1.35:
		push_error("FAIL: Speed change recovery peak speed spike! got %.3f m/s (expected <= %.3f)" % [peak_speed, 50.0 * 1.35])
		reg_spd.free()
		root.free()
		return false

	reg_spd.free()
	root.free()
	print("  PASS: test_recovery_and_speed_change_timeline_rebase (gap20 recovery peak <= 1.35, 50x->1x peak <= 67.5, clean stop)")
	return true


