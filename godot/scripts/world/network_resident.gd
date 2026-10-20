class_name NetworkResident
extends Node3D

const BuildingGeometry = preload("res://scripts/world/building_geometry.gd")
const SurfaceNavigation = preload("res://scripts/world/surface_navigation.gd")

## Visual 3D actor representing a Clayfolk resident driven by network snapshots.
## Manages skeletal animation, step frequency tied to ground distance,
## smooth position/rotation interpolation, colony material modulation,
## and bone-socket cargo attachment.

signal selected(resident: NetworkResident)

enum AnimState {
	IDLE,
	WALK,
	CARRY_IDLE,
	CARRY_WALK,
	WORK_GATHER
}

# Calibrated movement parameters matching visual laboratory:
# Stride travel = 0.24m per step * 2 steps = 0.48m per 1.0s cycle
const STRIDE_DISTANCE: float = 0.48
const CYCLE_DURATION: float = 1.0
const NOMINAL_SPEED: float = STRIDE_DISTANCE / CYCLE_DURATION # 0.48 m/s

# Entity identification
var ant_id: String = ""
var colony_id: String = ""
var role: String = "worker"
var state_name: String = "idle"
var job_name: String = ""
var carrying_amount: int = 0
var carry_kind: String = ""

# Interpolation state
var current_pos: Vector3 = Vector3.ZERO
var target_pos: Vector3 = Vector3.ZERO
var prev_pos: Vector3 = Vector3.ZERO
var target_heading: Vector3 = Vector3.FORWARD
var current_heading: Vector3 = Vector3.FORWARD
var interp_progress: float = 1.0
var interp_time: float = 0.0
var interp_duration: float = 0.1 # nominal 100ms per tick at 1x
var sim_speed_scale: float = 1.0
var is_network_stalled: bool = false
var is_sim_paused: bool = false

# Obstacle avoidance waypoints and full route polyline
var has_waypoint: bool = false
var intermediate_waypoint: Vector3 = Vector3.ZERO
var route_points: Array[Vector2] = []
var prev_pos_2d: Vector2 = Vector2.ZERO

# Visual nodes
var model_instance: Node3D
var anim_player: AnimationPlayer
var skeleton: Skeleton3D
var mesh_instance: MeshInstance3D
var bone_attachment_cargo: BoneAttachment3D
var cargo_prop: Node3D
var current_anim_state: AnimState = AnimState.IDLE

var is_first_update: bool = true

# Color palette by colony
const COLONY_COLORS = {
	"colony-1": Color(0.88, 0.38, 0.19, 1.0), # Terracotta orange
	"colony-2": Color(0.22, 0.52, 0.85, 1.0), # Slate / river blue
	"default": Color(0.75, 0.45, 0.25, 1.0)
}

func _init() -> void:
	_setup_visuals()

func _ready() -> void:
	if not model_instance:
		_setup_visuals()

func _setup_visuals() -> void:
	# Load resident GLB model
	var resident_scene = load("res://assets/models/resident.glb") as PackedScene
	if resident_scene:
		model_instance = resident_scene.instantiate()
		add_child(model_instance)

		anim_player = model_instance.find_child("AnimationPlayer", true, false) as AnimationPlayer
		skeleton = model_instance.find_child("Skeleton3D", true, false) as Skeleton3D
		mesh_instance = model_instance.find_child("Resident", true, false) as MeshInstance3D

		if anim_player:
			for clip_name in anim_player.get_animation_list():
				var anim = anim_player.get_animation(clip_name)
				if anim:
					anim.loop_mode = Animation.LOOP_LINEAR

		if skeleton:
			_setup_cargo_prop()

		_apply_colony_color()
		_play_anim(AnimState.IDLE)

func _setup_cargo_prop() -> void:
	var cargo_bone_idx = skeleton.find_bone("Socket_Cargo")
	if cargo_bone_idx >= 0:
		bone_attachment_cargo = BoneAttachment3D.new()
		bone_attachment_cargo.name = "CargoAttachment"
		bone_attachment_cargo.bone_name = "Socket_Cargo"
		skeleton.add_child(bone_attachment_cargo)

		var cargo_scene = load("res://assets/models/cargo.glb") as PackedScene
		if cargo_scene:
			cargo_prop = cargo_scene.instantiate()
			cargo_prop.name = "CargoProp"
			bone_attachment_cargo.add_child(cargo_prop)
			cargo_prop.position = Vector3.ZERO
			cargo_prop.rotation = Vector3.ZERO
			cargo_prop.visible = false
	else:
		push_warning("[NetworkResident] Socket_Cargo bone not found in Skeleton3D")

func _apply_colony_color() -> void:
	if not mesh_instance:
		return

	var col = COLONY_COLORS.get(colony_id, COLONY_COLORS["default"])
	var mat = mesh_instance.get_active_material(0)
	if mat and mat is StandardMaterial3D:
		var custom_mat = mat.duplicate() as StandardMaterial3D
		custom_mat.albedo_color = col
		mesh_instance.set_surface_override_material(0, custom_mat)

func update_from_ant_data(data: Dictionary, tick_interval_sec: float, speed_scale: float, sim_status: String = "playing", buildings: Array = [], entrances: Array = []) -> void:
	ant_id = data.get("id", ant_id)
	var new_colony = data.get("colonyId", colony_id)
	if new_colony != colony_id:
		colony_id = new_colony
		_apply_colony_color()

	role = data.get("role", "worker")
	state_name = data.get("state", "idle")
	job_name = data.get("job", "")
	carrying_amount = int(data.get("carrying", 0))
	carry_kind = str(data.get("carryKind", ""))

	sim_speed_scale = speed_scale
	var is_game_over = (sim_status != "playing")
	is_sim_paused = (speed_scale <= 0.0 or is_game_over)

	var pos_dict = data.get("pos", {})
	var heading_dict = data.get("heading", {})

	var new_target = Vector3(
		float(pos_dict.get("x", position.x)),
		0.0,
		float(pos_dict.get("y", position.z))
	)

	# Update target heading
	var hx = float(heading_dict.get("x", 0.0))
	var hy = float(heading_dict.get("y", 1.0))
	if Vector2(hx, hy).length_squared() > 0.001:
		target_heading = Vector3(hx, 0.0, hy).normalized()

	if is_sim_paused:
		position = position
		prev_pos = position
		target_pos = position
		prev_pos_2d = Vector2(position.x, position.z)
		route_points = [prev_pos_2d]
		interp_time = 0.0
		interp_progress = 1.0
		has_waypoint = false
		_update_movement_and_animation(0.0)
		return

	# If this is the initial placement or a true teleport, snap directly.
	# At high simulation speeds (e.g. 50x), legitimate movement can exceed static 8m,
	# so threshold scales dynamically with simulation speed and tick interval.
	var max_legit_travel: float = maxf(12.0, 3.0 * speed_scale * maxf(0.05, tick_interval_sec))
	if is_first_update or position.distance_to(new_target) > max_legit_travel:
		position = new_target
		current_pos = new_target
		prev_pos = new_target
		target_pos = new_target
		prev_pos_2d = Vector2(new_target.x, new_target.z)
		route_points = [prev_pos_2d]
		interp_time = 0.0
		interp_progress = 1.0
		is_first_update = false
		has_waypoint = false
	else:
		prev_pos = position
		target_pos = new_target
		prev_pos_2d = Vector2(prev_pos.x, prev_pos.z)
		var v_target = Vector2(target_pos.x, target_pos.z)
		interp_duration = maxf(0.04, tick_interval_sec)
		interp_time = 0.0
		interp_progress = 0.0

		# Safe multi-segment route avoiding buildings, hearths, walls, and water
		route_points = SurfaceNavigation.surface_route(prev_pos_2d, v_target, colony_id, buildings, entrances)
		if route_points.size() > 1:
			has_waypoint = true
			intermediate_waypoint = Vector3(route_points[0].x, 0.0, route_points[0].y)
			# Point target_pos to final destination
			target_pos = Vector3(route_points[-1].x, 0.0, route_points[-1].y)
		elif not route_points.is_empty():
			has_waypoint = false
			intermediate_waypoint = Vector3.ZERO
			target_pos = Vector3(route_points[0].x, 0.0, route_points[0].y)
		else:
			# Route completely failed: hold position at prev_pos, do not penetrate obstacles!
			has_waypoint = false
			intermediate_waypoint = Vector3.ZERO
			target_pos = prev_pos
			route_points = [prev_pos_2d]

	is_network_stalled = false
	_update_movement_and_animation(0.0 if is_sim_paused else (position.distance_to(target_pos) / maxf(0.001, interp_duration)))

func _process(delta: float) -> void:
	if is_network_stalled or is_sim_paused:
		_update_movement_and_animation(0.0)
		return

	var old_p = position
	var step_dist = 0.0

	interp_time += delta
	var u = interp_time / maxf(0.001, interp_duration)
	var ratio = 1.0
	if u <= 0.8:
		ratio = u
	elif u < 1.6:
		var w = (u - 0.8) / 0.8
		ratio = 0.8 + 0.2 * (1.0 - (1.0 - w) * (1.0 - w))
	else:
		ratio = 1.0

	interp_progress = ratio

	if ratio < 1.0:
		if not route_points.is_empty():
			var p2d = SurfaceNavigation.route_point(prev_pos_2d, route_points, ratio)
			position = Vector3(p2d.x, 0.0, p2d.y)
		else:
			position = prev_pos.lerp(target_pos, ratio)
		step_dist = old_p.distance_to(position)
	else:
		# At target: hold position, avoiding overshoot and obstacle penetration
		if not route_points.is_empty():
			position = Vector3(route_points[-1].x, 0.0, route_points[-1].y)
		else:
			position = target_pos
		step_dist = old_p.distance_to(position)

	# Measure real ground speed (m/s)
	var ground_speed = step_dist / delta if delta > 0.0001 else 0.0

	# Align heading with actual frame displacement vector, or target_heading if stationary
	var actual_disp = position - old_p
	actual_disp.y = 0.0
	if actual_disp.length_squared() > 0.0001:
		current_heading = current_heading.lerp(actual_disp.normalized(), minf(1.0, delta * 14.0))
	elif target_heading.length_squared() > 0.01:
		current_heading = current_heading.lerp(target_heading, minf(1.0, delta * 8.0))

	# The Blender GLB resident model has its face, chest and cargo socket oriented towards +Z.
	# Using rotation.y = atan2(x, z) aligns local +Z with current_heading, ensuring that
	# (global_basis * Vector3.BACK).dot(current_heading) == 1.0 (moving forward, not backward).
	if current_heading.length_squared() > 0.001:
		rotation.y = atan2(current_heading.x, current_heading.z)

	_update_movement_and_animation(ground_speed)

func _update_movement_and_animation(ground_speed: float) -> void:
	var is_carrying = (carrying_amount > 0 or state_name in ["carry", "return", "deposit"])
	if cargo_prop:
		cargo_prop.visible = is_carrying

	if is_sim_paused or is_network_stalled:
		# FREEZE the active animation clip in place without changing animation state.
		# Switching clips to IDLE during pause or stall abruptly alters bone positions
		# (e.g. Foot.R jumping 65mm). Freezing speed_scale = 0 keeps the exact pose intact.
		if anim_player:
			anim_player.speed_scale = 0.0
		return

	var target_state = AnimState.IDLE
	if ground_speed < 0.05:
		target_state = AnimState.CARRY_IDLE if is_carrying else AnimState.IDLE
	else:
		target_state = AnimState.CARRY_WALK if is_carrying else AnimState.WALK

	if current_anim_state != target_state:
		_play_anim(target_state)

	# Synchronize animation step frequency to real ground speed
	if anim_player:
		if ground_speed < 0.05:
			anim_player.speed_scale = 1.0
		else:
			# Stride distance is 0.48m per cycle: speed_scale = ground_speed / 0.48
			var stride_rate = ground_speed / NOMINAL_SPEED
			# High-speed policy: clamp visual stride playback to 8.0x max to avoid visual flicker,
			# while positional translation remains 100% faithful and unhampered.
			anim_player.speed_scale = clampf(stride_rate, 0.2, 8.0)

func _play_anim(new_state: AnimState) -> void:
	current_anim_state = new_state
	if not anim_player:
		return

	var clip_name = "idle"
	match new_state:
		AnimState.IDLE:
			clip_name = "idle"
		AnimState.WALK:
			clip_name = "walk"
		AnimState.CARRY_IDLE:
			clip_name = "carry_idle"
		AnimState.CARRY_WALK:
			clip_name = "carry_walk"
		AnimState.WORK_GATHER:
			clip_name = "work_gather"

	if anim_player.has_animation(clip_name):
		# Preserve playback position to maintain alternating foot cycle
		var prev_pos_sec = anim_player.current_animation_position if anim_player.is_playing() else 0.0
		anim_player.play(clip_name)
		if clip_name in ["walk", "carry_walk"] and prev_pos_sec > 0.0:
			var anim_len = anim_player.current_animation_length
			if anim_len > 0.0:
				anim_player.seek(fmod(prev_pos_sec, anim_len), true)

func on_network_stalled() -> void:
	is_network_stalled = true
	_update_movement_and_animation(0.0)

func on_network_resumed() -> void:
	is_network_stalled = false
