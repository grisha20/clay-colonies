extends SceneTree

## Live check of «Доминирование» against an isolated QA server (--reset, a new
## random world). Tribe A takes its home spring with a totem chain (real build
## tool), then the game runs until the AI neighbour comes to besiege that
## totem. The player answers like a human would: defence post next to the
## totem and more guards. Saves stills of the siege and the defence, and logs
## events, totem strength, the advice and the HUD alerts.
##   godot --path godot --script res://tests/visual/capture_war.gd -- --qa-port 8817 --out <dir> [--seconds 600]

var scene: WorldObserver
var out_dir := "user://war_capture"
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
	print("WAR saved ", name)

func look(pos: Vector2, dist: float) -> void:
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = Vector3(pos.x, 0, pos.y)
	wv.target_camera_distance = dist
	wv.camera_distance = dist

func snap() -> Dictionary:
	return scene.world_view.last_snapshot

func colony() -> Dictionary:
	return snap().colonies[0].colony

func own(type: String, built := true) -> Array:
	return snap().surface.buildings.filter(func(b): return str(b.type) == type and str(b.colonyId) == "colony-1" and (str(b.stage) == "built") == built)

func place(kind: String, p: Vector2) -> void:
	scene.build.set_tool(kind)
	await process_frame
	scene.build.update_preview(p)
	await process_frame
	scene.build._place_point(p, false)
	scene.build.set_tool("")

func spot_toward(kind: String, c: Vector2, ang: float, radii: Array) -> Vector2:
	for r in radii:
		for turn in [0.0, 0.2, -0.2, 0.4, -0.4, 0.7, -0.7, 1.0, -1.0]:
			var p = c + Vector2(cos(ang + turn), sin(ang + turn)) * float(r)
			var reason = BuildRules.post_placement(snap().surface, "colony-1", p) if kind == "post" else BuildRules.point_building_placement(snap().surface, "colony-1", kind, p)
			if reason == "":
				return p
	return Vector2.INF

func events() -> Array:
	return snap().session.events.map(func(e): return str(e.text))

func run() -> void:
	var port = ""
	var seconds = 600.0
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
	await wait_seconds(1.0)
	var camp = Vector2(float(snap().surface.entrances[0].x), float(snap().surface.entrances[0].y))
	var target: Dictionary = {}
	for s in snap().surface.springs:
		if target.is_empty() or Vector2(s.pos.x, s.pos.y).distance_to(camp) < Vector2(target.pos.x, target.pos.y).distance_to(camp):
			target = s
	var spring_pos = Vector2(float(target.pos.x), float(target.pos.y))
	await place("workshop", spot_toward("workshop", camp, (spring_pos - camp).angle() + PI, [18, 24, 30]))
	scene.ws_client.send_command({"type": "setSpeed", "value": 20})
	var until = Time.get_ticks_msec() + int(seconds * 1000.0)
	var held = false
	# 1. Take the home spring with a chain of totems.
	while Time.get_ticks_msec() < until and not held:
		await wait_seconds(0.5)
		held = snap().surface.springs.any(func(s): return str(s.id) == str(target.id) and str(s.get("holder", "")) == "colony-1")
		if held or not own("totem", false).is_empty():
			continue
		var c = colony()
		if float(c.clay) < 14 or float(c.wood) < 7 or float(c.stone) < 4:
			continue
		var discs = BuildRules.territory_discs(snap().surface).filter(func(d): return str(d.owner) == "colony-1")
		discs.sort_custom(func(a, b): return Vector2(a.x, a.y).distance_to(spring_pos) - float(a.r) < Vector2(b.x, b.y).distance_to(spring_pos) - float(b.r))
		var from = Vector2(float(discs[0].x), float(discs[0].y))
		var p = spot_toward("totem", from, (spring_pos - from).angle(), [float(discs[0].r) - 5, float(discs[0].r) - 9])
		if p != Vector2.INF:
			await place("totem", p)
	check("home_spring_held", held)
	print("WAR spring held at tick ", int(snap().tick))
	# 2. Wait for the neighbour's war.
	var siege_seen = false
	var besieged: Dictionary = {}
	while Time.get_ticks_msec() < until and not siege_seen:
		await wait_seconds(0.5)
		for t in own("totem"):
			if float(t.hp) < float(t.maxHp) - 0.5:
				besieged = t
				siege_seen = true
	check("ai_besieges_a_totem", siege_seen, str(events()))
	if not siege_seen:
		print("WAR_FAILURES=%d" % (failures))
		quit(1)
		return
	var tp = Vector2(float(besieged.pos.x), float(besieged.pos.y))
	print("WAR siege at tick %d totem %s hp %.0f" % [int(snap().tick), str(besieged.id), float(besieged.hp)])
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	look(tp, 18.0)
	await wait_seconds(2.0)
	shot("war_01_siege")
	var advice: Array = []
	var t_adv = Time.get_ticks_msec()
	while Time.get_ticks_msec() - t_adv < 8000 and not ("siege" in advice):
		advice = colony().get("advice", []).map(func(a): return str(a.key))
		await wait_seconds(0.3)
	check("advice_warns_of_siege", "siege" in advice, str(advice))
	# 3. The player answers: post next to the totem and more guards.
	var post = spot_toward("post", tp, 0.0, [3.0, 4.0])
	scene.build.set_tool("post")
	await process_frame
	scene.build._place_point(post, false)
	var pr = colony().priorities.duplicate()
	pr["guard"] = 8
	scene.ws_client.send_command({"type": "setPriorities", "colony": 0, "priorities": pr})
	scene.ws_client.send_command({"type": "setSpeed", "value": 5})
	var outcome = ""
	var t_end = Time.get_ticks_msec() + 300000
	var next_log = 0
	var defenders_shot = false
	while Time.get_ticks_msec() < t_end:
		await wait_seconds(0.5)
		var still = own("totem").filter(func(t): return str(t.id) == str(besieged.id))
		if still.is_empty():
			outcome = "totem fell"
			break
		var war = snap().colonies[1].colony.get("war")
		if Time.get_ticks_msec() > next_log:
			next_log = Time.get_ticks_msec() + 10000
			var near_a = 0
			var near_b = 0
			for ant in snap().ants:
				if str(ant.get("job", "")) == "guard" and Vector2(float(ant.pos.x), float(ant.pos.y)).distance_to(tp) < 20:
					if str(ant.colonyId) == "colony-1": near_a += 1
					else: near_b += 1
			print("WAR tick %d speed %s war %s hp %.0f guards A %d B %d" % [int(snap().tick), str(snap().session.get("speed")), str(war), float(still[0].hp), near_a, near_b])
		if not defenders_shot and int(snap().tick) % 400 < 60:
			scene.ws_client.send_command({"type": "setSpeed", "value": 1})
			look(tp, 20.0)
			await wait_seconds(1.5)
			shot("war_02_defence")
			defenders_shot = true
			scene.ws_client.send_command({"type": "setSpeed", "value": 5})
		if war == null:
			outcome = "siege lifted (hp %.0f)" % float(still[0].hp)
			break
	print("WAR outcome: ", outcome, " events: ", events())
	check("siege_resolved", outcome != "", outcome)
	look(tp, 26.0)
	await wait_seconds(1.5)
	shot("war_03_after")
	print("WAR_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
