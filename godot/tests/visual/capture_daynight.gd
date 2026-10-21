extends SceneTree

## Live day -> night on an isolated QA server at 20x: samples the smoothed
## darkness every half second (must rise without jumps), saves dusk and night
## frames and measures frame times while it happens.
##   godot --path godot --script res://tests/visual/capture_daynight.gd -- --server-port 8796 --out <dir>

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var port = ""
	var out = "user://daynight"
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out = args[i + 1]
	DirAccess.make_dir_recursive_absolute(out)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	while scene.entity_registry.residents.is_empty():
		await process_frame
	var wv = scene.world_view
	wv.focus_on_colony(0)
	wv.target_camera_distance = 30.0
	scene.ws_client.send_command({"type": "setSpeed", "value": 20})
	var atmo = wv.atmosphere
	var samples: Array[float] = []
	var max_jump = 0.0
	var saved_dusk = false
	var deltas: Array[float] = []
	var last = Time.get_ticks_usec()
	var next_sample = Time.get_ticks_msec()
	var until = Time.get_ticks_msec() + 60000
	while Time.get_ticks_msec() < until:
		await process_frame
		var now = Time.get_ticks_usec()
		deltas.append(float(now - last) / 1000.0)
		last = now
		if Time.get_ticks_msec() >= next_sample:
			next_sample += 500
			if not samples.is_empty():
				max_jump = maxf(max_jump, absf(atmo.darkness - samples[-1]))
			samples.append(atmo.darkness)
			if not saved_dusk and atmo.darkness > 0.4:
				saved_dusk = true
				root.get_viewport().get_texture().get_image().save_png(out.path_join("daynight_dusk.png"))
			if atmo.darkness > 0.99:
				break
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	for i in range(60):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(out.path_join("daynight_night.png"))
	deltas.sort()
	print("DAYNIGHT tick=", wv.atmosphere.snapshot_tick, " final_darkness=%.2f max_jump_per_0.5s=%.3f samples=%d" % [atmo.darkness, max_jump, samples.size()])
	print("DAYNIGHT frames avg=%.2f p99=%.2f max=%.2f" % [deltas.reduce(func(a, b): return a + b, 0.0) / deltas.size(), deltas[int(deltas.size() * 0.99)], deltas[-1]])
	scene.ws_client.disconnect_from_server()
	await process_frame
	quit(0)
