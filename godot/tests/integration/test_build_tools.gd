extends SceneTree

## Build tools end-to-end against an isolated QA server: real mouse events on
## the production observer place a hut, draw a fence line, paint a harvest
## zone and erase it; each change must come back from the server. Refused
## spots must send nothing. With --shots <dir> it saves preview screenshots.
##   godot --path godot --script res://tests/integration/test_build_tools.gd -- --server-port 8797 [--shots dir]

var scene: WorldObserver
var failures := 0
var shots := ""

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func frames(n: int) -> void:
	for i in range(n):
		await process_frame

func wait_until(cond: Callable, sec: float) -> bool:
	var until = Time.get_ticks_msec() + int(sec * 1000.0)
	while Time.get_ticks_msec() < until:
		if cond.call():
			return true
		await process_frame
	return cond.call()

func screen_of(p: Vector2) -> Vector2:
	return scene.world_view.camera.unproject_position(Vector3(p.x, 0.0, p.y))

func mouse(p: Vector2, button: int, pressed: bool, shift := false) -> void:
	var e = InputEventMouseButton.new()
	e.position = screen_of(p)
	e.global_position = e.position
	e.button_index = button
	e.pressed = pressed
	e.shift_pressed = shift
	scene._unhandled_input(e)

func hover(p: Vector2) -> void:
	Input.warp_mouse(screen_of(p))
	await frames(4)
	scene.build.update_preview(p)

func shot(name: String) -> void:
	if shots == "":
		return
	await frames(10)
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))

func own(type: String) -> Array:
	return scene.world_view.last_snapshot.surface.buildings.filter(func(b): return b.colonyId == "colony-1" and b.type == type)

func zones() -> Dictionary:
	return scene.world_view.last_snapshot.colonies[0].colony.get("zones", {"harvest": [], "forbid": []})

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--shots" and i + 1 < args.size():
			shots = args[i + 1]
	if shots != "":
		DirAccess.make_dir_recursive_absolute(shots)
	scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	check("connected", await wait_until(func(): return scene.entity_registry.residents.size() > 0, 20.0))
	var surface = scene.world_view.last_snapshot.surface
	var camp = Vector2(float(surface.entrances[0].x), float(surface.entrances[0].y))
	scene.world_view.focus_on_colony(0)
	scene.world_view.target_camera_distance = 34.0
	scene.world_view.camera_distance = 34.0
	await frames(30)

	# A valid hut spot near camp, found with the same rules the server uses.
	var spot = Vector2.INF
	var bad_spot = camp + Vector2(0, 3)  # on the hearth
	for r in range(14, 30, 2):
		for k in range(16):
			var p = camp + Vector2(cos(k * TAU / 16.0), sin(k * TAU / 16.0)) * r
			if BuildRules.point_building_placement(surface, "colony-1", "hut", p) == "":
				spot = p
				break
		if spot != Vector2.INF:
			break
	check("found_hut_spot", spot != Vector2.INF)

	var huts_before = own("hut").size()
	scene.build.set_tool("hut")
	await hover(bad_spot)
	check("refused_spot_reason", scene.build.last_reason == "Слишком близко к костру", scene.build.last_reason)
	await shot("build_01_hut_refused")
	mouse(bad_spot, MOUSE_BUTTON_LEFT, true)
	await frames(15)
	check("refused_spot_sends_nothing", own("hut").size() == huts_before and scene.build.tool == "hut")
	await hover(spot)
	check("valid_spot_green", scene.build.last_reason == "")
	await shot("build_02_hut_ok")
	mouse(spot, MOUSE_BUTTON_LEFT, true)
	check("hut_site_appears", await wait_until(func(): return own("hut").size() == huts_before + 1, 5.0))
	check("tool_released_after_place", scene.build.tool == "")
	var site = own("hut").filter(func(b): return Vector2(b.pos.x, b.pos.y).distance_to(spot) < 0.5)
	check("site_at_cursor", site.size() == 1 and str(site[0].stage) != "built")

	# Fence brush: a line of free cells beside camp.
	var walls_before = own("wall").size()
	var a = camp + Vector2(18, 4)
	var b = camp + Vector2(32, 4)
	scene.build.set_tool("wall")
	mouse(a, MOUSE_BUTTON_LEFT, true)
	await hover(b)
	await shot("build_03_fence_brush")
	var free = BuildRules.wall_line_cells(surface, a, b).filter(func(idx): return BuildRules.fence_placement(scene.world_view.last_snapshot.surface, "colony-1", BuildRules.cell_center(surface, idx, 2.0)) == "").size()
	mouse(b, MOUSE_BUTTON_LEFT, false)
	check("fence_cells_sent", await wait_until(func(): return own("wall").size() == walls_before + free, 5.0), "free=%d got=%d" % [free, own("wall").size() - walls_before])

	# Harvest zone rectangle, then the eraser removes it.
	var z0 = camp + Vector2(30, -30)
	var z1 = camp + Vector2(46, -18)
	var expected = BuildRules.rect_cells(surface, z0, z1, 4.0).size()
	var before = zones().get("harvest", []).size()
	scene.build.set_tool("harvest")
	mouse(z0, MOUSE_BUTTON_LEFT, true)
	await hover(z1)
	await shot("build_04_zone_rect")
	mouse(z1, MOUSE_BUTTON_LEFT, false)
	check("harvest_zone_painted", await wait_until(func(): return zones().get("harvest", []).size() == before + expected, 5.0), "expected +%d" % expected)
	scene.build.set_tool("")
	await frames(10)
	check("zone_overlay_drawn", scene.build.zone_overlay.multimesh.instance_count >= expected)
	await shot("build_05_zone_overlay")
	scene.build.set_tool("erase")
	mouse(z0, MOUSE_BUTTON_LEFT, true)
	mouse(z1, MOUSE_BUTTON_LEFT, false)
	check("eraser_removes_zone", await wait_until(func(): return zones().get("harvest", []).size() == before, 5.0))

	# Gate: R rotates, a click on a free spot places a vertical gatehouse.
	var gates_before = own("gate").size()
	var gspot = Vector2.INF
	for r in range(16, 40, 2):
		for k in range(12):
			var p = camp + Vector2(cos(k * TAU / 12.0), sin(k * TAU / 12.0)) * r
			if BuildRules.gate_placement(scene.world_view.last_snapshot.surface, "colony-1", p, "vertical") == "":
				gspot = p
				break
		if gspot != Vector2.INF:
			break
	scene.build.set_tool("gate")
	var rkey = InputEventKey.new()
	rkey.keycode = KEY_R
	rkey.pressed = true
	scene._unhandled_input(rkey)
	check("r_rotates_gate", scene.build.gate_axis == "vertical")
	await hover(gspot)
	await shot("build_06_gate")
	mouse(gspot, MOUSE_BUTTON_LEFT, true)
	check("gate_placed", await wait_until(func(): return own("gate").size() == gates_before + 1 and str(own("gate")[-1].get("gateAxis", "")) == "vertical", 5.0))

	# Defence post: the banner tool moves colony.defensePost to the click.
	var post_spot = camp + Vector2(-24, -10)
	if BuildRules.post_placement(scene.world_view.last_snapshot.surface, "colony-1", post_spot) != "":
		post_spot = camp + Vector2(-26, 8)
	var key0 = InputEventKey.new()
	key0.keycode = KEY_0
	key0.pressed = true
	scene._unhandled_input(key0)
	check("hotkey_selects_post", scene.build.tool == "post")
	await hover(post_spot)
	await shot("build_07_post")
	mouse(post_spot, MOUSE_BUTTON_LEFT, true)
	var post_at = func():
		var dp = scene.world_view.last_snapshot.colonies[0].colony.get("defensePost")
		return typeof(dp) == TYPE_DICTIONARY and Vector2(float(dp.x), float(dp.y)).distance_to(post_spot) < 0.5
	check("defense_post_moved", await wait_until(post_at, 5.0))
	check("post_banner_drawn", scene.world_view.defense_posts[0] != null and scene.world_view.defense_posts[0].visible)

	# Work priorities: the panel buttons change colony.priorities on the server.
	var prio_before = int(scene.world_view.last_snapshot.colonies[0].colony.priorities.get("guard", 0))
	var next = scene.world_view.last_snapshot.colonies[0].colony.priorities.duplicate()
	next["guard"] = prio_before + 1
	scene.priority_panel.priorities_requested.emit(next)
	var guard_now = func(): return int(scene.world_view.last_snapshot.colonies[0].colony.priorities.get("guard", 0)) == prio_before + 1
	check("priority_reaches_server", await wait_until(guard_now, 5.0))
	await frames(10)
	await shot("build_08_priorities")

	# Esc and right click leave the tool.
	scene.build.set_tool("gate")
	var esc = InputEventKey.new()
	esc.keycode = KEY_ESCAPE
	esc.pressed = true
	scene._unhandled_input(esc)
	check("esc_cancels_tool", scene.build.tool == "")
	var key3 = InputEventKey.new()
	key3.keycode = KEY_3
	key3.pressed = true
	scene._unhandled_input(key3)
	check("hotkey_selects_workshop", scene.build.tool == "workshop")
	mouse(camp, MOUSE_BUTTON_RIGHT, true)
	check("right_click_cancels", scene.build.tool == "")

	scene.ws_client.disconnect_from_server()
	await process_frame
	print("BUILD_TOOLS_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
