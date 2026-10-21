class_name WorldView
extends Node3D

## Visual 3D environment for Clayfolk Surface Map (480x480).
## Renders the meadow ground (clearings, trails, quarries, shores), pond water,
## procedural clay props for every snapshot entity (trees, bushes, rocks, clay,
## sticks, quarries, buildings, fences, creatures, fish), lighting and camera.
## Visual only: no gameplay state is derived here.

const SurfaceTerrain = preload("res://scripts/world/surface_terrain.gd")
const PropFactory = preload("res://scripts/world/prop_factory.gd")
const GroundDecor = preload("res://scripts/world/ground_decor.gd")
const TrailMap = preload("res://scripts/world/trail_map.gd")

@export var camera_distance: float = 14.0
@export var camera_angle_deg: float = 52.0
@export var pan_speed: float = 35.0

var camera_pivot: Node3D
var camera: Camera3D
var focused_target: Node3D = null
var target_camera_distance: float = 14.0
const MIN_CAMERA_DISTANCE: float = 4.0
const MAX_CAMERA_DISTANCE: float = 80.0
var colony_focus_points: Array[Vector3] = [COLONY_1_ENTRANCE, COLONY_2_ENTRANCE]
var received_landmarks: bool = false
var camera_navigated: bool = false


# Map dimensions matching CONFIG.mapWidth/mapHeight
const MAP_WIDTH: float = 480.0
const MAP_HEIGHT: float = 480.0
const GROUND_MARGIN: float = 160.0

# Key surface landmarks
const COLONY_1_ENTRANCE = Vector3(120.0, 0.0, 240.0)
const COLONY_2_ENTRANCE = Vector3(360.0, 0.0, 240.0)
const NORTH_LAKE_CENTER = Vector3(230.0, 0.0, 140.0)
const SOUTH_LAKE_CENTER = Vector3(240.0, 0.0, 370.0)

# shared/resourceDeposits.ts
const DEPOSIT_RX: float = 10.0
const DEPOSIT_RY: float = 6.5
const WALL_CELL_SIZE: float = 2.0
const GATE_SPAN: int = 3
const CAMP_CLEARING_RADIUS: float = 17.0
# Hut GLB is 3.16 x 3.16; stretch it over the server footprint (rx 4.0, ry 2.3).
const HUT_SCALE = Vector3(2.25, 1.75, 1.45)

# Dynamic containers for snapshot entities
var buildings_container: Node3D
var campfires_container: Node3D
var entities_container: Node3D
var fence_container: Node3D
var ground_decor: GroundDecor
var ground_material: ShaderMaterial
var water_material: ShaderMaterial
var water_container: Node3D
var mountain_container: Node3D
var trail_map: TrailMap

var active_buildings: Dictionary = {}  # building_id -> Node3D
var active_campfires: Dictionary = {}  # entrance_idx -> Node3D
var active_world_nodes: Dictionary = {} # id -> Node3D
var fence_signature: String = ""
var ground_signature: String = ""
var colony_fire: Array[float] = [1.0, 1.0]
var anim_time: float = 0.0
var sim_speed: float = 1.0
var _source_cache: Dictionary = {}
## Latest snapshot, read by describe_at for hover tooltips.
var last_snapshot: Dictionary = {}
const BUILDING_NAMES = {"hut": "Хижина", "storage": "Склад", "workshop": "Мастерская", "idol": "Идол", "wall": "Ограда", "gate": "Ворота"}
var _prewarm: Array[Callable] = []
## Targets residents are working on (EntityRegistry.worked_targets): trees shake.
var worked_targets: Dictionary = {}
var _trail_updates: int = 0

func _ready() -> void:
	_queue_prewarm()
	_setup_environment()
	_setup_terrain()
	_setup_containers()
	_setup_lakes()
	_setup_camera()

func _setup_containers() -> void:
	buildings_container = Node3D.new()
	buildings_container.name = "BuildingsContainer"
	add_child(buildings_container)

	fence_container = Node3D.new()
	fence_container.name = "FenceContainer"
	add_child(fence_container)

	campfires_container = Node3D.new()
	campfires_container.name = "CampfiresContainer"
	add_child(campfires_container)

	entities_container = Node3D.new()
	entities_container.name = "EntitiesContainer"
	add_child(entities_container)

	ground_decor = GroundDecor.new()
	ground_decor.name = "GroundDecor"
	ground_decor.map_size = Vector2(MAP_WIDTH, MAP_HEIGHT)
	add_child(ground_decor)

func _setup_environment() -> void:
	var sun = DirectionalLight3D.new()
	sun.name = "SunLight"
	# Warm late-morning sun from the south-west: long enough shadows to ground
	# every prop, but not so low that trees swallow the residents.
	sun.transform = Transform3D(
		Basis(Vector3.UP, deg_to_rad(-35.0)) * Basis(Vector3.RIGHT, deg_to_rad(-50.0))
	)
	sun.light_color = Color(1.0, 0.93, 0.80, 1.0)
	sun.light_energy = 1.35
	sun.shadow_enabled = true
	sun.shadow_blur = 1.5
	sun.directional_shadow_max_distance = 120.0
	add_child(sun)

	var we = WorldEnvironment.new()
	we.name = "WorldEnv"
	var env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky = Sky.new()
	var sky_mat = ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.45, 0.62, 0.82, 1.0)
	sky_mat.sky_horizon_color = Color(0.80, 0.82, 0.78, 1.0)
	sky_mat.ground_bottom_color = Color(0.30, 0.38, 0.20, 1.0)
	sky_mat.ground_horizon_color = Color(0.62, 0.66, 0.50, 1.0)
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_color = Color(0.80, 0.76, 0.66, 1.0)
	env.ambient_light_sky_contribution = 0.55
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_white = 6.0
	# Contact shading keeps feet, pots and boulders sitting in the ground.
	env.ssao_enabled = true
	env.ssao_radius = 1.2
	env.ssao_intensity = 1.6
	env.ssao_power = 1.3
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.02
	env.glow_hdr_threshold = 1.2
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.0
	env.adjustment_contrast = 1.04
	we.environment = env
	add_child(we)

func _setup_terrain() -> void:
	var ground = MeshInstance3D.new()
	ground.name = "TerrainMesh"
	var plane_mesh = PlaneMesh.new()
	plane_mesh.size = Vector2(MAP_WIDTH + GROUND_MARGIN * 2.0, MAP_HEIGHT + GROUND_MARGIN * 2.0)
	# Small triangles keep the interpolated world position precise; one huge quad
	# quantises it into visible square blotches in the procedural ground.
	plane_mesh.subdivide_width = 319
	plane_mesh.subdivide_depth = 319
	ground.mesh = plane_mesh
	ground.position = Vector3(MAP_WIDTH * 0.5, 0.0, MAP_HEIGHT * 0.5)

	trail_map = TrailMap.new(MAP_WIDTH, MAP_HEIGHT)
	ground_material = ShaderMaterial.new()
	ground_material.shader = load("res://shaders/ground.gdshader")
	ground_material.set_shader_parameter("map_size", Vector2(MAP_WIDTH, MAP_HEIGHT))
	ground_material.set_shader_parameter("trail_map", trail_map.texture)
	var norm_tex = load("res://assets/textures/clay_normal.png") as Texture2D
	if norm_tex:
		ground_material.set_shader_parameter("detail_normal", norm_tex)
	_apply_lake_uniforms(ground_material)
	_set_ground_features([Vector2(COLONY_1_ENTRANCE.x, COLONY_1_ENTRANCE.z), Vector2(COLONY_2_ENTRANCE.x, COLONY_2_ENTRANCE.z)], [], [], [])
	ground.set_surface_override_material(0, ground_material)
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ground)

func _apply_lake_uniforms(mat: ShaderMaterial) -> void:
	var points = PackedVector2Array()
	var starts = PackedInt32Array()
	var lens = PackedInt32Array()
	var boxes = PackedVector4Array()
	for lake in SurfaceTerrain.get_lakes():
		var outline: Array[Vector2] = lake.outline
		if starts.size() >= 8 or points.size() + outline.size() > 384:
			push_warning("Terrain has more lakes/points than the surface shader draws")
			break
		starts.append(points.size())
		lens.append(outline.size())
		points.append_array(PackedVector2Array(outline))
		var box: Rect2 = lake.box
		# Padded for the sand/shore band drawn around each lake.
		boxes.append(Vector4(box.position.x - 20.0, box.position.y - 20.0, box.end.x + 20.0, box.end.y + 20.0))
	var count = starts.size()
	while points.size() < 384:
		points.append(Vector2.ZERO)
	while starts.size() < 8:
		starts.append(0)
		lens.append(0)
		boxes.append(Vector4.ZERO)
	mat.set_shader_parameter("lake_points", points)
	mat.set_shader_parameter("lake_start", starts)
	mat.set_shader_parameter("lake_len", lens)
	mat.set_shader_parameter("lake_box", boxes)
	mat.set_shader_parameter("lake_count", count)
	_apply_relief_uniforms(mat)

func _apply_relief_uniforms(mat: ShaderMaterial) -> void:
	var hill_arr = PackedVector4Array()
	for h in SurfaceTerrain.hills.slice(0, 16):
		hill_arr.append(h)
	var hill_count = hill_arr.size()
	while hill_arr.size() < 16:
		hill_arr.append(Vector4(0, 0, 1, 0))
	var points = PackedVector2Array()
	var starts = PackedInt32Array()
	var lens = PackedInt32Array()
	var boxes = PackedVector4Array()
	var heights = PackedFloat32Array()
	for m in SurfaceTerrain.get_mountains():
		var outline: Array[Vector2] = m.outline
		if starts.size() >= 8 or points.size() + outline.size() > 256:
			push_warning("Terrain has more mountains/points than the ground shader draws")
			break
		starts.append(points.size())
		lens.append(outline.size())
		points.append_array(PackedVector2Array(outline))
		var box: Rect2 = m.box
		# Padded for the foot slope and scree band.
		boxes.append(Vector4(box.position.x - 8.0, box.position.y - 8.0, box.end.x + 8.0, box.end.y + 8.0))
		heights.append(float(m.height))
	var mcount = starts.size()
	while points.size() < 256:
		points.append(Vector2.ZERO)
	while starts.size() < 8:
		starts.append(0)
		lens.append(0)
		boxes.append(Vector4.ZERO)
		heights.append(0.0)
	mat.set_shader_parameter("hills", hill_arr)
	mat.set_shader_parameter("hill_count", hill_count)
	mat.set_shader_parameter("mountain_points", points)
	mat.set_shader_parameter("mountain_start", starts)
	mat.set_shader_parameter("mountain_len", lens)
	mat.set_shader_parameter("mountain_box", boxes)
	mat.set_shader_parameter("mountain_height", heights)
	mat.set_shader_parameter("mountain_count", mcount)

func _setup_lakes() -> void:
	water_material = ShaderMaterial.new()
	water_material.shader = load("res://shaders/water.gdshader")
	water_container = Node3D.new()
	water_container.name = "WaterContainer"
	add_child(water_container)
	_build_water()
	mountain_container = Node3D.new()
	mountain_container.name = "MountainContainer"
	add_child(mountain_container)
	_build_mountains()

## Rock massifs: one merged mesh per mountain, cached by its shape.
func _build_mountains() -> void:
	if not mountain_container:
		return
	for c in mountain_container.get_children():
		c.queue_free()
	for m in SurfaceTerrain.get_mountains():
		var mi = MeshInstance3D.new()
		mi.name = "Mountain_" + str(m.id)
		mi.mesh = PropFactory.mountain(str(m.id), m.outline, float(m.height))
		mountain_container.add_child(mi)

## Water surfaces cover each lake's box; the shader draws the softened pond
## outline from the world's terrain and discards the rest.
func _build_water() -> void:
	_apply_lake_uniforms(water_material)
	for c in water_container.get_children():
		c.queue_free()
	for lake in SurfaceTerrain.get_lakes():
		var box: Rect2 = lake.box
		var quad = PlaneMesh.new()
		quad.size = box.size + Vector2(2.0, 2.0)
		quad.subdivide_width = int(quad.size.x / 2.0)
		quad.subdivide_depth = int(quad.size.y / 2.0)
		var mi = MeshInstance3D.new()
		mi.name = "Lake_" + str(lake.id)
		mi.mesh = quad
		mi.position = Vector3(box.get_center().x, 0.06, box.get_center().y)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.set_surface_override_material(0, water_material)
		water_container.add_child(mi)

## Called when a snapshot brings different terrain (another world was loaded or
## generated): redraw water, shores and meadow dressing.
func apply_terrain() -> void:
	if ground_material:
		_apply_lake_uniforms(ground_material)
	if water_container:
		_build_water()
	_build_mountains()
	ground_signature = ""
	if ground_decor:
		ground_decor.signature = ""
	# Another world: its paths have not been walked yet.
	if trail_map:
		trail_map.data.fill(0)
		trail_map.last_cells.clear()
		trail_map.dirty = true
		trail_map.upload()

func _setup_camera() -> void:
	camera_pivot = Node3D.new()
	camera_pivot.name = "CameraPivot"
	camera_pivot.position = COLONY_1_ENTRANCE # Start focused on Colony 1
	add_child(camera_pivot)

	camera = Camera3D.new()
	camera.name = "ObserverCamera"
	camera.current = true
	camera.far = 1000.0
	camera_pivot.add_child(camera)

	# Position camera locally relative to pivot and pitch down 52 degrees
	var rad = deg_to_rad(camera_angle_deg)
	var cam_y = sin(rad) * camera_distance
	var cam_z = cos(rad) * camera_distance
	camera.position = Vector3(0, cam_y, cam_z)
	camera.rotation_degrees = Vector3(-camera_angle_deg, 0, 0)


func update_world_entities(snapshot: Dictionary) -> void:
	var surface = snapshot.get("surface", {})
	if typeof(surface) != TYPE_DICTIONARY:
		return
	last_snapshot = snapshot
	_update_colony_focus_points(surface.get("entrances", []))
	var session = snapshot.get("session", {})
	if typeof(session) == TYPE_DICTIONARY:
		sim_speed = float(session.get("speed", 1.0))
	_update_colony_fire(snapshot.get("colonies", []))

	var entrances = _as_array(surface.get("entrances", []))
	var buildings = _as_array(surface.get("buildings", []))
	var deposits = _as_array(surface.get("deposits", []))
	var resource_nodes = _as_array(surface.get("resourceNodes", []))

	_update_campfires(entrances)
	_update_buildings(buildings)
	_update_fences(buildings)
	_update_ground_features(entrances, buildings, deposits)
	_update_trails(_as_array(snapshot.get("ants", [])))

	var seen_node_ids: Dictionary = {}
	var deposit_remaining: Dictionary = {}
	for rnode in resource_nodes:
		if typeof(rnode) != TYPE_DICTIONARY:
			continue
		var rid = str(rnode.get("id", ""))
		if rid.is_empty():
			continue
		var dep_id = str(rnode.get("depositId", ""))
		if not dep_id.is_empty():
			# Quarry work sites are drawn by their deposit, as in the 2D client.
			deposit_remaining[dep_id] = float(deposit_remaining.get(dep_id, 0.0)) + maxf(0.0, float(rnode.get("amount", 0.0)))
			continue
		var amount = float(rnode.get("amount", 0.0))
		if amount <= 0.0:
			continue
		seen_node_ids[rid] = true
		if _unchanged(rid, rnode.get("pos", {}), amount, str(rnode.get("growth", "")).length()):
			continue
		_update_prop(rid, "Resource_" + rid, _pos3(rnode.get("pos", {})), _resource_visual(rid, rnode, amount))

	for dep in deposits:
		if typeof(dep) != TYPE_DICTIONARY:
			continue
		var did = str(dep.get("id", ""))
		if did.is_empty():
			continue
		seen_node_ids[did] = true
		if _unchanged(did, dep.get("pos", {}), float(deposit_remaining.get(did, -1.0)), 0):
			continue
		var kind = str(dep.get("kind", "clay"))
		var capacity = maxf(1.0, float(dep.get("capacity", 1.0)))
		var remaining = float(deposit_remaining.get(did, capacity))
		var fill = 0 if remaining <= 0.0 else clampi(int(ceil(remaining / capacity * 4.0)), 1, 4)
		var key = "deposit:%s:%d" % [kind, fill]
		_update_prop(did, "Deposit_" + did, _pos3(dep.get("pos", {})), [key, func(): return PropFactory.deposit(kind, fill, DEPOSIT_RX, DEPOSIT_RY), 0.0, 1.0])

	for fnode in _as_array(surface.get("foodSources", [])):
		if typeof(fnode) != TYPE_DICTIONARY:
			continue
		var fid = str(fnode.get("id", ""))
		if fid.is_empty():
			continue
		var amount = float(fnode.get("amount", 0.0))
		var kind = str(fnode.get("kind", "food"))
		if kind != "food" and amount <= 0.0:
			continue
		seen_node_ids[fid] = true
		if _unchanged(fid, fnode.get("pos", {}), amount, kind.length()):
			continue
		_update_prop(fid, "Food_" + fid, _pos3(fnode.get("pos", {})), _food_visual(fid, kind, amount))

	for car in _as_array(surface.get("carrion", [])):
		if typeof(car) != TYPE_DICTIONARY:
			continue
		var cid = str(car.get("id", ""))
		var amount = float(car.get("amount", 0.0))
		if cid.is_empty() or amount <= 0.0:
			continue
		seen_node_ids[cid] = true
		if _unchanged(cid, car.get("pos", {}), amount, 0):
			continue
		var chunks = clampi(int(ceil(amount / 10.0)), 1, 6)
		var variant = PropFactory.hash_id(cid) % 3
		_update_prop(cid, "Carrion_" + cid, _pos3(car.get("pos", {})), ["meat:%d:%d" % [chunks, variant], func(): return PropFactory.meat(chunks, variant), _yaw_for(cid), 1.0])

	for fish in _as_array(surface.get("fish", [])):
		if typeof(fish) != TYPE_DICTIONARY:
			continue
		var fish_id = str(fish.get("id", ""))
		if fish_id.is_empty() or str(fish.get("state", "swim")) == "respawning":
			continue
		seen_node_ids[fish_id] = true
		var species = str(fish.get("species", "gold"))
		var p = _pos3(fish.get("pos", {}))
		p.y = 0.03
		_update_moving(fish_id, "Fish_" + fish_id, p, fish.get("heading", {}), ["fish:" + species, func(): return PropFactory.fish(species), 0.0, 1.0], Vector3(1.0, 0.25, 1.0))

	for enode in _as_array(snapshot.get("enemies", [])):
		if typeof(enode) != TYPE_DICTIONARY:
			continue
		var eid = str(enode.get("id", ""))
		if eid.is_empty() or float(enode.get("hp", 1.0)) <= 0.0:
			continue
		seen_node_ids[eid] = true
		var etype = str(enode.get("type", "spider"))
		var p = _pos3(enode.get("pos", {}))
		var visual: Array
		var scale = Vector3.ONE
		if etype == "beetle":
			visual = ["beetle", func(): return PropFactory.beetle(), 0.0, 1.0]
		elif etype == "lakeMonster":
			visual = ["lake_monster", func(): return PropFactory.lake_monster(), 0.0, 1.0]
			if SurfaceTerrain.is_water_at(p.x, p.z):
				p.y = -0.55
		else:
			visual = ["spider", func(): return PropFactory.spider(false), 0.0, 1.0]
		_update_moving(eid, "Enemy_" + eid, p, enode.get("heading", {}), visual, scale)

	var markers_to_remove: Array[String] = []
	for mid in active_world_nodes.keys():
		if not seen_node_ids.has(mid):
			markers_to_remove.append(mid)
	for mid in markers_to_remove:
		var n = active_world_nodes[mid]
		active_world_nodes.erase(mid)
		_source_cache.erase(mid)
		if is_instance_valid(n):
			n.queue_free()

## Static props only need work when their server state changed; most snapshots
## leave hundreds of trees, bushes and rocks untouched.
func _unchanged(id: String, pos_d: Variant, amount: float, extra: int) -> bool:
	var x = 0.0
	var y = 0.0
	if typeof(pos_d) == TYPE_DICTIONARY:
		x = float(pos_d.get("x", 0.0))
		y = float(pos_d.get("y", 0.0))
	var src = Vector4(x, y, amount, float(extra))
	if active_world_nodes.has(id) and _source_cache.get(id) == src:
		return true
	_source_cache[id] = src
	return false

func _as_array(value: Variant) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []

func _pos3(pos_d: Variant) -> Vector3:
	if typeof(pos_d) != TYPE_DICTIONARY:
		return Vector3.ZERO
	return Vector3(float(pos_d.get("x", 0.0)), 0.0, float(pos_d.get("y", 0.0)))

func _yaw_for(id: String) -> float:
	return float(PropFactory.hash_id(id) % 628) / 100.0

## Visual descriptor: [cache key, mesh builder, yaw, uniform scale].
func _resource_visual(rid: String, rnode: Dictionary, amount: float) -> Array:
	var kind = str(rnode.get("kind", "clay"))
	var max_amount = maxf(0.1, float(rnode.get("maxAmount", amount)))
	var ratio = clampf(amount / max_amount, 0.12, 1.0)
	var variant = PropFactory.hash_id(rid) % 3
	var yaw = _yaw_for(rid)
	var jitter = 0.9 + 0.2 * float(PropFactory.hash_id(rid + "s") % 100) / 100.0
	match kind:
		"tree":
			var growth = str(rnode.get("growth", "mature"))
			var bucket = clampi(int(ceil(ratio * 4.0)), 1, 4)
			return ["tree:%s:%d:%d" % [growth, bucket, variant], func(): return PropFactory.tree(growth, bucket, variant), yaw, jitter]
		"stick":
			var count = clampi(int(ceil(amount)), 1, 3)
			return ["sticks:%d:%d" % [count, variant], func(): return PropFactory.sticks(count, variant), yaw, 1.0]
		"stone", "loose-stone":
			var chunks = clampi(int(ceil(amount)), 1, 3) if kind == "loose-stone" else clampi(int(ceil(amount / 16.0)), 1, 5)
			return ["rocks:%s:%d:%d" % [kind, chunks, variant], func(): return PropFactory.rocks(kind, chunks, variant), yaw, jitter]
		_:
			var wash = rid.begins_with("wash-")
			var chunks = clampi(int(ceil(amount / 14.0)), 2, 7)
			return ["clay:%d:%d:%s" % [chunks, variant, wash], func(): return PropFactory.clay_lumps(chunks, variant, wash), yaw, 1.0]

func _food_visual(fid: String, kind: String, amount: float) -> Array:
	var variant = PropFactory.hash_id(fid) % 3
	if kind == "food":
		var berries = clampi(int(ceil(amount / 15.0)), 0, 8)
		return ["bush:%d:%d" % [berries, variant], func(): return PropFactory.bush(berries, variant), _yaw_for(fid), 1.15 + 0.1 * variant]
	if kind == "spiderCarcass":
		return ["spider_dead", func(): return PropFactory.spider(true), _yaw_for(fid), 1.0]
	var chunks = clampi(int(ceil(amount / 30.0)), 1, 6)
	return ["meat:%d:%d" % [chunks, variant], func(): return PropFactory.meat(chunks, variant), _yaw_for(fid), 1.0]

func _update_prop(id: String, node_name: String, pos: Vector3, visual: Array) -> MeshInstance3D:
	var mi: MeshInstance3D = active_world_nodes.get(id) as MeshInstance3D
	if mi == null:
		mi = MeshInstance3D.new()
		mi.name = node_name
		entities_container.add_child(mi)
		active_world_nodes[id] = mi
	if mi.get_meta("visual_key", "") != visual[0]:
		mi.set_meta("visual_key", visual[0])
		mi.mesh = visual[1].call()
	mi.position = _ground(pos)
	mi.rotation = Vector3(0.0, visual[2], 0.0)
	mi.scale = Vector3.ONE * float(visual[3])
	return mi

## Creatures and fish arrive at snapshot cadence; their node glides toward the
## newest position each frame (see _animate_world) instead of hopping 10x/s.
func _update_moving(id: String, node_name: String, pos: Vector3, heading: Variant, visual: Array, scale: Vector3) -> void:
	var is_new = not active_world_nodes.has(id)
	var mi = _update_prop(id, node_name, pos, visual)
	var target_yaw = mi.get_meta("target_yaw", 0.0)
	if typeof(heading) == TYPE_DICTIONARY and (absf(float(heading.get("x", 0.0))) + absf(float(heading.get("y", 0.0)))) > 0.001:
		target_yaw = atan2(float(heading.get("x", 0.0)), float(heading.get("y", 0.0)))
	elif not is_new:
		var prev: Vector3 = mi.get_meta("target_pos", pos)
		var step = pos - prev
		if Vector2(step.x, step.z).length() > 0.02:
			target_yaw = atan2(step.x, step.z)
	mi.set_meta("target_pos", pos)
	mi.set_meta("target_yaw", target_yaw)
	mi.scale = scale
	if is_new:
		mi.set_meta("shown_pos", pos)
		mi.set_meta("shown_yaw", target_yaw)
	mi.position = _ground(mi.get_meta("shown_pos", pos))
	mi.rotation = Vector3(0.0, mi.get_meta("shown_yaw", target_yaw), 0.0)
	mi.set_meta("moving", true)

func _update_colony_fire(colonies: Variant) -> void:
	if typeof(colonies) != TYPE_ARRAY:
		return
	for i in range(mini(2, colonies.size())):
		var entry = colonies[i]
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		var inner = entry.get("colony", {})
		if typeof(inner) == TYPE_DICTIONARY and inner.has("fire"):
			colony_fire[i] = clampf(float(inner.get("fire", 1.0)), 0.0, 1.0)

func _update_campfires(entrances: Array) -> void:
	var seen_campfires: Dictionary = {}
	for i in range(entrances.size()):
		var ent = entrances[i]
		if typeof(ent) != TYPE_DICTIONARY:
			continue
		seen_campfires[i] = true
		var e_pos = Vector3(float(ent.get("x", 0.0)), 0.0, float(ent.get("y", 0.0)))
		if not active_campfires.has(i):
			var camp_scene = load("res://assets/models/campfire.glb") as PackedScene
			var camp_node: Node3D = camp_scene.instantiate() if camp_scene else Node3D.new()
			camp_node.name = "Campfire_Colony_%d" % (i + 1)
			camp_node.position = _ground(e_pos)
			var flame = MeshInstance3D.new()
			flame.name = "Flame"
			flame.mesh = PropFactory.flame()
			flame.position = Vector3(0, 0.12, 0)
			flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			camp_node.add_child(flame)
			var seats = MeshInstance3D.new()
			seats.name = "Seats"
			seats.mesh = PropFactory.hearth_seats()
			camp_node.add_child(seats)
			var light = OmniLight3D.new()
			light.name = "FireLight"
			light.light_color = Color(1.0, 0.62, 0.25, 1.0)
			light.light_energy = 2.0
			light.omni_range = 12.0
			light.position = Vector3(0, 1.2, 0)
			camp_node.add_child(light)
			campfires_container.add_child(camp_node)
			active_campfires[i] = camp_node
		else:
			active_campfires[i].position = _ground(e_pos)

	var camps_to_remove: Array[int] = []
	for cid in active_campfires.keys():
		if not seen_campfires.has(cid):
			camps_to_remove.append(cid)
	for cid in camps_to_remove:
		var cn = active_campfires[cid]
		active_campfires.erase(cid)
		if is_instance_valid(cn):
			cn.queue_free()

func _update_buildings(buildings: Array) -> void:
	var seen_b_ids: Dictionary = {}
	for b in buildings:
		if typeof(b) != TYPE_DICTIONARY:
			continue
		var b_id = str(b.get("id", ""))
		if b_id.is_empty():
			continue
		seen_b_ids[b_id] = true
		var b_type = str(b.get("type", "hut"))
		var b_pos = _pos3(b.get("pos", {}))
		var b_stage = str(b.get("stage", "built"))
		var vertical = str(b.get("gateAxis", "horizontal")) == "vertical"
		var span = GATE_SPAN if int(b.get("gateSpan", 1)) == GATE_SPAN else 1
		var key = "%s:%s:%s:%d" % [b_type, b_stage == "built", vertical, span]

		var node: Node3D = active_buildings.get(b_id)
		if node != null and node.get_meta("visual_key", "") != key:
			active_buildings.erase(b_id)
			node.queue_free()
			node = null
		if node == null:
			node = _make_building(b_type, b_stage == "built", vertical, span)
			node.name = "Building_" + b_id
			node.set_meta("visual_key", key)
			buildings_container.add_child(node)
			active_buildings[b_id] = node
		node.position = _ground(b_pos)
		# Sites and buildings under construction read as translucent ghosts
		# that firm up with progress.
		var fade = 0.0
		if b_stage != "built":
			fade = snappedf(lerpf(0.65, 0.25, clampf(float(b.get("progress", 0.0)), 0.0, 1.0)), 0.01)
		if node.get_meta("fade", -1.0) != fade:
			node.set_meta("fade", fade)
			_set_fade(node, fade)

	var b_to_remove: Array[String] = []
	for b_id in active_buildings.keys():
		if not seen_b_ids.has(b_id):
			b_to_remove.append(b_id)
	for b_id in b_to_remove:
		var n = active_buildings[b_id]
		active_buildings.erase(b_id)
		if is_instance_valid(n):
			n.queue_free()

func _make_building(b_type: String, built: bool, vertical: bool, span: int) -> Node3D:
	match b_type:
		"hut":
			var hut_scene = load("res://assets/models/hut.glb") as PackedScene
			var root = Node3D.new()
			var hut: Node3D = hut_scene.instantiate() if hut_scene else Node3D.new()
			hut.scale = HUT_SCALE
			hut.position = Vector3(0, 0, 0.5)
			root.add_child(hut)
			return root
		"wall":
			var post = MeshInstance3D.new()
			post.mesh = PropFactory.fence_post(false)
			return post
		"gate":
			var gate = MeshInstance3D.new()
			gate.mesh = PropFactory.gate(float(span) * WALL_CELL_SIZE, not built)
			gate.rotation = Vector3(0, PI * 0.5 if vertical else 0.0, 0)
			var root = Node3D.new()
			root.add_child(gate)
			var half = float(span) * WALL_CELL_SIZE * 0.5 + 0.2
			for side in [-1.0, 1.0]:
				var post = MeshInstance3D.new()
				post.mesh = PropFactory.fence_post(true)
				post.position = Vector3(0, 0, side * half) if vertical else Vector3(side * half, 0, 0)
				root.add_child(post)
			return root
		"storage":
			var s = MeshInstance3D.new()
			s.mesh = PropFactory.storage()
			return s
		"workshop":
			var w = MeshInstance3D.new()
			w.mesh = PropFactory.workshop()
			return w
		_:
			var i = MeshInstance3D.new()
			i.mesh = PropFactory.idol()
			return i

func _set_fade(node: Node, fade: float) -> void:
	if node is GeometryInstance3D:
		node.transparency = fade
	for c in node.get_children():
		_set_fade(c, fade)

## Fence rails between neighbouring built wall/gate cells of the same colony,
## following client/src/render/surface/fenceLayout.ts topology.
func _update_fences(buildings: Array) -> void:
	var cells: Dictionary = {}
	var sig_parts: PackedStringArray = []
	for b in buildings:
		if typeof(b) != TYPE_DICTIONARY:
			continue
		var b_type = str(b.get("type", ""))
		if str(b.get("stage", "")) != "built" or (b_type != "wall" and b_type != "gate"):
			continue
		var owner = str(b.get("colonyId", ""))
		var pos = _pos3(b.get("pos", {}))
		var count = GATE_SPAN if b_type == "gate" and int(b.get("gateSpan", 1)) == GATE_SPAN else 1
		var vertical = str(b.get("gateAxis", "horizontal")) == "vertical"
		for i in range(count):
			var off = (float(i) - float(count - 1) * 0.5) * WALL_CELL_SIZE
			var c = Vector3(pos.x, 0, pos.z + off) if vertical else Vector3(pos.x + off, 0, pos.z)
			var cx = int(floor(c.x / WALL_CELL_SIZE))
			var cy = int(floor(c.z / WALL_CELL_SIZE))
			cells["%s:%d:%d" % [owner, cx, cy]] = [owner, cx, cy, c, b_type == "gate", str(b.get("id", ""))]
			sig_parts.append("%s:%d:%d" % [owner, cx, cy])
	sig_parts.sort()
	var sig = ",".join(sig_parts)
	if sig == fence_signature:
		return
	fence_signature = sig
	for c in fence_container.get_children():
		c.queue_free()
	for k in cells.keys():
		var cell = cells[k]
		for d in [Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1), Vector2i(-1, 1)]:
			var nk = "%s:%d:%d" % [cell[0], cell[1] + d.x, cell[2] + d.y]
			if not cells.has(nk):
				continue
			var other = cells[nk]
			# Cells inside one gate are spanned by the gate itself.
			if cell[4] and other[4] and cell[5] == other[5]:
				continue
			if d.x != 0 and d.y != 0:
				if cells.has("%s:%d:%d" % [cell[0], cell[1] + d.x, cell[2]]) or cells.has("%s:%d:%d" % [cell[0], cell[1], cell[2] + d.y]):
					continue
			var a: Vector3 = cell[3]
			var bpos: Vector3 = other[3]
			var length = a.distance_to(bpos)
			var rails = MeshInstance3D.new()
			rails.mesh = PropFactory.fence_rails(snappedf(length, 0.01))
			rails.position = _ground(a)
			rails.rotation = Vector3(0, -atan2(bpos.z - a.z, bpos.x - a.x), 0)
			fence_container.add_child(rails)

func _update_ground_features(entrances: Array, buildings: Array, deposits: Array) -> void:
	var camps: Array = []
	for e in entrances:
		if typeof(e) == TYPE_DICTIONARY:
			camps.append(Vector2(float(e.get("x", 0.0)), float(e.get("y", 0.0))))
	var yards: Array = []
	for b in buildings:
		if typeof(b) != TYPE_DICTIONARY:
			continue
		var b_type = str(b.get("type", ""))
		if b_type == "wall" or b_type == "gate":
			continue
		var p = _pos3(b.get("pos", {}))
		var r = Vector2(5.6, 3.8)
		match b_type:
			"workshop": r = Vector2(6.0, 3.8)
			"storage": r = Vector2(4.4, 3.0)
			"idol": r = Vector2(2.6, 2.0)
		yards.append(Vector4(p.x, p.z + 0.5, r.x, r.y))
	var digs: Array = []
	var dig_kinds: Array = []
	for d in deposits:
		if typeof(d) != TYPE_DICTIONARY:
			continue
		var p = _pos3(d.get("pos", {}))
		digs.append(Vector4(p.x, p.z, DEPOSIT_RX * 0.92, DEPOSIT_RY * 0.92))
		dig_kinds.append(1.0 if str(d.get("kind", "clay")) == "stone" else 0.0)
	var sig = "%s|%s|%s" % [str(camps), str(yards), str(digs)]
	if sig == ground_signature:
		return
	ground_signature = sig
	_set_ground_features(camps, yards, digs, dig_kinds)
	var focus = Vector2(camera_pivot.position.x, camera_pivot.position.z) if camera_pivot else Vector2(MAP_WIDTH, MAP_HEIGHT) * 0.5
	ground_decor.rebuild(camps, digs, yards, sig, focus)

func _set_ground_features(camps: Array, yards: Array, digs: Array, dig_kinds: Array) -> void:
	var camp_arr = PackedVector4Array()
	for c in camps.slice(0, 4):
		camp_arr.append(Vector4(c.x, c.y, CAMP_CLEARING_RADIUS, 0.0))
	var yard_arr = PackedVector4Array()
	for y in yards.slice(0, 32):
		yard_arr.append(y)
	var dig_arr = PackedVector4Array()
	var kind_arr = PackedFloat32Array()
	for i in range(mini(12, digs.size())):
		dig_arr.append(digs[i])
		kind_arr.append(dig_kinds[i])
	# Uniform arrays must be uploaded at full declared length.
	while camp_arr.size() < 4:
		camp_arr.append(Vector4.ZERO)
	while yard_arr.size() < 32:
		yard_arr.append(Vector4(0, 0, 1, 1))
	while dig_arr.size() < 12:
		dig_arr.append(Vector4(0, 0, 1, 1))
	while kind_arr.size() < 12:
		kind_arr.append(0.0)
	ground_material.set_shader_parameter("camps", camp_arr)
	ground_material.set_shader_parameter("camp_count", mini(4, camps.size()))
	ground_material.set_shader_parameter("yards", yard_arr)
	ground_material.set_shader_parameter("yard_count", mini(32, yards.size()))
	ground_material.set_shader_parameter("digs", dig_arr)
	ground_material.set_shader_parameter("dig_kinds", kind_arr)
	ground_material.set_shader_parameter("dig_count", mini(12, digs.size()))

func _update_trails(ants: Array) -> void:
	var alive: Dictionary = {}
	for a in ants:
		if typeof(a) != TYPE_DICTIONARY:
			continue
		if str(a.get("layer", "surface")) != "surface" or str(a.get("state", "")) == "dead":
			continue
		var id = str(a.get("id", ""))
		var p = a.get("pos", {})
		if id.is_empty() or typeof(p) != TYPE_DICTIONARY:
			continue
		alive[id] = true
		var x = float(p.get("x", 0.0))
		var y = float(p.get("y", 0.0))
		if not _near_lake(x, y) or not SurfaceTerrain.is_water_at(x, y):
			trail_map.stamp(id, x, y)
	trail_map.forget_missing(alive)
	if sim_speed > 0.0:
		trail_map.decay()
	_trail_updates += 1
	if _trail_updates % 3 == 0:
		trail_map.upload()

func set_worked_targets(targets: Dictionary) -> void:
	# Release trees that are no longer being chopped.
	for id in worked_targets.keys():
		if not targets.has(id):
			var tree = active_world_nodes.get(id) as Node3D
			if is_instance_valid(tree):
				tree.rotation.x = 0.0
				tree.rotation.z = 0.0
	worked_targets = targets.duplicate()

## Hover text for the object at a world point (x, z), or "" for open ground.
func describe_at(p: Vector2) -> String:
	var surface = last_snapshot.get("surface", {})
	if typeof(surface) != TYPE_DICTIONARY:
		return ""
	var tribe = func(colony_id: String) -> String: return "племени A" if colony_id == "colony-1" else "племени B"
	for e in _as_array(last_snapshot.get("enemies", [])):
		if typeof(e) == TYPE_DICTIONARY and _pos3(e.get("pos")).distance_to(Vector3(p.x, 0, p.y)) < 2.2:
			var n = {"spider": "Паук", "beetle": "Жук", "lakeMonster": "Озёрный монстр"}.get(str(e.get("type", "")), "Зверь")
			return "%s · здоровье %d / %d" % [n, int(float(e.get("hp", 0))), int(float(e.get("maxHp", 0)))]
	var entrances = _as_array(surface.get("entrances", []))
	for i in range(entrances.size()):
		if Vector2(_pos3(entrances[i]).x, _pos3(entrances[i]).z).distance_to(p) < 3.0:
			return "Костёр %s · огонь %d%%" % ["племени A" if i == 0 else "племени B", int(colony_fire[mini(i, 1)] * 100.0)]
	for b in _as_array(surface.get("buildings", [])):
		if typeof(b) != TYPE_DICTIONARY:
			continue
		var bp = _pos3(b.get("pos"))
		var reach = 1.4 if str(b.get("type", "")) in ["wall", "gate"] else 4.0
		if Vector2(bp.x, bp.z + 0.5).distance_to(p) < reach:
			var text = "%s %s" % [BUILDING_NAMES.get(str(b.get("type", "")), "Постройка"), tribe.call(str(b.get("colonyId", "")))]
			if str(b.get("stage", "built")) != "built":
				text += " · строится %d%%" % int(clampf(float(b.get("progress", 0.0)), 0.0, 1.0) * 100.0)
			elif float(b.get("maxHp", 0)) > 0:
				text += " · прочность %d / %d" % [int(float(b.get("hp", 0))), int(float(b.get("maxHp", 0)))]
			return text
	var remaining: Dictionary = {}
	var best_text = ""
	var best_d = 2.0
	for n in _as_array(surface.get("resourceNodes", [])):
		if typeof(n) != TYPE_DICTIONARY:
			continue
		var dep = str(n.get("depositId", ""))
		if dep != "":
			remaining[dep] = float(remaining.get(dep, 0.0)) + maxf(0.0, float(n.get("amount", 0.0)))
			continue
		var amount = float(n.get("amount", 0.0))
		if amount <= 0.0:
			continue
		var np = _pos3(n.get("pos"))
		var d = Vector2(np.x, np.z).distance_to(p)
		if d >= best_d:
			continue
		best_d = d
		match str(n.get("kind", "")):
			"tree":
				best_text = "Росток · ещё растёт" if str(n.get("growth", "")) == "sapling" else "Дерево · %d дерева · нужен топор" % int(ceil(amount))
			"stick":
				best_text = "Хворост · %d дерева · руками" % int(ceil(amount))
			"stone":
				best_text = "Скала · %d камня · нужна кирка" % int(ceil(amount))
			"loose-stone":
				best_text = "Камешки · %d камня · руками" % int(ceil(amount))
			_:
				best_text = "Глина · %d · руками" % int(ceil(amount))
	for f in _as_array(surface.get("foodSources", [])):
		if typeof(f) != TYPE_DICTIONARY:
			continue
		var fp = _pos3(f.get("pos"))
		var d = Vector2(fp.x, fp.z).distance_to(p)
		if d < best_d:
			best_d = d
			var amount = float(f.get("amount", 0.0))
			if str(f.get("kind", "food")) == "food":
				best_text = "Ягодный куст · %d еды" % int(amount) if amount > 0.0 else "Ягодный куст · обобран, отрастёт"
			else:
				best_text = "Мясо · %d еды" % int(amount)
	if best_text != "":
		return best_text
	for dep in _as_array(surface.get("deposits", [])):
		if typeof(dep) != TYPE_DICTIONARY:
			continue
		var dp = _pos3(dep.get("pos"))
		if pow((p.x - dp.x) / DEPOSIT_RX, 2) + pow((p.y - dp.z) / DEPOSIT_RY, 2) <= 1.0:
			var left = int(float(remaining.get(str(dep.get("id", "")), 0.0)))
			var kind_name = "Каменный карьер" if str(dep.get("kind", "")) == "stone" else "Глиняный карьер"
			var how = "6 рабочих мест · нужна кирка" if str(dep.get("kind", "")) == "stone" else "6 рабочих мест · руками"
			return "%s · %d / %d · %s" % [kind_name, left, int(float(dep.get("capacity", 0))), "Истощён" if left <= 0 else how]
	if SurfaceTerrain.is_mountain_at(p.x, p.y):
		return "Скалы · не пройти"
	var lake = SurfaceTerrain.get_lake_id_at(p.x, p.y)
	if lake != "":
		return "Озеро · рыба и водный монстр"
	return ""

## Cheap box test around both authored lakes before the exact polygon test.
func _near_lake(x: float, y: float) -> bool:
	for lake in SurfaceTerrain.get_lakes():
		if lake.box.has_point(Vector2(x, y)):
			return true
	return false

## Every prop variant costs a few milliseconds to sculpt the first time. Build
## them one per frame in the background so a berry being picked or a tree
## thinning never stalls a frame later.
func _queue_prewarm() -> void:
	for growth in ["mature", "young", "sapling"]:
		for bucket in [4, 3, 2, 1]:
			for v in range(3):
				_prewarm.append(PropFactory.tree.bind(growth, bucket, v))
	for berries in range(9):
		for v in range(3):
			_prewarm.append(PropFactory.bush.bind(berries, v))
	for v in range(3):
		for chunks in range(1, 6):
			_prewarm.append(PropFactory.rocks.bind("stone", chunks, v))
		for chunks in range(1, 4):
			_prewarm.append(PropFactory.rocks.bind("loose-stone", chunks, v))
			_prewarm.append(PropFactory.sticks.bind(chunks, v))
		for chunks in range(2, 8):
			_prewarm.append(PropFactory.clay_lumps.bind(chunks, v, false))
		for chunks in range(1, 7):
			_prewarm.append(PropFactory.meat.bind(chunks, v))
	for kind in ["clay", "stone"]:
		for fill in range(5):
			_prewarm.append(PropFactory.deposit.bind(kind, fill, DEPOSIT_RX, DEPOSIT_RY))
	for f in [PropFactory.storage, PropFactory.workshop, PropFactory.idol, PropFactory.spider.bind(false), PropFactory.spider.bind(true), PropFactory.beetle, PropFactory.lake_monster]:
		_prewarm.append(f)

## Per-frame life: gliding creatures, flickering fires, water speed.
func _animate_world(delta: float) -> void:
	anim_time += delta
	if not _prewarm.is_empty():
		_prewarm.pop_front().call()
	var k = 1.0 - exp(-8.0 * maxf(delta, 0.0))
	for mi in active_world_nodes.values():
		if not is_instance_valid(mi) or not mi.has_meta("moving"):
			continue
		var target: Vector3 = mi.get_meta("target_pos")
		var shown: Vector3 = mi.get_meta("shown_pos", target)
		if shown.distance_to(target) > 12.0:
			shown = target
		shown = shown.lerp(target, k)
		var yaw = lerp_angle(float(mi.get_meta("shown_yaw", 0.0)), float(mi.get_meta("target_yaw", 0.0)), k)
		mi.set_meta("shown_pos", shown)
		mi.set_meta("shown_yaw", yaw)
		mi.position = _ground(shown)
		mi.rotation.y = yaw
	# Trees being chopped shudder at each blow; base stays planted (mesh origin is the root).
	for id in worked_targets.keys():
		if worked_targets[id] != "chop":
			continue
		var tree = active_world_nodes.get(id) as Node3D
		if is_instance_valid(tree):
			var hit = pow(maxf(0.0, sin(anim_time * 7.0 + float(id.hash() % 7))), 6.0)
			tree.rotation.x = hit * 0.05
			tree.rotation.z = hit * 0.03
	for idx in active_campfires.keys():
		var camp = active_campfires[idx]
		if not is_instance_valid(camp):
			continue
		var fire = colony_fire[idx] if idx < colony_fire.size() else 1.0
		var t = anim_time * 9.0 + float(idx) * 3.1
		var flicker = sin(t) * 0.5 + sin(t * 2.3) * 0.3 + sin(t * 4.7) * 0.2
		var flame = camp.get_node_or_null("Flame") as Node3D
		if flame:
			flame.visible = fire > 0.05
			var size = lerpf(0.35, 1.0, fire)
			flame.scale = Vector3(size * (1.0 + flicker * 0.06), size * (1.0 + flicker * 0.14), size * (1.0 - flicker * 0.05))
			flame.rotation.y = anim_time * 0.7
		var light = camp.get_node_or_null("FireLight") as OmniLight3D
		if light:
			light.visible = fire > 0.05
			light.light_energy = (1.4 + flicker * 0.35) * lerpf(0.3, 1.0, fire)

func _process(delta: float) -> void:
	_animate_world(delta)
	if not camera_pivot:
		return
	camera_distance = lerpf(camera_distance, target_camera_distance, 1.0 - exp(-4.0 * maxf(delta, 0.0)))
	if camera:
		var rad = deg_to_rad(camera_angle_deg)
		camera.position = Vector3(0, sin(rad) * camera_distance, cos(rad) * camera_distance)

	var pan = Vector3.ZERO
	var focus_owner = get_viewport().gui_get_focus_owner()
	if not (focus_owner is LineEdit or focus_owner is TextEdit):
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			pan.x -= 1.0
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			pan.x += 1.0
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			pan.z -= 1.0
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			pan.z += 1.0

	if pan.length_squared() > 0:
		focused_target = null
		camera_navigated = true
		camera_pivot.position += pan.normalized() * (pan_speed * camera_distance / 14.0 * delta)
	elif is_instance_valid(focused_target):
		camera_pivot.position = camera_pivot.position.lerp(focused_target.global_position, 1.0 - exp(-6.0 * maxf(delta, 0.0)))
	camera_pivot.position = _clamp_focus(camera_pivot.position)

func _clamp_focus(point: Vector3) -> Vector3:
	var x = clampf(point.x, 0.0, MAP_WIDTH)
	var z = clampf(point.z, 0.0, MAP_HEIGHT)
	# Follow the relief a little so hills and ridges never swallow the camera.
	return Vector3(x, SurfaceTerrain.height_at(x, z) * 0.8, z)

## Lifts a flat server position onto the visual ground (hills, mountain feet).
func _ground(p: Vector3) -> Vector3:
	return Vector3(p.x, p.y + SurfaceTerrain.height_at(p.x, p.z), p.z)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			target_camera_distance = maxf(MIN_CAMERA_DISTANCE, target_camera_distance / 1.15)
			get_viewport().set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			target_camera_distance = minf(MAX_CAMERA_DISTANCE, target_camera_distance * 1.15)
			get_viewport().set_input_as_handled()

func _update_colony_focus_points(entrances: Variant) -> void:
	if not entrances is Array:
		return
	var found = false
	for index in range(mini(2, entrances.size())):
		var point = entrances[index]
		if point is Dictionary and point.has("x") and point.has("y"):
			colony_focus_points[index] = _clamp_focus(Vector3(float(point.x), 0.0, float(point.y)))
			found = true
	if found and not received_landmarks:
		received_landmarks = true
		if not camera_navigated:
			camera_pivot.position = colony_focus_points[0]

func focus_on_colony(colony_idx: int) -> void:
	focused_target = null
	camera_navigated = true
	target_camera_distance = 15.0
	camera_pivot.position = colony_focus_points[clampi(colony_idx, 0, 1)]

func focus_on_lake(lake_name: String) -> void:
	focused_target = null
	camera_navigated = true
	target_camera_distance = 18.0
	# "north"/"south" buttons pick the first/second lake of the current world.
	var lakes = SurfaceTerrain.get_lakes()
	var index = 0 if lake_name == "north" else 1
	if lakes.size() > index:
		var c: Vector2 = lakes[index].box.get_center()
		camera_pivot.position = Vector3(c.x, 0.0, c.y)
	elif lake_name == "north":
		camera_pivot.position = NORTH_LAKE_CENTER
	else:
		camera_pivot.position = SOUTH_LAKE_CENTER

func focus_on_resident(res: Node3D) -> void:
	camera_navigated = true
	if focused_target != res:
		focused_target = res
		target_camera_distance = 6.0
		camera_distance = 6.0
		if is_instance_valid(res):
			camera_pivot.position = _clamp_focus(res.global_position)

