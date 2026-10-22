extends SceneTree

## Review shots of resident v3 at work and carrying: one resident per job,
## frozen at the strike, and carriers with each load in the back basket.
## Connects only to a caller-provided isolated QA port:
##   godot_console --path godot --script tests/visual/capture_resident_jobs.gd -- --qa-port <port>
var scene: WorldObserver
var out: String
var caption: Label

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func shot(name: String, text: String, focus: Vector3, distance: float, angle: float, yaw: float = 0.0, fov: float = 40.) -> void:
	caption.text = text
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = focus
	wv.camera_yaw = yaw
	wv.camera_angle_deg = angle
	wv.camera.fov = fov
	wv.camera.rotation_degrees.x = -angle
	wv.target_camera_distance = distance
	wv.camera_distance = distance
	# Close-ups aim above the ground: stop WorldView clamping the focus to it.
	wv.set_process(distance > 5.0)
	if distance <= 5.0:
		wv.camera_pivot.rotation.y = yaw
		var rad = deg_to_rad(angle)
		wv.camera.position = Vector3(0, sin(rad) * distance, cos(rad) * distance)
	await frames(20)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join(name + ".jpg"), .92)
	print("JOBS_CAPTURE ", name)

func actor(pos: Vector3, label: String, data: Dictionary) -> NetworkResident:
	var r = NetworkResident.new()
	scene.add_child(r)
	var d = {"id": label, "colonyId": "colony-1", "state": "idle", "tick": 1, "pos": {"x": pos.x, "y": pos.z}}
	d.merge(data, true)
	r.update_from_ant_data(d, .1, 1.)
	r.set_process(false)
	r.position = pos
	r.rotation.y = 0.
	var tag = Label3D.new()
	tag.text = label
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.position.y = 2.1
	tag.font_size = 48
	tag.outline_size = 12
	r.add_child(tag)
	return r

func pose(r: NetworkResident, clip: String, t: float) -> void:
	r.anim_player.play(clip)
	r.anim_player.seek(t, true)
	r.anim_player.advance(0.)
	r.anim_player.speed_scale = 0.

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
	if port.is_empty():
		push_error("Require --qa-port <isolated port>")
		quit(2); return
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/resident_jobs")
	DirAccess.make_dir_recursive_absolute(out)
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var deadline = Time.get_ticks_msec() + 15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() > deadline: quit(2); return
		await process_frame
	scene.get_node("HUD").visible = false
	var layer = CanvasLayer.new(); root.add_child(layer)
	caption = Label.new(); caption.position = Vector2(24, 16); caption.add_theme_font_size_override("font_size", 24)
	caption.add_theme_color_override("font_color", Color(1, .95, .8)); caption.add_theme_constant_override("outline_size", 8); layer.add_child(caption)
	for r in scene.entity_registry.residents.values(): r.visible = false
	var camp = scene.world_view.colony_focus_points[0]
	var c = camp + Vector3(10, 0, 9)
	c.y = SurfaceTerrain.height_at(c.x, c.z)
	var jobs = [["chop", "Рубка", .35], ["mine", "Кирка", .38], ["build", "Молоток", .2], ["dig", "Копает", .25], ["gather", "Собирает", .42], ["fish", "Рыбачит", .1]]
	var workers = []
	for i in range(jobs.size()):
		var p = c + Vector3(-5.0 + 2.0 * i, 0, 0)
		p.y = SurfaceTerrain.height_at(p.x, p.z)
		var r = actor(p, jobs[i][1], {})
		r.set_work({"kind": jobs[i][0], "target": p + Vector3(1.5, 0, 0)})
		r._update_movement_and_animation(0.)
		r.rotation.y = PI * .5  # face +X: the camera from -Z sees them in profile
		pose(r, "work_" + jobs[i][0], jobs[i][2])
		workers.append(r)
	await shot("jobs_side", "v3 · удар в каждом занятии · сбоку", c + Vector3(0, .9, 0), 12.5, 8.)
	for r in workers: r.rotation.y = 0.
	await shot("jobs_front", "v3 · удар в каждом занятии · спереди", c + Vector3(0, .9, 0), 12.5, 14.)
	for i in range(workers.size()):
		pose(workers[i], "work_" + jobs[i][0], 0.)
	await shot("jobs_windup", "v3 · замах", c + Vector3(0, .9, 0), 12.5, 14.)
	for r in workers: r.queue_free()
	await process_frame
	var loads = [["wood", "Дрова"], ["stone", "Камень"], ["clay", "Глина"], ["fruit", "Ягоды"], ["fish", "Рыба"], ["meat", "Мясо"]]
	var carriers = []
	for i in range(loads.size()):
		var p = c + Vector3(-5.0 + 2.0 * i, 0, 0)
		p.y = SurfaceTerrain.height_at(p.x, p.z)
		var r = actor(p, loads[i][1], {"carrying": 2, "carryKind": loads[i][0]})
		r._update_movement_and_animation(1.)
		pose(r, "carry_walk", .25)
		carriers.append(r)
	for r in carriers: r.rotation.y = PI
	await shot("carry_back", "v3 · корзина за спиной · со спины", c + Vector3(0, .9, 0), 12.5, 14.)
	for r in carriers: r.rotation.y = PI * .5
	await shot("carry_side", "v3 · корзина за спиной · сбоку", c + Vector3(0, .9, 0), 12.5, 8.)
	var close = carriers[0]
	for spec in [["carry_close_side", PI * .5, "сбоку"], ["carry_close_front", 0., "спереди"], ["carry_close_back", PI * .8, "со спины"]]:
		close.rotation.y = spec[1]
		await shot(spec[0], "v3 · корзина, лямки, дрова · " + spec[2], close.position + Vector3(0, .8, 0), 3.2, 12.)
	for i in range(carriers.size()): carriers[i].rotation.y = [0., PI, PI * .5, -PI * .5, PI * .25, -PI * .75][i]
	await shot("carry_game", "v3 · носильщики · игровая камера 15 м", c + Vector3(0, .5, 0), 15., 52., 0., 70.)
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(0)
