extends SceneTree

## Stage «Территория и тотемы» in the client: land rules like the server
## (shared/territory.ts), totem in tribe colours, springs with the holder's
## flag and tooltip, land discs sent to the ground shader, the totem tile and
## special clay in the HUD.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func surface(buildings: Array, springs: Array) -> Dictionary:
	return {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}, {"x": 380, "y": 380}], "buildings": buildings, "deposits": [], "springs": springs, "resourceNodes": [], "fish": []}

func totem(owner: String, x: float, y: float, stage := "built") -> Dictionary:
	return {"id": "t-%s-%d" % [owner, int(x)], "type": "totem", "stage": stage, "colonyId": owner, "pos": {"x": x, "y": y}, "progress": 1}

func run() -> void:
	var s = surface([], [])
	check("own_camp_land", BuildRules.territory_placement(s, "colony-1", Vector2(130, 100)) == "")
	check("outside_land", BuildRules.territory_placement(s, "colony-1", Vector2(160, 100)) == "Вне своей земли — поставь тотем ближе")
	check("rival_land", BuildRules.territory_placement(s, "colony-1", Vector2(360, 380)) == "Чужая земля")
	check("site_does_not_claim", BuildRules.territory_placement(surface([totem("colony-1", 140, 100, "site")], []), "colony-1", Vector2(160, 100)) != "")
	check("built_totem_claims", BuildRules.territory_placement(surface([totem("colony-1", 140, 100)], []), "colony-1", Vector2(160, 100)) == "")
	check("no_camps_no_rules", BuildRules.territory_placement({"entrances": [], "buildings": []}, "colony-1", Vector2(5, 5)) == "")
	check("totem_cost", BuildRules.cost_text("totem") == "12 глина, 6 дерево, 4 камень", BuildRules.cost_text("totem"))
	check("spring_blocks_building", BuildRules.point_building_placement(surface([], [{"id": "spring-1", "pos": {"x": 120, "y": 100}}]), "colony-1", "hut", Vector2(124, 100)) == "Здесь бьёт источник особой глины")
	check("totem_meshes_differ_by_tribe", PropFactory.totem(WorldView.POST_COLORS[0]) != PropFactory.totem(WorldView.POST_COLORS[1]))

	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	var snap = {"tick": 1, "ants": [], "colonies": [], "surface": surface([totem("colony-2", 300, 300)], [
		{"id": "spring-1", "pos": {"x": 240, "y": 240}, "progress": 0},
		{"id": "spring-2", "pos": {"x": 300, "y": 320}, "holder": "colony-2", "progress": 100},
	])}
	view.update_world_entities(snap)
	await process_frame
	check("springs_drawn", view.spring_nodes.size() == 2)
	check("free_spring_no_flag", not (view.spring_nodes["spring-1"].get_node("Flag") as Node3D).visible)
	check("held_spring_flag", (view.spring_nodes["spring-2"].get_node("Flag") as Node3D).visible)
	check("spring_tooltip_free", view.describe_at(Vector2(240, 240)).begins_with("Источник особой глины · ничей"), view.describe_at(Vector2(240, 240)))
	check("spring_tooltip_held", view.describe_at(Vector2(300, 320)).contains("у племени B"), view.describe_at(Vector2(300, 320)))
	var lands = view.ground_material.get_shader_parameter("land_count")
	check("land_discs_to_shader", int(lands) == 3, str(lands))
	var totem_node = view.active_buildings.get("t-colony-2-300") as MeshInstance3D
	var accent = totem_node.get_node_or_null("TribeAccent") as MeshInstance3D if totem_node else null
	var tribe_material = accent.material_override as StandardMaterial3D if accent else null
	var authored = load("res://assets/models/buildings/totem_v2.glb").instantiate()
	var authored_mesh = (authored.get_node("TotemV2") as MeshInstance3D).mesh
	check("totem_built_node", totem_node != null and totem_node.mesh == authored_mesh and tribe_material != null and tribe_material.albedo_color == WorldView.POST_COLORS[1])
	authored.free()
	view.queue_free()

	var hud = GameHud.new()
	root.add_child(hud)
	await process_frame
	hud.update_from_snapshot({"tick": 1, "session": {}, "colonies": [{"colony": {"clay": 3, "specialClay": 7}}]}, 5)
	check("hud_special_clay", hud.resource_labels.special.text == "7")
	hud.queue_free()
	check("totem_tool_listed", BuildController.TOOLS.any(func(t): return t[0] == "totem" and t[2] == "T"))

	# Clicks land on the visible relief, not on y=0 (review 569d093, item 2).
	SurfaceTerrain.set_terrain({"version": 1, "seed": 1, "lakes": [], "hills": [{"x": 120.0, "y": 236.0, "radius": 30.0, "height": 5.0}]})
	var worst = 0.0
	for target in [Vector2(120, 236), Vector2(132, 244), Vector2(104, 226)]:
		var top = Vector3(target.x, SurfaceTerrain.height_at(target.x, target.y), target.y)
		var dir = Vector3(0.0, -0.8, -0.6).normalized()
		var hit = WorldObserver.ray_ground_hit(top - dir * 60.0, dir)
		worst = maxf(worst, hit.distance_to(target))
	check("hill_click_hits_visible_ground", worst < 0.05, str(worst))
	SurfaceTerrain.set_terrain(null)
	await process_frame
	print("TERRITORY_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
