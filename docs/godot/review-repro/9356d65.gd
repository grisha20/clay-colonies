extends SceneTree

# Independent review of 9356d65, using production registry/actors.
# No network, commands, save files or recording artifacts.
# Unlike older print probes, exit 1 means a failed requirement below.
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("audit")

func snap(tick: int, x: float, speed: float = 1.0, amount: int = 3, kind: String = "clay", colony: String = "colony-1") -> Dictionary:
	return {"tick": tick, "session": {"speed": speed, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [], "entrances": []},
		"ants": [{"id": "audit", "colonyId": colony, "pos": {"x": x, "y": 100},
			"heading": {"x": 1, "y": 0}, "state": "idle", "carrying": amount, "carryKind": kind}]}

func registry_at(tick: int = 100, x: float = 100.0, speed: float = 1.0, colony: String = "colony-1") -> EntityRegistry:
	var registry = EntityRegistry.new()
	root.add_child(registry)
	registry.set_process(false)
	deliver(registry, snap(tick, x, speed, 3, "clay", colony))
	var actor = registry.get_resident("audit")
	actor.set_process(false)
	actor.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	return registry

func deliver(registry: EntityRegistry, data: Dictionary) -> void:
	registry.last_snapshot_timestamp = Time.get_ticks_msec() / 1000.0 - 0.100
	registry.update_from_snapshot(data)

func check(condition: bool, label: String) -> void:
	print("REVIEW_9356 ", "PASS " if condition else "FAIL ", label)
	if not condition:
		failures.append(label)

func audit() -> void:
	# Preserve accepted steady pacing, now over a longer stream and actual tick
	# increments matching 100ms broadcasts at each constant simulation speed.
	for speed in [1.0, 5.0, 20.0, 50.0]:
		var registry = registry_at(100, 100.0, speed)
		var actor = registry.get_resident("audit")
		var low = INF
		var high = 0.0
		var max_samples = 0
		for packet in range(1, 201):
			deliver(registry, snap(100 + packet * int(speed), 100.0 + packet * 0.1, speed))
			max_samples = maxi(max_samples, actor.timeline.samples.size())
			for frame in range(10):
				var before = actor.position.x
				actor._process(0.010)
				if packet >= 16:
					var v = (actor.position.x - before) / 0.010
					low = minf(low, v)
					high = maxf(high, v)
		print("REVIEW_9356_STEADY speed=", speed, " min=", low, " max=", high, " samples_max=", max_samples)
		check(low >= 0.95 and high <= 1.05 and max_samples <= 48, "steady source 1m/s at %sx" % speed)
		registry.free()

	# Numeric cargo and resource identity must survive every frame for both tribes.
	for colony in ["colony-1", "colony-2"]:
		var registry = registry_at(100, 100.0, 1.0, colony)
		var actor = registry.get_resident("audit")
		var retained = true
		for frame in range(10):
			actor._process(0.010)
			retained = retained and actor.carrying_amount == 3 and actor.carry_kind == "clay" and actor.cargo_prop.visible
		check(retained, "numeric cargo and carryKind after frames " + colony)
		# Delayed snapshot says unloaded at x=102. Source history spans two seconds.
		# While rendering x=100.01, the resident has not reached that unload yet.
		deliver(registry, snap(120, 102.0, 1.0, 0, "", colony))
		actor._process(0.010)
		print("REVIEW_9356_UNLOAD colony=", colony, " render_x=", actor.position.x,
			" unload_x=102 amount=", actor.carrying_amount, " visible=", actor.cargo_prop.visible,
			" cursor=", actor.timeline.render_time, " source_head=", actor.timeline.samples[-1].server_time)
		check(actor.carrying_amount == 3 and actor.cargo_prop.visible, "unload follows displayed history " + colony)
		registry.free()

	# The first frame of a gap can pass while the next packets trigger a cursor
	# jump. Feed continuous source history after an ordinary two-second outage.
	for warm in [false, true]:
		var registry = registry_at()
		var actor = registry.get_resident("audit")
		var tick = 100
		var x = 100.0
		if warm:
			for packet in range(20):
				tick += 1
				x += 0.1
				deliver(registry, snap(tick, x))
				for frame in range(10):
					actor._process(0.010)
		registry.on_network_stalled()
		for frame in range(200):
			actor._process(0.010)
		tick += 20
		x += 2.0
		deliver(registry, snap(tick, x))
		var high = 0.0
		var largest_frame = 0.0
		var burst_packet = -1
		for packet in range(8):
			if packet > 0:
				tick += 1
				x += 0.1
				deliver(registry, snap(tick, x))
			for frame in range(10):
				var before = actor.position.x
				actor._process(0.010)
				var d = actor.position.x - before
				if d > largest_frame:
					largest_frame = d
					burst_packet = packet
				high = maxf(high, d / 0.010)
		print("REVIEW_9356_RECOVERY warm=", warm, " peak_mps=", high, " largest_frame_m=", largest_frame,
			" burst_packet=", burst_packet, " lag=", actor.timeline.samples[-1].server_time - actor.timeline.render_time)
		check(high <= 1.35, "gap20 recovery subsequent packets warm=" + str(warm))
		var clean_stop = true
		for packet in range(10):
			tick += 1
			deliver(registry, snap(tick, x))
			for frame in range(10):
				var before = actor.position.x
				actor._process(0.010)
				clean_stop = clean_stop and actor.position.x >= before - 0.0001 and actor.position.x <= x + 0.001
				clean_stop = clean_stop and actor.timeline.samples.size() <= 48
		check(clean_stop and absf(actor.position.x - x) < 0.01,
			"bounded history and final stop without overshoot/reversal warm=" + str(warm))
		registry.free()

	# A speed change can happen just before the next snapshot: the tick delta
	# mostly belongs to the OLD 50x epoch. Current speed alone cannot retime it.
	var registry = registry_at(100, 100.0, 50.0)
	var actor = registry.get_resident("audit")
	deliver(registry, snap(150, 105.0, 1.0))
	actor._process(0.010)
	var peak = 0.0
	var low = INF
	for packet in range(1, 11):
		deliver(registry, snap(150 + packet, 105.0 + packet * 0.1, 1.0))
		for frame in range(10):
			var before = actor.position.x
			actor._process(0.010)
			var v = (actor.position.x - before) / 0.010
			peak = maxf(peak, v)
			low = minf(low, v)
	print("REVIEW_9356_SPEED_CHANGE from=50 to=1 min_mps=", low, " peak_mps=", peak,
		" render_x=", actor.position.x, " target_x=106.0")
	# A buffered interval from the old 50x epoch may still render at 50m/s.
	# Allow that plus catch-up tolerance; 495m/s is neither epoch's motion.
	check(peak <= 50.0 * 1.35, "speed change recovery subsequent frames")
	registry.free()
	print("REVIEW_9356_FAILED_REQUIREMENTS=", failures.size())
	await process_frame
	quit(1 if not failures.is_empty() else 0)
