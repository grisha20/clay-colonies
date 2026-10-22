extends SceneTree

## Gate leaves swing open for a resident of the owner tribe and stay shut for
## strangers (the server lets only the owner through).
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(ants: Array) -> Dictionary:
	var gate = {"id": "g1", "type": "gate", "stage": "built", "colonyId": "colony-1", "pos": {"x": 120, "y": 120}, "gateAxis": "horizontal", "gateSpan": 1, "progress": 1}
	return {"tick": 1, "ants": ants, "colonies": [],
		"surface": {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}], "buildings": [gate], "deposits": [], "springs": [], "resourceNodes": [], "fish": []}}

func ant(colony: String, x: float, y: float) -> Dictionary:
	return {"id": "a-" + colony, "colonyId": colony, "pos": {"x": x, "y": y}, "state": "search"}

func leaf_angle(view: WorldView) -> float:
	var node = view.active_buildings.get("g1") as Node3D
	return (node.get_node("Leaves/LeafR") as Node3D).rotation.y

func settle(view: WorldView) -> void:
	for i in range(30):
		view._animate_gates(0.05)

func run() -> void:
	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	view.update_world_entities(snap([]))
	var node = view.active_buildings.get("g1") as Node3D
	check("gate_has_leaves", node != null and node.get_node_or_null("Leaves/LeafL") != null and node.get_node_or_null("Leaves/LeafR") != null)
	settle(view)
	check("closed_when_alone", absf(leaf_angle(view)) < 0.01)
	view.update_world_entities(snap([ant("colony-2", 121, 120)]))
	settle(view)
	check("stranger_does_not_open", absf(leaf_angle(view)) < 0.01, str(leaf_angle(view)))
	view.update_world_entities(snap([ant("colony-1", 121.5, 121)]))
	settle(view)
	check("owner_opens", leaf_angle(view) > 1.5, str(leaf_angle(view)))
	view.update_world_entities(snap([ant("colony-1", 130, 130)]))
	settle(view)
	check("closes_after_passing", absf(leaf_angle(view)) < 0.01, str(leaf_angle(view)))
	view.queue_free()
	await process_frame
	print("GATE_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
