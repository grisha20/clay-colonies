class_name BuildingGeometry
extends RefCounted

## Pure geometric predicates matching shared/buildingGeometry.ts and shared/campGeometry.ts.
## Used by NetworkResident to ensure visual trajectories never clip through foundations or hearths.

const HEARTH_RADIUS_X: float = 2.7
const HEARTH_RADIUS_Y: float = 1.45

static func get_building_footprint(building: Dictionary) -> Dictionary:
	var stage = str(building.get("stage", "built"))
	var b_type = str(building.get("type", "hut"))
	if stage != "built" or b_type == "wall" or b_type == "gate":
		return {}

	var pos_d = building.get("pos", {})
	var bx = float(pos_d.get("x", 0.0))
	var by = float(pos_d.get("y", 0.0))

	# [rx, ry, offset_y]
	var shape: Array = [1.8, 1.0, 0.0]
	if b_type == "hut":
		shape = [4.0, 2.3, 0.5]
	elif b_type == "workshop":
		shape = [4.6, 2.6, 0.6]
	elif b_type == "storage":
		shape = [3.4, 2.1, 0.6]
	elif b_type == "kiln":
		shape = [2.4, 1.7, 0.3]

	return {
		"x": bx,
		"y": by + shape[2],
		"rx": shape[0],
		"ry": shape[1]
	}

static func inside_footprint(x: float, y: float, f: Dictionary) -> bool:
	if f.is_empty():
		return false
	var rx = float(f["rx"])
	var ry = float(f["ry"])
	var dx = (x - float(f["x"])) / rx
	var dy = (y - float(f["y"])) / ry
	return dx * dx + dy * dy < 1.0

static func crosses_footprint(from_p: Vector2, to_p: Vector2, f: Dictionary) -> bool:
	if f.is_empty():
		return false
	var rx = float(f["rx"])
	var ry = float(f["ry"])
	var x = (from_p.x - float(f["x"])) / rx
	var y = (from_p.y - float(f["y"])) / ry
	var dx = (to_p.x - from_p.x) / rx
	var dy = (to_p.y - from_p.y) / ry
	var length_sq = dx * dx + dy * dy
	var t = 0.0
	if length_sq > 0.00001:
		t = clampf(-(x * dx + y * dy) / length_sq, 0.0, 1.0)
	var px = x + dx * t
	var py = y + dy * t
	return px * px + py * py < 1.0

static func outside_footprint(pos: Vector2, f: Dictionary) -> Vector2:
	if f.is_empty():
		return pos
	var rx = float(f["rx"])
	var ry = float(f["ry"])
	var x = (pos.x - float(f["x"])) / rx
	var y = (pos.y - float(f["y"])) / ry
	var length = sqrt(x * x + y * y)
	if length > 0.0001:
		return Vector2(float(f["x"]) + (x / length) * (rx + 0.15), float(f["y"]) + (y / length) * (ry + 0.15))
	return Vector2(float(f["x"]), float(f["y"]) + ry + 0.15)

static func crosses_hearth(from_p: Vector2, to_p: Vector2, camp: Vector2) -> bool:
	var f = {
		"x": camp.x,
		"y": camp.y,
		"rx": HEARTH_RADIUS_X,
		"ry": HEARTH_RADIUS_Y
	}
	return crosses_footprint(from_p, to_p, f)

## Finds a safe intermediate waypoint if the direct segment crosses any solid foundation or hearth.
## Returns target directly if no obstacle is crossed.
static func calculate_safe_waypoint(from_p: Vector2, target_p: Vector2, buildings: Array, entrances: Array) -> Vector2:
	var solids: Array[Dictionary] = []
	for b in buildings:
		if typeof(b) == TYPE_DICTIONARY:
			var f = get_building_footprint(b)
			if not f.is_empty():
				solids.append(f)

	for ent in entrances:
		if typeof(ent) == TYPE_DICTIONARY:
			solids.append({
				"x": float(ent.get("x", 0.0)),
				"y": float(ent.get("y", 0.0)),
				"rx": HEARTH_RADIUS_X,
				"ry": HEARTH_RADIUS_Y
			})


	# Find if target is inside a solid
	var goal = target_p
	for f in solids:
		if inside_footprint(target_p.x, target_p.y, f):
			goal = outside_footprint(target_p, f)
			break

	# Find closest blocker crossed by chord
	var blocker: Dictionary = {}
	var min_dist = INF
	for f in solids:
		if not inside_footprint(from_p.x, from_p.y, f) and crosses_footprint(from_p, goal, f):
			var d = from_p.distance_to(Vector2(f["x"], f["y"]))
			if d < min_dist:
				min_dist = d
				blocker = f

	if blocker.is_empty():
		return goal

	# Generate waypoints around the blocker perimeter
	var bx = float(blocker["x"])
	var by = float(blocker["y"])
	var brx = float(blocker["rx"])
	var bry = float(blocker["ry"])
	var margin_x = brx + 0.8
	var margin_y = bry + 0.8

	var candidates: Array[Vector2] = [
		Vector2(bx, by - margin_y),
		Vector2(bx, by + margin_y),
		Vector2(bx - margin_x, by),
		Vector2(bx + margin_x, by),
		Vector2(bx - margin_x, by - margin_y),
		Vector2(bx + margin_x, by - margin_y),
		Vector2(bx - margin_x, by + margin_y),
		Vector2(bx + margin_x, by + margin_y)
	]

	var valid_candidates: Array[Vector2] = []
	for p in candidates:
		if from_p.distance_to(p) > 0.6:
			var crosses_any = false
			for f in solids:
				if crosses_footprint(from_p, p, f):
					crosses_any = true
					break
			if not crosses_any:
				valid_candidates.append(p)

	if valid_candidates.is_empty():
		return goal

	# Select candidate that minimizes total travel distance
	var best_p = valid_candidates[0]
	var best_dist = INF
	for p in valid_candidates:
		var d = from_p.distance_to(p) + p.distance_to(goal)
		if d < best_dist:
			best_dist = d
			best_p = p

	return best_p
