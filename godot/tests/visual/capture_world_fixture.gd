extends SceneTree

## GPU visual capture of the production observer scene fed with a saved QA
## fixture (no server, no user save). Renders fixed camera shots to PNG so world
## dressing can be reviewed and compared. Must run with a real renderer:
##   godot --path godot --script res://tests/visual/capture_world_fixture.gd -- --fixture <json> --out <dir>

const SHOTS = [
	["01_camp_a", Vector3(120, 0, 236), 26.0],
	["02_camp_a_close", Vector3(116, 0, 232), 12.0],
	["03_clay_quarry", Vector3(92, 0, 216), 22.0],
	["04_north_lake", Vector3(232, 0, 142), 46.0],
	["05_camp_b", Vector3(360, 0, 236), 26.0],
	["06_overview", Vector3(240, 0, 240), 80.0],
	["07_stone_quarry", Vector3(154, 0, 268), 20.0],
	["08_grove", Vector3(244, 0, 312), 18.0],
	["09_rocks_and_bushes", Vector3(312, 0, 410), 18.0],
	["10_storage", Vector3(120, 0, 250), 10.0],
	["11_camp_default_zoom", Vector3(120, 0, 240), 14.0],
	["12_bushes_close", Vector3(322, 0, 386), 9.0],
	["13_lake_monster", Vector3(260, 0, 120), 14.0],
]

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var args = OS.get_cmdline_user_args()
	var fixture_path = ""
	var out_dir = "user://captures"
	var hide_prefix = ""
	var organic = false
	for i in range(args.size()):
		if args[i] == "--fixture" and i + 1 < args.size():
			fixture_path = args[i + 1]
		elif args[i] == "--organic-lakes":
			organic = true
		elif args[i] == "--hide" and i + 1 < args.size():
			hide_prefix = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out_dir = args[i + 1]
	var text = FileAccess.get_file_as_string(fixture_path)
	var snapshot = JSON.parse_string(text)
	if typeof(snapshot) != TYPE_DICTIONARY:
		push_error("Cannot read fixture " + fixture_path)
		quit(1)
		return
	if organic:
		# Preview of generated-world water: replace the legacy lakes with organic ones.
		var lakes = []
		for spec in [["lake-a", 232.0, 140.0, 40.0, 26.0], ["lake-b", 240.0, 372.0, 46.0, 34.0], ["lake-c", 60.0, 420.0, 22.0, 16.0]]:
			var pts = []
			for i in range(40):
				var a = TAU * float(i) / 40.0
				var wob = 1.0 + 0.12 * sin(a * 3.0 + spec[1]) + 0.07 * sin(a * 5.0)
				pts.append({"x": spec[1] + cos(a) * spec[3] * wob, "y": spec[2] + sin(a) * spec[4] * wob})
			lakes.append({"id": spec[0], "seed": 1, "outline": pts})
		snapshot.surface["terrain"] = {"version": 1, "seed": 1, "lakes": lakes}
	DirAccess.make_dir_recursive_absolute(out_dir)
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	var started = Time.get_ticks_msec()
	scene._on_snapshot_received(snapshot)
	var first_ms = Time.get_ticks_msec() - started
	scene.world_view.ground_decor.build_all_now()
	print("CAPTURE first_snapshot_ms=", first_ms, " total_with_decor_ms=", Time.get_ticks_msec() - started, " decor_build_ms=", scene.world_view.ground_decor.last_build_msec, " decor_instances=", scene.world_view.ground_decor.instance_count, " props=", scene.world_view.active_world_nodes.size())
	# Advance a few ticks so residents settle into their poses.
	for t in range(12):
		snapshot["tick"] = int(snapshot.get("tick", 0)) + 1
		scene._on_snapshot_received(snapshot)
		for f in range(6):
			await process_frame
	var wv = scene.world_view
	if hide_prefix != "":
		for c in wv.ground_decor.get_children():
			if c.name.begins_with(hide_prefix):
				c.visible = false
	for shot in SHOTS:
		wv.focused_target = null
		wv.camera_navigated = true
		wv.camera_pivot.position = shot[1]
		wv.target_camera_distance = shot[2]
		wv.camera_distance = shot[2]
		for f in range(20):
			await process_frame
		var img = root.get_viewport().get_texture().get_image()
		var path = out_dir.path_join(shot[0] + ".png")
		img.save_png(path)
		print("CAPTURE saved ", path)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	var frames = 0
	var t0 = Time.get_ticks_usec()
	wv.camera_pivot.position = Vector3(120, 0, 236)
	wv.target_camera_distance = 26.0
	while frames < 240:
		await process_frame
		frames += 1
	var avg_ms = float(Time.get_ticks_usec() - t0) / 1000.0 / frames
	print("CAPTURE avg_frame_ms=%.2f over %d frames" % [avg_ms, frames])
	quit(0)
