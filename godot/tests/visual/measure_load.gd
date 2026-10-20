extends SceneTree

## Feeds a QA fixture to the production observer at 10 Hz with the project's
## normal frame pacing (no vsync override) and reports the frame rate, so GPU/CPU
## load of an idle-but-live client can be sampled externally (nvidia-smi).
##   godot --path godot --script res://tests/visual/measure_load.gd -- --fixture <json> --seconds 20

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var args = OS.get_cmdline_user_args()
	var fixture_path = ""
	var seconds = 20.0
	for i in range(args.size()):
		if args[i] == "--fixture" and i + 1 < args.size():
			fixture_path = args[i + 1]
		elif args[i] == "--seconds" and i + 1 < args.size():
			seconds = float(args[i + 1])
	var snapshot = JSON.parse_string(FileAccess.get_file_as_string(fixture_path))
	var scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	var start = Time.get_ticks_msec()
	var next_packet = start
	var frames = 0
	var last = Time.get_ticks_usec()
	var spikes = 0
	var worst = 0.0
	var slow_updates = 0
	while Time.get_ticks_msec() - start < int(seconds * 1000.0):
		if Time.get_ticks_msec() >= next_packet:
			snapshot["tick"] = int(snapshot.get("tick", 0)) + 1
			var t0 = Time.get_ticks_usec()
			scene._on_snapshot_received(snapshot)
			if Time.get_ticks_usec() - t0 > 8000:
				slow_updates += 1
			next_packet += 100
		await process_frame
		frames += 1
		var now = Time.get_ticks_usec()
		var dt = float(now - last) / 1000.0
		last = now
		if frames > 120:
			worst = maxf(worst, dt)
			if dt > 33.4:
				spikes += 1
	print("LOAD fps=%.1f max_fps_setting=%d vsync=%d worst_ms=%.1f over33=%d slow_snapshot_updates=%d" % [frames / seconds, Engine.max_fps, DisplayServer.window_get_vsync_mode(), worst, spikes, slow_updates])
	quit(0)
