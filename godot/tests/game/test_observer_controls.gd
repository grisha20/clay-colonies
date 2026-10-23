extends SceneTree

# Production observer scene and real viewport/physics input. No socket connection
# or simulation commands are made; the default URL only appears in the field.
var failures: int = 0

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, label: String) -> void:
	print("OBSERVER_CONTROLS ", "PASS " if value else "FAIL ", label)
	if not value:
		failures += 1

func snapshot(tick: int, ants: Array) -> Dictionary:
	return {"tick": tick, "session": {"speed": 1, "status": "playing"},
		"surface": {"width": 480, "height": 480, "buildings": [],
			"entrances": [{"x": 110, "y": 235}, {"x": 370, "y": 242}]}, "ants": ants}

func ant(id: String, x: float, colony: String) -> Dictionary:
	return {"id": id, "colonyId": colony, "pos": {"x": x, "y": 235.0},
		"heading": {"x": 0, "y": 1}, "role": "worker", "job": "harvest",
		"state": "idle", "carrying": 3, "carryKind": "clay"}

func mouse_event(point: Vector2, button: MouseButton, pressed: bool) -> void:
	var motion = InputEventMouseMotion.new()
	motion.position = point
	motion.global_position = point
	root.push_input(motion, true)
	var event = InputEventMouseButton.new()
	event.position = point
	event.global_position = point
	event.button_index = button
	event.pressed = pressed
	root.push_input(event, true)

func click(point: Vector2) -> void:
	mouse_event(point, MOUSE_BUTTON_LEFT, true)
	mouse_event(point, MOUSE_BUTTON_LEFT, false)

func key(code: Key, pressed: bool) -> void:
	var event = InputEventKey.new()
	event.keycode = code
	event.physical_keycode = code
	event.pressed = pressed
	Input.parse_input_event(event)
	Input.flush_buffered_events()

func run() -> void:
	root.size = Vector2i(1280, 720)
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	var view = scene.world_view
	var a = ant("inspect-a", 110.0, "colony-1")
	var b = ant("inspect-b", 112.0, "colony-2")
	scene._on_snapshot_received(snapshot(100, [a, b]))
	await physics_frame
	await process_frame
	check(scene.ws_client.current_state == WSClient.ClientState.DISCONNECTED and scene.ws_client.packets_received == 0,
		"inspection never connects or sends a game command")
	view.focus_on_colony(0)
	var camp_a = view.camera_pivot.position
	view.focus_on_colony(1)
	check(camp_a == Vector3(110, 0, 235) and view.camera_pivot.position == Vector3(370, 0, 242), "camp buttons use snapshot entrances")

	view.focus_on_colony(0)
	view.set_process(false)
	view.camera_distance = 14
	view.target_camera_distance = 14
	view._process(0)
	var wheel_point = Vector2(800, 300)
	for i in range(40):
		mouse_event(wheel_point, MOUSE_BUTTON_WHEEL_UP, true)
	var near = view.target_camera_distance
	view._process(0.1)
	var smooth = view.camera_distance > near and view.camera_distance < 14
	for i in range(80):
		mouse_event(wheel_point, MOUSE_BUTTON_WHEEL_DOWN, true)
	check(near >= 4 and view.target_camera_distance <= 80 and smooth, "wheel zoom is bounded and smooth")
	view.camera_pivot.position = Vector3(479, 0, 479)
	key(KEY_D, true)
	key(KEY_S, true)
	view._process(1)
	key(KEY_D, false)
	key(KEY_S, false)
	check(view.camera_pivot.position.x == 480 and view.camera_pivot.position.z == 480, "keyboard pan moves and stays in map")
	view.camera_pivot.position = Vector3(110, 0, 235)
	# The address field lives in the ⚙ settings menu: open it first.
	scene.hud.settings_requested.emit()
	check(scene.settings_panel.visible, "gear opens the settings menu")
	await process_frame
	scene.server_line_edit.grab_focus()
	var before_typing = view.camera_pivot.position
	key(KEY_W, true)
	view._process(1)
	key(KEY_W, false)
	check(view.camera_pivot.position == before_typing, "typing address does not pan camera")
	scene.server_line_edit.release_focus()

	var actor_a = scene.entity_registry.get_resident("inspect-a")
	var actor_b = scene.entity_registry.get_resident("inspect-b")
	view.focus_on_colony(0)
	view.camera_distance = 14
	view.target_camera_distance = 14
	view._process(0)
	await physics_frame
	await process_frame
	var point_a = view.camera.unproject_position(actor_a.global_position + Vector3(0, 0.55, 0))
	var point_b = view.camera.unproject_position(actor_b.global_position + Vector3(0, 0.55, 0))
	check(scene.resident_at_screen(point_a) == actor_a and scene.resident_at_screen(point_b) == actor_b, "physics rays pick residents of both tribes")
	click(point_a)
	await process_frame
	check(scene.selected_resident_id == "inspect-a" and actor_a.selection_ring.visible and not actor_b.selection_ring.visible,
		"viewport click selects and highlights resident")
	var capture = OS.get_environment("CLAYFOLK_UI_CAPTURE")
	if not capture.is_empty() and DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		DirAccess.make_dir_recursive_absolute(capture.get_base_dir())
		check(root.get_texture().get_image().save_png(capture) == OK, "GPU inspector screenshot")
	click(scene.server_line_edit.get_global_rect().get_center())
	check(scene.selected_resident_id == "inspect-a", "HUD click does not clear world selection")
	var zoom_before_hud = view.target_camera_distance
	mouse_event(scene.server_line_edit.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, true)
	check(view.target_camera_distance == zoom_before_hud, "HUD consumes mouse wheel")
	scene.server_line_edit.release_focus()

	scene._on_snapshot_received(snapshot(101, [b.duplicate(true), a.duplicate(true)]))
	check(scene.selected_resident_id == "inspect-a" and scene.inspector_label.text.contains("inspect-a") and scene.inspector_label.text.contains("глина (3)"),
		"selection uses stable ID after snapshot reorder")
	key(KEY_F, true)
	key(KEY_F, false)
	await process_frame
	check(view.focused_target == actor_a, "F follows selected resident")
	key(KEY_D, true)
	view._process(0.1)
	key(KEY_D, false)
	check(view.focused_target == null and scene.selected_resident_id == "inspect-a", "manual pan releases follow without changing selection")
	var changed = a.duplicate(true)
	changed.job = "guard"
	changed.carrying = 4
	changed.carryKind = "wood"
	scene._on_snapshot_received(snapshot(102, [changed, b.duplicate(true)]))
	actor_a._process(0.3)
	scene._process(0)
	check(scene.inspector_label.text.contains("охрана") and scene.inspector_label.text.contains("дерево (4)"), "inspector refreshes occupation and displayed cargo")
	scene._on_snapshot_received(snapshot(103, [b.duplicate(true)]))
	check(scene.selected_resident_id.is_empty() and scene.inspector_label.text.contains("не выбран") and scene.follow_button.disabled,
		"despawn clears selection and stale inspector")
	# Esc steps back one layer at a time: open panels first, then the selection.
	scene.settings_panel.visible = false
	scene.close_start_menu()
	scene.select_resident(actor_b)
	key(KEY_ESCAPE, true)
	key(KEY_ESCAPE, false)
	await process_frame
	check(scene.selected_resident_id.is_empty() and not actor_b.selection_ring.visible, "Escape clears selection and ring")
	key(KEY_ESCAPE, true)
	key(KEY_ESCAPE, false)
	await process_frame
	check(scene.pause_menu.visible, "Escape with nothing open shows the pause menu")
	key(KEY_ESCAPE, true)
	key(KEY_ESCAPE, false)
	await process_frame
	check(not scene.pause_menu.visible, "Escape closes the pause menu")
	scene.select_resident(actor_b)
	scene._on_connected()
	check(scene.selected_resident_id.is_empty(), "reconnect clears selection")
	view.set_process(true)
	# Optional screenshot only on an actual GPU run; no tracked media is replaced.
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
	scene.free()
	await process_frame
	print("OBSERVER_CONTROLS_FAILURES=", failures)
	quit(1 if failures > 0 else 0)
