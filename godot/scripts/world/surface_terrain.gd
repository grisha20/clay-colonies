class_name SurfaceTerrain
extends RefCounted

## Terrain geometry and polygon predicates matching shared/surfaceTerrain.ts exactly.
## Provides water detection and procedural ArrayMesh triangulation for lakes.

# Authored polygon outlines matching shared/surfaceTerrain.ts
const NORTH_LAKE_OUTLINE: Array[Vector2] = [
	Vector2(180, 128), Vector2(208, 128), Vector2(208, 116),
	Vector2(220, 116), Vector2(220, 104), Vector2(248, 104),
	Vector2(248, 112), Vector2(264, 112), Vector2(264, 128),
	Vector2(284, 128), Vector2(284, 156),
	Vector2(264, 156), Vector2(264, 176), Vector2(248, 176),
	Vector2(248, 160), Vector2(232, 160), Vector2(232, 176),
	Vector2(208, 176), Vector2(208, 160), Vector2(180, 160)
]

const SOUTH_LAKE_OUTLINE: Array[Vector2] = [
	Vector2(164, 348), Vector2(200, 348), Vector2(200, 324),
	Vector2(208, 324), Vector2(208, 312), Vector2(228, 312),
	Vector2(228, 336), Vector2(244, 336), Vector2(244, 340),
	Vector2(256, 340), Vector2(256, 312),
	Vector2(280, 312), Vector2(280, 336), Vector2(300, 336),
	Vector2(300, 340), Vector2(312, 340), Vector2(312, 348),
	Vector2(316, 348), Vector2(316, 364), Vector2(312, 364),
	Vector2(312, 372), Vector2(292, 372), Vector2(292, 396),
	Vector2(280, 396), Vector2(280, 408), Vector2(268, 408), Vector2(268, 432),
	Vector2(240, 432), Vector2(240, 420), Vector2(216, 420),
	Vector2(216, 408), Vector2(184, 408), Vector2(184, 400),
	Vector2(176, 400), Vector2(176, 392), Vector2(172, 392),
	Vector2(172, 380), Vector2(164, 380)
]

static func is_inside_polygon_exact(x: float, y: float, points: Array[Vector2]) -> bool:
	var inside = false
	var n = points.size()
	var j = n - 1
	for i in range(n):
		var a = points[i]
		var b = points[j]
		if (a.y > y) != (b.y > y) and x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x:
			inside = not inside
		j = i
	return inside

# Active terrain. Lakes are world data (snapshot surface.terrain); snapshots
# without terrain mean the authored legacy map above.
# Each entry: {"id": String, "outline": Array[Vector2], "box": Rect2}
static var lakes: Array = []
# {"id", "outline": Array[Vector2], "box": Rect2, "height": float}
static var mountains: Array = []
# Vector4(x, y, radius, height)
static var hills: Array = []
static var revision: int = 0
const MOUNTAIN_FOOT: float = 5.0
static var _signature: String = ""

static func _legacy_lakes() -> Array:
	return [_make_lake("north", NORTH_LAKE_OUTLINE), _make_lake("south", SOUTH_LAKE_OUTLINE)]

static func _make_lake(id: String, outline: Array[Vector2]) -> Dictionary:
	var lo = Vector2(INF, INF)
	var hi = Vector2(-INF, -INF)
	for p in outline:
		lo = Vector2(minf(lo.x, p.x), minf(lo.y, p.y))
		hi = Vector2(maxf(hi.x, p.x), maxf(hi.y, p.y))
	return {"id": id, "outline": outline, "box": Rect2(lo, hi - lo)}

static func _ensure() -> void:
	if lakes.is_empty() and _signature == "":
		lakes = _legacy_lakes()
		_signature = "legacy"

## Installs terrain from a snapshot's surface.terrain (null/invalid -> legacy map).
## Returns true when the active terrain changed.
static func set_terrain(data: Variant) -> bool:
	var next: Array = []
	var next_mountains: Array = []
	var next_hills: Array = []
	var sig = "legacy"
	if typeof(data) == TYPE_DICTIONARY and typeof(data.get("lakes")) == TYPE_ARRAY:
		sig = str(data.get("seed", 0)) + ":" + JSON.stringify([data.get("lakes"), data.get("mountains", []), data.get("hills", [])])
		for m in data.get("mountains", []):
			if typeof(m) != TYPE_DICTIONARY or typeof(m.get("outline")) != TYPE_ARRAY:
				continue
			var mo: Array[Vector2] = []
			for pt in m.get("outline"):
				if typeof(pt) == TYPE_DICTIONARY:
					mo.append(Vector2(float(pt.get("x", 0.0)), float(pt.get("y", 0.0))))
			if mo.size() >= 3:
				var entry = _make_lake(str(m.get("id", "")), mo)
				entry["height"] = float(m.get("height", 10.0))
				next_mountains.append(entry)
		for h in data.get("hills", []):
			if typeof(h) == TYPE_DICTIONARY:
				next_hills.append(Vector4(float(h.get("x", 0.0)), float(h.get("y", 0.0)), maxf(1.0, float(h.get("radius", 1.0))), float(h.get("height", 0.0))))
		for lake in data.get("lakes"):
			if typeof(lake) != TYPE_DICTIONARY or typeof(lake.get("outline")) != TYPE_ARRAY:
				continue
			var outline: Array[Vector2] = []
			for pt in lake.get("outline"):
				if typeof(pt) == TYPE_DICTIONARY:
					outline.append(Vector2(float(pt.get("x", 0.0)), float(pt.get("y", 0.0))))
			if outline.size() >= 3:
				next.append(_make_lake(str(lake.get("id", "")), outline))
	else:
		next = _legacy_lakes()
	if sig == _signature:
		return false
	_signature = sig
	lakes = next
	mountains = next_mountains
	hills = next_hills
	revision += 1
	return true

static func get_lakes() -> Array:
	_ensure()
	return lakes

static func get_mountains() -> Array:
	_ensure()
	return mountains

static func is_mountain_at(x: float, y: float) -> bool:
	_ensure()
	for m in mountains:
		var box: Rect2 = m.box
		if x < box.position.x or y < box.position.y or x > box.end.x or y > box.end.y:
			continue
		if is_inside_polygon_exact(x, y, m.outline):
			return true
	return false

## Water or rock: nobody walks or builds there (shared/surfaceTerrain.ts isTerrainBlockedAt).
static func is_blocked_at(x: float, y: float) -> bool:
	return is_water_at(x, y) or is_mountain_at(x, y)

static func _outline_distance(x: float, y: float, outline: Array[Vector2]) -> float:
	var p = Vector2(x, y)
	var best = INF
	var n = outline.size()
	for i in range(n):
		var a = outline[i]
		var b = outline[(i + 1) % n]
		var ab = b - a
		var t = 0.0
		var len_sq = ab.length_squared()
		if len_sq > 0.0001:
			t = clampf((p - a).dot(ab) / len_sq, 0.0, 1.0)
		best = minf(best, p.distance_to(a + ab * t))
	return best

## Visual ground height, same formula as shared/surfaceTerrain.ts heightAt.
static func height_at(x: float, y: float) -> float:
	_ensure()
	var h = 0.0
	for hill in hills:
		var d2 = ((x - hill.x) * (x - hill.x) + (y - hill.y) * (y - hill.y)) / (hill.z * hill.z)
		if d2 < 1.0:
			h += hill.w * (1.0 - d2) * (1.0 - d2)
	for m in mountains:
		var box: Rect2 = m.box
		if x < box.position.x - MOUNTAIN_FOOT or x > box.end.x + MOUNTAIN_FOOT or y < box.position.y - MOUNTAIN_FOOT or y > box.end.y + MOUNTAIN_FOOT:
			continue
		var d = _outline_distance(x, y, m.outline)
		var inside = is_inside_polygon_exact(x, y, m.outline)
		var t = minf(1.0, 0.25 + d / 10.0) if inside else maxf(0.0, 0.25 * (1.0 - d / MOUNTAIN_FOOT))
		h = maxf(h, float(m.height) * t * t * (3.0 - 2.0 * t))
	return h

static func is_water_at(x: float, y: float) -> bool:
	return get_lake_id_at(x, y) != ""

static func get_lake_id_at(x: float, y: float) -> String:
	_ensure()
	for lake in lakes:
		var box: Rect2 = lake.box
		# Bounding box first: identical result, skips the polygon walk almost everywhere.
		if x < box.position.x or y < box.position.y or x > box.end.x or y > box.end.y:
			continue
		if is_inside_polygon_exact(x, y, lake.outline):
			return lake.id
	return ""

static func generate_lake_mesh(outline: Array[Vector2], water_height_y: float = 0.015) -> ArrayMesh:
	var packed_outline = PackedVector2Array(outline)
	var indices = Geometry2D.triangulate_polygon(packed_outline)

	var verts = PackedVector3Array()
	var normals = PackedVector3Array()
	var uvs = PackedVector2Array()

	for pt in outline:
		verts.append(Vector3(pt.x, water_height_y, pt.y))
		normals.append(Vector3.UP)
		uvs.append(Vector2(pt.x / 16.0, pt.y / 16.0))

	var arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices

	var mesh = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
