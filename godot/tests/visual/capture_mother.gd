extends SceneTree

## Live check of «Праматерь ведёт племя игрока» against an isolated QA server
## (scripts/godot/qa_server.py --reset). Plays a fresh match at 5x with the
## mother in charge, logs her priorities and advice, catches a molding at the
## hearth, toggles «вручную» and back through the work panel, saves stills.
##   godot --path godot --script res://tests/visual/capture_mother.gd -- --qa-port 8801 --out <dir> [--seconds 150]

var scene: WorldObserver
var out_dir := "user://mother_capture"
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func wait_seconds(sec: float) -> void:
	var until = Time.get_ticks_msec() + int(sec * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame

func shot(name: String) -> void:
	root.get_viewport().get_texture().get_image().save_png(out_dir.path_join(name + ".png"))
	print("MOTHER saved ", name)

func colony() -> Dictionary:
	var cols = scene.world_view.last_snapshot.get("colonies", [])
	return cols[0].get("colony", {}) if cols.size() > 0 else {}

func look(pos: Vector3, dist: float) -> void:
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = pos
	wv.target_camera_distance = dist
	wv.camera_distance = dist

func run() -> void:
	var port = ""
	var seconds = 150.0
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out_dir = args[i + 1]
		elif args[i] == "--seconds" and i + 1 < args.size():
			seconds = float(args[i + 1])
	if port == "":
		push_error("--qa-port of an isolated QA server is required")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(out_dir)
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
	check("new_game_mother_decides", bool(colony().get("autoManage", false)))
	var camp = scene.world_view.colony_focus_points[0]
	var mother = scene.world_view.mothers[0] as Node3D
	check("mother_at_hearth", mother != null and mother.visible)
	look(mother.global_position if mother else camp, 9.0)
	await wait_seconds(2.0)
	shot("mother_01_hearth")
	scene.ws_client.send_command({"type": "setSpeed", "value": 5})
	var molding_shot = false
	var advice_shot = false
	var advice_seen: Dictionary = {}
	var priority_sets: Dictionary = {}
	var births0 = scene.world_view.births_seen[0]
	var until = Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame
		var c = colony()
		priority_sets[JSON.stringify(c.get("priorities", {}))] = true
		for a in c.get("advice", []):
			if not advice_seen.has(a.key):
				advice_seen[a.key] = a.text
				print("MOTHER advice tick=%d %s: %s" % [int(scene.world_view.last_snapshot.get("tick", 0)), a.key, a.text])
		if not molding_shot and scene.world_view.mother_mold[0] > 0.7:
			look(mother.global_position, 7.0)
			await wait_seconds(0.25)
			shot("mother_02_molding")
			molding_shot = true
			look(camp, 26.0)
		if not advice_shot and scene.advice_feed.visible and scene.advice_feed.rows.get_child_count() >= 2:
			look(camp, 26.0)
			await wait_seconds(0.6)
			shot("mother_03_advice")
			advice_shot = true
	var births = scene.world_view.births_seen[0] - births0
	print("MOTHER births=%d priority_sets=%d advice=%s" % [births, priority_sets.size(), str(advice_seen.keys())])
	check("births_molded", births > 0 and molding_shot, str(births))
	check("mother_changes_priorities", priority_sets.size() >= 2, str(priority_sets.keys()))
	check("advice_shown", advice_seen.size() > 0)

	# Hand the work over and back through the panel.
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	scene.priority_panel.manual_seg.pressed.emit()
	var t0 = Time.get_ticks_msec()
	while bool(colony().get("autoManage", true)) and Time.get_ticks_msec() - t0 < 5000:
		await process_frame
	check("manual_via_panel", not bool(colony().get("autoManage", true)))
	await wait_seconds(0.5)
	look(camp, 26.0)
	await wait_seconds(0.5)
	shot("mother_04_manual")
	scene.priority_panel.mother_seg.pressed.emit()
	t0 = Time.get_ticks_msec()
	while not bool(colony().get("autoManage", false)) and Time.get_ticks_msec() - t0 < 5000:
		await process_frame
	check("back_to_mother", bool(colony().get("autoManage", false)))
	print("MOTHER_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
