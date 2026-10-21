extends SceneTree

## Real QA camp, plus explicitly staged old/new model comparisons. No commands
## or save writes. --server-port <own QA port> --out <absolute directory>
var scene: WorldObserver
var out: String
var title: Label

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n):
		await process_frame

func shot(name: String, text: String, focus: Vector3, distance: float, angle: float = 52.0) -> void:
	title.text = text
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = focus
	wv.camera_angle_deg = angle
	wv.camera.rotation_degrees.x = -angle
	wv.target_camera_distance = distance
	wv.camera_distance = distance
	await frames(30)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join(name + ".jpg"), .94)
	print("RESIDENT_CAPTURE ", name)

func tag(parent: Node3D, text: String) -> void:
	var label = Label3D.new()
	label.text = text
	label.position.y = 2.4
	label.font_size = 42
	label.pixel_size = 0.004
	label.modulate = Color(1.0, 0.94, 0.75)
	label.outline_size = 12
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	parent.add_child(label)

func actor(pos: Vector3, label: String, kind: String = "") -> NetworkResident:
	var r = NetworkResident.new()
	scene.add_child(r)
	r.update_from_ant_data({"id": label, "colonyId": "colony-1", "state": "idle", "tick": 1,
		"pos": {"x":pos.x,"y":pos.z}, "fired":kind == "fired", "carrying":2 if kind == "carry" else 0,"carryKind":"wood"}, .1, 1.)
	r.set_process(false)
	r.rotation.y = 0
	if kind in ["axe", "pick"]:
		r.set_work({"kind":"chop" if kind == "axe" else "mine", "target":pos + Vector3(0,0,2)})
		r._update_movement_and_animation(0.)
	r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	r.anim_player.seek(.15 if kind in ["axe", "pick"] else .0, true)
	r.anim_player.advance(0.)
	if r.chips:
		r.chips.emitting = false
	tag(r, label)
	return r

func run() -> void:
	var port = ""
	out = "user://resident_remodel"
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i+1 < args.size():
			port = args[i+1]
		elif args[i] == "--out" and i+1 < args.size():
			out = args[i+1]
	if port == "":
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(out)
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var until = Time.get_ticks_msec() + 15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() > until:
			quit(2)
			return
		await process_frame
	scene.get_node("HUD").visible = false
	var layer = CanvasLayer.new()
	root.add_child(layer)
	title = Label.new()
	title.position = Vector2(24,18)
	title.add_theme_font_size_override("font_size", 26)
	title.add_theme_color_override("font_color", Color(1,.94,.78))
	title.add_theme_color_override("font_outline_color", Color(.12,.08,.05))
	title.add_theme_constant_override("outline_size", 8)
	layer.add_child(title)
	var camp = scene.world_view.colony_focus_points[0]
	await shot("resident_live_15m", "Живой QA-лагерь · новая модель · камера 15 м", camp,15)
	await shot("resident_live_25m", "Живой QA-лагерь · новая модель · камера 25 м", camp,25)
	# Review actors only: all ordinary residents above came from the QA server.
	var center = camp + Vector3(9,0,8)
	var old = load("res://tests/fixtures/resident_before_20261022.glb").instantiate() as Node3D
	scene.add_child(old)
	old.position = Vector3(center.x-1.1, SurfaceTerrain.height_at(center.x-1.1,center.z),center.z)
	var old_mesh = old.find_child("Resident",true,false) as MeshInstance3D
	for idx in [0,2]:
		var m = old_mesh.get_active_material(idx).duplicate() as StandardMaterial3D
		m.albedo_color = NetworkResident.COLONY_COLORS["colony-1"] if idx == 0 else NetworkResident.COLONY_CORDS["colony-1"]
		old_mesh.set_surface_override_material(idx,m)
	tag(old,"Прежний")
	var fresh = actor(center+Vector3(1.1,0,0),"Новый")
	await shot("resident_pair_close", "Одинаковые свет, масштаб и цвет племени · прежний / новый", center+Vector3(0,.7,0),5.8,32)
	await shot("resident_pair_15m", "Сравнение силуэта · камера 15 м", center,15)
	await shot("resident_pair_25m", "Сравнение силуэта · камера 25 м", center,25)
	old.visible = false
	fresh.visible = false
	var axe = actor(center+Vector3(-2.4,0,0),"Топор","axe")
	var carrier = actor(center,"Груз на голове","carry")
	var fired = actor(center+Vector3(2.4,0,0),"Обожжённый","fired")
	await shot("resident_equipment", "Проверочные позы в QA-лагере · инструмент / груз / обжиг", center+Vector3(0,.6,0),8.5,32)
	axe.visible = false
	carrier.visible = false
	fired.visible = false
	fresh.visible = true
	for child in fresh.get_children():
		if child is Label3D:
			child.visible = false
	for spec in [["front",0.0],["side",PI*.5],["back",PI],["other_side",-PI*.5]]:
		fresh.rotation.y = spec[1]
		await shot("resident_"+spec[0], "Новая модель · четыре ракурса", fresh.position+Vector3(0,.8,0),3.0,24)
	scene.ws_client.disconnect_from_server()
	scene.free()
	await process_frame
	quit(0)
