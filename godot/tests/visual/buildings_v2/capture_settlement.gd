extends SceneTree

## Final unretouched live QA settlement, no local model stand or UI changes.
func _initialize() -> void:call_deferred("run")
func run() -> void:
	var args=OS.get_cmdline_user_args();var port=""
	for i in range(args.size()):
		if args[i]=="--qa-port" and i+1<args.size():port=args[i+1]
	if not port.begins_with("88"):push_error("Isolated QA required");quit(2);return
	var scene=load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene);scene.set_ui_scale(100,false)
	var until=Time.get_ticks_msec()+20000
	while scene.world_view.last_snapshot.is_empty():
		if Time.get_ticks_msec()>until:quit(2);return
		await process_frame
	var view=scene.world_view
	var found={}
	for b in view.last_snapshot.surface.buildings:
		if b.colonyId=="colony-1" and b.stage=="built":found["house" if b.type=="hut" and int(b.get("level",1))>=2 else b.type]=true
	for type in ["hut","house","storage","workshop","kiln","idol","totem"]:
		if not found.has(type):push_error("Missing QA building: "+type);quit(3);return
	scene.close_start_menu();view.focused_target=null;view.camera_navigated=true
	# Move the framing toward the foreground, keeping the kiln above the HUD.
	view.camera_pivot.position=view.colony_focus_points[0]+Vector3(0,0,5)
	view.camera_yaw=0;view.camera_angle_deg=52;view.camera.rotation_degrees.x=-52
	view.target_camera_distance=34;view.camera_distance=34
	Input.warp_mouse(Vector2(10,root.size.y*.65))
	for i in range(180):await process_frame
	await RenderingServer.frame_post_draw
	var output=ProjectSettings.globalize_path("res://../docs/godot/screenshots/buildings_v2")
	DirAccess.make_dir_recursive_absolute(output)
	var file=output.path_join("settlement_%dx%d.png" % [root.size.x,root.size.y])
	var error=root.get_texture().get_image().save_png(file)
	if error!=OK:push_error("Capture failed");quit(3);return
	print("SETTLEMENT_CAPTURE ",file," QA tick=",view.last_snapshot.get("tick")," models=",found.keys())
	scene.ws_client.disconnect_from_server();scene.free();await process_frame;quit()
