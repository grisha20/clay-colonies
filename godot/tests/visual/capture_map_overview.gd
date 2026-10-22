extends SceneTree

## Review shots of the whole map, a wild corner and open meadow at game height.
##   godot_console --path godot --script tests/visual/capture_map_overview.gd -- --qa-port <port>
var scene: WorldObserver
var out: String

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func shot(name: String, focus: Vector3, distance: float, angle: float) -> void:
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = focus
	wv.camera_angle_deg = angle
	wv.camera.rotation_degrees.x = -angle
	wv.target_camera_distance = distance
	wv.camera_distance = distance
	await frames(30)
	var decor = wv.ground_decor
	var deadline = Time.get_ticks_msec() + 8000
	while decor and not decor.is_settled() and Time.get_ticks_msec() < deadline:
		await process_frame
	await frames(10)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join(name + ".jpg"), .9)
	print("MAP_CAPTURE ", name)

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
	if port.is_empty():
		push_error("Require --qa-port <isolated port>")
		quit(2); return
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/map_life")
	DirAccess.make_dir_recursive_absolute(out)
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var deadline = Time.get_ticks_msec() + 15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() > deadline: quit(2); return
		await process_frame
	await frames(30)
	var camps = scene.world_view.colony_focus_points
	# Wild corners: the two corners without a camp.
	var a: Vector3 = camps[0]
	var corner = Vector3(72 if a.x > 240 else 408, 0, 72 if a.z < 240 else 408)
	await shot("overview", Vector3(240, 0, 240), 80., 60.)
	await shot("wild_corner", corner, 35., 52.)
	await shot("meadow_game", (camps[0] + camps[1]) * 0.5 + Vector3(30, 0, -20), 20., 52.)
	await shot("camp_game", camps[0], 22., 52.)
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(0)
