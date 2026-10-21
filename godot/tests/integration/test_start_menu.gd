extends SceneTree

## Start menu against an isolated QA server (never the player's server):
## launch as the main scene -> menu connects and lists saves; New game (random
## map) autosaves the running match and switches terrain; Save adds a slot;
## Load restores the saved map. With --shots <dir> it also writes screenshots.
##   godot --path godot --script res://tests/integration/test_start_menu.gd -- --server-port 8793 [--shots dir]

var scene: WorldObserver
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func wait_until(cond: Callable, timeout_sec: float) -> bool:
	var until = Time.get_ticks_msec() + int(timeout_sec * 1000.0)
	while Time.get_ticks_msec() < until:
		if cond.call():
			return true
		await process_frame
	return cond.call()

func shot(dir: String, name: String) -> void:
	if dir == "":
		return
	for i in range(30):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(dir.path_join(name + ".png"))

func run() -> void:
	var port = ""
	var shots = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		# Not --qa-port: the observer itself would auto-connect and skip the menu.
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--shots" and i + 1 < args.size():
			shots = args[i + 1]
	if port == "":
		push_error("--server-port of an isolated QA server is required")
		quit(2)
		return
	if shots != "":
		DirAccess.make_dir_recursive_absolute(shots)
	var packed = load("res://scenes/game/world_observer.tscn")
	scene = packed.instantiate() as WorldObserver
	scene.get_node("WSClient").server_url = "ws://127.0.0.1:" + port
	root.add_child(scene)
	current_scene = scene
	await process_frame
	await process_frame

	check("menu_opens_on_launch", scene.start_menu.visible)
	var connected = await wait_until(func(): return scene.start_menu.connected and scene.entity_registry.residents.size() > 0, 20.0)
	check("menu_connects_and_world_shows", connected)
	check("menu_actions_enabled", not scene.start_menu.continue_button.disabled and not scene.start_menu.new_random_button.disabled)
	await shot(shots, "menu_01_start")

	var saves_before = scene.start_menu.saves.size()
	var seed_before = int(SurfaceTerrain._signature.get_slice(":", 0)) if SurfaceTerrain._signature != "legacy" else 0
	var sig_before = SurfaceTerrain._signature
	# First press only asks for confirmation.
	scene.start_menu._ask_new_game(0)
	check("new_game_needs_confirmation", scene.start_menu.visible and scene.start_menu.confirm_label.visible)
	scene.start_menu._ask_new_game(0)
	check("menu_closes_on_new_game", not scene.start_menu.visible)
	var switched = await wait_until(func(): return SurfaceTerrain._signature != sig_before and SurfaceTerrain._signature != "legacy", 20.0)
	check("new_game_brings_new_random_map", switched, "seed %d -> %s" % [seed_before, SurfaceTerrain._signature.get_slice(":", 0)])
	var autosaved = await wait_until(func(): return scene.start_menu.saves.size() == saves_before + 1, 10.0)
	check("previous_match_autosaved", autosaved and str(scene.start_menu.saves[0].get("name", "")) == "Перед новой игрой")
	await wait_until(func(): return scene.entity_registry.residents.size() > 0, 10.0)
	scene.world_view.focus_on_colony(0)
	await shot(shots, "menu_02_new_world_camp")

	# Save the new match, then come back to the autosaved one through Load.
	var sig_new = SurfaceTerrain._signature
	var ids_before = scene.start_menu.saves.map(func(m): return str(m.get("id", "")))
	scene.ws_client.send_command({"type": "saveGame", "name": "Проверка меню"})
	var saved = await wait_until(func(): return scene.start_menu.saves.size() == saves_before + 2, 10.0)
	check("save_button_adds_slot", saved)
	scene.open_start_menu()
	scene.start_menu.saves_panel.visible = true
	await shot(shots, "menu_03_load_list")
	var autosave_id = ""
	for meta in scene.start_menu.saves:
		if str(meta.get("name", "")) == "Перед новой игрой" and autosave_id == "":
			autosave_id = str(meta.get("id", ""))
	scene.start_menu.load_requested.emit(autosave_id)
	check("menu_closes_on_load", not scene.start_menu.visible)
	var restored = await wait_until(func(): return SurfaceTerrain._signature == sig_before, 20.0)
	check("load_restores_saved_map", restored)
	var check_id = ""
	for meta in scene.start_menu.saves:
		if str(meta.get("name", "")) == "Проверка меню" and not ids_before.has(str(meta.get("id", ""))):
			check_id = str(meta.get("id", ""))
	print("loading second slot ", check_id)
	scene.start_menu.load_requested.emit(check_id)
	var back = await wait_until(func(): return SurfaceTerrain._signature == sig_new, 20.0)
	check("load_second_slot", back)

	scene.ws_client.disconnect_from_server()
	await process_frame
	print("START_MENU_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
