class_name SurfaceNavigation
extends RefCounted

## Pure geometric surface navigation and route interpolation matching
## shared/surfaceNavigation.ts, shared/surfaceGrid.ts, and shared/fenceGeometry.ts.
## Ensures resident movement trajectories never penetrate buildings, campfires,
## walls, enemy gates, or water bodies.

const BuildingGeometry = preload("res://scripts/world/building_geometry.gd")
const SurfaceTerrain = preload("res://scripts/world/surface_terrain.gd")

const WALL_CELL_SIZE: float = 2.0
const GATE_SPAN: int = 3
const MAP_WIDTH: float = 480.0
const MAP_HEIGHT: float = 480.0

# Obstacle index for one buildings array. Every resident of a snapshot queries
# the same array, so footprints and fence cells are derived once instead of per
# probe. Keyed by content hash, so an array edited in place is re-indexed.
static var _index_hash: int = 0
static var _index_size: int = -1
static var _footprints: Array = []
static var _wall_cells: Dictionary = {}
static var _gate_cells: Dictionary = {}

static func _index(buildings: Array) -> void:
	var h = buildings.hash()
	if h == _index_hash and buildings.size() == _index_size:
		return
	_index_hash = h
	_index_size = buildings.size()
	_footprints = []
	_wall_cells = {}
	_gate_cells = {}
	for b in buildings:
		if typeof(b) != TYPE_DICTIONARY:
			continue
		var f = BuildingGeometry.get_building_footprint(b)
		if not f.is_empty():
			_footprints.append(f)
			continue
		if str(b.get("stage", "built")) != "built":
			continue
		var b_type = str(b.get("type", "wall"))
		if b_type != "wall" and b_type != "gate":
			continue
		var pos_d = b.get("pos", {})
		var cx = int(floor(float(pos_d.get("x", 0.0)) / WALL_CELL_SIZE))
		var cy = int(floor(float(pos_d.get("y", 0.0)) / WALL_CELL_SIZE))
		var cells: Array[Vector2i] = [Vector2i(cx, cy)]
		if b_type == "gate" and int(b.get("gateSpan", 1)) == GATE_SPAN:
			if str(b.get("gateAxis", "horizontal")) == "vertical":
				cells = [Vector2i(cx, cy - 1), Vector2i(cx, cy), Vector2i(cx, cy + 1)]
			else:
				cells = [Vector2i(cx - 1, cy), Vector2i(cx, cy), Vector2i(cx + 1, cy)]
		if b_type == "wall":
			for c in cells:
				_wall_cells[c] = true
		else:
			var colony = str(b.get("colonyId", ""))
			for c in cells:
				if not _gate_cells.has(c):
					_gate_cells[c] = []
				_gate_cells[c].append(colony)

## Same predicate as fence_contains over every built wall and foreign gate.
static func _fence_blocks(cell: Vector2i, owner: String) -> bool:
	if _wall_cells.has(cell):
		return true
	for colony in _gate_cells.get(cell, []):
		if colony != owner:
			return true
	return false

static func fence_contains(b: Dictionary, p: Vector2) -> bool:
	var pos_d = b.get("pos", {})
	var bx = float(pos_d.get("x", 0.0))
	var by = float(pos_d.get("y", 0.0))
	var dx = int(floor(p.x / WALL_CELL_SIZE)) - int(floor(bx / WALL_CELL_SIZE))
	var dy = int(floor(p.y / WALL_CELL_SIZE)) - int(floor(by / WALL_CELL_SIZE))
	var b_type = str(b.get("type", "wall"))
	var gate_span = int(b.get("gateSpan", 1))
	if b_type != "gate" or gate_span != GATE_SPAN:
		return dx == 0 and dy == 0
	var gate_axis = str(b.get("gateAxis", "horizontal"))
	if gate_axis == "vertical":
		return dx == 0 and absi(dy) <= 1
	else:
		return dy == 0 and absi(dx) <= 1

static func surface_point_open(p: Vector2, owner: String, buildings: Array, entrances: Array, map_w: float = MAP_WIDTH, map_h: float = MAP_HEIGHT) -> bool:
	if p.x < 1.0 or p.y < 1.0 or p.x >= map_w - 1.0 or p.y >= map_h - 1.0:
		return false
	if SurfaceTerrain.is_water_at(p.x, p.y):
		return false
	for ent in entrances:
		if typeof(ent) == TYPE_DICTIONARY:
			var ex = float(ent.get("x", 0.0))
			var ey = float(ent.get("y", 0.0))
			var edx = (p.x - ex) / BuildingGeometry.HEARTH_RADIUS_X
			var edy = (p.y - ey) / BuildingGeometry.HEARTH_RADIUS_Y
			if edx * edx + edy * edy < 1.0:
				return false
	_index(buildings)
	for f in _footprints:
		if BuildingGeometry.inside_footprint(p.x, p.y, f):
			return false
	if _fence_blocks(Vector2i(int(floor(p.x / WALL_CELL_SIZE)), int(floor(p.y / WALL_CELL_SIZE))), owner):
		return false
	return true

static func surface_grid_line_open(from_p: Vector2, to_p: Vector2, buildings: Array, owner: String) -> bool:
	var x = int(floor(from_p.x / WALL_CELL_SIZE))
	var y = int(floor(from_p.y / WALL_CELL_SIZE))
	var end_x = int(floor(to_p.x / WALL_CELL_SIZE))
	var end_y = int(floor(to_p.y / WALL_CELL_SIZE))
	var dx = to_p.x - from_p.x
	var dy = to_p.y - from_p.y
	var step_x = 1 if dx > 0 else (-1 if dx < 0 else 0)
	var step_y = 1 if dy > 0 else (-1 if dy < 0 else 0)
	var delta_x = WALL_CELL_SIZE / absf(dx) if absf(dx) > 0.00001 else INF
	var delta_y = WALL_CELL_SIZE / absf(dy) if absf(dy) > 0.00001 else INF
	var cross_x = ((x + (1 if dx > 0 else 0)) * WALL_CELL_SIZE - from_p.x) / dx if absf(dx) > 0.00001 else INF
	var cross_y = ((y + (1 if dy > 0 else 0)) * WALL_CELL_SIZE - from_p.y) / dy if absf(dy) > 0.00001 else INF

	_index(buildings)
	var check_cell = func(cx: int, cy: int) -> bool:
		var center = Vector2((cx + 0.5) * WALL_CELL_SIZE, (cy + 0.5) * WALL_CELL_SIZE)
		if SurfaceTerrain.is_water_at(center.x, center.y):
			return false
		return not _fence_blocks(Vector2i(cx, cy), owner)

	if not check_cell.call(x, y):
		return false

	while x != end_x or y != end_y:
		if x == end_x:
			y += step_y
			cross_y += delta_y
		elif y == end_y:
			x += step_x
			cross_x += delta_x
		elif absf(cross_x - cross_y) < 1e-6:
			if not check_cell.call(x + step_x, y) or not check_cell.call(x, y + step_y):
				return false
			x += step_x
			y += step_y
			cross_x += delta_x
			cross_y += delta_y
		elif cross_x < cross_y:
			x += step_x
			cross_x += delta_x
		else:
			y += step_y
			cross_y += delta_y

		if not check_cell.call(x, y):
			return false

	return true

static func surface_line_open(a: Vector2, b: Vector2, owner: String, buildings: Array, entrances: Array) -> bool:
	if not surface_point_open(b, owner, buildings, entrances):
		return false
	for ent in entrances:
		if typeof(ent) == TYPE_DICTIONARY:
			var camp = Vector2(float(ent.get("x", 0.0)), float(ent.get("y", 0.0)))
			if BuildingGeometry.crosses_hearth(a, b, camp):
				return false
	_index(buildings)
	for f in _footprints:
		if BuildingGeometry.crosses_footprint(a, b, f):
			return false
	return surface_grid_line_open(a, b, buildings, owner)

static func route_point(from_p: Vector2, points: Array[Vector2], ratio: float) -> Vector2:
	if points.is_empty():
		return from_p
	var total = 0.0
	var p = from_p
	for q in points:
		total += p.distance_to(q)
		p = q
	if total < 0.0001:
		return points[-1]
	var clamped_ratio = clampf(ratio, 0.0, 1.0)
	var left = total * clamped_ratio
	p = from_p
	for q in points:
		var d = p.distance_to(q)
		if left <= d:
			var t = (left / d) if d > 0.00001 else 0.0
			return p.lerp(q, t)
		left -= d
		p = q
	return points[-1]

## Finds a safe route from from_p to target_p.
## Returns [target_p] if direct segment is completely open.
## Otherwise returns a multi-segment polyline [wp1, wp2, ..., goal] where every segment is verified open.
static func surface_route(from_p: Vector2, target_p: Vector2, owner: String, buildings: Array, entrances: Array) -> Array[Vector2]:
	var goal = target_p
	_index(buildings)
	for f in _footprints:
		if BuildingGeometry.inside_footprint(goal.x, goal.y, f):
			goal = BuildingGeometry.outside_footprint(goal, f)

	if not surface_point_open(goal, owner, buildings, entrances):
		var found_open = false
		for r in range(1, 13):
			for i in range(24):
				var angle = i * PI / 12.0
				var cand = target_p + Vector2(cos(angle), sin(angle)) * float(r)
				if surface_point_open(cand, owner, buildings, entrances):
					goal = cand
					found_open = true
					break
			if found_open:
				break
		if not found_open:
			return [from_p]

	# If direct chord is open, no waypoints are needed!
	if surface_line_open(from_p, goal, owner, buildings, entrances):
		return [goal]

	# Check for convex obstacle candidates (huts, workshops, storage, hearths, walls)
	var route = _find_local_route(from_p, goal, owner, buildings, entrances)
	if not route.is_empty():
		return route

	# Fallback: if no route could be found, stop at from_p rather than penetrating obstacles
	return [from_p]

static func _find_local_route(from_p: Vector2, goal: Vector2, owner: String, buildings: Array, entrances: Array) -> Array[Vector2]:
	# 1. Fast perimeter waypoint search for convex blockers
	var candidate_paths: Array = []

	# Check buildings with footprints
	_index(buildings)
	for f in _footprints:
		if BuildingGeometry.crosses_footprint(from_p, goal, f):
			var bx = float(f["x"])
			var by = float(f["y"])
			var mx = float(f["rx"]) + 0.8
			var my = float(f["ry"]) + 0.8
			_generate_perimeter_paths(from_p, goal, bx, by, mx, my, candidate_paths)

	# Check hearths
	for ent in entrances:
		if typeof(ent) == TYPE_DICTIONARY:
			var camp = Vector2(float(ent.get("x", 0.0)), float(ent.get("y", 0.0)))
			if BuildingGeometry.crosses_hearth(from_p, goal, camp):
				_generate_perimeter_paths(from_p, goal, camp.x, camp.y, BuildingGeometry.HEARTH_RADIUS_X + 0.8, BuildingGeometry.HEARTH_RADIUS_Y + 0.8, candidate_paths)

	# Check walls
	for b in buildings:
		if typeof(b) == TYPE_DICTIONARY:
			var stage = str(b.get("stage", "built"))
			var b_type = str(b.get("type", "wall"))
			var b_colony = str(b.get("colonyId", ""))
			if stage == "built" and (b_type == "wall" or (b_type == "gate" and b_colony != owner)):
				var pos_d = b.get("pos", {})
				var wx = float(pos_d.get("x", 0.0))
				var wy = float(pos_d.get("y", 0.0))
				_generate_perimeter_paths(from_p, goal, wx, wy, 1.8, 1.8, candidate_paths)

	# Check candidate paths for validity
	var best_path: Array[Vector2] = []
	var best_dist = INF
	for raw_path in candidate_paths:
		var valid = true
		var prev = from_p
		for pt in raw_path:
			if not surface_line_open(prev, pt, owner, buildings, entrances):
				valid = false
				break
			prev = pt
		if valid:
			var dist = 0.0
			var cur = from_p
			for pt in raw_path:
				dist += cur.distance_to(pt)
				cur = pt
			if dist < best_dist:
				best_dist = dist
				best_path = []
				for pt in raw_path:
					best_path.append(pt)

	if not best_path.is_empty():
		return _simplify_path(from_p, best_path, owner, buildings, entrances)

	# 2. Local A* search on 2x2 grid for arbitrary obstacles / water shorelines
	return _grid_astar_route(from_p, goal, owner, buildings, entrances)

static func _generate_perimeter_paths(from_p: Vector2, goal: Vector2, cx: float, cy: float, mx: float, my: float, out_paths: Array) -> void:
	var nw = Vector2(cx - mx, cy - my)
	var ne = Vector2(cx + mx, cy - my)
	var sw = Vector2(cx - mx, cy + my)
	var se = Vector2(cx + mx, cy + my)

	out_paths.append([nw, ne, goal])
	out_paths.append([ne, nw, goal])
	out_paths.append([sw, se, goal])
	out_paths.append([se, sw, goal])
	out_paths.append([nw, sw, goal])
	out_paths.append([sw, nw, goal])
	out_paths.append([ne, se, goal])
	out_paths.append([se, ne, goal])

	out_paths.append([nw, goal])
	out_paths.append([ne, goal])
	out_paths.append([sw, goal])
	out_paths.append([se, goal])

static func _simplify_path(from_p: Vector2, path: Array[Vector2], owner: String, buildings: Array, entrances: Array) -> Array[Vector2]:
	var result: Array[Vector2] = []
	var last = from_p
	var i = 0
	while i < path.size():
		var far = path.size() - 1
		while far > i and not surface_line_open(last, path[far], owner, buildings, entrances):
			far -= 1
		result.append(path[far])
		last = path[far]
		i = far + 1
	return result

static func _grid_astar_route(from_p: Vector2, goal: Vector2, owner: String, buildings: Array, entrances: Array) -> Array[Vector2]:
	var min_gx = int(clamp(floor(minf(from_p.x, goal.x) / WALL_CELL_SIZE) - 6, 0, floor(MAP_WIDTH / WALL_CELL_SIZE) - 1))
	var max_gx = int(clamp(floor(maxf(from_p.x, goal.x) / WALL_CELL_SIZE) + 6, 0, floor(MAP_WIDTH / WALL_CELL_SIZE) - 1))
	var min_gy = int(clamp(floor(minf(from_p.y, goal.y) / WALL_CELL_SIZE) - 6, 0, floor(MAP_HEIGHT / WALL_CELL_SIZE) - 1))
	var max_gy = int(clamp(floor(maxf(from_p.y, goal.y) / WALL_CELL_SIZE) + 6, 0, floor(MAP_HEIGHT / WALL_CELL_SIZE) - 1))

	var w = max_gx - min_gx + 1
	var h = max_gy - min_gy + 1

	var cell_center = func(gx: int, gy: int) -> Vector2:
		return Vector2((gx + 0.5) * WALL_CELL_SIZE, (gy + 0.5) * WALL_CELL_SIZE)

	var start_c = cell_center.call(int(floor(from_p.x / WALL_CELL_SIZE)), int(floor(from_p.y / WALL_CELL_SIZE)))
	var goal_c = cell_center.call(int(floor(goal.x / WALL_CELL_SIZE)), int(floor(goal.y / WALL_CELL_SIZE)))

	# Find open start cell
	var start_id = -1
	var min_s_dist = INF
	for gy in range(min_gy, max_gy + 1):
		for gx in range(min_gx, max_gx + 1):
			var c = cell_center.call(gx, gy)
			if surface_point_open(c, owner, buildings, entrances) and surface_line_open(from_p, c, owner, buildings, entrances):
				var d = from_p.distance_to(c)
				if d < min_s_dist:
					min_s_dist = d
					start_id = (gy - min_gy) * w + (gx - min_gx)

	# Find open goal cell
	var goal_id = -1
	var min_g_dist = INF
	for gy in range(min_gy, max_gy + 1):
		for gx in range(min_gx, max_gx + 1):
			var c = cell_center.call(gx, gy)
			if surface_point_open(c, owner, buildings, entrances) and surface_line_open(c, goal, owner, buildings, entrances):
				var d = goal.distance_to(c)
				if d < min_g_dist:
					min_g_dist = d
					goal_id = (gy - min_gy) * w + (gx - min_gx)

	if start_id == -1 or goal_id == -1:
		return []

	var dist_map: Dictionary = {start_id: 0.0}
	var parent_map: Dictionary = {}
	var open_set: Array = [start_id]

	var dirs = [
		Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
		Vector2i(1, 1), Vector2i(-1, 1), Vector2i(1, -1), Vector2i(-1, -1)
	]

	while not open_set.is_empty():
		# Pop lowest f_score
		var current_idx = 0
		var current_id = open_set[0]
		var cur_gx = min_gx + (current_id % w)
		var cur_gy = min_gy + (current_id / w)
		var cur_c = cell_center.call(cur_gx, cur_gy)
		var best_score = dist_map[current_id] + cur_c.distance_to(goal)

		for idx in range(1, open_set.size()):
			var sid = open_set[idx]
			var sgx = min_gx + (sid % w)
			var sgy = min_gy + (sid / w)
			var sc = cell_center.call(sgx, sgy)
			var score = dist_map[sid] + sc.distance_to(goal)
			if score < best_score:
				best_score = score
				current_id = sid
				current_idx = idx

		open_set.remove_at(current_idx)

		if current_id == goal_id:
			break

		cur_gx = min_gx + (current_id % w)
		cur_gy = min_gy + (current_id / w)
		cur_c = cell_center.call(cur_gx, cur_gy)

		for dir in dirs:
			var ngx = cur_gx + dir.x
			var ngy = cur_gy + dir.y
			if ngx < min_gx or ngx > max_gx or ngy < min_gy or ngy > max_gy:
				continue
			var nid = (ngy - min_gy) * w + (ngx - min_gx)
			var nc = cell_center.call(ngx, ngy)
			if not surface_point_open(nc, owner, buildings, entrances):
				continue
			if not surface_line_open(cur_c, nc, owner, buildings, entrances):
				continue

			var step_cost = cur_c.distance_to(nc)
			var tentative_g = dist_map[current_id] + step_cost
			if tentative_g < dist_map.get(nid, INF):
				dist_map[nid] = tentative_g
				parent_map[nid] = current_id
				if nid not in open_set:
					open_set.append(nid)

	if not parent_map.has(goal_id) and start_id != goal_id:
		return []

	var full_path: Array[Vector2] = [goal]
	var curr = goal_id
	while curr != start_id and parent_map.has(curr):
		var cgx = min_gx + (curr % w)
		var cgy = min_gy + (curr / w)
		full_path.append(cell_center.call(cgx, cgy))
		curr = parent_map[curr]

	if start_id != goal_id:
		var sgx = min_gx + (start_id % w)
		var sgy = min_gy + (start_id / w)
		full_path.append(cell_center.call(sgx, sgy))

	full_path.reverse()
	return _simplify_path(from_p, full_path, owner, buildings, entrances)
