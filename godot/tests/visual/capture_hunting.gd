extends SceneTree

## Review shots of game animals and a hunter (resident v3, spear, 1.15×).
##   godot_console --path godot --script tests/visual/capture_hunting.gd -- --qa-port <port>
var scene: WorldObserver
var out: String

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func shot(name: String, focus: Vector3, distance: float, angle: float, yaw: float = 0.0) -> void:
	var wv = scene.world_view
	wv.set_process(false)
	wv.camera_pivot.position = focus
	wv.camera_pivot.rotation.y = yaw
	wv.camera_angle_deg = angle
	wv.camera.fov = 40.
	wv.camera.rotation_degrees.x = -angle
	var rad = deg_to_rad(angle)
	wv.camera.position = Vector3(0, sin(rad) * distance, cos(rad) * distance)
	await frames(20)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_jpg(out.path_join(name + ".jpg"), .9)
	print("HUNT_CAPTURE ", name)

func prop(mesh: Mesh, pos: Vector3, yaw: float) -> void:
	var mi = MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation.y = yaw
	scene.add_child(mi)

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
	if port.is_empty():
		push_error("Require --qa-port <isolated port>")
		quit(2); return
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/hunting")
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
	for r in scene.entity_registry.residents.values(): r.visible = false
	var c = scene.world_view.colony_focus_points[0] + Vector3(12, 0, 10)
	c.y = SurfaceTerrain.height_at(c.x, c.z)
	prop(PropFactory.deer(), c + Vector3(2.5, 0, 0), -PI * 0.5)
	prop(PropFactory.deer(), c + Vector3(4.2, 0, 1.6), -PI * 0.3)
	prop(PropFactory.hare(), c + Vector3(1.8, 0, 2.2), PI)
	var plain = NetworkResident.new()
	scene.add_child(plain)
	plain.update_from_ant_data({"id": "plain", "colonyId": "colony-1", "pos": {"x": c.x - 2.0, "y": c.z}, "state": "idle", "job": "forage", "tick": 1}, .1, 1.)
	plain.set_process(false); plain.position = c + Vector3(-2.0, 0, 0)
	var hunter = NetworkResident.new()
	scene.add_child(hunter)
	hunter.update_from_ant_data({"id": "hunter", "colonyId": "colony-1", "pos": {"x": c.x, "y": c.z}, "state": "search", "job": "hunt", "tick": 1}, .1, 1.)
	hunter.set_process(false); hunter.position = c
	hunter._update_movement_and_animation(1.0)
	hunter.rotation.y = PI * 0.5
	hunter.anim_player.play("walk"); hunter.anim_player.seek(0.3, true); hunter.anim_player.advance(0.); hunter.anim_player.speed_scale = 0.
	plain.rotation.y = PI * 0.5
	var brave = NetworkResident.new()
	scene.add_child(brave)
	brave.update_from_ant_data({"id": "warrior", "colonyId": "colony-1", "pos": {"x": c.x - 4.2, "y": c.z}, "state": "idle", "job": "guard", "warrior": true, "tick": 1}, .1, 1.)
	brave.set_process(false); brave.position = c + Vector3(-4.2, 0, 0)
	brave._update_movement_and_animation(0.0)
	brave.rotation.y = PI * 0.5
	await shot("hunt_side", c + Vector3(1, .9, 0), 8.5, 12.)
	for spec in [["warrior_front", 0.0], ["warrior_back", PI], ["warrior_three_quarter", PI * 0.3]]:
		brave.rotation.y = spec[1]
		hunter.visible = false
		await shot(spec[0], brave.position + Vector3(0, 1.0, 0), 3.6, 10.)
	hunter.visible = true
	brave.rotation.y = PI * 0.5
	hunter.set_work({"kind": "hunt", "target": c + Vector3(2.5, 0, 0)})
	hunter._update_movement_and_animation(0.0)
	hunter.anim_player.seek(0.35, true); hunter.anim_player.advance(0.); hunter.anim_player.speed_scale = 0.
	await shot("hunt_throw", c + Vector3(1, .9, 0), 6.0, 14., -0.4)
	await shot("hunt_game_camera", c + Vector3(1, 0, 0), 16., 52.)
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	quit(0)
