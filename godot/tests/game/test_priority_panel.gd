extends SceneTree

## Work priorities panel: job counting like the 2D client, free hands, unmet
## reasons and +/- buttons that emit the next priorities. Also resident names.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func ant(id: String, job: String, extra := {}) -> Dictionary:
	var a = {"id": id, "colonyId": "colony-1", "job": job}
	a.merge(extra, true)
	return a

func run() -> void:
	var snap = {
		"ants": [
			ant("ant-1", "harvest", {"carryKind": "clay"}),
			ant("ant-2", "harvest", {"harvestNodeId": "t1"}),
			ant("ant-3", "harvest", {"harvestNodeId": "s1"}),
			ant("ant-4", "build"),
			ant("ant-5", "guard"),
			ant("ant-6", "forage", {"forageRole": "scout"}),
			ant("ant-7", "forage"),
			{"id": "ant-9", "colonyId": "colony-2", "job": "build"},
		],
		"colonies": [{"colony": {"priorities": {"clay": 2, "wood": 1, "stone": 1, "build": 1, "guard": 0, "fish": 1}, "food": 20, "axes": 1, "picks": 0, "rods": 0}}],
		"surface": {
			"resourceNodes": [{"id": "t1", "kind": "tree", "amount": 5}, {"id": "s1", "kind": "loose-stone", "amount": 2}, {"id": "c1", "kind": "clay", "amount": 9}],
			"fish": [{"state": "swim"}],
		},
	}
	var counts = PriorityPanel.count_jobs(snap, "colony-1")
	check("counts_like_2d", counts.clay == 1 and counts.wood == 1 and counts.stone == 1 and counts.build == 1 and counts.guard == 1 and counts.fish == 0 and counts.food == 2, str(counts))

	var panel = PriorityPanel.new()
	root.add_child(panel)
	await process_frame
	panel.update_from_snapshot(snap, 0)
	# 7 residents, 1 scout, 6 assigned -> 0 free.
	check("free_hands", panel.free_for_plus == 0, str(panel.free_for_plus))
	check("header", panel.header.text == "Жители 7 · Свободно 0", panel.header.text)
	var texts = []
	# Each job is a unit: its row and, below it, the "why not" note.
	for unit in panel.rows_box.get_children():
		for c in unit.get_children():
			if c is Label:
				texts.append(c.text.strip_edges())
	check("reason_food_for_gathering", texts.has("Для добычи нужно 8 жителей"), str(texts))
	check("reason_rods_for_fishing", texts.has("Не хватает удочек"), str(texts))
	var asked = []
	panel.priorities_requested.connect(func(p): asked.append(p))
	panel._change("guard", 1)
	check("plus_blocked_without_free_hands", asked.is_empty())
	panel._change("clay", -1)
	check("minus_emits_next", asked.size() == 1 and asked[0].clay == 1 and asked[0].wood == 1, str(asked))

	check("unmet_alarm", PriorityPanel.unmet_reason("wood", 2, 0, {"wood": true}, true, 10, 50, {}, false) == "Тревога: рабочие у костра")
	check("unmet_pick", PriorityPanel.unmet_reason("stone", 1, 0, {"stone": true}, false, 10, 50, {"stone": 0}, false) == "Нужна кирка из мастерской")
	check("met_no_reason", PriorityPanel.unmet_reason("wood", 1, 1, {}, false, 10, 50, {}, false) == "")

	check("resident_names", WorldObserver.resident_name("ant-1") == "Храбрый Малой" and WorldObserver.resident_name("ant-12") == "Кривой Глинко", WorldObserver.resident_name("ant-12"))
	panel.queue_free()
	await process_frame
	print("PRIORITY_PANEL_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
