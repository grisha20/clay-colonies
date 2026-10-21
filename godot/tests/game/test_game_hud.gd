extends SceneTree

## GameHud and hover descriptions: stores of the controlled tribe, tasks,
## raid/weather alerts, speed/alarm state and tooltips for world objects.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(tick: int) -> Dictionary:
	return {
		"tick": tick,
		"session": {"speed": 5, "status": "playing", "playerColonyIndex": 1, "raid": {"phase": "warning", "at": tick + 600}},
		"weather": {"state": "rain", "bigRainAt": tick + 900},
		"colonies": [
			{"id": "colony-1", "colony": {"clay": 1, "wood": 2, "stone": 3, "foodStock": {"fruit": 4}}},
			{"id": "colony-2", "colony": {"clay": 12, "wood": 34, "stone": 5, "foodStock": {"fruit": 40, "fish": 2, "meat": 1}, "alarm": true}},
		],
		"objectives": [
			{"id": "a", "text": "Запасти 40 глины", "target": 40, "progress": 12, "done": false},
			{"id": "b", "text": "Одолеть паука", "target": 1, "progress": 0, "done": false, "victory": true},
			{"id": "c", "text": "Построить мастерскую", "target": 1, "progress": 1, "done": true},
		],
		"surface": {
			"entrances": [{"x": 120, "y": 240}, {"x": 360, "y": 240}],
			"resourceNodes": [
				{"id": "t", "kind": "tree", "pos": {"x": 50, "y": 50}, "amount": 6},
				{"id": "s", "kind": "tree", "pos": {"x": 60, "y": 50}, "amount": 2, "growth": "sapling"},
				{"id": "w1", "kind": "stone", "pos": {"x": 300, "y": 300}, "amount": 100, "depositId": "dep-s"},
			],
			"deposits": [{"id": "dep-s", "kind": "stone", "pos": {"x": 300, "y": 300}, "capacity": 7200}],
			"foodSources": [{"id": "f", "pos": {"x": 80, "y": 80}, "amount": 0, "kind": "food"}],
			"buildings": [{"id": "h", "type": "hut", "colonyId": "colony-2", "stage": "inProgress", "progress": 0.4, "pos": {"x": 200, "y": 100}}],
		},
		"enemies": [{"id": "sp", "type": "spider", "pos": {"x": 400, "y": 50}, "hp": 30, "maxHp": 60}],
	}

func run() -> void:
	var hud = GameHud.new()
	root.add_child(hud)
	await process_frame
	var s = snap(4300)
	hud.update_from_snapshot(s, 21)
	check("player_tribe_stores", hud.resource_labels.clay.text == "12" and hud.resource_labels.wood.text == "34" and hud.resource_labels.food.text == "43" and hud.resource_labels.people.text == "21")
	check("night_and_rain_label", hud.weather_label.text == "День 1 · ночь · дождь", hud.weather_label.text)
	check("speed_button_follows_server", hud.speed_buttons[5].button_pressed and not hud.speed_buttons[1].button_pressed)
	check("alarm_button_follows_server", hud.alarm_button.button_pressed)
	check("tasks_listed", hud.tasks_box.get_child_count() == 3)
	check("raid_and_rain_alerts", hud.alert_panel.visible and hud.alert_label.text.contains("набег") and hud.alert_label.text.contains("Дождь") and hud.alert_label.text.contains("Большой дождь"), hud.alert_label.text)
	var asked = []
	hud.speed_requested.connect(func(v): asked.append(v))
	hud.speed_buttons[20].pressed.emit()
	check("speed_button_emits", asked == [20])
	hud.show_tooltip("Дерево", Vector2(100, 100))
	check("tooltip_shows", hud.tooltip_panel.visible and hud.tooltip_label.text == "Дерево")
	hud.show_tooltip("", Vector2(100, 100))
	check("tooltip_hides", not hud.tooltip_panel.visible)

	var view = WorldView.new()
	root.add_child(view)
	view.set_process(false)
	view.update_world_entities(s)
	check("describe_tree", view.describe_at(Vector2(50.3, 50.2)) == "Дерево · 6 дерева · нужен топор", view.describe_at(Vector2(50.3, 50.2)))
	check("describe_sapling", view.describe_at(Vector2(60, 50)).begins_with("Росток"))
	check("describe_quarry", view.describe_at(Vector2(305, 302)).begins_with("Каменный карьер · 100 / 7200"), view.describe_at(Vector2(305, 302)))
	check("describe_bare_bush", view.describe_at(Vector2(80, 80)).contains("обобран"))
	check("describe_site", view.describe_at(Vector2(200, 100)) == "Хижина племени B · строится 40%", view.describe_at(Vector2(200, 100)))
	check("describe_spider", view.describe_at(Vector2(401, 50)) == "Паук · здоровье 30 / 60")
	check("describe_campfire", view.describe_at(Vector2(120, 241)).begins_with("Костёр племени A"))
	check("describe_lake", view.describe_at(Vector2(230, 135)).begins_with("Озеро"))
	check("open_ground_is_silent", view.describe_at(Vector2(440, 440)) == "")

	view.queue_free()
	hud.queue_free()
	await process_frame
	print("GAME_HUD_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
