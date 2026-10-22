extends SceneTree

## Visible blows: a spider lunges when the server reports a fresh bite or blow
## (attackAt), and a building shakes and puffs dust when its hp drops.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(tick: int, attack_at: int, gate_hp: float) -> Dictionary:
	var gate = {"id": "g1", "type": "gate", "stage": "built", "colonyId": "colony-1", "pos": {"x": 120, "y": 120}, "gateAxis": "horizontal", "gateSpan": 1, "hp": gate_hp, "maxHp": 80}
	var spider = {"id": "sp1", "type": "spider", "pos": {"x": 123, "y": 120}, "hp": 100, "maxHp": 100, "attackAt": attack_at, "attackPos": {"x": 120, "y": 120}}
	return {"tick": tick, "ants": [], "colonies": [], "enemies": [spider],
		"surface": {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}], "buildings": [gate], "deposits": [], "springs": [], "resourceNodes": [], "fish": []}}

func run() -> void:
	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	view.update_world_entities(snap(10, -1000, 80))
	var spider = view.active_world_nodes.get("sp1") as Node3D
	check("spider_drawn", spider != null)
	view._animate_world(0.1)
	check("no_lunge_without_attack", spider.rotation.x == 0.0)
	view.update_world_entities(snap(20, 19, 60))
	view._animate_world(0.2)
	check("lunges_on_fresh_attack", spider.rotation.x < -0.1, str(spider.rotation.x))
	var gate = view.active_buildings.get("g1") as Node3D
	check("hit_building_shakes", view.shaking_buildings.has("g1") and gate.get_node_or_null("HitDust") != null)
	for i in range(10):
		view._animate_world(0.1)
	check("lunge_settles", spider.rotation.x == 0.0)
	check("shake_settles", not view.shaking_buildings.has("g1"))
	view.update_world_entities(snap(200, 19, 60))
	view._animate_world(0.2)
	check("old_attack_no_lunge", spider.rotation.x == 0.0)
	view.queue_free()
	await process_frame
	print("ATTACK_FEEDBACK_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
