extends SceneTree

## Minimap: map ↔ minimap coordinates, terrain painted once per map, click and
## drag ask the camera to move there, the camera frame is kept; in the observer
## it sits bottom-right with the mother perched on its top edge.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func run() -> void:
	var m = Minimap.new()
	root.add_child(m)
	await process_frame
	m.canvas.size = Vector2(240, 240)
	check("to_map", m.to_map(Vector2(240, 120)).is_equal_approx(Vector2(120, 60)))
	check("to_world_clamped", m.to_world(Vector2(300, -5)) == Vector2(480, 0))
	var snap = {"surface": {"entrances": [{"x": 100, "y": 100}, {"x": 380, "y": 380}], "terrain": {}, "buildings": [], "resourceNodes": []}, "ants": [], "enemies": []}
	m.update_from_snapshot(snap)
	var t0 = Time.get_ticks_msec()
	while m.terrain_tex == null and Time.get_ticks_msec() - t0 < 5000:
		await process_frame
	var tex = m.terrain_tex
	check("terrain_painted_in_background", tex != null and tex.get_width() == Minimap.TERRAIN_RES)
	m.update_from_snapshot(snap)
	check("terrain_painted_once", m.terrain_tex == tex)
	var asked: Array = []
	m.focus_requested.connect(func(p): asked.append(p))
	var press = InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.position = Vector2(60, 180)
	m._on_input(press)
	var drag = InputEventMouseMotion.new()
	drag.position = Vector2(120, 120)
	m._on_input(drag)
	check("click_and_drag_focus", asked.size() == 2 and asked[0] == Vector2(120, 360) and asked[1] == Vector2(240, 240), str(asked))
	m.set_view_quad(PackedVector2Array([Vector2(0, 0), Vector2(10, 0), Vector2(10, 10), Vector2(0, 10)]))
	check("view_quad_kept", m.view_quad.size() == 4)
	m.queue_free()

	var scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	for i in range(6):
		await process_frame
	var view = root.get_viewport().get_visible_rect().size
	var map_rect: Rect2 = scene.minimap.get_global_rect()
	check("minimap_bottom_right", map_rect.end.x <= view.x and map_rect.end.x > view.x - 40 and map_rect.end.y > view.y - 40, str(map_rect))
	var portrait: Rect2 = scene.mother_speaker.portrait_frame.get_global_rect()
	check("mother_sits_on_minimap", portrait.end.y > map_rect.position.y and portrait.end.y < map_rect.position.y + 60 and portrait.get_center().x > map_rect.position.x and portrait.get_center().x < map_rect.end.x, "%s vs %s" % [portrait, map_rect])
	check("works_panel_separate_top_right", scene.priority_panel.get_parent() is CanvasLayer and scene.priority_panel.get_global_rect().position.y < 120)
	check("build_bar_bottom", scene.build.toolbar.visible)
	scene.queue_free()
	await process_frame
	print("MINIMAP_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
