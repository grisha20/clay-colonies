extends SceneTree

## HUD hints use the HUD tooltip panel: the hovered control or an ancestor
## supplies the text, and the panel stays on screen near the edges.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func run() -> void:
	var tile = Button.new()
	tile.tooltip_text = "Хижина: +4 места"
	var pic = TextureRect.new()
	tile.add_child(pic)
	root.add_child(tile)
	check("tip_from_ancestor", WorldObserver._ui_tooltip(pic) == "Хижина: +4 места")
	check("no_tip", WorldObserver._ui_tooltip(Label.new()) == "")

	var hud = GameHud.new()
	root.add_child(hud)
	await process_frame
	var view = root.get_viewport().get_visible_rect().size
	hud.show_tooltip("Длинная подсказка про постройку\nи вторая строка", Vector2(view.x - 10, view.y - 10))
	var r = Rect2(hud.tooltip_panel.position, hud.tooltip_panel.size)
	check("panel_visible", hud.tooltip_panel.visible)
	check("stays_on_screen_bottom_right", r.end.x <= view.x and r.end.y <= view.y and r.position.x >= 0 and r.position.y >= 0, str(r))
	hud.show_tooltip("Слева сверху", Vector2(20, 20))
	check("normal_offset", hud.tooltip_panel.position == Vector2(38, 38), str(hud.tooltip_panel.position))
	hud.show_tooltip("", Vector2.ZERO)
	check("hides_on_empty", not hud.tooltip_panel.visible)
	hud.queue_free()
	tile.queue_free()
	await process_frame
	print("HUD_TOOLTIP_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
