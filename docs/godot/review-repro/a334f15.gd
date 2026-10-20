extends SceneTree

# Read-only review: production registry/actors, no network or save files.
# Reproduce observer's on_network_resumed -> update_from_snapshot order when
# WSClient drains buffered packets before the next actor frame.
# Exit 1 on an ordinary movement spike; explicit snapshot-boundary reset is allowed.
var failures: int = 0

func _initialize() -> void:
	call_deferred("audit")

func snap(tick: int, x: float) -> Dictionary:
	return {"tick": tick, "session": {"speed": 1.0, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
		"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100.0},
			"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": 3, "carryKind": "clay"}]}

func receive(registry: EntityRegistry, data: Dictionary) -> void:
	# Matches world_observer._on_snapshot_received for resident presentation.
	registry.on_network_resumed()
	registry.update_from_snapshot(data)

func audit() -> void:
	for count in [20, 48, 60]:
		var registry = EntityRegistry.new()
		root.add_child(registry)
		registry.set_process(false)
		receive(registry, snap(100, 100.0))
		var actor = registry.get_resident("audit")
		actor.set_process(false)
		actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
		registry.on_network_stalled()
		actor._process(0.010)

		# Genuine consecutive source ticks, one snapshot per 100ms at 1m/s.
		# All arrive in one batch after buffering. No frames between receives.
		for packet in range(1, count + 1):
			receive(registry, snap(100 + packet, 100.0 + packet * 0.1))
		var before_x = actor.position.x
		var first_sample_time = actor.timeline.samples[0].server_time
		var cursor_before = actor.timeline.render_time
		var duration = actor.timeline.samples[-1].server_time - cursor_before
		actor._process(0.010)
		var step = actor.position.x - before_x
		var peak = step / 0.010
		print("A334_BURST packets=", count, " samples=", actor.timeline.samples.size(),
			" first_sample_time=", first_sample_time, " cursor_before=", cursor_before,
			" pending_seconds=", duration, " before_x=", before_x, " after_x=", actor.position.x,
			" first_frame_step_m=", step, " first_frame_mps=", peak,
			" animation_scale=", actor.anim_player.speed_scale)
		var bounded = actor.timeline.samples.size() <= 48
		var smooth = peak >= -0.01 and peak <= 1.35
		var target = 100.0 + count * 0.1
		# Keep delivering current snapshots. The same source remains
		# at 1m/s; deferred sample pruning must not create a later spike either.
		for packet in range(1, 21):
			receive(registry, snap(100 + count + packet, target + packet * 0.1))
			for frame in range(10):
				var prev = actor.position.x
				actor._process(0.010)
				var velocity = (actor.position.x - prev) / 0.010
				peak = maxf(peak, velocity)
				smooth = smooth and velocity >= -0.01 and velocity <= 1.35
				bounded = bounded and actor.timeline.samples.size() <= 48
		var lag = actor.timeline.samples[-1].server_time - actor.timeline.render_time
		print("A334_BURST_CONTINUATION packets=", count, " peak_mps=", peak,
			" pending_after_2s=", lag, " memory_bounded=", bounded, " smooth=", smooth)
		if not bounded or not smooth:
			failures += 1
		registry.free()
	print("A334_FAILED_CASES=", failures)
	await process_frame
	quit(1 if failures > 0 else 0)
