extends SceneTree

## Headless checks for the dressed surface world (WorldView + PropFactory +
## GroundDecor + TrailMap): every snapshot entity maps to a readable prop whose
## look follows server state, and the purely visual layers never leak into water
## or clearings.

var failures: int = 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snapshot() -> Dictionary:
	return {
		"tick": 10,
		"session": {"speed": 1, "status": "playing"},
		"colonies": [{"colony": {"fire": 1.0}}, {"colony": {"fire": 0.0}}],
		"ants": [],
		"enemies": [{"id": "spider-1", "type": "spider", "pos": {"x": 300, "y": 300}, "hp": 10, "maxHp": 10}],
		"surface": {
			"entrances": [{"x": 120, "y": 240}, {"x": 360, "y": 240}],
			"resourceNodes": [
				{"id": "tree-a", "kind": "tree", "pos": {"x": 50, "y": 50}, "amount": 60, "maxAmount": 60, "growth": "mature"},
				{"id": "tree-b", "kind": "tree", "pos": {"x": 54, "y": 50}, "amount": 6, "maxAmount": 6, "growth": "sapling"},
				{"id": "rock-a", "kind": "stone", "pos": {"x": 60, "y": 60}, "amount": 48, "maxAmount": 48},
				{"id": "pit-1", "kind": "clay", "pos": {"x": 88, "y": 214}, "amount": 200, "maxAmount": 200, "depositId": "deposit-clay-a"},
				{"id": "gone", "kind": "stick", "pos": {"x": 70, "y": 70}, "amount": 0, "maxAmount": 3},
			],
			"deposits": [{"id": "deposit-clay-a", "kind": "clay", "pos": {"x": 88, "y": 214}, "capacity": 400}],
			"foodSources": [
				{"id": "food-1", "pos": {"x": 80, "y": 80}, "amount": 60, "kind": "food"},
				{"id": "food-2", "pos": {"x": 84, "y": 80}, "amount": 0, "kind": "food"},
			],
			"carrion": [],
			"fish": [
				{"id": "fish-1", "lakeId": "north", "species": "gold", "state": "swim", "pos": {"x": 230, "y": 140}, "heading": {"x": 1, "y": 0}},
				{"id": "fish-2", "lakeId": "north", "species": "red", "state": "respawning", "pos": {"x": 232, "y": 140}},
			],
			"buildings": [
				{"id": "hut-1", "colonyId": "colony-1", "type": "hut", "stage": "built", "pos": {"x": 109, "y": 232}},
				{"id": "store-1", "colonyId": "colony-1", "type": "storage", "stage": "inProgress", "progress": 0.5, "pos": {"x": 120, "y": 252}},
				{"id": "w1", "colonyId": "colony-1", "type": "wall", "stage": "built", "pos": {"x": 101, "y": 201}},
				{"id": "w2", "colonyId": "colony-1", "type": "wall", "stage": "built", "pos": {"x": 103, "y": 201}},
				{"id": "w3", "colonyId": "colony-1", "type": "wall", "stage": "built", "pos": {"x": 105, "y": 203}},
				{"id": "w4", "colonyId": "colony-2", "type": "wall", "stage": "built", "pos": {"x": 107, "y": 203}},
			],
		},
	}

func run() -> void:
	var view = WorldView.new()
	root.add_child(view)
	view.set_process(false)
	var snap = snapshot()
	view.update_world_entities(snap)

	var nodes = view.active_world_nodes
	check("tree_mature_prop", nodes.has("tree-a") and str(nodes["tree-a"].get_meta("visual_key")).begins_with("tree:mature:4"), str(nodes.get("tree-a", null)))
	check("tree_sapling_prop", nodes.has("tree-b") and str(nodes["tree-b"].get_meta("visual_key")).begins_with("tree:sapling"))
	check("tree_has_mesh", nodes.has("tree-a") and nodes["tree-a"].mesh != null and nodes["tree-a"].mesh.get_aabb().size.y > 3.0, str(nodes["tree-a"].mesh.get_aabb()) if nodes.has("tree-a") else "")
	check("deposit_site_hidden", not nodes.has("pit-1"))
	check("deposit_drawn_half_full", nodes.has("deposit-clay-a") and nodes["deposit-clay-a"].get_meta("visual_key") == "deposit:clay:2", str(nodes["deposit-clay-a"].get_meta("visual_key")) if nodes.has("deposit-clay-a") else "")
	check("empty_node_hidden", not nodes.has("gone"))
	check("bush_with_berries", nodes.has("food-1") and nodes["food-1"].get_meta("visual_key").begins_with("bush:4:"))
	check("picked_bush_stays_bare", nodes.has("food-2") and nodes["food-2"].get_meta("visual_key").begins_with("bush:0:"))
	check("respawning_fish_hidden", nodes.has("fish-1") and not nodes.has("fish-2"))
	check("fish_under_water_surface", nodes.has("fish-1") and nodes["fish-1"].position.y < 0.06)
	check("spider_prop", nodes.has("spider-1") and nodes["spider-1"].get_meta("visual_key") == "spider")

	# Depleting a tree swaps to a thinner crown without recreating the node.
	var tree_node = nodes["tree-a"]
	snap.surface.resourceNodes[0].amount = 10.0
	view.update_world_entities(snap)
	check("tree_thins_in_place", nodes["tree-a"] == tree_node and str(tree_node.get_meta("visual_key")).begins_with("tree:mature:1"), str(tree_node.get_meta("visual_key")))

	# Buildings: hut is stretched over its server footprint; sites are ghosted.
	var hut = view.active_buildings.get("hut-1")
	check("hut_present", hut != null and hut.get_child_count() == 1)
	var store = view.active_buildings.get("store-1") as GeometryInstance3D
	check("construction_ghosted", store != null and store.transparency > 0.2 and store.transparency < 0.65, str(store.transparency if store else -1))
	snap.surface.buildings[1].stage = "built"
	view.update_world_entities(snap)
	store = view.active_buildings.get("store-1") as GeometryInstance3D
	check("built_is_solid", store != null and store.transparency == 0.0)

	# Fence rails connect only same-colony neighbours; the diagonal w2-w3 is allowed
	# because no orthogonal intermediate exists, w4 belongs to another colony.
	check("fence_rails", view.fence_container.get_child_count() == 2, "rails=%d" % view.fence_container.get_child_count())

	# Second colony fire is out: its flame and light hide.
	view._animate_world(0.016)
	var camp_b = view.active_campfires.get(1)
	check("dead_fire_hidden", camp_b != null and not camp_b.get_node("Flame").visible and not camp_b.get_node("FireLight").visible)
	var camp_a = view.active_campfires.get(0)
	check("live_fire_visible", camp_a != null and camp_a.get_node("Flame").visible)

	# Creatures glide toward the newest snapshot position instead of hopping.
	snap.enemies[0].pos = {"x": 304, "y": 300}
	view.update_world_entities(snap)
	var spider = nodes["spider-1"]
	view._animate_world(0.016)
	var mid_x = spider.position.x
	check("creature_glides", mid_x > 300.0 and mid_x < 304.0, "x=%.3f" % mid_x)
	for i in range(120):
		view._animate_world(0.016)
	check("creature_arrives", absf(spider.position.x - 304.0) < 0.01)

	# Trails: walking wears the ground, standing still does not.
	var trails = view.trail_map
	for i in range(30):
		snap.ants = [{"id": "ant-1", "layer": "surface", "state": "carry", "pos": {"x": 150.0 + (i % 2) * 2.5, "y": 150.0}}]
		view.update_world_entities(snap)
	var worn = trails.value_at(150.0, 150.0)
	check("trail_worn_by_walking", worn > 40, "value=%d" % worn)
	for i in range(30):
		snap.ants = [{"id": "ant-2", "layer": "surface", "state": "idle", "pos": {"x": 170.0, "y": 170.0}}]
		view.update_world_entities(snap)
	check("standing_does_not_wear", trails.value_at(170.0, 170.0) <= TrailMap.STAMP, "value=%d" % trails.value_at(170.0, 170.0))
	snap.ants = [{"id": "ant-3", "layer": "surface", "state": "carry", "pos": {"x": 230.0, "y": 140.0}}]
	view.update_world_entities(snap)
	check("no_trail_in_water", trails.value_at(230.0, 140.0) == 0)

	# Ground decor stays out of water and camp clearings. The dummy headless
	# renderer does not keep MultiMesh buffers, so decode the computed buffers.
	var decor = view.ground_decor
	decor.build_all_now()
	var in_water = 0
	var in_camp = 0
	var total = 0
	var zones = [[Vector2(120, 240), Vector2(360, 240)], [], []]
	for cy in range(12):
		for cx in range(12):
			var item = decor._compute_chunk(Vector2i(cx, cy), zones)
			for kind in range(4):
				var buf: PackedFloat32Array = item.buffers[kind]
				var stride = 12 if kind == GroundDecor.KIND_PEBBLE else 16
				for i in range(item.counts[kind]):
					var p = item.center + Vector2(buf[i * stride + 3], buf[i * stride + 11])
					total += 1
					if SurfaceTerrain.is_water_at(p.x, p.y):
						in_water += 1
					if kind == GroundDecor.KIND_TUFT and p.distance_to(Vector2(120, 240)) < 12.0:
						in_camp += 1
	check("decor_populated", total > 15000, "instances=%d" % total)
	check("decor_not_in_water", in_water == 0, "in_water=%d" % in_water)
	check("decor_not_in_camp", in_camp == 0, "in_camp=%d" % in_camp)

	# A new clearing restarts dressing without waiting for the running task.
	var t0 = Time.get_ticks_usec()
	decor.rebuild([Vector2(120, 240)], [], [], "first")
	decor.rebuild([Vector2(120, 240), Vector2(300, 300)], [], [], "second")
	var rebuild_ms = float(Time.get_ticks_usec() - t0) / 1000.0
	decor.build_all_now()
	check("rebuild_does_not_block", rebuild_ms < 50.0, "ms=%.1f" % rebuild_ms)
	check("rebuild_settles", decor.is_settled() and decor.instance_count > 15000 and decor.signature == "second", "instances=%d" % decor.instance_count)

	# Removal follows the snapshot.
	snap.surface.resourceNodes = []
	snap.surface.foodSources = []
	snap.enemies = []
	view.update_world_entities(snap)
	check("props_removed", not nodes.has("tree-a") and not nodes.has("food-1") and not nodes.has("spider-1"))

	view.queue_free()
	await process_frame
	print("WORLD_DRESSING_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
