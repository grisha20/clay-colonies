extends SceneTree

## Explicit candidate review, connecting only to a caller-provided QA port.
var scene: WorldObserver
var out: String
var caption: Label
var staged: Array[Node3D] = []

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func shot(name: String, text: String, focus: Vector3, distance: float, angle: float = 32., fov: float = 70.) -> void:
	caption.text = text
	var wv = scene.world_view
	wv.focused_target = null
	wv.camera_navigated = true
	wv.camera_pivot.position = focus
	wv.camera_angle_deg = angle
	wv.camera.fov = fov
	wv.camera.rotation_degrees.x = -angle
	wv.target_camera_distance = distance
	wv.camera_distance = distance
	await frames(20)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join(name+".jpg"), .95)
	print("V3_CAPTURE ",name)

func actor(pos: Vector3, label: String, candidate: bool = true, kind: String = "", colony: String = "colony-1") -> NetworkResident:
	var r = NetworkResident.new(1 if candidate else 0)
	scene.add_child(r)
	r.update_from_ant_data({"id":label,"colonyId":colony,"state":"idle","tick":1,"pos":{"x":pos.x,"y":pos.z},"fired":kind=="fired","carrying":2 if kind=="carry" else 0,"carryKind":"wood"},.1,1.)
	r.set_process(false)
	r.rotation.y = 0.
	if kind == "axe":
		r.set_work({"kind":"chop","target":pos+Vector3(0,0,2)})
		r._update_movement_and_animation(0.)
	if kind == "walk": r.anim_player.play("walk")
	r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	r.anim_player.seek(.22 if kind == "walk" else (.05 if kind == "axe" else .0),true)
	r.anim_player.advance(0.)
	if r.chips: r.chips.emitting = false
	var tag = Label3D.new()
	tag.text=label;tag.position.y=2.35;tag.font_size=36;tag.pixel_size=.004
	tag.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	r.add_child(tag);staged.append(r)
	return r

func reference_card(pos: Vector3, path: String, label: String, region: Rect2i = Rect2i()) -> Node3D:
	var image = Image.load_from_file(ProjectSettings.globalize_path("res://../"+path))
	if region.size.x>0: image=image.get_region(region)
	var card=Sprite3D.new()
	card.texture=ImageTexture.create_from_image(image)
	card.pixel_size=1.75/image.get_height()
	card.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	scene.add_child(card);card.position=pos+Vector3(0,.875,0)
	var tag=Label3D.new();tag.text=label;tag.position.y=1.5;tag.font_size=42;tag.pixel_size=.004;tag.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	card.add_child(tag);staged.append(card)
	return card

func run() -> void:
	var port = ""
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/resident_v3")
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i]=="--qa-port" and i+1<args.size(): port=args[i+1]
	if port.is_empty() or not "--resident-v3" in args:
		push_error("Require --qa-port <isolated port> --resident-v3")
		quit(2);return
	DirAccess.make_dir_recursive_absolute(out)
	scene=load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:"+port)
	var deadline=Time.get_ticks_msec()+15000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec()>deadline: quit(2);return
		await process_frame
	scene.get_node("HUD").visible=false
	var layer=CanvasLayer.new();root.add_child(layer)
	caption=Label.new();caption.position=Vector2(24,16);caption.add_theme_font_size_override("font_size",24)
	caption.add_theme_color_override("font_color",Color(1,.95,.8));caption.add_theme_constant_override("outline_size",8);layer.add_child(caption)
	var camp=scene.world_view.colony_focus_points[0]
	await shot("camp_15m","Hunyuan v3 · живой QA-лагерь · 15 м",camp,15.,52.)
	await shot("camp_25m","Hunyuan v3 · живой QA-лагерь · 25 м",camp,25.,52.)
	# Move the staged comparison to an empty, flat patch. It is a review fixture,
	# not a server command or a change to saved residents.
	var center=camp+Vector3(10,0,9)
	center.y=SurfaceTerrain.height_at(center.x,center.z)
	for r in scene.entity_registry.residents.values(): r.visible=false
	var old=actor(center+Vector3(-1.1,0,0),"Нынешний 3D",false)
	var fresh=actor(center+Vector3(1.1,0,0),"Hunyuan v3")
	await shot("pair","Одинаковые камера, свет и рост · нынешний / Hunyuan v3",center+Vector3(0,.8,0),5.8,24.,40.)
	old.position.x=center.x+1.1;fresh.position.x=center.x+3.3
	var atlas=reference_card(center+Vector3(-3.3,0,0),"client/public/assets/characters/clayfolk/resident-atlas.png","2D-атлас",Rect2i(68,30,182,254))
	var reference=reference_card(center+Vector3(-1.1,0,0),"art/source/resident_hunyuan/reference/front.png","Референс Hunyuan")
	await shot("comparison","2D-атлас / исходный референс / нынешний 3D / Hunyuan v3",center+Vector3(0,.8,0),9.,24.,36.)
	atlas.visible=false;reference.visible=false
	fresh.position.x=center.x+1.1
	old.visible=false;fresh.visible=false
	actor(center+Vector3(-3,0,0),"Топор",true,"axe")
	actor(center+Vector3(-1.5,0,0),"Груз",true,"carry")
	actor(center,"Шаг",true,"walk")
	actor(center+Vector3(1.5,0,0),"Племя B",true,"","colony-2")
	actor(center+Vector3(3,0,0),"Обжиг",true,"fired")
	await shot("equipment","Hunyuan v3 · инструмент / груз / ходьба / племя B / обжиг",center+Vector3(0,.8,0),9.3,28.,36.)
	for r in staged: r.visible=false
	fresh.visible=true
	for child in fresh.get_children():
		if child is Label3D: child.visible=false
	for spec in [["front",0.],["left",PI*.5],["back",PI],["right",-PI*.5]]:
		fresh.rotation.y=spec[1]
		await shot(spec[0],"Hunyuan v3 · проверка внешности",fresh.position+Vector3(0,.88,0),3.0,18.)
	fresh.rotation.y=0.
	fresh.anim_player.play("work_gather")
	for t in [0.,.25,.5,.75]:
		fresh.anim_player.seek(t,true);fresh.anim_player.advance(0.)
		await shot("strike_"+str(int(t*100)),"Hunyuan v3 · проверка плеч и повязки · удар",fresh.position+Vector3(0,.88,0),3.2,18.)
	fresh.rotation.y=-PI*.5
	fresh.anim_player.seek(0.,true);fresh.anim_player.advance(0.)
	await shot("strike_side","Hunyuan v3 · правое плечо и повязка при замахе",fresh.position+Vector3(0,.88,0),3.2,18.)
	fresh.anim_player.play("walk");fresh.anim_player.seek(.25,true);fresh.anim_player.advance(0.)
	await shot("walk_side","Hunyuan v3 · боковая проверка шага",fresh.position+Vector3(0,.88,0),3.2,18.)
	scene.ws_client.disconnect_from_server();scene.free()
	await process_frame
	quit(0)
