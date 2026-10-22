extends SceneTree

## Mouse camera: held right button turns the view, a plain right click does
## not; held middle button drags the map; Home turns north back up.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func button(view: WorldView, index: int, pressed: bool) -> void:
	var e = InputEventMouseButton.new()
	e.button_index = index
	e.pressed = pressed
	view._unhandled_input(e)

func motion(view: WorldView, rel: Vector2) -> void:
	var e = InputEventMouseMotion.new()
	e.relative = rel
	view._unhandled_input(e)

func run() -> void:
	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	view.camera_pivot.position = Vector3(200, 0, 200)

	button(view, MOUSE_BUTTON_RIGHT, true)
	motion(view, Vector2(2, 0))
	check("tiny_wiggle_does_not_turn", view.camera_yaw == 0.0)
	button(view, MOUSE_BUTTON_RIGHT, false)
	check("plain_right_click_not_swallowed", not view._rmb_rotated)

	button(view, MOUSE_BUTTON_RIGHT, true)
	for i in range(10):
		motion(view, Vector2(-20, 0))
	check("right_drag_turns", view.camera_yaw > 1.0, str(view.camera_yaw))
	check("turn_applies_to_pivot", is_equal_approx(view.camera_pivot.rotation.y, view.camera_yaw))
	button(view, MOUSE_BUTTON_RIGHT, false)
	check("turn_marks_release", view._rmb_rotated)

	# With the view turned 90°, dragging right still moves the map with the cursor.
	view.camera_yaw = PI * 0.5
	var before = view.camera_pivot.position
	button(view, MOUSE_BUTTON_MIDDLE, true)
	motion(view, Vector2(100, 0))
	button(view, MOUSE_BUTTON_MIDDLE, false)
	var moved = view.camera_pivot.position - before
	var screen_right = Basis(Vector3.UP, view.camera_yaw) * Vector3.RIGHT
	check("middle_drag_pans_against_cursor", moved.dot(screen_right) < -1.0, str(moved))
	before = view.camera_pivot.position
	motion(view, Vector2(100, 0))
	check("no_pan_after_release", view.camera_pivot.position.is_equal_approx(before))

	var home = InputEventKey.new()
	home.keycode = KEY_HOME
	home.pressed = true
	view._unhandled_input(home)
	check("home_resets_north", view.camera_yaw == 0.0)

	view.queue_free()
	await process_frame
	print("CAMERA_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
