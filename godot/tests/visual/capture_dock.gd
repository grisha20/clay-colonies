extends SceneTree

## Review shots of the Stronghold-style bottom dock: build tab with a hint on
## the slab, the works tab, the mother speaking above the dock.
##   godot_console --path godot --script tests/visual/capture_dock.gd -- --qa-port <port>
var scene: WorldObserver
var out: String

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func shot(name: String) -> void:
	await frames(6)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join(name + ".jpg"), .9)
	print("DOCK_CAPTURE ", name)

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/bottom_dock")
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
	scene.dock.show_hint(scene.build.buttons["hut"].tooltip_text)
	scene.dock.set_process(false)
	scene.mother_speaker.update_from_snapshot({"colonies": [{"colony": {"advice": [{"key": "huts", "severity": "warn", "text": "Хижин мало — жители спят под открытым небом", "pos": {"x": 100, "y": 100}}, {"key": "clay", "severity": "info", "text": "Глины нет — новых лепить не из чего"}]}}]}, 0)
	scene.mother_speaker.signature = "frozen"
	await frames(120)
	await shot("dock_build")
	scene.dock.set_process(true)
	scene.dock.select_tab(1)
	await shot("dock_defence")
	scene.dock.select_tab(3)
	await frames(10)
	await shot("dock_works")
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(0)
