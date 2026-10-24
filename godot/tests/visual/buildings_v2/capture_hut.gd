extends SceneTree

## Actual QA building, unchanged game lighting and 52-degree camera. Only
## the close-up hides the HUD. No world fixtures, build/save/speed commands.
var scene: WorldObserver
var out := "res://../docs/godot/screenshots/buildings_v2"

func _initialize() -> void: call_deferred("run")

func frames(count: int) -> void:
	for i in range(count): await process_frame

func capture(name: String) -> void:
	await frames(30)
	await RenderingServer.frame_post_draw
	var error = root.get_texture().get_image().save_png(out.path_join(name+".png"))
	if error != OK: push_error("Capture failed"); quit(3)
	print("HUT_CAPTURE ", name)

func focus(point: Vector3, distance: float) -> void:
	var view = scene.world_view
	view.focused_target = null
	view.camera_navigated = true
	view.camera_pivot.position = point
	view.camera_yaw = 0
	view.camera_angle_deg = 52
	view.camera.rotation_degrees.x = -52
	view.camera_distance = distance
	view.target_camera_distance = distance

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i]=="--qa-port" and i+1<args.size():port=args[i+1]
	if not port.begins_with("88"): push_error("QA 88xx required");quit(2);return
	out=ProjectSettings.globalize_path(out)
	DirAccess.make_dir_recursive_absolute(out)
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	scene.set_ui_scale(100,false)
	var until = Time.get_ticks_msec()+20000
	while scene.world_view.active_buildings.is_empty():
		if Time.get_ticks_msec()>until:quit(2);return
		await process_frame
	scene.close_start_menu()
	await frames(60)
	var selected: Node3D
	for building in scene.world_view.last_snapshot.surface.buildings:
		if building.type=="hut" and building.stage=="built" and int(building.get("level",1))==1:
			selected=scene.world_view.active_buildings.get(str(building.id));break
	if not selected: push_error("QA has no built level-1 hut");quit(2);return
	scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
	Input.warp_mouse(Vector2(900,120))
	focus(scene.world_view.colony_focus_points[0],24)
	await capture("hut_ingame")
	scene.get_node("HUD").visible=false
	focus(selected.position+Vector3(0,2.45,.5),8.8)
	await capture("hut_close")
	scene.ws_client.disconnect_from_server()
	scene.free();await process_frame;quit()
