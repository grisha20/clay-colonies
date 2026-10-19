class_name LabResident
extends Node3D

## Controller for Clayfolk Resident in Visual Laboratory.
## Manages animations, calibrated forward walking, bone-socket cargo attachment,
## and rigorous 3-component stance-phase foot contact measurements:
## 1. Vertical contact error (|Y_sole| <= 2.5 mm)
## 2. Ground penetration (max(0, -Y_sole) < 2.0 mm)
## 3. Horizontal slip (< 10% sole length, i.e. < 22 mm)

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
var skeleton: Skeleton3D
var bone_attachment_cargo: BoneAttachment3D
var cargo_prop: Node3D

# Calibrated movement parameters:
# Stride travel = 0.24m per step * 2 steps = 0.48m per 1.0s cycle
const STRIDE_DISTANCE: float = 0.48 # meters per cycle
const CYCLE_DURATION: float = 1.0  # seconds at 1.0x speed
const FOOT_LENGTH: float = 0.22    # meters (22 cm clay sole)
const FOOT_ANKLE_HEIGHT: float = 0.05 # Ankle joint above bottom of sole

# Strict M1.1 Grounding Tolerances:
const MAX_VERTICAL_CONTACT_ERR_M: float = 0.0025 # 2.5 mm contact tolerance
const MAX_PENETRATION_M: float = 0.0020          # 2.0 mm max ground penetration
const PASS_SLIP_THRESHOLD_PCT: float = 10.0      # < 10% sole length is PASS (< 22 mm)

var move_speed: float:
	get:
		var base = STRIDE_DISTANCE / CYCLE_DURATION
		if test_mismatch_mode:
			return base * 2.2 # Artificial speed mismatch for negative test
		return base

# Movement track along X axis with unobstructed bounds
var move_direction: float = 1.0
var move_bounds: float = 4.8
var is_paused: bool = false
var test_mismatch_mode: bool = false # Negative test: speed desync
var test_elevated_mode: bool = false # Negative test: elevated above ground

# Foot tracking indices
var left_foot_bone_idx: int = -1
var right_foot_bone_idx: int = -1

# Stance measurement state
var left_stance_active: bool = false
var right_stance_active: bool = false
var left_stance_origin_xz: Vector2 = Vector2.ZERO
var right_stance_origin_xz: Vector2 = Vector2.ZERO

var left_stance_max_slip: float = 0.0
var right_stance_max_slip: float = 0.0
var left_stance_max_v_err: float = 0.0
var right_stance_max_v_err: float = 0.0
var left_stance_max_pen: float = 0.0
var right_stance_max_pen: float = 0.0

# Current metrics (last completed stance)
var last_completed_slip_mm: float = 0.0
var last_completed_slip_pct: float = 0.0
var last_completed_v_err_mm: float = 0.0
var last_completed_pen_mm: float = 0.0
var completed_stance_count: int = 0
var current_grounding_status: String = "N/A"
var current_stance_name: String = "None"

# Cumulative worst-case tracking across entire test run
var worst_slip_mm: float = 0.0
var worst_slip_pct: float = 0.0
var worst_v_err_mm: float = 0.0
var worst_pen_mm: float = 0.0
var all_stances_passed: bool = true

func _ready() -> void:
	anim_player = find_child("AnimationPlayer", true, false) as AnimationPlayer
	skeleton = find_child("Skeleton3D", true, false) as Skeleton3D

	if skeleton:
		left_foot_bone_idx = skeleton.find_bone("Foot.L")
		right_foot_bone_idx = skeleton.find_bone("Foot.R")
		_setup_cargo_attachment()

	if anim_player:
		_setup_animations()
		play_state(AnimState.IDLE)

func _setup_cargo_attachment() -> void:
	var cargo_bone_idx = skeleton.find_bone("Socket_Cargo")
	if cargo_bone_idx >= 0:
		bone_attachment_cargo = BoneAttachment3D.new()
		bone_attachment_cargo.name = "CargoBoneAttachment"
		bone_attachment_cargo.bone_name = "Socket_Cargo"
		skeleton.add_child(bone_attachment_cargo)

		cargo_prop = find_child("CargoProp", true, false) as Node3D
		if cargo_prop:
			cargo_prop.get_parent().remove_child(cargo_prop)
			bone_attachment_cargo.add_child(cargo_prop)
			cargo_prop.position = Vector3(0, 0, 0)
			cargo_prop.rotation = Vector3.ZERO
	else:
		push_warning("Socket_Cargo bone not found in Skeleton3D")

	_update_cargo_visibility()

func _setup_animations() -> void:
	for anim_name in anim_player.get_animation_list():
		var anim = anim_player.get_animation(anim_name)
		if anim:
			anim.loop_mode = Animation.LOOP_LINEAR

func play_state(new_state: AnimState) -> void:
	current_state = new_state
	_reset_slip_tracking()

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
		anim_player.speed_scale = 0.0 if is_paused else speed_scale

func _update_cargo_visibility() -> void:
	if cargo_prop:
		var should_show = (current_state == AnimState.CARRY_IDLE or current_state == AnimState.CARRY_WALK)
		cargo_prop.visible = should_show

func toggle_pause() -> void:
	is_paused = not is_paused
	_update_anim_speed()
	if is_paused:
		_reset_slip_tracking()

func toggle_mismatch_test() -> void:
	set_test_mismatch(not test_mismatch_mode)

func set_test_mismatch(enable: bool) -> void:
	test_mismatch_mode = enable
	_reset_slip_tracking()

func set_test_elevated(enable: bool) -> void:
	test_elevated_mode = enable
	position.y = 0.50 if enable else 0.00
	_reset_slip_tracking()

func _reset_slip_tracking() -> void:
	left_stance_active = false
	right_stance_active = false
	left_stance_max_slip = 0.0
	right_stance_max_slip = 0.0
	left_stance_max_v_err = 0.0
	right_stance_max_v_err = 0.0
	left_stance_max_pen = 0.0
	right_stance_max_pen = 0.0
	completed_stance_count = 0
	current_grounding_status = "N/A"
	current_stance_name = "Transition / Reset"

func reset_cumulative_metrics() -> void:
	worst_slip_mm = 0.0
	worst_slip_pct = 0.0
	worst_v_err_mm = 0.0
	worst_pen_mm = 0.0
	all_stances_passed = true
	_reset_slip_tracking()

func _physics_process(delta: float) -> void:
	if is_paused:
		return

	var is_moving = (current_state == AnimState.WALK_MOVE or current_state == AnimState.CARRY_WALK)
	if is_moving:
		var step = move_speed * speed_scale * delta * move_direction
		position.x += step

		# Face direction of travel along X axis
		# Facing +X: rotation.y = +PI/2
		# Facing -X: rotation.y = -PI/2
		rotation.y = PI / 2.0 if move_direction > 0.0 else -PI / 2.0

		# Turnaround at boundaries: reset stance measurement so turning frames don't taint metrics
		if position.x > move_bounds:
			position.x = move_bounds
			move_direction = -1.0
			_reset_slip_tracking()
		elif position.x < -move_bounds:
			position.x = -move_bounds
			move_direction = 1.0
			_reset_slip_tracking()
	elif current_state == AnimState.IDLE or current_state == AnimState.CARRY_IDLE or current_state == AnimState.WORK_GATHER:
		# Face towards camera (+Z)
		rotation.y = 0.0

	_measure_honest_foot_grounding()

func _measure_honest_foot_grounding() -> void:
	if not skeleton or left_foot_bone_idx < 0 or right_foot_bone_idx < 0 or not anim_player or is_paused:
		return

	var is_moving_walk = (current_state == AnimState.WALK_MOVE or current_state == AnimState.CARRY_WALK)
	if not is_moving_walk:
		current_grounding_status = "N/A"
		current_stance_name = "Not moving (N/A)"
		return

	var anim_pos = fmod(anim_player.current_animation_position, 1.0)

	# In calibrated 30 FPS walk cycle (duration = 1.0s):
	# Left Foot Stance window: phase in [0.06, 0.44] (fully planted sole)
	# Right Foot Stance window: phase in [0.56, 0.94] (fully planted sole)
	var left_in_stance = (anim_pos >= 0.06 and anim_pos <= 0.44)
	var right_in_stance = (anim_pos >= 0.56 and anim_pos <= 0.94)

	var left_foot_xf = skeleton.global_transform * skeleton.get_bone_global_pose(left_foot_bone_idx)
	var right_foot_xf = skeleton.global_transform * skeleton.get_bone_global_pose(right_foot_bone_idx)

	var left_foot_xz = Vector2(left_foot_xf.origin.x, left_foot_xf.origin.z)
	var right_foot_xz = Vector2(right_foot_xf.origin.x, right_foot_xf.origin.z)

	# Bottom of sole is at ankle.y - FOOT_ANKLE_HEIGHT
	var left_sole_y = left_foot_xf.origin.y - FOOT_ANKLE_HEIGHT
	var right_sole_y = right_foot_xf.origin.y - FOOT_ANKLE_HEIGHT

	# 1. Left Foot Stance Tracking
	if left_in_stance:
		current_stance_name = "Left Sole Planted"
		var v_err = abs(left_sole_y)
		var pen = max(0.0, -left_sole_y)

		if not left_stance_active:
			left_stance_active = true
			left_stance_origin_xz = left_foot_xz
			left_stance_max_slip = 0.0
			left_stance_max_v_err = v_err
			left_stance_max_pen = pen
		else:
			var slip = left_foot_xz.distance_to(left_stance_origin_xz)
			left_stance_max_slip = max(left_stance_max_slip, slip)
			left_stance_max_v_err = max(left_stance_max_v_err, v_err)
			left_stance_max_pen = max(left_stance_max_pen, pen)
	else:
		if left_stance_active:
			left_stance_active = false
			_record_completed_stance(left_stance_max_slip, left_stance_max_v_err, left_stance_max_pen)

	# 2. Right Foot Stance Tracking
	if right_in_stance:
		current_stance_name = "Right Sole Planted"
		var v_err = abs(right_sole_y)
		var pen = max(0.0, -right_sole_y)

		if not right_stance_active:
			right_stance_active = true
			right_stance_origin_xz = right_foot_xz
			right_stance_max_slip = 0.0
			right_stance_max_v_err = v_err
			right_stance_max_pen = pen
		else:
			var slip = right_foot_xz.distance_to(right_stance_origin_xz)
			right_stance_max_slip = max(right_stance_max_slip, slip)
			right_stance_max_v_err = max(right_stance_max_v_err, v_err)
			right_stance_max_pen = max(right_stance_max_pen, pen)
	else:
		if right_stance_active:
			right_stance_active = false
			_record_completed_stance(right_stance_max_slip, right_stance_max_v_err, right_stance_max_pen)

	if not left_in_stance and not right_in_stance:
		current_stance_name = "Double support / Weight transfer"

func _record_completed_stance(slip_dist_m: float, v_err_m: float, pen_m: float) -> void:
	completed_stance_count += 1
	last_completed_slip_mm = slip_dist_m * 1000.0
	last_completed_slip_pct = (slip_dist_m / FOOT_LENGTH) * 100.0
	last_completed_v_err_mm = v_err_m * 1000.0
	last_completed_pen_mm = pen_m * 1000.0

	worst_slip_mm = max(worst_slip_mm, last_completed_slip_mm)
	worst_slip_pct = max(worst_slip_pct, last_completed_slip_pct)
	worst_v_err_mm = max(worst_v_err_mm, last_completed_v_err_mm)
	worst_pen_mm = max(worst_pen_mm, last_completed_pen_mm)

	var slip_pass = (last_completed_slip_pct < PASS_SLIP_THRESHOLD_PCT)
	var contact_pass = (v_err_m <= MAX_VERTICAL_CONTACT_ERR_M)
	var pen_pass = (pen_m <= MAX_PENETRATION_M)

	if slip_pass and contact_pass and pen_pass:
		current_grounding_status = "PASS"
	else:
		all_stances_passed = false
		var fails: Array[String] = []
		if not contact_pass:
			fails.append("V-Err %.1fmm" % last_completed_v_err_mm)
		if not pen_pass:
			fails.append("Pen %.1fmm" % last_completed_pen_mm)
		if not slip_pass:
			fails.append("Slip %.1f%%" % last_completed_slip_pct)
		current_grounding_status = "FAIL (" + ", ".join(fails) + ")"

func get_metrics_summary() -> Dictionary:
	return {
		"last_slip_mm": last_completed_slip_mm,
		"last_slip_pct": last_completed_slip_pct,
		"last_v_err_mm": last_completed_v_err_mm,
		"last_pen_mm": last_completed_pen_mm,
		"worst_slip_mm": worst_slip_mm,
		"worst_slip_pct": worst_slip_pct,
		"worst_v_err_mm": worst_v_err_mm,
		"worst_pen_mm": worst_pen_mm,
		"stances_tested": completed_stance_count,
		"all_passed": all_stances_passed,
		"status": current_grounding_status
	}
