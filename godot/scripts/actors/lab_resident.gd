class_name LabResident
extends Node3D

## Controller for Clayfolk Resident in Visual Laboratory.
## Manages animations, calibrated forward walking, cargo attachment, and foot contact metrics.

enum AnimState {
	IDLE,
	WALK_IN_PLACE,
	WALK_MOVE,
	CARRY_IDLE,
	CARRY_WALK,
	WORK_GATHER
}

@export var speed_scale: float = 1.0:
	set(val):
		speed_scale = val
		_update_anim_speed()

var current_state: AnimState = AnimState.IDLE
var anim_player: AnimationPlayer
var cargo_prop: Node3D
var socket_cargo: Node3D

# Calibrated movement parameters
# In Blender, stride length D = 0.60 m per 1.0 sec (30 frames at 30 fps)
const STRIDE_DISTANCE: float = 0.60 # meters per cycle
const CYCLE_DURATION: float = 1.0 # seconds at 1.0x speed
const FOOT_LENGTH: float = 0.30 # meters (approx 30 cm clay sole)

var move_speed: float:
	get:
		return STRIDE_DISTANCE / CYCLE_DURATION # 0.6 m/s

# Movement along a line [-2.5, +2.5]
var move_direction: float = 1.0
var move_bounds: float = 2.4
var path_origin_z: float = 0.0

# Foot tracking and slip measurement
var left_foot_bone_idx: int = -1
var right_foot_bone_idx: int = -1
var skeleton: Skeleton3D

var last_left_foot_world_pos: Vector3 = Vector3.ZERO
var last_right_foot_world_pos: Vector3 = Vector3.ZERO
var stance_slip_distance_mm: float = 0.0
var stance_slip_percent: float = 0.0
var current_stance_foot: String = "Left"

func _ready() -> void:
	# Find AnimationPlayer in imported GLB hierarchy
	anim_player = find_child("AnimationPlayer", true, false) as AnimationPlayer
	if not anim_player:
		push_error("LabResident: AnimationPlayer not found in resident hierarchy!")
	else:
		_setup_animations()
		play_state(AnimState.IDLE)

	skeleton = find_child("Skeleton3D", true, false) as Skeleton3D
	if skeleton:
		left_foot_bone_idx = skeleton.find_bone("Foot.L")
		right_foot_bone_idx = skeleton.find_bone("Foot.R")

	# Find or instantiate Cargo prop
	cargo_prop = find_child("CargoProp", true, false) as Node3D
	_update_cargo_visibility()

func _setup_animations() -> void:
	if not anim_player:
		return
	# Ensure all animation clips loop seamlessly
	for anim_name in anim_player.get_animation_list():
		var anim = anim_player.get_animation(anim_name)
		if anim:
			anim.loop_mode = Animation.LOOP_LINEAR

func play_state(new_state: AnimState) -> void:
	current_state = new_state
	if not anim_player:
		return

	var clip_name = "idle"
	match new_state:
		AnimState.IDLE:
			clip_name = "idle"
		AnimState.WALK_IN_PLACE, AnimState.WALK_MOVE:
			clip_name = "walk"
		AnimState.CARRY_IDLE:
			clip_name = "carry_idle"
		AnimState.CARRY_WALK:
			clip_name = "carry_walk"
		AnimState.WORK_GATHER:
			clip_name = "work_gather"

	if anim_player.has_animation(clip_name):
		anim_player.play(clip_name)
	else:
		push_warning("Animation clip not found: " + clip_name)

	_update_anim_speed()
	_update_cargo_visibility()

func _update_anim_speed() -> void:
	if anim_player:
		anim_player.speed_scale = speed_scale

func _update_cargo_visibility() -> void:
	if cargo_prop:
		var should_show = (current_state == AnimState.CARRY_IDLE or current_state == AnimState.CARRY_WALK)
		cargo_prop.visible = should_show

func _physics_process(delta: float) -> void:
	var is_moving = (current_state == AnimState.WALK_MOVE or current_state == AnimState.CARRY_WALK)
	if is_moving:
		var step = move_speed * speed_scale * delta * move_direction
		position.x += step

		# Face direction of travel (+X is -PI/2 rad, -X is +PI/2 rad)
		rotation.y = -PI / 2.0 if move_direction > 0.0 else PI / 2.0

		# Turn around at bounds
		if position.x > move_bounds:
			position.x = move_bounds
			move_direction = -1.0
		elif position.x < -move_bounds:
			position.x = -move_bounds
			move_direction = 1.0
	elif current_state == AnimState.IDLE or current_state == AnimState.CARRY_IDLE or current_state == AnimState.WORK_GATHER:
		# Face towards South / Camera
		rotation.y = PI

	_measure_foot_slip(delta)

func _measure_foot_slip(delta: float) -> void:
	if not skeleton or left_foot_bone_idx < 0 or right_foot_bone_idx < 0 or not anim_player:
		return

	var anim_pos = anim_player.current_animation_position
	# Walk cycle is 1.0s long:
	# Phase 0.0 - 0.5: Left foot is in stance on the ground
	# Phase 0.5 - 1.0: Right foot is in stance on the ground
	var phase = fmod(anim_pos, 1.0)
	var is_left_stance = (phase < 0.5)
	current_stance_foot = "Left (sole planted)" if is_left_stance else "Right (sole planted)"

	var active_bone_idx = left_foot_bone_idx if is_left_stance else right_foot_bone_idx
	var bone_transform = skeleton.global_transform * skeleton.get_bone_global_pose(active_bone_idx)
	var foot_pos = bone_transform.origin

	if delta > 0.0001:
		var last_pos = last_left_foot_world_pos if is_left_stance else last_right_foot_world_pos
		if last_pos != Vector3.ZERO:
			# Horizontal displacement in world space during stance phase
			var horizontal_slip = Vector2(foot_pos.x - last_pos.x, foot_pos.z - last_pos.z).length()
			var slip_velocity = horizontal_slip / delta
			# Convert to mm per 0.5s stance phase
			var stance_phase_slip = slip_velocity * 0.5
			stance_slip_distance_mm = stance_phase_slip * 1000.0 # to mm
			stance_slip_percent = (stance_phase_slip / FOOT_LENGTH) * 100.0

	last_left_foot_world_pos = foot_pos if is_left_stance else Vector3.ZERO
	last_right_foot_world_pos = foot_pos if not is_left_stance else Vector3.ZERO
