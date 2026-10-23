extends SceneTree

## Review shot of the live HUD on a QA match: real stores and goals, a raid
## alert under the toast, and a tooltip under the speed buttons (it must stay
## above the «Работы» panel).
##   godot --path godot --resolution 1920x1080 --script tests/visual/capture_hud_review.gd -- --qa-port <port> [--out <png>] [--scale 100]
var scene: WorldObserver

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func run() -> void:
	var port = ""
	var out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/hud_layout/hud_review.png")
	var scale = 100
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
		if args[i] == "--out" and i + 1 < args.size(): out = args[i + 1]
		if args[i] == "--scale" and i + 1 < args.size(): scale = int(args[i + 1])
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.set_ui_scale(scale, false)
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var deadline = Time.get_ticks_msec() + 15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() > deadline: quit(2); return
		await process_frame
	scene.close_start_menu()
	await frames(60)
	scene.hud.show_toast("Цель выполнена: Построить мастерскую")
	scene.hud._update_alert({"raid": {"phase": "warning", "at": 900}}, {"state": "clear"}, 0, {})
	var b: Control = scene.hud.speed_buttons[20]
	var at = b.get_global_rect().get_center() + Vector2(0, 30)
	scene.hud.show_tooltip("Скорость 20×", at)
	await frames(20)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(out)
	print("HUD_REVIEW ", out)
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(0)
