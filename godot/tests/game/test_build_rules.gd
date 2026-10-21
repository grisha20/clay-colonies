extends SceneTree

## BuildRules must answer placement exactly like the server's shared TS rules
## (fixture from server/src/bench/exportPlacementParity.ts), and the brush/rect
## helpers must produce the same cells as the 2D client.

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func run() -> void:
	var data = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/placement_parity.json"))
	var surface: Dictionary = data.surface
	SurfaceTerrain.set_terrain(surface.get("terrain"))
	var bad = 0
	var by_kind: Dictionary = {}
	for q in data.queries:
		var p = Vector2(float(q.x), float(q.y))
		var got = ""
		match str(q.kind):
			"fence":
				got = BuildRules.fence_placement(surface, q.owner, p)
			"gate-h":
				got = BuildRules.gate_placement(surface, q.owner, p, "horizontal")
			"gate-v":
				got = BuildRules.gate_placement(surface, q.owner, p, "vertical")
			_:
				got = BuildRules.point_building_placement(surface, q.owner, q.kind, p)
		by_kind[q.kind] = int(by_kind.get(q.kind, 0)) + 1
		if got != str(q.reason):
			bad += 1
			if bad <= 5:
				print("  mismatch %s at %s: godot='%s' ts='%s'" % [q.kind, p, got, q.reason])
	check("placement_parity", bad == 0, "%d queries, %d mismatches %s" % [data.queries.size(), bad, by_kind])

	var cells = BuildRules.wall_line_cells(surface, Vector2(10.5, 10.5), Vector2(20.5, 10.5))
	check("brush_cells_straight_line", cells.size() == 6 and cells[0] == 5 * 240 + 5 and cells[-1] == 5 * 240 + 10, str(cells))
	var rect = BuildRules.rect_cells(surface, Vector2(1, 1), Vector2(9, 5), 4.0)
	check("rect_zone_cells", rect == [0, 1, 2, 120, 121, 122], str(rect))
	check("cell_center", BuildRules.cell_center(surface, 241, 2.0) == Vector2(3, 3))
	check("gate_cells", BuildRules.gate_cell_centers(Vector2(100.2, 50.7), "horizontal") == [Vector2(99, 51), Vector2(101, 51), Vector2(103, 51)])
	check("cost_text", BuildRules.cost_text("hut") == "8 глина, 5 дерево")
	SurfaceTerrain.set_terrain(null)
	print("BUILD_RULES_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
