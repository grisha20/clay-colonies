extends SceneTree

## Stage «Доминирование» in the client: dominance countdown and finale scores
## in the HUD alert, a besieged totem that leans with damage and throws dust.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func hud_snap(session: Dictionary, weather: Dictionary, tick: int) -> Dictionary:
	return {"tick": tick, "session": session, "weather": weather, "colonies": [{"colony": {}}], "objectives": []}

func run() -> void:
	var hud = GameHud.new()
	root.add_child(hud)
	await process_frame
	hud.update_from_snapshot(hud_snap({"status": "playing", "dominance": {"holder": "colony-1", "since": 1000, "count": 2, "required": 12000}}, {"state": "clear"}, 4000), 10)
	check("own dominance countdown", hud.alert_label.text.contains("Мы держим 2 источника: победа через 900 с."), hud.alert_label.text)
	hud.update_from_snapshot(hud_snap({"status": "playing", "dominance": {"holder": "colony-2", "since": 1000, "count": 3, "required": 6000}}, {"state": "clear"}, 1000), 10)
	check("rival all-spring warning", hud.alert_label.text.contains("Соседи держат 3 источника: поражение через 600 с."), hud.alert_label.text)
	hud.update_from_snapshot(hud_snap({"status": "playing", "finaleScores": [54, 16]}, {"state": "rain", "bigRainActive": true}, 61000), 10)
	check("finale scores", hud.alert_label.text.contains("Счёт племён: A 54 — B 16"), hud.alert_label.text)
	hud.update_from_snapshot(hud_snap({"status": "playing"}, {"state": "clear", "bigRainAt": 60000}, 59000), 10)
	check("finale is announced", hud.alert_label.text.contains("Великий ливень — финал партии — через 100 с."), hud.alert_label.text)
	hud.queue_free()

	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	var totem = {"id": "t1", "type": "totem", "stage": "built", "colonyId": "colony-1", "pos": {"x": 150, "y": 150}, "hp": 150, "maxHp": 150, "progress": 1}
	var snap = {"tick": 1, "ants": [], "colonies": [], "surface": {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}], "buildings": [totem], "deposits": [], "springs": [], "resourceNodes": [], "fish": []}}
	view.update_world_entities(snap)
	var node = view.active_buildings.get("t1") as Node3D
	check("healthy totem stands straight", node != null and is_zero_approx(node.rotation.z))
	totem.hp = 75
	view.update_world_entities(snap)
	check("damaged totem leans", node.rotation.z > 0.1, str(node.rotation.z))
	check("hit throws dust", node.get_node_or_null("SiegeDust") != null)
	check("tooltip shows strength", view.describe_at(Vector2(150, 150.5)).contains("прочность 75 / 150"), view.describe_at(Vector2(150, 150.5)))
	# House of the clan: picking the hut and why not, and how it looks.
	var hut = {"id": "bld-7", "type": "hut", "stage": "built", "colonyId": "colony-1", "pos": {"x": 200, "y": 200}, "hp": 120, "maxHp": 120, "progress": 1}
	var surf = {"entrances": [{"x": 100, "y": 100}], "buildings": [hut]}
	var rich = {"clay": 50, "wood": 50, "specialClay": 20}
	check("house: own hut under cursor", BuildRules.house_target(surf, rich, "colony-1", Vector2(201, 201))[1] == "")
	check("house: needs special clay", BuildRules.house_target(surf, {"clay": 50, "wood": 50, "specialClay": 2}, "colony-1", Vector2(200, 200))[1] == "Не хватает особой глины")
	check("house: rival hut refused", BuildRules.house_target(surf, rich, "colony-2", Vector2(200, 200))[1] == "Наведите на свою хижину")
	check("house: nothing under cursor", BuildRules.house_target(surf, rich, "colony-1", Vector2(260, 260))[1] == "Наведите на свою хижину")
	check("house: cost text", BuildRules.cost_text("house") == "12 глина, 6 дерево, 8 особая глина", BuildRules.cost_text("house"))
	check("house tool listed", BuildController.TOOLS.any(func(t): return t[0] == "house" and t[2] == "U"))
	snap.surface.buildings = [hut]
	view.update_world_entities(snap)
	var hut_node = view.active_buildings.get("bld-7") as Node3D
	check("plain hut has no house decor", hut_node != null and hut_node.get_node_or_null("HouseDecor") == null)
	hut["level"] = 2
	view.update_world_entities(snap)
	hut_node = view.active_buildings.get("bld-7") as Node3D
	check("house of the clan gets its decor", hut_node != null and hut_node.get_node_or_null("HouseDecor") != null)
	check("house tooltip", view.describe_at(Vector2(200, 200.5)).begins_with("Дом рода"), view.describe_at(Vector2(200, 200.5)))
	view.queue_free()
	await process_frame
	print("DOMINANCE_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
