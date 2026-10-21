class_name BuildRules
extends RefCounted

## Placement rules for the build tools, ported from shared/buildingPlacement.ts
## and shared/fenceGeometry.ts so the preview turns red exactly where the
## server would refuse. Reasons are the same Russian strings. Costs mirror
## server/src/config.ts (*Cost). Checked against TS answers in
## tests/fixtures/placement_parity.json.

const WALL_CELL_SIZE := 2.0
const ZONE_CELL_SIZE := 4.0
const GATE_SPAN := 3
const DEPOSIT_RX := 10.0
const DEPOSIT_RY := 6.5
const LIMITS := {"hut": 8, "storage": 6, "workshop": 2, "idol": 1}
const COSTS := {
	"hut": {"clay": 8, "wood": 5, "stone": 0},
	"storage": {"clay": 0, "wood": 6, "stone": 4},
	"workshop": {"clay": 8, "wood": 4, "stone": 0},
	"idol": {"clay": 25, "wood": 0, "stone": 5},
	"wall": {"clay": 2, "wood": 0, "stone": 0},
	"gate": {"clay": 2, "wood": 1, "stone": 0},
}


static func _pos(d: Variant) -> Vector2:
	if typeof(d) != TYPE_DICTIONARY:
		return Vector2.INF
	return Vector2(float(d.get("x", 0.0)), float(d.get("y", 0.0)))


static func _footprint(b: Dictionary) -> Dictionary:
	var built = b.duplicate()
	built["stage"] = "built"
	return BuildingGeometry.get_building_footprint(built)


static func point_building_placement(surface: Dictionary, owner: String, type: String, pos: Vector2) -> String:
	var w = float(surface.get("width", 480))
	var h = float(surface.get("height", 480))
	if pos.x < 2 or pos.y < 2 or pos.x > w - 2 or pos.y > h - 2:
		return "За границей карты"
	for e in surface.get("entrances", []):
		if _pos(e).distance_to(pos) < 7.0:
			return "Слишком близко к костру"
	var f = _footprint({"type": type, "pos": {"x": pos.x, "y": pos.y}})
	var fx = float(f.x)
	var fy = float(f.y)
	var frx = float(f.rx)
	var fry = float(f.ry)
	for d in surface.get("deposits", []):
		var dp = _pos(d.get("pos"))
		if pow((fx - dp.x) / (DEPOSIT_RX + frx + 1.0), 2) + pow((fy - dp.y) / (DEPOSIT_RY + fry + 1.0), 2) <= 1.0:
			return "Рабочая площадка карьера"
	var rim: Array[Vector2] = []
	for i in range(16):
		var a = float(i) * PI / 8.0
		rim.append(Vector2(fx + cos(a) * (frx + 0.6), fy + sin(a) * (fry + 0.6)))
	if SurfaceTerrain.is_water_at(pos.x, pos.y) or rim.any(func(p): return SurfaceTerrain.is_water_at(p.x, p.y)):
		return "Основание попадает в воду"
	if SurfaceTerrain.is_mountain_at(pos.x, pos.y) or rim.any(func(p): return SurfaceTerrain.is_mountain_at(p.x, p.y)):
		return "Основание упирается в скалы"
	var own = 0
	for b in surface.get("buildings", []):
		if str(b.get("colonyId", "")) == owner and str(b.get("type", "")) == type:
			own += 1
	if own >= int(LIMITS.get(type, 99)):
		return "Достигнут предел этих построек"
	for b in surface.get("buildings", []):
		if _pos(b.get("pos")).distance_to(pos) < 8.0:
			return "Слишком близко к другой постройке"
	return ""


static func snap_fence_position(p: Vector2) -> Vector2:
	return Vector2((floor(p.x / WALL_CELL_SIZE) + 0.5) * WALL_CELL_SIZE, (floor(p.y / WALL_CELL_SIZE) + 0.5) * WALL_CELL_SIZE)


static func fence_contains(b: Dictionary, p: Vector2) -> bool:
	var bp = _pos(b.get("pos"))
	var dx = int(floor(p.x / WALL_CELL_SIZE)) - int(floor(bp.x / WALL_CELL_SIZE))
	var dy = int(floor(p.y / WALL_CELL_SIZE)) - int(floor(bp.y / WALL_CELL_SIZE))
	if str(b.get("type", "")) != "gate" or int(b.get("gateSpan", 1)) != GATE_SPAN:
		return dx == 0 and dy == 0
	if str(b.get("gateAxis", "horizontal")) == "vertical":
		return dx == 0 and absi(dy) <= 1
	return dy == 0 and absi(dx) <= 1


static func fence_placement(surface: Dictionary, owner: String, pos: Vector2, replace_own_wall: bool = false) -> String:
	var half = WALL_CELL_SIZE / 2.0
	var w = float(surface.get("width", 480))
	var h = float(surface.get("height", 480))
	if pos.x < half or pos.y < half or pos.x > w - half or pos.y > h - half:
		return "За границей карты"
	for e in surface.get("entrances", []):
		if _pos(e).distance_to(pos) < 7.0:
			return "Слишком близко к костру"
	for d in surface.get("deposits", []):
		var dp = _pos(d.get("pos"))
		if pow((pos.x - dp.x) / (DEPOSIT_RX + 1.5), 2) + pow((pos.y - dp.y) / (DEPOSIT_RY + 1.5), 2) <= 1.0:
			return "Рабочая площадка карьера"
	for dx in [-0.85, 0.0, 0.85]:
		for dy in [-0.85, 0.0, 0.85]:
			if SurfaceTerrain.is_water_at(pos.x + dx, pos.y + dy):
				return "Основание попадает в воду"
	for dx in [-0.85, 0.0, 0.85]:
		for dy in [-0.85, 0.0, 0.85]:
			if SurfaceTerrain.is_mountain_at(pos.x + dx, pos.y + dy):
				return "Основание упирается в скалы"
	for b in surface.get("buildings", []):
		var t = str(b.get("type", ""))
		if t == "wall" or t == "gate":
			if fence_contains(b, pos) and not (replace_own_wall and t == "wall" and str(b.get("colonyId", "")) == owner):
				return "Место уже занято"
		else:
			var f = _footprint(b)
			if not f.is_empty():
				var grown = {"x": f.x, "y": f.y, "rx": float(f.rx) + half, "ry": float(f.ry) + half}
				if BuildingGeometry.inside_footprint(pos.x, pos.y, grown):
					return "Слишком близко к зданию"
	return ""


static func gate_cell_centers(pos: Vector2, axis: String) -> Array[Vector2]:
	var snapped = snap_fence_position(pos)
	var out: Array[Vector2] = []
	for i in range(GATE_SPAN):
		var off = (float(i) - float(GATE_SPAN - 1) / 2.0) * WALL_CELL_SIZE
		out.append(snapped + (Vector2(0, off) if axis == "vertical" else Vector2(off, 0)))
	return out


static func gate_placement(surface: Dictionary, owner: String, pos: Vector2, axis: String) -> String:
	for p in gate_cell_centers(pos, axis):
		var reason = fence_placement(surface, owner, p, true)
		if reason != "":
			return reason
	return ""


static func grid_width(surface: Dictionary, cell: float) -> int:
	return int(ceil(float(surface.get("width", 480)) / cell))


## Cells crossed by a straight brush stroke (client/src/main.ts wallLineCells).
static func wall_line_cells(surface: Dictionary, a: Vector2, b: Vector2) -> Array[int]:
	var gw = grid_width(surface, WALL_CELL_SIZE)
	var gh = int(ceil(float(surface.get("height", 480)) / WALL_CELL_SIZE))
	var seen: Dictionary = {}
	var out: Array[int] = []
	var steps = maxi(1, int(ceil(a.distance_to(b) / (WALL_CELL_SIZE * 0.45))))
	for i in range(steps + 1):
		var p = a.lerp(b, float(i) / float(steps))
		var cx = int(floor(p.x / WALL_CELL_SIZE))
		var cy = int(floor(p.y / WALL_CELL_SIZE))
		if cx >= 0 and cx < gw and cy >= 0 and cy < gh:
			var idx = cy * gw + cx
			if not seen.has(idx):
				seen[idx] = true
				out.append(idx)
	return out


static func cell_center(surface: Dictionary, index: int, cell: float) -> Vector2:
	var gw = grid_width(surface, cell)
	return Vector2((float(index % gw) + 0.5) * cell, (float(index / gw) + 0.5) * cell)


## Rectangle of zone/erase cells (client/src/main.ts rectCells).
static func rect_cells(surface: Dictionary, a: Vector2, b: Vector2, cell: float) -> Array[int]:
	var gw = grid_width(surface, cell)
	var gh = int(ceil(float(surface.get("height", 480)) / cell))
	var min_x = maxi(0, int(floor(minf(a.x, b.x) / cell)))
	var max_x = mini(gw - 1, int(floor(maxf(a.x, b.x) / cell)))
	var min_y = maxi(0, int(floor(minf(a.y, b.y) / cell)))
	var max_y = mini(gh - 1, int(floor(maxf(a.y, b.y) / cell)))
	var out: Array[int] = []
	for cy in range(min_y, max_y + 1):
		for cx in range(min_x, max_x + 1):
			out.append(cy * gw + cx)
	return out


static func cost_text(kind: String) -> String:
	var c: Dictionary = COSTS.get(kind, {})
	var parts: PackedStringArray = []
	for res in [["clay", "глина"], ["wood", "дерево"], ["stone", "камень"]]:
		if int(c.get(res[0], 0)) > 0:
			parts.append("%d %s" % [int(c[res[0]]), res[1]])
	return ", ".join(parts)
