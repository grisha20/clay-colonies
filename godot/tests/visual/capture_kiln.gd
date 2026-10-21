extends SceneTree

## Live check of «Обжиг и дождь» against an isolated QA server (a late-match
## fixture with stock). Places a kiln with the real build tool next to camp A,
## plays at 5x until builders finish it and residents get fired, then saves
## stills: the burning kiln, fired vs raw residents, the work panel and the bar.
##   godot --path godot --script res://tests/visual/capture_kiln.gd -- --qa-port 8808 --out <dir> [--seconds 240]

var scene: WorldObserver
var out_dir := "user://kiln_capture"
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
	print("KILN saved ", name)

func look(pos: Vector3, dist: float) -> void:
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = pos
	wv.target_camera_distance = dist
	wv.camera_distance = dist

func kiln_of(owner: String) -> Dictionary:
	for b in scene.world_view.last_snapshot.get("surface", {}).get("buildings", []):
		if str(b.get("type", "")) == "kiln" and str(b.get("colonyId", "")) == owner:
			return b
	return {}

func fired_count(owner: String) -> int:
	var n = 0
	for a in scene.world_view.last_snapshot.get("ants", []):
		if str(a.get("colonyId", "")) == owner and bool(a.get("fired", false)):
			n += 1
	return n

func run() -> void:
	var port = ""
	var seconds = 240.0
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
	var camp = scene.world_view.colony_focus_points[0]
	var surface = scene.world_view.last_snapshot.surface
	# A free spot for the kiln near camp A, as the preview would show it.
	var spot = Vector2.INF
	for r in [14, 18, 22, 26, 30, 34]:
		for k in range(16):
			var p = Vector2(camp.x, camp.z) + Vector2(cos(k * PI / 8.0), sin(k * PI / 8.0)) * float(r)
			if BuildRules.point_building_placement(surface, "colony-1", "kiln", p) == "":
				spot = p
				break
		if spot != Vector2.INF:
			break
	check("free_kiln_spot", spot != Vector2.INF, str(spot))
	scene.build.set_tool("kiln")
	await process_frame
	scene.build.update_preview(spot)
	await process_frame
	look(Vector3(spot.x, 0, spot.y), 18.0)
	await wait_seconds(0.6)
	shot("kiln_01_preview")
	scene.build._place_point(spot, false)
	var t0 = Time.get_ticks_msec()
	while kiln_of("colony-1").is_empty() and Time.get_ticks_msec() - t0 < 5000:
		await process_frame
	check("kiln_site_on_server", not kiln_of("colony-1").is_empty())
	scene.ws_client.send_command({"type": "setSpeed", "value": 5})
	var built_shot = false
	var fire_shot = false
	var until = Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame
		var kiln = kiln_of("colony-1")
		if not built_shot and str(kiln.get("stage", "")) == "built":
			built_shot = true
			print("KILN built at tick ", scene.world_view.last_snapshot.get("tick", 0))
		var firing = kiln.get("firing")
		if built_shot and not fire_shot and typeof(firing) == TYPE_DICTIONARY and bool(firing.get("paid", false)) and int(firing.get("progress", 0)) > 40:
			scene.ws_client.send_command({"type": "setSpeed", "value": 1})
			look(Vector3(spot.x, 0, spot.y + 1.5), 9.0)
			await wait_seconds(1.2)
			shot("kiln_02_firing")
			fire_shot = true
			scene.ws_client.send_command({"type": "setSpeed", "value": 5})
		if fire_shot and fired_count("colony-1") >= 4:
			break
	var fired = fired_count("colony-1")
	check("kiln_built", built_shot)
	check("kiln_fire_seen", fire_shot)
	check("residents_fired", fired >= 2, str(fired))
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	# Fired residents next to raw ones near camp.
	var target: NetworkResident = null
	for r in scene.entity_registry.residents.values():
		if r.fired and r.colony_id == "colony-1":
			target = r
			break
	if target:
		scene.select_resident(target)
		scene.world_view.focus_on_resident(target)
		scene.world_view.camera_distance = 7.0
		scene.world_view.target_camera_distance = 7.0
		await wait_seconds(2.0)
		shot("kiln_03_fired_resident")
		scene.world_view.focused_target = null
	look(Vector3(spot.x, 0, spot.y), 24.0)
	await wait_seconds(1.0)
	shot("kiln_04_panel")
	check("panel_firing_row", scene.priority_panel.firing_row.visible, scene.priority_panel.firing_label.text)
	print("KILN fired=%d panel='%s'" % [fired, scene.priority_panel.firing_label.text])
	print("KILN_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
