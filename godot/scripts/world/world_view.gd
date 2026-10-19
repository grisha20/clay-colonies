class_name WorldView
extends Node3D

## Visual 3D environment for Clayfolk Surface Map (480x480).
## Renders clay ground terrain, lakes, campfires at colony entrances,
## directional sun lighting, and controllable fixed-angle top-down camera.

@export var camera_distance: float = 14.0
@export var camera_angle_deg: float = 52.0
@export var pan_speed: float = 35.0

var camera_pivot: Node3D
var camera: Camera3D
var focused_target: Node3D = null

# Map dimensions matching CONFIG.mapWidth/mapHeight
const MAP_WIDTH: float = 480.0
const MAP_HEIGHT: float = 480.0

# Key surface landmarks
const COLONY_1_ENTRANCE = Vector3(120.0, 0.0, 240.0)
const COLONY_2_ENTRANCE = Vector3(360.0, 0.0, 240.0)
const NORTH_LAKE_CENTER = Vector3(260.0, 0.0, 118.0)
const SOUTH_LAKE_CENTER = Vector3(212.0, 0.0, 338.0)

func _ready() -> void:
	_setup_environment()
	_setup_terrain()
	_setup_lakes()
	_setup_campfires()
	_setup_camera()

func _setup_environment() -> void:
	# Directional sun light
	var sun = DirectionalLight3D.new()
	sun.name = "SunLight"
	sun.transform = Transform3D(
		Basis(Vector3.UP, deg_to_rad(-45.0)) * Basis(Vector3.RIGHT, deg_to_rad(-55.0))
	)
	sun.light_color = Color(1.0, 0.96, 0.90, 1.0)
	sun.light_energy = 1.4
	sun.shadow_enabled = true
	add_child(sun)

	# World environment
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
	for lake_info in [
		{"pos": NORTH_LAKE_CENTER, "radius": 32.0, "name": "NorthLake"},
		{"pos": SOUTH_LAKE_CENTER, "radius": 34.0, "name": "SouthLake"}
	]:
		var lake = MeshInstance3D.new()
		lake.name = lake_info["name"]
		var cyl = CylinderMesh.new()
		cyl.top_radius = lake_info["radius"]
		cyl.bottom_radius = lake_info["radius"]
		cyl.height = 0.05
		lake.mesh = cyl
		lake.position = Vector3(lake_info["pos"].x, 0.01, lake_info["pos"].z)

		var water_mat = StandardMaterial3D.new()
		water_mat.albedo_color = Color(0.18, 0.42, 0.58, 0.85)
		water_mat.roughness = 0.15
		water_mat.metallic = 0.3
		water_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		lake.set_surface_override_material(0, water_mat)
		add_child(lake)

func _setup_campfires() -> void:
	var camp_scene = load("res://assets/models/campfire.glb") as PackedScene
	var hut_scene = load("res://assets/models/hut.glb") as PackedScene

	for c_pos in [COLONY_1_ENTRANCE, COLONY_2_ENTRANCE]:
		var camp_node: Node3D = camp_scene.instantiate() if camp_scene else Node3D.new()
		camp_node.position = c_pos
		add_child(camp_node)

		var light = OmniLight3D.new()
		light.light_color = Color(1.0, 0.65, 0.25, 1.0)
		light.light_energy = 2.5
		light.omni_range = 14.0
		light.position = Vector3(0, 1.0, 0)
		camp_node.add_child(light)

		if hut_scene:
			var h1 = hut_scene.instantiate()
			h1.position = c_pos + Vector3(-6.0, 0.0, -5.0)
			h1.rotation_degrees.y = 25.0
			add_child(h1)

			var h2 = hut_scene.instantiate()
			h2.position = c_pos + Vector3(6.0, 0.0, -5.0)
			h2.rotation_degrees.y = -25.0
			add_child(h2)

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

func _process(delta: float) -> void:
	if is_instance_valid(focused_target):
		camera_pivot.position = camera_pivot.position.lerp(focused_target.global_position, delta * 6.0)
	else:
		# Manual camera pan controls (WASD / Arrows)
		var pan = Vector3.ZERO
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			pan.x -= 1.0
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			pan.x += 1.0
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			pan.z -= 1.0
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			pan.z += 1.0

		if pan.length_squared() > 0:
			camera_pivot.position += pan.normalized() * (pan_speed * delta)
			camera_pivot.position.x = clamp(camera_pivot.position.x, 10.0, MAP_WIDTH - 10.0)
			camera_pivot.position.z = clamp(camera_pivot.position.z, 10.0, MAP_HEIGHT - 10.0)

func focus_on_colony(colony_idx: int) -> void:
	focused_target = null
	if colony_idx == 0:
		camera_pivot.position = COLONY_1_ENTRANCE
	else:
		camera_pivot.position = COLONY_2_ENTRANCE

func focus_on_lake(lake_name: String) -> void:
	focused_target = null
	if lake_name == "north":
		camera_pivot.position = NORTH_LAKE_CENTER
	else:
		camera_pivot.position = SOUTH_LAKE_CENTER

func focus_on_resident(res: Node3D) -> void:
	focused_target = res
