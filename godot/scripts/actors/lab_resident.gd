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
var test_penetrated_mode: bool = false # Negative test: ground penetration
var test_neutral_bone_mode: bool = false # Negative test: simulated unweighted / frozen legs
var test_submerged_cargo_mode: bool = false # Negative test: cargo buried inside torso
var turnaround_in_progress: bool = false

# Foot tracking indices
var left_foot_bone_idx: int = -1
var right_foot_bone_idx: int = -1

# Skinned mesh vertex tracking for honest multi-point contact
var mesh_instance: MeshInstance3D
var mesh_skin: Skin
var mesh_rest_vertices: PackedVector3Array
var mesh_bone_indices: PackedInt32Array
var mesh_bone_weights: PackedFloat32Array
var mesh_influence_count: int = 4

var left_sole_indices: Array[int] = []
var right_sole_indices: Array[int] = []

var left_heel_vidx: int = -1
var left_center_vidx: int = -1
var left_toe_vidx: int = -1

var right_heel_vidx: int = -1
var right_center_vidx: int = -1
var right_toe_vidx: int = -1

# Stance measurement state (honest 3-point: Heel, Center, Toe)
var left_stance_active: bool = false
var right_stance_active: bool = false
var left_heel_origin_xz: Vector2 = Vector2.ZERO
var left_center_origin_xz: Vector2 = Vector2.ZERO
var left_toe_origin_xz: Vector2 = Vector2.ZERO

var right_heel_origin_xz: Vector2 = Vector2.ZERO
var right_center_origin_xz: Vector2 = Vector2.ZERO
var right_toe_origin_xz: Vector2 = Vector2.ZERO

var left_stance_max_slip: float = 0.0
var right_stance_max_slip: float = 0.0
var left_stance_max_v_err: float = 0.0
var right_stance_max_v_err: float = 0.0
var left_stance_max_pen: float = 0.0
var right_stance_max_pen: float = 0.0

# Dynamic swing phase tracking (verifying actual deforming mesh lift)
var left_swing_peak_lift: float = 0.0
var right_swing_peak_lift: float = 0.0

# Current metrics (last completed stance)
var last_completed_slip_mm: float = 0.0
var last_completed_slip_pct: float = 0.0
var last_completed_v_err_mm: float = 0.0
var last_completed_pen_mm: float = 0.0
var last_completed_swing_lift_mm: float = 0.0
var completed_stance_count: int = 0
var current_grounding_status: String = "N/A"
var current_stance_name: String = "None"

# Cumulative worst-case tracking across entire test run
var worst_slip_mm: float = 0.0
var worst_slip_pct: float = 0.0
var worst_v_err_mm: float = 0.0
var worst_pen_mm: float = 0.0
var worst_swing_lift_mm: float = 0.0
var all_stances_passed: bool = true

func _ready() -> void:
	anim_player = find_child("AnimationPlayer", true, false) as AnimationPlayer
	skeleton = find_child("Skeleton3D", true, false) as Skeleton3D

	if skeleton:
		left_foot_bone_idx = skeleton.find_bone("Foot.L")
		right_foot_bone_idx = skeleton.find_bone("Foot.R")
		_setup_mesh_skinning()
		_setup_cargo_attachment()

	if anim_player:
		_setup_animations()
		play_state(AnimState.IDLE)

func _setup_mesh_skinning() -> void:
	mesh_instance = find_child("Resident", true, false) as MeshInstance3D
	if not mesh_instance:
		for child in find_children("*", "MeshInstance3D", true, false):
			if child.skin and child.mesh:
				mesh_instance = child as MeshInstance3D
				break

	if not mesh_instance or not mesh_instance.skin or not mesh_instance.mesh:
		push_error("LabResident: MeshInstance3D or skin not found!")
		return

	mesh_skin = mesh_instance.skin
	var arrays = mesh_instance.mesh.surface_get_arrays(0)
	mesh_rest_vertices = arrays[Mesh.ARRAY_VERTEX]
	mesh_bone_indices = arrays[Mesh.ARRAY_BONES]
	mesh_bone_weights = arrays[Mesh.ARRAY_WEIGHTS]
	mesh_influence_count = int(mesh_bone_weights.size() / mesh_rest_vertices.size())

	left_sole_indices.clear()
	right_sole_indices.clear()

	# Identify the 24 ground contact sole vertices strictly at rest pose Y = 0.000m
	for i in mesh_rest_vertices.size():
		if abs(mesh_rest_vertices[i].y) < 0.001:
			if mesh_rest_vertices[i].x < 0.0:
				left_sole_indices.append(i)
			elif mesh_rest_vertices[i].x > 0.0:
				right_sole_indices.append(i)

	# Sort along Z: in glTF character space, -Z is front (toe), +Z is back (heel)
	left_sole_indices.sort_custom(func(a, b): return mesh_rest_vertices[a].z < mesh_rest_vertices[b].z)
	right_sole_indices.sort_custom(func(a, b): return mesh_rest_vertices[a].z < mesh_rest_vertices[b].z)

	if left_sole_indices.size() > 0:
		left_toe_vidx = left_sole_indices[0]
		left_heel_vidx = left_sole_indices[left_sole_indices.size() - 1]
		left_center_vidx = left_sole_indices[int(left_sole_indices.size() / 2)]

	if right_sole_indices.size() > 0:
		right_toe_vidx = right_sole_indices[0]
		right_heel_vidx = right_sole_indices[right_sole_indices.size() - 1]
		right_center_vidx = right_sole_indices[int(right_sole_indices.size() / 2)]

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

func set_test_penetrated(enable: bool) -> void:
	test_penetrated_mode = enable
	position.y = -0.050 if enable else 0.00
	_reset_slip_tracking()

func set_test_neutral_bone(enable: bool) -> void:
	test_neutral_bone_mode = enable
	_reset_slip_tracking()

func sample_deformed_world_vertex(v_idx: int) -> Vector3:
	if test_neutral_bone_mode:
		# Simulated negative test: vertices are unweighted or bound to neutral_bone, remaining frozen in rest pose
		return global_transform * mesh_rest_vertices[v_idx]

	if not skeleton or not mesh_skin or v_idx < 0 or v_idx >= mesh_rest_vertices.size():
		return global_transform.origin

	var v_rest = mesh_rest_vertices[v_idx]
	var p_sk_local = Vector3.ZERO

	for k in mesh_influence_count:
		var idx = v_idx * mesh_influence_count + k
		var w = mesh_bone_weights[idx]
		if w <= 0.0001:
			continue
		var bind = mesh_bone_indices[idx]
		var bname = mesh_skin.get_bind_name(bind)
		if bname == &"neutral_bone":
			p_sk_local += v_rest * w
			continue
		var bone_id = skeleton.find_bone(bname)
		if bone_id < 0:
			p_sk_local += v_rest * w
			continue
		var bone_pose = skeleton.get_bone_global_pose(bone_id)
		var bind_pose = mesh_skin.get_bind_pose(bind)
		p_sk_local += (bone_pose * bind_pose * v_rest) * w

	return skeleton.global_transform * p_sk_local

func _reset_slip_tracking() -> void:
	left_stance_active = false
	right_stance_active = false
	left_stance_max_slip = 0.0
	right_stance_max_slip = 0.0
	left_stance_max_v_err = 0.0
	right_stance_max_v_err = 0.0
	left_stance_max_pen = 0.0
	right_stance_max_pen = 0.0
	left_swing_peak_lift = 0.0
	right_swing_peak_lift = 0.0
	completed_stance_count = 0
	current_grounding_status = "N/A"
	current_stance_name = "Transition / Reset"

func reset_cumulative_metrics() -> void:
	worst_slip_mm = 0.0
	worst_slip_pct = 0.0
	worst_v_err_mm = 0.0
	worst_pen_mm = 0.0
	worst_swing_lift_mm = 0.0
	all_stances_passed = true
	_reset_slip_tracking()

func _physics_process(delta: float) -> void:
	if is_paused:
		return

	var is_moving = (current_state == AnimState.WALK_MOVE or current_state == AnimState.CARRY_WALK)
	if is_moving:
		var step = move_speed * speed_scale * delta * move_direction
		position.x += step

		# Turnaround at boundaries: update heading immediately and discard interrupted step
		if position.x > move_bounds:
			position.x = move_bounds
			move_direction = -1.0
			rotation.y = -PI / 2.0
			_reset_slip_tracking()
			turnaround_in_progress = true
		elif position.x < -move_bounds:
			position.x = -move_bounds
			move_direction = 1.0
			rotation.y = PI / 2.0
			_reset_slip_tracking()
			turnaround_in_progress = true
		else:
			rotation.y = PI / 2.0 if move_direction > 0.0 else -PI / 2.0
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

	# If currently turning around at boundary, ignore interrupted step until feet enter swing phase
	if turnaround_in_progress:
		if not left_in_stance and not right_in_stance:
			turnaround_in_progress = false
		else:
			current_grounding_status = "OK"
			current_stance_name = "Turnaround transition"
			return

	# 1. Left Foot Stance Tracking (Actual Deformed Skinned Vertices: Heel, Center, Toe)
	if left_in_stance:
		current_stance_name = "Left Sole Planted (Heel/Center/Toe)"
		var heel = sample_deformed_world_vertex(left_heel_vidx)
		var center = sample_deformed_world_vertex(left_center_vidx)
		var toe = sample_deformed_world_vertex(left_toe_vidx)

		var min_y = min(heel.y, min(center.y, toe.y))
		var v_err = max(abs(heel.y), max(abs(center.y), abs(toe.y)))
		var pen = max(0.0, -min_y)

		if not left_stance_active:
			left_stance_active = true
			left_heel_origin_xz = Vector2(heel.x, heel.z)
			left_center_origin_xz = Vector2(center.x, center.z)
			left_toe_origin_xz = Vector2(toe.x, toe.z)
			left_stance_max_slip = 0.0
			left_stance_max_v_err = v_err
			left_stance_max_pen = pen
			right_swing_peak_lift = 0.0
		else:
			var slip_h = Vector2(heel.x, heel.z).distance_to(left_heel_origin_xz)
			var slip_c = Vector2(center.x, center.z).distance_to(left_center_origin_xz)
			var slip_t = Vector2(toe.x, toe.z).distance_to(left_toe_origin_xz)
			var slip = max(slip_h, max(slip_c, slip_t))

			left_stance_max_slip = max(left_stance_max_slip, slip)
			left_stance_max_v_err = max(left_stance_max_v_err, v_err)
			left_stance_max_pen = max(left_stance_max_pen, pen)

		# Monitor swinging Right foot to ensure sole geometry actively lifts off ground
		for idx in right_sole_indices:
			var pt = sample_deformed_world_vertex(idx)
			right_swing_peak_lift = max(right_swing_peak_lift, pt.y)
	else:
		if left_stance_active:
			left_stance_active = false
			_record_completed_stance(left_stance_max_slip, left_stance_max_v_err, left_stance_max_pen, right_swing_peak_lift)

	# 2. Right Foot Stance Tracking (Actual Deformed Skinned Vertices: Heel, Center, Toe)
	if right_in_stance:
		current_stance_name = "Right Sole Planted (Heel/Center/Toe)"
		var heel = sample_deformed_world_vertex(right_heel_vidx)
		var center = sample_deformed_world_vertex(right_center_vidx)
		var toe = sample_deformed_world_vertex(right_toe_vidx)

		var min_y = min(heel.y, min(center.y, toe.y))
		var v_err = max(abs(heel.y), max(abs(center.y), abs(toe.y)))
		var pen = max(0.0, -min_y)

		if not right_stance_active:
			right_stance_active = true
			right_heel_origin_xz = Vector2(heel.x, heel.z)
			right_center_origin_xz = Vector2(center.x, center.z)
			right_toe_origin_xz = Vector2(toe.x, toe.z)
			right_stance_max_slip = 0.0
			right_stance_max_v_err = v_err
			right_stance_max_pen = pen
			left_swing_peak_lift = 0.0
		else:
			var slip_h = Vector2(heel.x, heel.z).distance_to(right_heel_origin_xz)
			var slip_c = Vector2(center.x, center.z).distance_to(right_center_origin_xz)
			var slip_t = Vector2(toe.x, toe.z).distance_to(right_toe_origin_xz)
			var slip = max(slip_h, max(slip_c, slip_t))

			right_stance_max_slip = max(right_stance_max_slip, slip)
			right_stance_max_v_err = max(right_stance_max_v_err, v_err)
			right_stance_max_pen = max(right_stance_max_pen, pen)

		# Monitor swinging Left foot to ensure sole geometry actively lifts off ground
		for idx in left_sole_indices:
			var pt = sample_deformed_world_vertex(idx)
			left_swing_peak_lift = max(left_swing_peak_lift, pt.y)
	else:
		if right_stance_active:
			right_stance_active = false
			_record_completed_stance(right_stance_max_slip, right_stance_max_v_err, right_stance_max_pen, left_swing_peak_lift)

	if not left_in_stance and not right_in_stance:
		current_stance_name = "Double support / Weight transfer"

func _record_completed_stance(slip_dist_m: float, v_err_m: float, pen_m: float, swing_lift_m: float = 0.0) -> void:
	completed_stance_count += 1
	last_completed_slip_mm = slip_dist_m * 1000.0
	last_completed_slip_pct = (slip_dist_m / FOOT_LENGTH) * 100.0
	last_completed_v_err_mm = v_err_m * 1000.0
	last_completed_pen_mm = pen_m * 1000.0
	last_completed_swing_lift_mm = swing_lift_m * 1000.0

	worst_slip_mm = max(worst_slip_mm, last_completed_slip_mm)
	worst_slip_pct = max(worst_slip_pct, last_completed_slip_pct)
	worst_v_err_mm = max(worst_v_err_mm, last_completed_v_err_mm)
	worst_pen_mm = max(worst_pen_mm, last_completed_pen_mm)
	worst_swing_lift_mm = max(worst_swing_lift_mm, last_completed_swing_lift_mm)

	var slip_pass = (last_completed_slip_pct < PASS_SLIP_THRESHOLD_PCT)
	var contact_pass = (v_err_m <= MAX_VERTICAL_CONTACT_ERR_M)
	var pen_pass = (pen_m <= MAX_PENETRATION_M)
	var swing_pass = (swing_lift_m >= 0.040) # Swing foot geometry MUST lift >= 40 mm

	if slip_pass and contact_pass and pen_pass and swing_pass:
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
		if not swing_pass:
			fails.append("No-Lift %.1fmm" % last_completed_swing_lift_mm)
		current_grounding_status = "FAIL (" + ", ".join(fails) + ")"

func get_metrics_summary() -> Dictionary:
	return {
		"last_slip_mm": last_completed_slip_mm,
		"last_slip_pct": last_completed_slip_pct,
		"last_v_err_mm": last_completed_v_err_mm,
		"last_pen_mm": last_completed_pen_mm,
		"last_swing_lift_mm": last_completed_swing_lift_mm,
		"worst_slip_mm": worst_slip_mm,
		"worst_slip_pct": worst_slip_pct,
		"worst_v_err_mm": worst_v_err_mm,
		"worst_pen_mm": worst_pen_mm,
		"worst_swing_lift_mm": worst_swing_lift_mm,
		"stances_tested": completed_stance_count,
		"all_passed": all_stances_passed,
		"status": current_grounding_status
	}

func set_test_submerged_cargo(enable: bool) -> void:
	test_submerged_cargo_mode = enable
	if cargo_prop:
		if enable:
			# Artificially push cargo deep inside torso (-0.25 m in socket space)
			cargo_prop.position = Vector3(0, 0, -0.25)
		else:
			cargo_prop.position = Vector3.ZERO

func check_cargo_clearance() -> Dictionary:
	if not cargo_prop or not cargo_prop.visible or not skeleton:
		return {"valid": false, "reason": "Cargo prop missing or invisible", "clearance_mm": 0.0}

	var cargo_bone_idx = skeleton.find_bone("Socket_Cargo")
	if cargo_bone_idx < 0:
		return {"valid": false, "reason": "Socket_Cargo bone not found", "clearance_mm": 0.0}

	var cargo_pose = skeleton.get_bone_global_pose(cargo_bone_idx)
	# In Godot model space: +Z is forward, +Y is height.
	# Torso front surface at chest level (Y ~ 0.70-0.85) is at Z ~ +0.336 m.
	var local_cargo_z = cargo_pose.origin.z + cargo_prop.position.z
	var torso_belly_front_z = 0.336
	var clearance_m = local_cargo_z - torso_belly_front_z
	var clearance_mm = clearance_m * 1000.0

	var idx_hand_l = skeleton.find_bone("Hand.L")
	var idx_hand_r = skeleton.find_bone("Hand.R")
	var hand_l_pose = skeleton.get_bone_global_pose(idx_hand_l) if idx_hand_l >= 0 else Transform3D.IDENTITY
	var hand_r_pose = skeleton.get_bone_global_pose(idx_hand_r) if idx_hand_r >= 0 else Transform3D.IDENTITY

	var hands_flank = (hand_l_pose.origin.x < -0.10 and hand_r_pose.origin.x > 0.10)
	var hands_in_front = (hand_l_pose.origin.z >= torso_belly_front_z and hand_r_pose.origin.z >= torso_belly_front_z)

	var is_clear = (clearance_mm >= 50.0) and hands_flank and hands_in_front
	var reason = "OK" if is_clear else ("Submerged (clearance %.1f mm)" % clearance_mm if clearance_mm < 50.0 else "Hands misaligned")

	return {
		"valid": is_clear,
		"reason": reason,
		"local_cargo_z": local_cargo_z,
		"clearance_mm": clearance_mm,
		"hand_l_x": hand_l_pose.origin.x,
		"hand_r_x": hand_r_pose.origin.x,
		"hand_l_z": hand_l_pose.origin.z,
		"hand_r_z": hand_r_pose.origin.z
	}

