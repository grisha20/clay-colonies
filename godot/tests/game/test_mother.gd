extends SceneTree

## Stage «Праматерь ведёт племя игрока»: the «Праматерь решает / вручную»
## switch of the work panel, the advice feed (rows, "где", flash of new lines)
## and the mother figure at the hearth that molds a newcomer.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(auto: bool, advice: Array, ants: Array = []) -> Dictionary:
	return {
		"tick": 100,
		"ants": ants,
		"colonies": [{"colony": {"priorities": {"clay": 1, "wood": 1, "stone": 0, "build": 1, "guard": 1, "fish": 0}, "food": 50, "autoManage": auto, "advice": advice, "queenAlive": true, "fire": 1.0}}],
		"surface": {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}], "resourceNodes": [], "buildings": [], "deposits": [], "fish": []},
	}

func run() -> void:
	# Work panel switch.
	var panel = PriorityPanel.new()
	root.add_child(panel)
	await process_frame
	panel.update_from_snapshot(snap(true, []), 0)
	check("panel_auto_switch", panel.mother_seg.button_pressed and not panel.manual_seg.button_pressed)
	var asked = []
	panel.auto_manage_requested.connect(func(v): asked.append(v))
	panel.manual_seg.pressed.emit()
	check("panel_switch_to_manual", asked == [false], str(asked))
	panel.update_from_snapshot(snap(false, []), 0)
	check("panel_manual_switch", panel.manual_seg.button_pressed and not panel.mother_seg.button_pressed)
	panel.mother_seg.pressed.emit()
	check("panel_switch_back", asked == [false, true], str(asked))
	panel.queue_free()

	# Advice feed.
	var feed = AdviceFeed.new()
	root.add_child(feed)
	await process_frame
	feed.update_from_snapshot(snap(true, []), 0)
	check("feed_hidden_when_quiet", not feed.visible)
	var huts = {"key": "huts", "severity": "warn", "text": "Нам тесно — поставь ещё хижину", "since": 100, "pos": {"x": 100, "y": 100}}
	var rain = {"key": "rain", "severity": "info", "text": "Тучи собираются — скоро дождь", "since": 100}
	feed.update_from_snapshot(snap(true, [huts]), 0)
	await process_frame
	check("feed_visible", feed.visible and feed.rows.get_child_count() == 1)
	check("feed_new_flash", feed.last_new == ["huts"], str(feed.last_new))
	var shown = []
	feed.show_requested.connect(func(p): shown.append(p))
	var where: Button = null
	for c in feed.rows.get_child(0).get_children():
		if c is Button:
			where = c
	check("feed_where_button", where != null)
	if where:
		where.pressed.emit()
	check("feed_where_emits_pos", shown == [Vector2(100, 100)], str(shown))
	feed.update_from_snapshot(snap(true, [huts, rain]), 0)
	await process_frame
	check("feed_only_new_flashes", feed.last_new == ["rain"], str(feed.last_new))
	var rain_row = feed.rows.get_child(1)
	var rain_has_button = false
	for c in rain_row.get_children():
		rain_has_button = rain_has_button or c is Button
	check("feed_no_where_without_pos", not rain_has_button)
	feed.queue_free()

	# Mother at the hearth.
	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	var ants = [{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 101, "y": 101}, "state": "search"}]
	view.update_world_entities(snap(true, [], ants))
	await process_frame
	var mother = view.mothers[0] as Node3D
	check("mother_exists", mother != null and mother.visible)
	if mother:
		var gp = mother.global_position
		check("mother_by_hearth", Vector2(gp.x, gp.z).distance_to(Vector2(100, 100)) < 5.0, str(gp))
		var to_fire = (Vector3(100, gp.y, 100) - gp).normalized()
		var facing = mother.global_transform.basis.z.normalized()
		check("mother_faces_fire", facing.dot(to_fire) > 0.9, str(facing.dot(to_fire)))
		check("mother_tooltip", view.describe_at(Vector2(gp.x, gp.z)).begins_with("Праматерь"), view.describe_at(Vector2(gp.x, gp.z)))
	check("no_birth_on_first_snapshot", view.births_seen[0] == 0)
	ants.append({"id": "ant-2", "colonyId": "colony-1", "pos": {"x": 99, "y": 101}, "state": "search"})
	view.update_world_entities(snap(true, [], ants))
	check("birth_molds", view.births_seen[0] == 1 and view.mother_mold[0] > 1.0, str(view.births_seen))
	await process_frame
	var dead = snap(true, [], ants)
	dead.colonies[0].colony.queenAlive = false
	view.update_world_entities(dead)
	check("dead_mother_hidden", mother == null or not mother.visible)
	view.queue_free()
	await process_frame
	print("MOTHER_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
