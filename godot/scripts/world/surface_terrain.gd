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

static func is_water_at(x: float, y: float) -> bool:
	var pt = Vector2(x, y)
	if Geometry2D.is_point_in_polygon(pt, PackedVector2Array(NORTH_LAKE_OUTLINE)):
		return true
	if Geometry2D.is_point_in_polygon(pt, PackedVector2Array(SOUTH_LAKE_OUTLINE)):
		return true
	return false

static func get_lake_id_at(x: float, y: float) -> String:
	var pt = Vector2(x, y)
	if Geometry2D.is_point_in_polygon(pt, PackedVector2Array(NORTH_LAKE_OUTLINE)):
		return "north"
	if Geometry2D.is_point_in_polygon(pt, PackedVector2Array(SOUTH_LAKE_OUTLINE)):
		return "south"
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
