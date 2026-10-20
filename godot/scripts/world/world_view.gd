class_name WorldView
extends Node3D

## Visual 3D environment for Clayfolk Surface Map (480x480).
## Renders clay ground terrain, authored lake polygon meshes from SurfaceTerrain,
## dynamic buildings and entrances from server snapshots, lighting, and camera.

const SurfaceTerrain = preload("res://scripts/world/surface_terrain.gd")

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

# Key surface landmarks
const COLONY_1_ENTRANCE = Vector3(120.0, 0.0, 240.0)
const COLONY_2_ENTRANCE = Vector3(360.0, 0.0, 240.0)
const NORTH_LAKE_CENTER = Vector3(230.0, 0.0, 140.0)
const SOUTH_LAKE_CENTER = Vector3(240.0, 0.0, 370.0)

# Dynamic containers for snapshot entities
var buildings_container: Node3D
var campfires_container: Node3D
var entities_container: Node3D

var active_buildings: Dictionary = {}  # building_id -> Node3D
var active_campfires: Dictionary = {}  # entrance_idx -> Node3D
var active_world_nodes: Dictionary = {} # id -> Node3D

func _ready() -> void:
	_setup_environment()
	_setup_terrain()
	_setup_containers()
	_setup_lakes()
	_setup_camera()

func _setup_containers() -> void:
	buildings_container = Node3D.new()
	buildings_container.name = "BuildingsContainer"
	add_child(buildings_container)

	campfires_container = Node3D.new()
	campfires_container.name = "CampfiresContainer"
	add_child(campfires_container)

	entities_container = Node3D.new()
	entities_container.name = "EntitiesContainer"
	add_child(entities_container)

func _setup_environment() -> void:
	var sun = DirectionalLight3D.new()
	sun.name = "SunLight"
	sun.transform = Transform3D(
		Basis(Vector3.UP, deg_to_rad(-45.0)) * Basis(Vector3.RIGHT, deg_to_rad(-55.0))
	)
	sun.light_color = Color(1.0, 0.96, 0.90, 1.0)
	sun.light_energy = 1.4
	sun.shadow_enabled = true
	add_child(sun)

	var we = WorldEnvironment.new()
	we.name = "WorldEnv"
	var env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky = Sky.new()
	var sky_mat = ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.42, 0.58, 0.78, 1.0)
	sky_mat.sky_horizon_color = Color(0.72, 0.75, 0.78, 1.0)
	sky_mat.ground_bottom_color = Color(0.55, 0.38, 0.24, 1.0)
	sky_mat.ground_horizon_color = Color(0.68, 0.45, 0.28, 1.0)
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_color = Color(0.75, 0.65, 0.55, 1.0)
	env.ambient_light_sky_contribution = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	we.environment = env
	add_child(we)

func _setup_terrain() -> void:
	var ground = MeshInstance3D.new()
	ground.name = "TerrainMesh"
	var plane_mesh = PlaneMesh.new()
	plane_mesh.size = Vector2(MAP_WIDTH, MAP_HEIGHT)
	ground.mesh = plane_mesh
	ground.position = Vector3(MAP_WIDTH * 0.5, 0.0, MAP_HEIGHT * 0.5)

	var mat = StandardMaterial3D.new()
	mat.albedo_color = Color(0.68, 0.45, 0.28, 1.0) # Clay ground
	mat.roughness = 0.88
	var norm_tex = load("res://assets/textures/clay_normal.png") as Texture2D
	if norm_tex:
		mat.normal_enabled = true
		mat.normal_texture = norm_tex
		mat.normal_scale = 0.3
		mat.uv1_scale = Vector3(MAP_WIDTH / 8.0, MAP_HEIGHT / 8.0, 1.0)
	ground.set_surface_override_material(0, mat)
	add_child(ground)

func _setup_lakes() -> void:
	var water_mat = StandardMaterial3D.new()
	water_mat.albedo_color = Color(0.18, 0.42, 0.58, 0.85)
	water_mat.roughness = 0.15
	water_mat.metallic = 0.3
	water_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA

	# 1. North Lake: authentic authored polygon from shared/surfaceTerrain.ts
	var north_mesh = SurfaceTerrain.generate_lake_mesh(SurfaceTerrain.NORTH_LAKE_OUTLINE)
	var north_lake = MeshInstance3D.new()
	north_lake.name = "NorthLakePolygon"
	north_lake.mesh = north_mesh
	north_lake.set_surface_override_material(0, water_mat)
	add_child(north_lake)

	# 2. South Lake: authentic authored polygon from shared/surfaceTerrain.ts
	var south_mesh = SurfaceTerrain.generate_lake_mesh(SurfaceTerrain.SOUTH_LAKE_OUTLINE)
	var south_lake = MeshInstance3D.new()
	south_lake.name = "SouthLakePolygon"
	south_lake.mesh = south_mesh
	south_lake.set_surface_override_material(0, water_mat)
	add_child(south_lake)

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
	_update_colony_focus_points(surface.get("entrances", []))

	# 1. Update Campfires from actual surface.entrances with full lifecycle
	var entrances = surface.get("entrances", [])
	var seen_campfires: Dictionary = {}
	if typeof(entrances) == TYPE_ARRAY:
		for i in range(entrances.size()):
			var ent = entrances[i]
			if typeof(ent) != TYPE_DICTIONARY:
				continue
			seen_campfires[i] = true
			var ex = float(ent.get("x", 0.0))
			var ey = float(ent.get("y", 0.0))
			var e_pos = Vector3(ex, 0.0, ey)
			if not active_campfires.has(i):
				var camp_scene = load("res://assets/models/campfire.glb") as PackedScene
				var camp_node: Node3D = camp_scene.instantiate() if camp_scene else Node3D.new()
				camp_node.name = "Campfire_Colony_%d" % (i + 1)
				camp_node.position = e_pos
				var light = OmniLight3D.new()
				light.light_color = Color(1.0, 0.65, 0.25, 1.0)
				light.light_energy = 2.5
				light.omni_range = 14.0
				light.position = Vector3(0, 1.0, 0)
				camp_node.add_child(light)
				campfires_container.add_child(camp_node)
				active_campfires[i] = camp_node
			else:
				active_campfires[i].position = e_pos

	# Remove campfires no longer in snapshot
	var camps_to_remove: Array[int] = []
	for cid in active_campfires.keys():
		if not seen_campfires.has(cid):
			camps_to_remove.append(cid)
	for cid in camps_to_remove:
		var cn = active_campfires[cid]
		active_campfires.erase(cid)
		if is_instance_valid(cn):
			cn.queue_free()

	# 2. Update Buildings from actual surface.buildings
	var buildings = surface.get("buildings", [])
	var seen_b_ids: Dictionary = {}
	if typeof(buildings) == TYPE_ARRAY:
		for b in buildings:
			if typeof(b) != TYPE_DICTIONARY:
				continue
			var b_id = str(b.get("id", ""))
			if b_id.is_empty():
				continue
			seen_b_ids[b_id] = true
			var b_type = str(b.get("type", "hut"))
			var b_pos_dict = b.get("pos", {})
			var bx = float(b_pos_dict.get("x", 0.0))
			var by = float(b_pos_dict.get("y", 0.0))
			var b_pos = Vector3(bx, 0.0, by)
			var b_stage = str(b.get("stage", "built"))

			if not active_buildings.has(b_id):
				var b_node: Node3D = null
				if b_type == "hut":
					var hut_scene = load("res://assets/models/hut.glb") as PackedScene
					b_node = hut_scene.instantiate() if hut_scene else Node3D.new()
					b_node.position = b_pos
				elif b_type == "wall":
					b_node = MeshInstance3D.new()
					var box = BoxMesh.new()
					box.size = Vector3(1.8, 1.2, 1.8)
					b_node.mesh = box
					var mat = StandardMaterial3D.new()
					mat.albedo_color = Color(0.72, 0.50, 0.32, 1.0)
					b_node.set_surface_override_material(0, mat)
					b_node.position = b_pos + Vector3(0, box.size.y / 2.0, 0)
				elif b_type == "gate":
					b_node = MeshInstance3D.new()
					var box = BoxMesh.new()
					var gate_axis = str(b.get("gateAxis", "x"))
					var gate_span = float(b.get("gateSpan", 2.4))
					box.size = Vector3(gate_span, 1.5, 0.8) if gate_axis == "x" else Vector3(0.8, 1.5, gate_span)
					b_node.mesh = box
					var mat = StandardMaterial3D.new()
					mat.albedo_color = Color(0.55, 0.35, 0.20, 1.0) if b_stage != "blueprint" else Color(0.55, 0.35, 0.20, 0.5)
					if b_stage == "blueprint":
						mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
					b_node.set_surface_override_material(0, mat)
					b_node.position = b_pos + Vector3(0, box.size.y / 2.0, 0)
				else:
					# Storage, Workshop, Idol
					b_node = MeshInstance3D.new()
					var box = BoxMesh.new()
					if b_type == "workshop":
						box.size = Vector3(4.6, 2.0, 2.6)
					elif b_type == "storage":
						box.size = Vector3(3.4, 1.6, 2.1)
					else:
						box.size = Vector3(2.5, 1.6, 2.5)
					b_node.mesh = box
					var mat = StandardMaterial3D.new()
					mat.albedo_color = Color(0.60, 0.45, 0.35, 1.0)
					b_node.set_surface_override_material(0, mat)
					b_node.position = b_pos + Vector3(0, box.size.y / 2.0, 0)

				b_node.name = "Building_" + b_id
				buildings_container.add_child(b_node)
				active_buildings[b_id] = b_node
			else:
				var existing = active_buildings[b_id]
				if existing is MeshInstance3D and existing.mesh:
					var aabb = existing.mesh.get_aabb()
					existing.position = b_pos + Vector3(0, aabb.size.y / 2.0, 0)
				else:
					existing.position = b_pos

	# Remove buildings no longer in snapshot
	var b_to_remove: Array[String] = []
	for b_id in active_buildings.keys():
		if not seen_b_ids.has(b_id):
			b_to_remove.append(b_id)
	for b_id in b_to_remove:
		var n = active_buildings[b_id]
		active_buildings.erase(b_id)
		if is_instance_valid(n):
			n.queue_free()

	# 3. Update ResourceNodes, FoodSources, Fish, Deposits, Carrion, Enemies
	var seen_node_ids: Dictionary = {}
	for rnode in surface.get("resourceNodes", []):
		if typeof(rnode) == TYPE_DICTIONARY:
			var rid = str(rnode.get("id", ""))
			if not rid.is_empty():
				seen_node_ids[rid] = true
				var pos_d = rnode.get("pos", {})
				_update_simple_marker(rid, "Resource_" + rid, Vector3(float(pos_d.get("x", 0)), 0, float(pos_d.get("y", 0))), Color(0.85, 0.55, 0.25, 1.0), 1.2)

	for fnode in surface.get("foodSources", []):
		if typeof(fnode) == TYPE_DICTIONARY:
			var fid = str(fnode.get("id", ""))
			if not fid.is_empty():
				seen_node_ids[fid] = true
				var pos_d = fnode.get("pos", {})
				_update_simple_marker(fid, "Food_" + fid, Vector3(float(pos_d.get("x", 0)), 0, float(pos_d.get("y", 0))), Color(0.95, 0.25, 0.25, 1.0), 0.8)

	for fish in surface.get("fish", []):
		if typeof(fish) == TYPE_DICTIONARY:
			var fish_id = str(fish.get("id", ""))
			if not fish_id.is_empty():
				seen_node_ids[fish_id] = true
				var pos_d = fish.get("pos", {})
				_update_simple_marker(fish_id, "Fish_" + fish_id, Vector3(float(pos_d.get("x", 0)), 0.02, float(pos_d.get("y", 0))), Color(0.30, 0.70, 0.90, 1.0), 0.7)

	for dep in surface.get("deposits", []):
		if typeof(dep) == TYPE_DICTIONARY:
			var did = str(dep.get("id", ""))
			if not did.is_empty():
				seen_node_ids[did] = true
				var pos_d = dep.get("pos", {})
				_update_simple_marker(did, "Deposit_" + did, Vector3(float(pos_d.get("x", 0)), 0, float(pos_d.get("y", 0))), Color(0.65, 0.50, 0.35, 1.0), 1.0)

	for car in surface.get("carrion", []):
		if typeof(car) == TYPE_DICTIONARY:
			var cid = str(car.get("id", ""))
			if not cid.is_empty():
				seen_node_ids[cid] = true
				var pos_d = car.get("pos", {})
				_update_simple_marker(cid, "Carrion_" + cid, Vector3(float(pos_d.get("x", 0)), 0, float(pos_d.get("y", 0))), Color(0.40, 0.25, 0.20, 1.0), 0.7)

	for enode in snapshot.get("enemies", []):
		if typeof(enode) == TYPE_DICTIONARY:
			var eid = str(enode.get("id", ""))
			if not eid.is_empty():
				seen_node_ids[eid] = true
				var pos_d = enode.get("pos", {})
				_update_simple_marker(eid, "Enemy_" + eid, Vector3(float(pos_d.get("x", 0)), 0, float(pos_d.get("y", 0))), Color(0.15, 0.15, 0.15, 1.0), 1.4)

	var markers_to_remove: Array[String] = []
	for mid in active_world_nodes.keys():
		if not seen_node_ids.has(mid):
			markers_to_remove.append(mid)
	for mid in markers_to_remove:
		var n = active_world_nodes[mid]
		active_world_nodes.erase(mid)
		if is_instance_valid(n):
			n.queue_free()

func _update_simple_marker(id: String, node_name: String, pos: Vector3, col: Color, marker_size: float) -> void:
	if not active_world_nodes.has(id):
		var mi = MeshInstance3D.new()
		mi.name = node_name
		var sph = SphereMesh.new()
		sph.radius = marker_size * 0.5
		sph.height = marker_size
		mi.mesh = sph
		var mat = StandardMaterial3D.new()
		mat.albedo_color = col
		mat.roughness = 0.7
		mi.set_surface_override_material(0, mat)
		mi.position = pos + Vector3(0, marker_size * 0.5, 0)
		entities_container.add_child(mi)
		active_world_nodes[id] = mi
	else:
		active_world_nodes[id].position = pos + Vector3(0, marker_size * 0.5, 0)

func _process(delta: float) -> void:
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
	return Vector3(clampf(point.x, 0.0, MAP_WIDTH), 0.0, clampf(point.z, 0.0, MAP_HEIGHT))

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
	if lake_name == "north":
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

