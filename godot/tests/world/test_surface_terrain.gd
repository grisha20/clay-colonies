extends SceneTree

## Automated Headless Unit Tests for Surface Terrain Geometry & Polygon Matching.
## Verifies:
## 1. Authored polygon points match shared/surfaceTerrain.ts.
## 2. Differentiates points where circular approximations fail (e.g. (240, 170) is water, (280, 100) is dry land).
## 3. South lake polygon detection.
## 4. ArrayMesh triangulation generation produces valid water surfaces.

const SurfaceTerrain = preload("res://scripts/world/surface_terrain.gd")

func _init() -> void:
	print("=== RUNNING SURFACE TERRAIN POLYGON TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_north_lake_polygon_points():
		passed += 1

	total += 1
	if test_points_where_circular_approximation_fails():
		passed += 1

	total += 1
	if test_south_lake_polygon_points():
		passed += 1

	total += 1
	if test_procedural_lake_mesh_generation():
		passed += 1

	total += 1
	if test_terrain_from_snapshot_data():
		passed += 1

	total += 1
	if test_parity_with_shared_terrain():
		passed += 1

	print("=== SURFACE TERRAIN RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL SURFACE TERRAIN TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME SURFACE TERRAIN TESTS FAILED!")
		quit(1)

func test_north_lake_polygon_points() -> bool:
	# Center of North lake interior: (230, 135)
	if not SurfaceTerrain.is_water_at(230.0, 135.0):
		push_error("North lake interior point (230, 135) was not detected as water!")
		return false

	if SurfaceTerrain.get_lake_id_at(230.0, 135.0) != "north":
		push_error("Expected lake id 'north', got '%s'" % SurfaceTerrain.get_lake_id_at(230.0, 135.0))
		return false

	# Point clearly outside North lake: (100, 100)
	if SurfaceTerrain.is_water_at(100.0, 100.0):
		push_error("Point (100, 100) falsely detected as water!")
		return false

	print("  PASS: test_north_lake_polygon_points")
	return true

func test_points_where_circular_approximation_fails() -> bool:
	# Point (255, 170): inside actual North lake polygon (y in [156, 176], x in [248, 264]),
	# but was OUTSIDE the old circular approximation (dist = 52.2m > radius 32m).
	if not SurfaceTerrain.is_water_at(255.0, 170.0):
		push_error("Polygon point (255, 170) must be WATER, but is_water_at returned false!")
		return false

	# Point (280, 100): north of actual polygon (top is y=104),
	# but was INSIDE the old circular approximation centered at (260, 118) with radius 32.
	if SurfaceTerrain.is_water_at(280.0, 100.0):
		push_error("Point (280, 100) must be DRY LAND, but is_water_at returned true!")
		return false

	print("  PASS: test_points_where_circular_approximation_fails (verified against shared polygon)")
	return true

func test_south_lake_polygon_points() -> bool:
	# Point (240, 380): inside South lake polygon
	if not SurfaceTerrain.is_water_at(240.0, 380.0):
		push_error("South lake interior point (240, 380) was not detected as water!")
		return false

	if SurfaceTerrain.get_lake_id_at(240.0, 380.0) != "south":
		push_error("Expected lake id 'south', got '%s'" % SurfaceTerrain.get_lake_id_at(240.0, 380.0))
		return false

	print("  PASS: test_south_lake_polygon_points")
	return true

func test_procedural_lake_mesh_generation() -> bool:
	var north_mesh = SurfaceTerrain.generate_lake_mesh(SurfaceTerrain.NORTH_LAKE_OUTLINE)
	if north_mesh == null or north_mesh.get_surface_count() == 0:
		push_error("Failed to generate North lake mesh!")
		return false

	var south_mesh = SurfaceTerrain.generate_lake_mesh(SurfaceTerrain.SOUTH_LAKE_OUTLINE)
	if south_mesh == null or south_mesh.get_surface_count() == 0:
		push_error("Failed to generate South lake mesh!")
		return false

	print("  PASS: test_procedural_lake_mesh_generation (triangulated ArrayMesh created)")
	return true

func test_terrain_from_snapshot_data() -> bool:
	# Generated worlds send their lakes in surface.terrain; missing terrain = legacy map.
	var ring: Array = []
	for i in range(24):
		var a = TAU * float(i) / 24.0
		ring.append({"x": 100.0 + cos(a) * 20.0, "y": 100.0 + sin(a) * 12.0})
	var rev = SurfaceTerrain.revision
	var changed = SurfaceTerrain.set_terrain({"version": 1, "seed": 5, "lakes": [{"id": "lake-x", "seed": 1, "outline": ring}]})
	var ok = changed and SurfaceTerrain.revision == rev + 1
	ok = ok and SurfaceTerrain.is_water_at(100.0, 100.0) and SurfaceTerrain.get_lake_id_at(100.0, 100.0) == "lake-x"
	ok = ok and not SurfaceTerrain.is_water_at(230.0, 135.0)
	ok = ok and not SurfaceTerrain.set_terrain({"version": 1, "seed": 5, "lakes": [{"id": "lake-x", "seed": 1, "outline": ring}]})
	SurfaceTerrain.set_terrain(null)
	ok = ok and SurfaceTerrain.is_water_at(230.0, 135.0) and not SurfaceTerrain.is_water_at(100.0, 100.0)
	if not ok:
		push_error("Terrain data was not applied or restored correctly")
		return false
	print("  PASS: test_terrain_from_snapshot_data")
	return true

func test_parity_with_shared_terrain() -> bool:
	# Reference answers exported from shared/surfaceTerrain.ts (server/src/bench/exportTerrainParity.ts).
	var data = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/terrain_parity.json"))
	if typeof(data) != TYPE_DICTIONARY:
		push_error("terrain_parity.json missing")
		return false
	SurfaceTerrain.set_terrain(data.terrain)
	var bad = 0
	var worst = 0.0
	for s in data.samples:
		var x = float(s.x)
		var y = float(s.y)
		var dh = absf(SurfaceTerrain.height_at(x, y) - float(s.height))
		worst = maxf(worst, dh)
		var membership_ok = SurfaceTerrain.is_water_at(x, y) == bool(s.water) and SurfaceTerrain.is_mountain_at(x, y) == bool(s.mountain)
		if not membership_ok and _edge_distance(x, y) < 0.001:
			# Godot Vector2 is 32-bit: a point within a millimetre of an outline may fall either side.
			membership_ok = true
		if not membership_ok or dh > 0.0005:
			bad += 1
			if bad < 5:
				push_error("parity mismatch at %s,%s" % [x, y])
	SurfaceTerrain.set_terrain(null)
	if bad > 0:
		push_error("%d of %d samples differ (worst height %.5f)" % [bad, data.samples.size(), worst])
		return false
	print("  PASS: test_parity_with_shared_terrain (%d samples, worst height diff %.6f)" % [data.samples.size(), worst])
	return true

func _edge_distance(x: float, y: float) -> float:
	var best = INF
	for shape in SurfaceTerrain.get_lakes() + SurfaceTerrain.get_mountains():
		best = minf(best, SurfaceTerrain._outline_distance(x, y, shape.outline))
	return best
