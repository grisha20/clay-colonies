extends SceneTree

## Residents at work: work detection mirrors the 2D client's canWork, the
## resident plays the work clip facing its target with the right tool, carried
## loads match carryKind, and the two tribes look different.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snapshot(weather := "clear", alarm := false) -> Dictionary:
	return {
		"weather": {"state": weather},
		"colonies": [{"id": "colony-1", "colony": {"alarm": alarm}}, {"id": "colony-2", "colony": {"alarm": false}}],
		"surface": {
			"resourceNodes": [
				{"id": "tree-1", "kind": "tree", "pos": {"x": 50, "y": 50}, "amount": 5},
				{"id": "rock-1", "kind": "stone", "pos": {"x": 60, "y": 50}, "amount": 30},
				{"id": "pit-w0", "kind": "clay", "pos": {"x": 80, "y": 50}, "amount": 100, "depositId": "deposit-clay-a"},
				{"id": "sticks-1", "kind": "stick", "pos": {"x": 70, "y": 50}, "amount": 2},
				{"id": "tree-dead", "kind": "tree", "pos": {"x": 90, "y": 50}, "amount": 0},
			],
			"buildings": [
				{"id": "site-1", "type": "hut", "stage": "inProgress", "pos": {"x": 100, "y": 100}},
				{"id": "hut-done", "type": "hut", "stage": "built", "pos": {"x": 120, "y": 100}},
			],
		},
	}

func ant(job: String, x: float, y: float, extra := {}) -> Dictionary:
	var a = {"id": "ant-w", "colonyId": "colony-1", "job": job, "state": "idle", "pos": {"x": x, "y": y}, "carrying": 0}
	a.merge(extra, true)
	return a

func run() -> void:
	var idx = EntityRegistry.build_work_index(snapshot())
	var w = EntityRegistry.work_for(ant("harvest", 50.8, 50.0, {"harvestNodeId": "tree-1", "harvestHits": 2}), idx)
	check("chop_tree", w.get("kind") == "chop" and w.get("target_id") == "tree-1" and w.target == Vector3(50, 0, 50), str(w))
	check("sticks_by_hand", EntityRegistry.work_for(ant("harvest", 70.5, 50.0, {"harvestNodeId": "sticks-1", "harvestHits": 1}), idx).get("kind") == "gather")
	check("mine_rock", EntityRegistry.work_for(ant("harvest", 60.5, 50.5, {"harvestNodeId": "rock-1", "harvestHits": 1}), idx).get("kind") == "mine")
	var q = EntityRegistry.work_for(ant("harvest", 80.4, 50.0, {"harvestNodeId": "pit-w0", "harvestHits": 1}), idx)
	check("dig_quarry_targets_deposit", q.get("kind") == "dig" and q.get("target_id") == "deposit-clay-a", str(q))
	check("too_far_is_not_work", EntityRegistry.work_for(ant("harvest", 55.0, 50.0, {"harvestNodeId": "tree-1", "harvestHits": 2}), idx).is_empty())
	check("no_hits_yet_is_not_work", EntityRegistry.work_for(ant("harvest", 50.5, 50.0, {"harvestNodeId": "tree-1", "harvestHits": 0}), idx).is_empty())
	check("empty_node_is_not_work", EntityRegistry.work_for(ant("harvest", 90.5, 50.0, {"harvestNodeId": "tree-dead", "harvestHits": 2}), idx).is_empty())
	check("carrying_is_not_work", EntityRegistry.work_for(ant("harvest", 50.5, 50.0, {"harvestNodeId": "tree-1", "harvestHits": 2, "carrying": 1}), idx).is_empty())
	check("rain_stops_work", EntityRegistry.work_for(ant("harvest", 50.5, 50.0, {"harvestNodeId": "tree-1", "harvestHits": 2}), EntityRegistry.build_work_index(snapshot("rain"))).is_empty())
	check("alarm_stops_work", EntityRegistry.work_for(ant("harvest", 50.5, 50.0, {"harvestNodeId": "tree-1", "harvestHits": 2}), EntityRegistry.build_work_index(snapshot("clear", true))).is_empty())
	check("build_site", EntityRegistry.work_for(ant("build", 101.5, 100.0, {"buildTargetId": "site-1"}), idx).get("kind") == "build")
	check("built_hut_is_not_work", EntityRegistry.work_for(ant("build", 120.5, 100.0, {"buildTargetId": "hut-done"}), idx).is_empty())
	check("fishing", EntityRegistry.work_for(ant("fish", 30, 30, {"fishingLurePos": {"x": 33, "y": 30}, "fishingTicks": 4}), idx).get("kind") == "fish")

	# Resident visuals.
	var holder = Node3D.new()
	root.add_child(holder)
	var a = NetworkResident.new()
	a.colony_id = "colony-1"
	holder.add_child(a)
	var b = NetworkResident.new()
	b.colony_id = "colony-2"
	holder.add_child(b)
	var data_a = {"id": "ant-a", "colonyId": "colony-1", "pos": {"x": 50.8, "y": 50.0}, "state": "idle", "tick": 1}
	var data_b = {"id": "ant-b", "colonyId": "colony-2", "pos": {"x": 70.0, "y": 70.0}, "state": "idle", "tick": 1}
	a.update_from_ant_data(data_a, 0.1, 1.0)
	b.update_from_ant_data(data_b, 0.1, 1.0)
	var body_a = (a.mesh_instance.get_surface_override_material(0) as StandardMaterial3D).albedo_color
	var body_b = (b.mesh_instance.get_surface_override_material(0) as StandardMaterial3D).albedo_color
	var cord_a = (a.mesh_instance.get_surface_override_material(2) as StandardMaterial3D).albedo_color
	var cord_b = (b.mesh_instance.get_surface_override_material(2) as StandardMaterial3D).albedo_color
	check("tribes_differ_in_clay_and_cord", not body_a.is_equal_approx(body_b) and not cord_a.is_equal_approx(cord_b))

	a.rotation.y = PI  # facing away from the tree (tree is at -x)
	a.set_work({"kind": "chop", "target": Vector3(50, 0, 50), "target_id": "tree-1"})
	for i in range(20):
		a._update_movement_and_animation(0.0)
	check("work_clip_plays", a.current_anim_state == NetworkResident.AnimState.WORK_GATHER)
	check("axe_in_hand", a.tool_prop.visible and a.tool_prop.mesh == PropFactory.tool("chop"))
	var facing = Vector3(sin(a.rotation.y), 0, cos(a.rotation.y))
	check("faces_the_tree", facing.dot(Vector3(-1, 0, 0)) > 0.95, "facing=%s" % facing)
	check("chips_fly", a.chips != null and a.chips.emitting)
	if a.use_resident_v3:
		for kind in ["chop", "mine", "build", "dig", "gather", "fish"]:
			a.set_work({"kind": kind, "target": Vector3(50, 0, 50)})
			a._update_movement_and_animation(0.0)
			check("job_clip_" + kind, a.anim_player.current_animation == "work_" + kind, a.anim_player.current_animation)
		check("basket_on_back", a.bone_attachment_cargo.bone_name == "Spine" and a.bone_attachment_cargo.get_node_or_null("Basket") != null)
		var basket = (a.bone_attachment_cargo.get_node("Basket") as Node3D)
		var at = a.skeleton.global_transform.affine_inverse() * basket.global_transform.origin
		check("basket_behind_below_head", at.z < -0.4 and at.y > 0.5 and at.y < 0.9, str(at))
	a.set_work({"kind": "dig", "target": Vector3(51, 0, 50)})
	a._update_movement_and_animation(0.0)
	check("clay_dug_by_hand", not a.tool_prop.visible)
	a.set_work({})
	a._update_movement_and_animation(0.0)
	check("idle_after_work", a.current_anim_state == NetworkResident.AnimState.IDLE and not a.tool_prop.visible and not a.chips.emitting)

	for kind in ["wood", "stone", "clay", "fish", "meat", "fruit"]:
		a.carrying_amount = 2
		a.carry_kind = kind
		a._update_movement_and_animation(0.0)
		var expected = PropFactory.carry_load("food" if kind == "fruit" else kind)
		check("carries_" + kind, a.cargo_prop.visible and a.cargo_load.mesh == expected)
	a.set_work({"kind": "chop", "target": Vector3(50, 0, 50)})
	a._update_movement_and_animation(0.0)
	check("carrying_never_works", a.current_anim_state != NetworkResident.AnimState.WORK_GATHER and not a.tool_prop.visible)

	holder.queue_free()
	await process_frame
	print("RESIDENT_WORK_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
