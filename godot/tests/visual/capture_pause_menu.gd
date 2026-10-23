extends SceneTree

## Review shot of the Esc menu over a live QA match; checks that Esc opens it
## and pauses the match, and a second Esc closes it and restores the speed.
##   godot --path godot --resolution 1920x1080 --script tests/visual/capture_pause_menu.gd -- --qa-port <port> [--out <png>]
var scene: WorldObserver
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func frames(n: int) -> void:
	for i in range(n): await process_frame

func press_escape() -> void:
	var e = InputEventKey.new()
	e.keycode = KEY_ESCAPE
	e.pressed = true
	scene._unhandled_input(e)

func wait_speed(want: float) -> bool:
	var until = Time.get_ticks_msec() + 5000
	while Time.get_ticks_msec() < until:
		if is_equal_approx(scene.entity_registry.current_sim_speed, want):
			return true
		await process_frame
	return false

func run() -> void:
	var port = ""
	var out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/hud_layout/pause_menu.png")
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
		if args[i] == "--out" and i + 1 < args.size(): out = args[i + 1]
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var deadline = Time.get_ticks_msec() + 15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() > deadline: quit(2); return
		await process_frame
	scene.close_start_menu()
	scene.select_resident(null)
	await frames(30)
	check("running_before", await wait_speed(1.0), str(scene.entity_registry.current_sim_speed))
	press_escape()
	check("esc_opens_menu", scene.pause_menu.visible)
	check("menu_pauses_match", await wait_speed(0.0), str(scene.entity_registry.current_sim_speed))
	await frames(40)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(out)
	press_escape()
	check("second_esc_closes", not scene.pause_menu.visible)
	check("speed_restored", await wait_speed(1.0), str(scene.entity_registry.current_sim_speed))
	print("PAUSE_MENU_FAILURES=%d" % failures)
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(1 if failures > 0 else 0)
