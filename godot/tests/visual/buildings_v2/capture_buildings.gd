extends SceneTree

## Review stand after loading an isolated QA world. Models use the production
## factory and lighting; stand instances are local, no server/save commands.
const Audit=preload("res://tests/visual/buildings_v2/probe_assets.gd")
var scene: WorldObserver

func _initialize() -> void:call_deferred("run")
func frames(n: int) -> void:
	for i in range(n):await process_frame

func run() -> void:
	var port="";var stage="1"
	var args=OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i]=="--qa-port" and i+1<args.size():port=args[i+1]
		if args[i]=="--stage" and i+1<args.size():stage=args[i+1]
	if not port.begins_with("88"):push_error("Isolated QA required");quit(2);return
	var groups={"1":["house","storage","workshop"],"2":["kiln","campfire"],"3":["idol","totem"]}
	var output=ProjectSettings.globalize_path("res://../docs/godot/screenshots/buildings_v2")
	DirAccess.make_dir_recursive_absolute(output)
	scene=load("res://scenes/game/world_observer.tscn").instantiate();root.add_child(scene)
	scene.set_ui_scale(100,false)
	var until=Time.get_ticks_msec()+20000
	while scene.world_view.last_snapshot.is_empty():
		if Time.get_ticks_msec()>until:quit(2);return
		await process_frame
	scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
	# Standard daytime on this local review stand; production atmosphere code
	# and the server state are unchanged. This avoids comparing night to a card.
	var daylight=scene.world_view.last_snapshot.duplicate(true)
	daylight["tick"]=1000;daylight["weather"]={"state":"clear"};daylight["session"]={"speed":0}
	scene.world_view.update_world_entities(daylight)
	scene.get_node("HUD").visible=false
	for resident in scene.entity_registry.residents.values():resident.visible=false
	var view=scene.world_view
	view.buildings_container.visible=false
	view.campfires_container.visible=false
	await frames(120)
	var center=view.colony_focus_points[0]+Vector3(0,0,19)
	center.y=SurfaceTerrain.height_at(center.x,center.z)
	for type in groups[stage]:
		var model=view._make_building("hut" if type=="house" else type,true,false,1,0,2 if type=="house" else 1)
		if type=="campfire":
			model.free()
			model=view.active_campfires[0].duplicate()
			for child in model.get_children():
				if child.name not in ["CampfireV2","Flame","FireLight"]:child.free()
		if type=="kiln":
			model.get_node("Glow").visible=true;model.get_node("KilnLight").visible=true
		view.add_child(model);model.position=center
		var box=Audit.bounds(model)
		view.focused_target=null;view.camera_navigated=true
		view.camera_pivot.position=center+Vector3(0,box.size.y*.48,.5)
		view.camera_yaw=deg_to_rad(25);view.camera_angle_deg=52
		view.camera.rotation_degrees.x=-52
		view.target_camera_distance=maxf(7.5,box.size.x*1.35);view.camera_distance=view.target_camera_distance
		if type=="campfire":view.target_camera_distance=2.8;view.camera_distance=2.8
		await frames(40);await RenderingServer.frame_post_draw
		var path=output.path_join(type+"_close.png")
		var error=root.get_texture().get_image().save_png(path)
		if error!=OK:push_error("Capture failed");quit(3);return
		print("BUILDING_CAPTURE ",path)
		if type in ["kiln","campfire"]:
			model.get_node("Glow" if type=="kiln" else "Flame").visible=false
			model.get_node("KilnLight" if type=="kiln" else "FireLight").visible=false
			await frames(10);await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(output.path_join(type+"_cold.png"))
		model.free()
	scene.ws_client.disconnect_from_server();scene.free();await process_frame;quit()
