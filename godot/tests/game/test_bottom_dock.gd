extends SceneTree

## Stronghold-style bottom dock in the observer scene: build groups and works
## are tabs on the slab, game buttons and the mother's portrait sit in the
## dock, the tablet shows the tribe's numbers, hovering a tile writes on the
## slab, and the dock is glued to the bottom edge at full width.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func run() -> void:
	var scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	for i in range(5):
		await process_frame
	var dock: BottomDock = scene.dock
	check("dock_exists", dock != null)
	check("four_tabs", dock.tab_buttons.size() == 4 and dock.tab_buttons[3].text == "Работы", str(dock.tab_buttons.map(func(b): return b.text)))
	check("build_tiles_in_dock", dock.owns(scene.build.buttons["hut"]) and not scene.build.toolbar.visible)
	check("works_in_dock", dock.owns(scene.priority_panel))
	check("game_buttons_in_dock", dock.column.is_ancestor_of(scene.hud.speed_buttons[0]) and dock.column.is_ancestor_of(scene.hud.settings_button) and not scene.hud.quick_panel.visible)
	check("mother_portrait_in_dock", dock.portrait_slot.is_ancestor_of(scene.mother_speaker.portrait_frame))
	var view = root.get_viewport().get_visible_rect().size
	check("full_width_at_bottom", is_equal_approx(dock.size.x, view.x) and absf(dock.position.y + dock.size.y - view.y) < 1.0, "%s %s" % [dock.position, dock.size])
	dock.select_tab(3)
	await process_frame
	await process_frame
	check("works_tab_shown", scene.priority_panel.visible and not scene.build.buttons["hut"].is_visible_in_tree() and not dock.hint_label.visible)
	dock.select_tab(0)
	dock.show_hint("Хижина: +4")
	check("slab_hint", dock.hint_label.visible and dock.hint_label.text == "Хижина: +4")
	dock.update_from_snapshot({"tick": 6100, "ants": [{"colonyId": "colony-1", "state": "idle"}, {"colonyId": "colony-1", "state": "dead"}],
		"colonies": [{"id": "colony-1", "colony": {"nestCapacity": 12, "foodStock": {"fruit": 30, "meat": 5}, "specialClay": 3}}]}, 0)
	check("tablet_numbers", dock.tablet_labels.people.text == "Жители 1/12" and dock.tablet_labels.food.text == "Еда 35" and dock.tablet_labels.special.text == "Особая глина 3" and dock.tablet_labels.day.text.begins_with("День 2"),
		"%s | %s | %s | %s" % [dock.tablet_labels.people.text, dock.tablet_labels.food.text, dock.tablet_labels.special.text, dock.tablet_labels.day.text])
	scene.hud.settings_requested.emit()
	await process_frame
	check("settings_above_dock", scene.settings_panel.visible and scene.settings_panel.get_global_rect().end.y <= dock.position.y + 1.0)
	scene.queue_free()
	await process_frame
	print("BOTTOM_DOCK_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
