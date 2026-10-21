extends SceneTree

## HUD review against an isolated QA server: camp view with the resource bar,
## tasks and alerts, then hover tooltips over a quarry and a tree.
##   godot --path godot --script res://tests/visual/capture_hud.gd -- --server-port 8795 --out <dir>

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n):
		await process_frame

func run() -> void:
	var port = ""
	var out = "user://hud"
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out = args[i + 1]
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	while scene.entity_registry.residents.is_empty():
		await process_frame
	var wv = scene.world_view
	wv.focus_on_colony(0)
	wv.target_camera_distance = 26.0
	await frames(90)
	root.get_viewport().get_texture().get_image().save_png(out.path_join("hud_01_camp.png"))
	print("HUD bar clay=", scene.hud.resource_labels.clay.text, " people=", scene.hud.resource_labels.people.text, " tasks=", scene.hud.tasks_box.get_child_count(), " weather=", scene.hud.weather_label.text)
	# Hover a quarry and the nearest tree.
	var surface = wv.last_snapshot.get("surface", {})
	var targets = []
	for d in surface.get("deposits", []):
		targets.append(["quarry", Vector3(float(d.pos.x), 0, float(d.pos.y))])
		break
	var camp = wv.colony_focus_points[0]
	var best = null
	for n in surface.get("resourceNodes", []):
		if str(n.get("kind", "")) == "tree":
			var p = Vector3(float(n.pos.x), 0, float(n.pos.y))
			if best == null or p.distance_to(camp) < best.distance_to(camp):
				best = p
	if best != null:
		targets.append(["tree", best])
	for t in targets:
		wv.camera_pivot.position = t[1]
		wv.focused_target = null
		wv.camera_navigated = true
		await frames(30)
		var screen = wv.camera.unproject_position(t[1] + Vector3(0, SurfaceTerrain.height_at(t[1].x, t[1].z), 0))
		Input.warp_mouse(screen)
		await frames(20)
		print("HUD tooltip ", t[0], ": ", scene.hud.tooltip_label.text if scene.hud.tooltip_panel.visible else "<hidden>")
		root.get_viewport().get_texture().get_image().save_png(out.path_join("hud_tooltip_%s.png" % t[0]))
	# Controls really drive the server: alarm and speed come back in the next snapshots.
	scene.hud.alarm_requested.emit(true)
	scene.hud.speed_requested.emit(5)
	var until = Time.get_ticks_msec() + 5000
	while Time.get_ticks_msec() < until and not (scene.hud.alarm_on and scene.hud.speed_buttons[5].button_pressed):
		await process_frame
	print("HUD controls alarm=", scene.hud.alarm_on, " speed5=", scene.hud.speed_buttons[5].button_pressed)
	wv.focus_on_colony(0)
	wv.target_camera_distance = 26.0
	await frames(60)
	root.get_viewport().get_texture().get_image().save_png(out.path_join("hud_02_alarm.png"))
	scene.hud.alarm_requested.emit(false)
	scene.hud.speed_requested.emit(1)
	await frames(20)
	scene.ws_client.disconnect_from_server()
	await process_frame
	quit(0)
