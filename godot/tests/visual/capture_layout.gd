extends SceneTree

## Review shot of the 2D-reference HUD layout with the mother speaking from
## her seat on the minimap.
##   godot_console --path godot --script tests/visual/capture_layout.gd -- --qa-port <port>
var scene: WorldObserver

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func run() -> void:
	var port = ""
	var output_override = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
		if args[i] == "--out-dir" and i + 1 < args.size(): output_override = args[i + 1]
	var out = ProjectSettings.globalize_path(output_override if output_override != "" else "res://../docs/godot/screenshots/hud_layout")
	DirAccess.make_dir_recursive_absolute(out)
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var deadline = Time.get_ticks_msec() + 15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() > deadline: quit(2); return
		await process_frame
	await frames(40)
	scene.mother_speaker.update_from_snapshot({"colonies": [{"colony": {"advice": [{"key": "clay", "severity": "warn", "text": "Глины нет — новых лепить не из чего", "pos": {"x": 100, "y": 100}}]}}]}, 0)
	scene.mother_speaker.update_from_snapshot({"colonies": [{"colony": {"advice": [{"key": "clay", "severity": "warn", "text": "Глины нет — новых лепить не из чего", "pos": {"x": 100, "y": 100}}, {"key": "huts", "severity": "warn", "text": "Хижин мало — жители спят под открытым небом", "pos": {"x": 100, "y": 100}}]}}]}, 0)
	scene.mother_speaker.signature = "frozen"
	await frames(150)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join("layout.jpg"), .9)
	print("LAYOUT_CAPTURE layout")
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(0)
