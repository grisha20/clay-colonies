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
const LIMITS := {"hut": 8, "storage": 6, "workshop": 2, "idol": 1, "kiln": 2, "totem": 8}
## shared/territory.ts: a tribe's land is a disc round its camp and one round
## each built totem; building only on own land. shared/buildingPlacement.ts
## SPRING_CLEARANCE keeps buildings off special clay springs.
const CAMP_TERRITORY_RADIUS := 45.0
const TOTEM_TERRITORY_RADIUS := 36.0
const SPRING_CLEARANCE := 6.0
const COSTS := {
	"hut": {"clay": 8, "wood": 5, "stone": 0},
	"storage": {"clay": 0, "wood": 6, "stone": 4},
	"workshop": {"clay": 8, "wood": 4, "stone": 0},
	"idol": {"clay": 25, "wood": 0, "stone": 5},
	"kiln": {"clay": 10, "wood": 0, "stone": 6},
	"totem": {"clay": 12, "wood": 6, "stone": 4},
	# server/src/config.ts hutUpgradeCost: house of the clan.
	"house": {"clay": 12, "wood": 6, "stone": 0, "special": 8},
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
	for s in surface.get("springs", []):
		if _pos(s.get("pos")).distance_to(pos) < SPRING_CLEARANCE + frx:
			return "Здесь бьёт источник особой глины"
	return territory_placement(surface, owner, pos)


static func territory_discs(surface: Dictionary) -> Array:
	var discs: Array = []
	var entrances = surface.get("entrances", [])
	for i in range(entrances.size()):
		var c = _pos(entrances[i])
		discs.append({"x": c.x, "y": c.y, "r": CAMP_TERRITORY_RADIUS, "owner": "colony-%d" % (i + 1)})
	for b in surface.get("buildings", []):
		if str(b.get("type", "")) == "totem" and str(b.get("stage", "")) == "built":
			var p = _pos(b.get("pos"))
			discs.append({"x": p.x, "y": p.y, "r": TOTEM_TERRITORY_RADIUS, "owner": str(b.get("colonyId", ""))})
	return discs


## Owner of the land at p ("" for no one's): the disc with the largest margin.
static func territory_owner_at(discs: Array, p: Vector2) -> String:
	var owner = ""
	var best = 0.0
	for d in discs:
		var margin = float(d.r) - p.distance_to(Vector2(float(d.x), float(d.y)))
		if margin > best:
			best = margin
			owner = str(d.owner)
	return owner


static func territory_placement(surface: Dictionary, owner: String, p: Vector2) -> String:
	if surface.get("entrances", []).is_empty():
		return ""
	var at = territory_owner_at(territory_discs(surface), p)
	if at == owner:
		return ""
	return "Чужая земля" if at != "" else "Вне своей земли — поставь тотем ближе"


## Own built hut under p for the house upgrade, and why it can't be upgraded
## ("" = can). Same checks as server/src/sim/building.ts hutUpgradeRefusal.
static func house_target(surface: Dictionary, colony: Dictionary, owner: String, p: Vector2) -> Array:
	var best: Dictionary = {}
	var best_d = 4.5
	for b in surface.get("buildings", []):
		if str(b.get("type", "")) != "hut":
			continue
		var d = _pos(b.get("pos")).distance_to(p)
		if d < best_d:
			best_d = d
			best = b
	if best.is_empty() or str(best.get("colonyId", "")) != owner:
		return [best, "Наведите на свою хижину"]
	if str(best.get("stage", "")) != "built":
		return [best, "Хижина ещё строится"]
	if int(best.get("level", 1)) >= 2:
		return [best, "Это уже дом рода"]
	var cost: Dictionary = COSTS.house
	if float(colony.get("specialClay", 0)) < float(cost.special):
		return [best, "Не хватает особой глины"]
	if float(colony.get("clay", 0)) < float(cost.clay) or float(colony.get("wood", 0)) < float(cost.wood):
		return [best, "Не хватает глины или дерева"]
	return [best, ""]


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
	for s in surface.get("springs", []):
		if _pos(s.get("pos")).distance_to(pos) < SPRING_CLEARANCE:
			return "Здесь бьёт источник особой глины"
	return territory_placement(surface, owner, pos)


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
	for res in [["clay", "глина"], ["wood", "дерево"], ["stone", "камень"], ["special", "особая глина"]]:
		if int(c.get(res[0], 0)) > 0:
			parts.append("%d %s" % [int(c[res[0]]), res[1]])
	return ", ".join(parts)


## setDefensePost is accepted where server/src/sim/building.ts isSurfaceBlockedAt
## is false: inside the map, not water or rock, not a wall or foreign gate cell,
## not a hearth, not inside a built footprint.
static func post_placement(surface: Dictionary, owner: String, pos: Vector2) -> String:
	if pos.x < 0 or pos.y < 0 or pos.x >= float(surface.get("width", 480)) or pos.y >= float(surface.get("height", 480)):
		return "За границей карты"
	if SurfaceTerrain.is_water_at(pos.x, pos.y):
		return "Пост нужен на сухом берегу или у ворот"
	if SurfaceTerrain.is_mountain_at(pos.x, pos.y):
		return "Основание упирается в скалы"
	for e in surface.get("entrances", []):
		var ep = _pos(e)
		if pow((pos.x - ep.x) / BuildingGeometry.HEARTH_RADIUS_X, 2) + pow((pos.y - ep.y) / BuildingGeometry.HEARTH_RADIUS_Y, 2) < 1.0:
			return "Слишком близко к костру"
	for b in surface.get("buildings", []):
		var t = str(b.get("type", ""))
		if str(b.get("stage", "")) == "built" and (t == "wall" or (t == "gate" and str(b.get("colonyId", "")) != owner)) and fence_contains(b, pos):
			return "Место занято оградой"
		var f = BuildingGeometry.get_building_footprint(b)
		if not f.is_empty() and BuildingGeometry.inside_footprint(pos.x, pos.y, f):
			return "Внутри постройки"
	return ""
