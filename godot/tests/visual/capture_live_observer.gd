extends SceneTree

## Live GPU review of the dressed world against an isolated QA server.
## Connects the production observer, measures frame pacing at 1x, runs the
## simulation at 5x so trails can wear in, then saves stills and a short frame
## sequence (for an MP4) of the camp. Never touches the user's save: pass the
## port of a server started with scripts/godot/qa_server.py.
##   godot --path godot --script res://tests/visual/capture_live_observer.gd -- --qa-port 8791 --out <dir>

var scene: WorldObserver
var out_dir := "user://live_capture"

func _initialize() -> void:
	call_deferred("run")

func wait_seconds(sec: float) -> void:
	var until = Time.get_ticks_msec() + int(sec * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame

func shot(name: String) -> void:
	var img = root.get_viewport().get_texture().get_image()
	img.save_png(out_dir.path_join(name + ".png"))
	print("LIVE saved ", name)

func look(pos: Vector3, dist: float) -> void:
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = pos
	wv.target_camera_distance = dist
	wv.camera_distance = dist

func measure(label: String, sec: float) -> void:
	var deltas: Array[float] = []
	var last = Time.get_ticks_usec()
	var until = Time.get_ticks_msec() + int(sec * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame
		var now = Time.get_ticks_usec()
		deltas.append(float(now - last) / 1000.0)
		last = now
	deltas.sort()
	var n = deltas.size()
	var avg = 0.0
	for d in deltas:
		avg += d
	avg /= maxf(1.0, n)
	var over33 = deltas.filter(func(d): return d > 33.4).size()
	print("LIVE_FRAMES %s frames=%d avg_ms=%.2f p95_ms=%.2f p99_ms=%.2f max_ms=%.2f over33=%d" % [label, n, avg, deltas[int(n * 0.95)], deltas[int(n * 0.99)], deltas[n - 1], over33])

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	var wear_seconds = 90.0
	var demo = false
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out_dir = args[i + 1]
		elif args[i] == "--wear-seconds" and i + 1 < args.size():
			wear_seconds = float(args[i + 1])
		elif args[i] == "--demo":
			demo = true
	if port == "":
		push_error("--qa-port of an isolated QA server is required")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(out_dir)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.server_line_edit.text = "ws://127.0.0.1:" + port
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var start = Time.get_ticks_msec()
	while scene.ws_client.packets_received < 5 or scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() - start > 15000:
			push_error("No snapshots from QA server")
			quit(1)
			return
		await process_frame
	var camp_a = scene.world_view.colony_focus_points[0]
	if demo:
		# Short presentation clip for --write-movie: camp overview, slow glide in, follow a carrier.
		look(camp_a + Vector3(0, 0, 6), 30.0)
		await wait_seconds(2.0)
		scene.world_view.target_camera_distance = 16.0
		await wait_seconds(4.0)
		var carrier: NetworkResident = null
		for r in scene.entity_registry.residents.values():
			if r.carrying_amount > 0:
				carrier = r
				break
		if carrier:
			scene.world_view.focus_on_resident(carrier)
			scene.world_view.camera_distance = 16.0
			scene.world_view.target_camera_distance = 10.0
		await wait_seconds(8.0)
		quit(0)
		return
	look(camp_a, 24.0)
	await measure("connect_and_decor_build", 3.0)
	await measure("steady_1x_camp", 15.0)
	shot("live_01_camp_start")
	scene.ws_client.send_command({"type": "setSpeed", "value": 5})
	look(Vector3(240, 0, 240), 80.0)
	await measure("overview_5x", 10.0)
	await wait_seconds(maxf(0.0, wear_seconds - 10.0))
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	await wait_seconds(1.5)
	look(camp_a, 24.0)
	await wait_seconds(1.5)
	shot("live_02_camp_after_wear")
	look(camp_a, 46.0)
	await wait_seconds(1.5)
	shot("live_03_camp_wide_trails")
	look(scene.world_view.colony_focus_points[1], 24.0)
	await wait_seconds(1.5)
	shot("live_04_camp_b")
	# Follow a carrier for a short frame sequence.
	var target: NetworkResident = null
	for r in scene.entity_registry.residents.values():
		if r.carrying_amount > 0:
			target = r
			break
	if target == null and not scene.entity_registry.residents.is_empty():
		target = scene.entity_registry.residents.values()[0]
	scene.world_view.focus_on_resident(target)
	scene.world_view.target_camera_distance = 11.0
	await wait_seconds(1.0)
	var frames_dir = out_dir.path_join("frames")
	DirAccess.make_dir_recursive_absolute(frames_dir)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED)
	var frame = 0
	var next_at = Time.get_ticks_msec()
	var end_at = next_at + 8000
	while Time.get_ticks_msec() < end_at:
		await process_frame
		if Time.get_ticks_msec() >= next_at:
			var img = root.get_viewport().get_texture().get_image()
			img.resize(960, 540, Image.INTERPOLATE_BILINEAR)
			img.save_png(frames_dir.path_join("f_%04d.png" % frame))
			frame += 1
			next_at += 33
	print("LIVE frames_saved=", frame)
	shot("live_05_follow")
	scene.ws_client.disconnect_from_server()
	await wait_seconds(0.3)
	quit(0)
