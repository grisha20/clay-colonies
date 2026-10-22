extends SceneTree

## Hunting in the client: deer and hares drawn from surface.animals (dead
## ones hidden), a hunter is a head taller and carries a spear while stalking,
## throws (work clip facing the prey) within range, and the panel has a hunt row.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(animals: Array, ants: Array = []) -> Dictionary:
	return {"tick": 10, "ants": ants, "enemies": [],
		"colonies": [{"id": "colony-1", "colony": {"priorities": {"hunt": 2}, "spears": 1, "food": 50, "autoManage": false}}],
		"surface": {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}], "buildings": [], "deposits": [], "springs": [], "resourceNodes": [], "fish": [], "animals": animals}}

func run() -> void:
	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	var deer = {"id": "deer-1", "kind": "deer", "pos": {"x": 200, "y": 200}, "heading": {"x": 1, "y": 0}, "hp": 2, "state": "graze"}
	var hare = {"id": "hare-2", "kind": "hare", "pos": {"x": 210, "y": 200}, "heading": {"x": 0, "y": 1}, "hp": 1, "state": "flee"}
	view.update_world_entities(snap([deer, hare]))
	check("deer_drawn", view.active_world_nodes.has("deer-1") and (view.active_world_nodes["deer-1"] as MeshInstance3D).mesh == PropFactory.deer())
	check("hare_drawn", view.active_world_nodes.has("hare-2") and (view.active_world_nodes["hare-2"] as MeshInstance3D).mesh == PropFactory.hare())
	check("animal_tooltip", view.describe_at(Vector2(200, 200)).begins_with("Олень"), view.describe_at(Vector2(200, 200)))
	var dead = deer.duplicate(); dead["state"] = "dead"
	view.update_world_entities(snap([dead, hare]))
	check("dead_game_hidden", not view.active_world_nodes.has("deer-1"))
	view.queue_free()

	var hunter_data = {"id": "ant-h", "colonyId": "colony-1", "pos": {"x": 195, "y": 200}, "state": "idle", "job": "hunt", "huntTargetId": "deer-1", "tick": 1}
	var idx = EntityRegistry.build_work_index(snap([deer]))
	var work = EntityRegistry.work_for(hunter_data, idx)
	check("hunt_work_when_in_range", str(work.get("kind", "")) == "hunt" and work.target.is_equal_approx(Vector3(200, 0, 200)), str(work))
	var walking = hunter_data.duplicate(); walking["state"] = "search"
	check("no_throw_while_stalking", EntityRegistry.work_for(walking, idx).is_empty())

	var r = NetworkResident.new()
	root.add_child(r)
	r.update_from_ant_data(walking, .1, 1.)
	r._update_movement_and_animation(1.0)
	check("hunter_is_bigger", r.model_instance.scale.x > 1.1, str(r.model_instance.scale))
	check("spear_while_stalking", r.tool_prop.visible and r.tool_prop.mesh == PropFactory.tool("hunt"))
	r.set_work(work)
	r._update_movement_and_animation(0.0)
	check("throw_clip", r.anim_player.current_animation == "work_chop", r.anim_player.current_animation)
	var plain = hunter_data.duplicate(); plain["job"] = "forage"
	r.update_from_ant_data(plain, .1, 1.)
	r.set_work({})
	r._update_movement_and_animation(1.0)
	check("forager_normal_size_no_spear", is_equal_approx(r.model_instance.scale.x, 1.0) and not r.tool_prop.visible)
	r.queue_free()

	var panel = PriorityPanel.new()
	root.add_child(panel)
	await process_frame
	panel.update_from_snapshot(snap([deer], [hunter_data]), 0)
	var texts = []
	for row in panel.rows_box.get_children():
		for c in row.get_children():
			if c is Label:
				texts.append((c as Label).text)
	check("hunt_row_with_spears", "Охота" in texts and texts.any(func(t): return t.contains("копья: 1")), str(texts))
	panel.queue_free()
	await process_frame
	print("HUNT_VIEW_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
