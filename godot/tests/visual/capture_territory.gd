extends SceneTree

## Live check of «Территория и тотемы» against an isolated QA server started
## with --reset (a new random world with springs). Plays tribe A with the real
## build tool: a workshop, then totems at the edge of its land toward the
## nearest spring until the tribe holds it. Saves stills of the land border,
## the totem chain and the held spring, and checks special clay arrives.
##   godot --path godot --script res://tests/visual/capture_territory.gd -- --qa-port 8811 --out <dir> [--seconds 420]

var scene: WorldObserver
var out_dir := "user://territory_capture"
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
	print("TERR saved ", name)

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

func has_built(type: String) -> int:
	var n = 0
	for b in snap().surface.buildings:
		if str(b.type) == type and str(b.colonyId) == "colony-1" and str(b.stage) == "built":
			n += 1
	return n

func pending(type: String) -> bool:
	for b in snap().surface.buildings:
		if str(b.type) == type and str(b.colonyId) == "colony-1" and str(b.stage) != "built":
			return true
	return false

func place(kind: String, p: Vector2) -> void:
	scene.build.set_tool(kind)
	await process_frame
	scene.build.update_preview(p)
	await process_frame
	scene.build._place_point(p, false)
	scene.build.set_tool("")

## A free spot for kind at distance r from c in direction ang (± turns).
func spot_toward(kind: String, c: Vector2, ang: float, radii: Array) -> Vector2:
	for r in radii:
		for turn in [0.0, 0.2, -0.2, 0.4, -0.4, 0.7, -0.7, 1.0, -1.0]:
			var p = c + Vector2(cos(ang + turn), sin(ang + turn)) * float(r)
			if BuildRules.point_building_placement(snap().surface, "colony-1", kind, p) == "":
				return p
	return Vector2.INF

func run() -> void:
	var port = ""
	var seconds = 420.0
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
	var springs: Array = snap().surface.get("springs", [])
	check("world_has_springs", springs.size() >= 1, str(springs.size()))
	var camp = Vector2(float(snap().surface.entrances[0].x), float(snap().surface.entrances[0].y))
	var target: Dictionary = {}
	for s in springs:
		if target.is_empty() or Vector2(s.pos.x, s.pos.y).distance_to(camp) < Vector2(target.pos.x, target.pos.y).distance_to(camp):
			target = s
	var spring_pos = Vector2(float(target.pos.x), float(target.pos.y))
	print("TERR camp ", camp, " spring ", spring_pos, " dist ", camp.distance_to(spring_pos))
	look(camp.lerp(spring_pos, 0.5), 70.0)
	await wait_seconds(1.5)
	shot("territory_01_start")
	# A workshop for picks (stone for the totems).
	var ws = spot_toward("workshop", camp, (spring_pos - camp).angle() + PI, [18, 24, 30])
	await place("workshop", ws)
	scene.ws_client.send_command({"type": "setSpeed", "value": 20})
	var totems_placed = 0
	var held = false
	var first_totem_shot = false
	var until = Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until and not held:
		await wait_seconds(0.5)
		held = str(snap().surface.springs.filter(func(s): return str(s.id) == str(target.id))[0].get("holder", "")) == "colony-1"
		if held:
			break
		if pending("totem") or has_built("totem") >= 4:
			continue
		var c = colony()
		if float(c.clay) < 14 or float(c.wood) < 7 or float(c.stone) < 4:
			continue
		# Step from the own land disc closest to the spring, near its edge.
		var discs = BuildRules.territory_discs(snap().surface).filter(func(d): return str(d.owner) == "colony-1")
		discs.sort_custom(func(a, b): return Vector2(a.x, a.y).distance_to(spring_pos) - float(a.r) < Vector2(b.x, b.y).distance_to(spring_pos) - float(b.r))
		var d = discs[0]
		var from = Vector2(float(d.x), float(d.y))
		var p = spot_toward("totem", from, (spring_pos - from).angle(), [float(d.r) - 5, float(d.r) - 9, float(d.r) - 13])
		if p == Vector2.INF:
			continue
		await place("totem", p)
		totems_placed += 1
		print("TERR totem %d at %s tick %d" % [totems_placed, p, int(snap().tick)])
		if not first_totem_shot:
			# Wait for the builders, then show the land growing.
			var t0 = Time.get_ticks_msec()
			while has_built("totem") < 1 and Time.get_ticks_msec() - t0 < 60000:
				await wait_seconds(0.3)
			scene.ws_client.send_command({"type": "setSpeed", "value": 1})
			look(p, 48.0)
			await wait_seconds(1.5)
			shot("territory_02_first_totem")
			first_totem_shot = true
			scene.ws_client.send_command({"type": "setSpeed", "value": 20})
	check("totem_built", has_built("totem") >= 1, str(has_built("totem")))
	check("spring_held", held)
	scene.ws_client.send_command({"type": "setSpeed", "value": 5})
	var clay0 = float(colony().get("specialClay", 0))
	var t1 = Time.get_ticks_msec()
	while float(colony().get("specialClay", 0)) <= clay0 and Time.get_ticks_msec() - t1 < 30000:
		await wait_seconds(0.3)
	check("special_clay_arrives", float(colony().get("specialClay", 0)) > clay0, str(colony().get("specialClay", 0)))
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	look(spring_pos, 30.0)
	await wait_seconds(1.5)
	shot("territory_03_spring_held")
	look(camp.lerp(spring_pos, 0.5), 80.0)
	await wait_seconds(1.5)
	shot("territory_04_overview")
	print("TERR totems=%d special=%s events=%s" % [has_built("totem"), str(colony().get("specialClay", 0)), str(snap().session.events.map(func(e): return e.text).filter(func(t): return "источник" in t))])
	print("TERR_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
