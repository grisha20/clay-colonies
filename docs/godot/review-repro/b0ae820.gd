extends SceneTree

# Read-only diagnostic: production actors, no network or save files.
# Numeric output is evidence, not an assertion-based acceptance runner.
func _initialize() -> void:
	call_deferred("audit")

func snap(tick: int, x: float, carrying: int = 0) -> Dictionary:
	return {"tick": tick, "session": {"speed": 1, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
		"ants": [{"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": 100},
			"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": carrying, "carryKind": "clay"}]}

func audit() -> void:
	var registry = EntityRegistry.new()
	root.add_child(registry)
	registry.update_from_snapshot(snap(0, 100, 3))
	var actor = registry.get_resident("audit")
	actor.set_process(false)
	actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	print("B0_CARGO_BEFORE_PROCESS amount=", actor.carrying_amount, " visible=", actor.cargo_prop.visible)
	actor._process(0.01)
	print("B0_CARGO_AFTER_PROCESS amount=", actor.carrying_amount, " visible=", actor.cargo_prop.visible)
	var carry_snap = snap(1, 100, 3)
	carry_snap.ants[0]["state"] = "carry"
	registry.update_from_snapshot(carry_snap)
	actor._process(0.01)
	print("B0_CARGO_CARRY_STATE amount=", actor.carrying_amount, " visible=", actor.cargo_prop.visible)
	# Reset the registry before the independent uniform motion sequence.
	registry.clear_all()
	registry.update_from_snapshot(snap(0, 100))
	actor = registry.get_resident("audit")
	actor.set_process(false)
	actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

	# Genuine server tick semantics: one tick = 100ms simulation time.
	# Uniform source snapshots remain uniform when delivery is delayed then caught up.
	for p in range(1, 21):
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
		registry.update_from_snapshot(snap(p, 100.0 + p * 0.1))
		for frame in range(10):
			actor._process(0.01)
	var packet = 20
	var prev_gap = 100
	for gap in [100, 160, 40, 100, 160, 40]:
		packet += 1
		registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - float(prev_gap) / 1000.0
		registry.update_from_snapshot(snap(packet, 100.0 + packet * 0.1))
		var speeds: Array = []
		for frame in range(int(gap / 10)):
			var old_x = actor.position.x
			actor._process(0.01)
			speeds.append(snapped((actor.position.x - old_x) / 0.01, 0.001))
		print("B0_REAL_TICK_JITTER tick=", packet, " next_gap_ms=", gap, " speeds=", JSON.stringify(speeds))
		prev_gap = gap
	registry.free()

	# Valid tick deltas must never switch units to milliseconds by magnitude.
	for tick_gap in [10, 11, 20]:
		var r = NetworkResident.new()
		root.add_child(r)
		r.set_process(false)
		var a = snap(100, 100).ants[0].duplicate(true)
		a["tick"] = 100
		r.update_from_ant_data(a, 0.100, 1.0)
		a["tick"] = 100 + tick_gap
		a["pos"]["x"] = 100.0 + tick_gap * 0.1
		r.update_from_ant_data(a, 0.100, 1.0)
		var duration = r.timeline.samples[-1].server_time - r.timeline.samples[0].server_time
		var old_x = r.position.x
		r._process(0.01)
		print("B0_TICK_GAP gap=", tick_gap, " timeline_seconds=", duration,
			" expected_source_seconds=", tick_gap * 0.1, " first_frame_speed=", (r.position.x - old_x) / 0.01)
		r.free()
	await process_frame
	quit(0)
