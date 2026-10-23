extends SceneTree

## Stage «Обжиг и дождь» in the client: kiln mesh and fire in its mouth only
## while a resident is being fired, the kiln tile and ghost, the firing row
## of the work panel, and the darker glazed look of fired residents.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(firing: Variant, ants: Array) -> Dictionary:
	var kiln = {"id": "bld-k", "type": "kiln", "stage": "built", "colonyId": "colony-1", "pos": {"x": 120, "y": 120}, "progress": 1}
	if firing != null:
		kiln["firing"] = firing
	return {
		"tick": 10,
		"ants": ants,
		"colonies": [{"colony": {"priorities": {}, "food": 50, "autoManage": true, "firingPaused": false, "queenAlive": true, "fire": 1.0}}],
		"surface": {"width": 480, "height": 480, "entrances": [{"x": 100, "y": 100}], "resourceNodes": [], "buildings": [kiln], "deposits": [], "fish": []},
	}

func run() -> void:
	check("kiln_mesh", PropFactory.kiln().get_surface_count() > 0)
	check("kiln_footprint", BuildingGeometry.get_building_footprint({"type": "kiln", "stage": "built", "pos": {"x": 10, "y": 10}}).rx == 2.4)
	check("kiln_cost", BuildRules.cost_text("kiln") == "10 глина, 6 камень", BuildRules.cost_text("kiln"))

	var view = WorldView.new()
	root.add_child(view)
	await process_frame
	view.update_world_entities(snap(null, []))
	var node = view.active_buildings.get("bld-k") as Node3D
	check("kiln_built_node", node != null and node.get_node_or_null("Glow") != null)
	check("kiln_cold_without_firing", node != null and not (node.get_node("Glow") as Node3D).visible)
	view.update_world_entities(snap({"antId": "ant-1", "progress": 0, "calledAt": 0, "paid": false}, []))
	check("kiln_cold_while_resident_walks", not (node.get_node("Glow") as Node3D).visible)
	view.update_world_entities(snap({"antId": "ant-1", "progress": 30, "calledAt": 0, "paid": true}, []))
	check("kiln_fire_while_firing", (node.get_node("Glow") as Node3D).visible and (node.get_node("KilnLight") as OmniLight3D).visible)
	check("kiln_tooltip", view.describe_at(Vector2(120, 120.3)).contains("Печь обжига"), view.describe_at(Vector2(120, 120.3)))
	view.queue_free()

	var panel = PriorityPanel.new()
	root.add_child(panel)
	await process_frame
	var ants = [{"id": "ant-1", "colonyId": "colony-1", "job": "forage", "fired": true}, {"id": "ant-2", "colonyId": "colony-1", "job": "forage"}]
	panel.update_from_snapshot(snap({"antId": "ant-2", "progress": 5, "calledAt": 0, "paid": true}, ants), 0)
	check("firing_row_shown", panel.firing_row.visible)
	check("firing_row_text", panel.firing_label.text == "Обжиг · 1 из 2 · печь горит", panel.firing_label.text)
	var asked = []
	panel.firing_requested.connect(func(v): asked.append(v))
	panel.firing_button.pressed.emit()
	check("firing_pause_request", asked == [true], str(asked))
	var s2 = snap(null, ants)
	s2.surface.buildings.append({"id": "w1", "type": "workshop", "stage": "built", "colonyId": "colony-1", "pos": {"x": 150, "y": 150}})
	s2.colonies[0].colony["wood"] = 20
	s2.colonies[0].colony["stone"] = 20
	panel.update_from_snapshot(s2, 0)
	check("water_button_offered", panel.water_button.visible and not panel.water_button.disabled, panel.water_button.text)
	var water_asked = [0]
	panel.water_requested.connect(func(): water_asked[0] += 1)
	panel.water_button.pressed.emit()
	check("water_request", water_asked[0] == 1)
	s2.colonies[0].colony["waterWeapons"] = true
	panel.update_from_snapshot(s2, 0)
	check("water_trained_shown", panel.water_button.disabled and panel.water_button.text == "Стража стреляет водой", panel.water_button.text)
	panel.queue_free()

	var reg = EntityRegistry.new()
	root.add_child(reg)
	await process_frame
	var s = snap(null, [
		{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 50, "y": 50}, "state": "search", "fired": true},
		{"id": "ant-2", "colonyId": "colony-1", "pos": {"x": 52, "y": 50}, "state": "search"},
	])
	reg.update_from_snapshot(s)
	await process_frame
	var fired_res = reg.residents.get("ant-1")
	var raw_res = reg.residents.get("ant-2")
	check("fired_flag_reaches_resident", fired_res and fired_res.fired and raw_res and not raw_res.fired)
	if fired_res and raw_res and fired_res.mesh_instance and raw_res.mesh_instance:
		var a = fired_res.mesh_instance.get_surface_override_material(0) as StandardMaterial3D
		var b = raw_res.mesh_instance.get_surface_override_material(0) as StandardMaterial3D
		check("fired_is_darker_and_glazed", a and b and a.albedo_color.v < b.albedo_color.v and a.roughness < b.roughness, "%s vs %s" % [a.albedo_color if a else null, b.albedo_color if b else null])
	reg.queue_free()
	await process_frame
	print("KILN_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
