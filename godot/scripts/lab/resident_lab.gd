class_name ResidentLab
extends Node3D

## Visual Laboratory Orchestrator for Clayfolk 3D Resident & Camp.
## Controls animations, speeds, relative viewpoints, pause, day/night lighting,
## and runs the comprehensive M1.1 grounding verification test matrix.

@onready var resident: LabResident = $Resident
@onready var camera_pivot: Node3D = $CameraPivot
@onready var camera: Camera3D = $CameraPivot/Camera3D
@onready var sun_light: DirectionalLight3D = $DirectionalLight3D
@onready var campfire_light: OmniLight3D = $Campfire/CampfireLight
@onready var world_env: WorldEnvironment = $WorldEnvironment

# UI Labels
@onready var state_label: Label = $UI/Panel/VBoxContainer/StateLabel
@onready var speed_label: Label = $UI/Panel/VBoxContainer/SpeedLabel
@onready var view_label: Label = $UI/Panel/VBoxContainer/ViewLabel
@onready var lighting_label: Label = $UI/Panel/VBoxContainer/LightingLabel
@onready var metrics_label: Label = $UI/Panel/VBoxContainer/MetricsLabel

var is_night: bool = false
var tour_mode: bool = false
var tour_quit: bool = false
var tour_time: float = 0.0

var test_grounding_mode: bool = false
var test_grounding_timer: float = 0.0
var test_matrix_stage: int = 0
var test_stage_timer: float = 0.0

# Predefined Camera Angles relative to character's heading
enum ViewAngle {
	GAME_VIEW,
	CHARACTER_FRONT,
	CHARACTER_BACK,
	CHARACTER_LEFT_PROFILE,
	CHARACTER_RIGHT_PROFILE
}
var current_view: ViewAngle = ViewAngle.GAME_VIEW

func _ready() -> void:
	var args = OS.get_cmdline_args()
	for arg in args:
		if arg == "--tour":
			tour_mode = true
		elif arg == "--tour-quit":
			tour_mode = true
			tour_quit = true
		elif arg == "--test-grounding":
			test_grounding_mode = true

	_apply_camera_angle(ViewAngle.GAME_VIEW)
	_apply_lighting(false)
	_update_ui_text()

	if test_grounding_mode:
		print("\n=== STARTING M1.1 COMPREHENSIVE GROUNDING VERIFICATION TEST MATRIX ===")
		test_matrix_stage = 1
		test_stage_timer = 0.0
		_setup_test_stage(1)

func _input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.is_pressed():
		return

	var key = event.keycode
	match key:
		KEY_1:
			set_resident_state(LabResident.AnimState.IDLE)
		KEY_2:
			set_resident_state(LabResident.AnimState.WALK_IN_PLACE)
		KEY_3:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
		KEY_4:
			set_resident_state(LabResident.AnimState.CARRY_IDLE)
		KEY_5:
			set_resident_state(LabResident.AnimState.CARRY_WALK)
		KEY_6:
			set_resident_state(LabResident.AnimState.WORK_GATHER)
		KEY_Q:
			set_playback_speed(0.25)
		KEY_W:
			set_playback_speed(1.0)
		KEY_E:
			set_playback_speed(5.0)
		KEY_A:
			_apply_camera_angle(ViewAngle.CHARACTER_FRONT)
		KEY_S:
			_apply_camera_angle(ViewAngle.CHARACTER_RIGHT_PROFILE)
		KEY_D:
			_apply_camera_angle(ViewAngle.CHARACTER_BACK)
		KEY_F:
			_apply_camera_angle(ViewAngle.CHARACTER_LEFT_PROFILE)
		KEY_G:
			_apply_camera_angle(ViewAngle.GAME_VIEW)
		KEY_N:
			toggle_day_night()
		KEY_SPACE:
			toggle_pause()
		KEY_T:
			toggle_negative_test()

func toggle_pause() -> void:
	if resident:
		resident.toggle_pause()
	_update_ui_text()

func toggle_negative_test() -> void:
	if resident:
		resident.toggle_mismatch_test()
	_update_ui_text()

func set_resident_state(state: LabResident.AnimState) -> void:
	if resident:
		resident.play_state(state)
	_update_ui_text()

func set_playback_speed(speed: float) -> void:
	if resident:
		resident.speed_scale = speed
	_update_ui_text()

func toggle_day_night() -> void:
	is_night = not is_night
	_apply_lighting(is_night)
	_update_ui_text()

func _apply_camera_angle(view: ViewAngle) -> void:
	current_view = view
	_update_camera_transform()
	_update_ui_text()

func _update_camera_transform() -> void:
	if not camera_pivot or not resident:
		return

	if current_view == ViewAngle.GAME_VIEW:
		camera_pivot.position = Vector3(0.0, 0.8, 0.0)
		camera_pivot.rotation = Vector3(-deg_to_rad(58.0), 0.0, 0.0)
		camera.position = Vector3(0.0, 0.0, 6.2)
	else:
		var view_yaw_offset = 0.0
		match current_view:
			ViewAngle.CHARACTER_FRONT:
				view_yaw_offset = 0.0 # Looking straight into face
			ViewAngle.CHARACTER_BACK:
				view_yaw_offset = PI # Looking at back of head
			ViewAngle.CHARACTER_LEFT_PROFILE:
				view_yaw_offset = -PI / 2.0 # Looking at left profile
			ViewAngle.CHARACTER_RIGHT_PROFILE:
				view_yaw_offset = PI / 2.0 # Looking at right profile

		camera_pivot.position = resident.position + Vector3(0.0, 0.7, 0.0)
		camera_pivot.rotation = Vector3(-deg_to_rad(8.0), resident.rotation.y + view_yaw_offset, 0.0)
		camera.position = Vector3(0.0, 0.0, 3.2)

func _apply_lighting(night: bool) -> void:
	if sun_light:
		sun_light.light_energy = 0.06 if night else 1.2
		sun_light.visible = true
	if campfire_light:
		campfire_light.visible = true
		campfire_light.base_energy = 3.6 if night else 1.2
	if world_env and world_env.environment:
		var env = world_env.environment
		env.background_energy_multiplier = 0.12 if night else 1.0

func _process(delta: float) -> void:
	_update_camera_transform()

	if test_grounding_mode:
		test_stage_timer += delta
		_run_matrix_test_step(delta)
		_update_live_metrics()
		return

	if tour_mode:
		tour_time += delta
		_advance_tour(tour_time)
	_update_live_metrics()

func _setup_test_stage(stage: int) -> void:
	resident.position = Vector3(0, 0, 0)
	resident.move_direction = 1.0
	resident.reset_cumulative_metrics()
	match stage:
		1:
			print("[STAGE 1] Walk at 1.0x (Calibrated normal walk)")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(false)
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
		2:
			print("[STAGE 2] Walk at 0.25x (Slow-motion contact check)")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(false)
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
		3:
			print("[STAGE 3] Walk at 5.0x (High-speed contact check)")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(false)
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(5.0)
		4:
			print("[STAGE 4] Carry Walk at 1.0x (Carrying cargo bundle)")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(false)
			set_resident_state(LabResident.AnimState.CARRY_WALK)
			set_playback_speed(1.0)
		5:
			print("[STAGE 5] Carry Walk at 0.25x (Carrying cargo bundle slow-motion)")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(false)
			set_resident_state(LabResident.AnimState.CARRY_WALK)
			set_playback_speed(0.25)
		6:
			print("[STAGE 6] Carry Walk at 5.0x (Carrying cargo bundle high-speed)")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(false)
			set_resident_state(LabResident.AnimState.CARRY_WALK)
			set_playback_speed(5.0)
		7:
			print("[STAGE 7: NEGATIVE TEST] Artificially Elevated (+0.50 m) - Must FAIL on vertical contact")
			resident.set_test_mismatch(false)
			resident.set_test_elevated(true)
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
		8:
			print("[STAGE 8: NEGATIVE TEST] Speed Mismatch (2.2x Desync) - Must FAIL on horizontal slip")
			resident.set_test_elevated(false)
			resident.set_test_mismatch(true)
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)

func _run_matrix_test_step(_delta: float) -> void:
	var m = resident.get_metrics_summary()
	var needed_stances = 2
	var min_time = 2.4

	match test_matrix_stage:
		1, 4: # 1.0x: 2 stances in ~2.0s
			needed_stances = 2
			min_time = 2.2
		2, 5: # 0.25x: 2 stances in ~8.0s
			needed_stances = 2
			min_time = 8.5
		3, 6: # 5.0x: 4 stances in ~1.2s
			needed_stances = 4
			min_time = 1.2
		7, 8: # Negative tests: 2 stances in ~2.4s
			needed_stances = 2
			min_time = 2.2

	if test_stage_timer < min_time or m["stances_tested"] < needed_stances:
		return

	# Evaluate stage result
	var passed = false
	if test_matrix_stage <= 6:
		# Positive stages: must PASS all criteria
		var status_is_pass = (resident.current_grounding_status == "PASS")
		var no_worst_fail = (m["worst_v_err_mm"] <= 2.5 and m["worst_pen_mm"] <= 2.0 and m["worst_slip_pct"] < 10.0)
		passed = status_is_pass and no_worst_fail
		print("  -> Stances: %d | Worst V-Err: %.2f mm | Pen: %.2f mm | Slip: %.2f mm (%.2f%%) | Status: %s" % [
			m["stances_tested"], m["worst_v_err_mm"], m["worst_pen_mm"], m["worst_slip_mm"], m["worst_slip_pct"], resident.current_grounding_status
		])
		if not passed:
			push_error("[TEST MATRIX FAILED] Stage %d expected PASS, but got %s!" % [test_matrix_stage, resident.current_grounding_status])
			get_tree().quit(1)
			return
		print("  -> Result: STAGE %d PASSED cleanly!\n" % test_matrix_stage)
	elif test_matrix_stage == 7:
		# Negative stage 7: must FAIL on vertical contact
		var failed_contact = (m["worst_v_err_mm"] > 2.5 or resident.current_grounding_status.contains("V-Err"))
		passed = failed_contact
		print("  -> Stances: %d | Worst V-Err: %.2f mm | Status: %s" % [m["stances_tested"], m["worst_v_err_mm"], resident.current_grounding_status])
		if not passed:
			push_error("[TEST MATRIX FAILED] Stage 7 expected vertical error detection, but got %s!" % resident.current_grounding_status)
			get_tree().quit(1)
			return
		print("  -> Result: STAGE 7 PASSED (properly detected vertical detachment)!\n")
	elif test_matrix_stage == 8:
		# Negative stage 8: must FAIL on horizontal slip
		var failed_slip = (m["worst_slip_pct"] >= 10.0 or resident.current_grounding_status.contains("Slip"))
		passed = failed_slip
		print("  -> Stances: %d | Worst Slip: %.2f mm (%.2f%%) | Status: %s" % [m["stances_tested"], m["worst_slip_mm"], m["worst_slip_pct"], resident.current_grounding_status])
		if not passed:
			push_error("[TEST MATRIX FAILED] Stage 8 expected slip detection, but got %s!" % resident.current_grounding_status)
			get_tree().quit(1)
			return
		print("  -> Result: STAGE 8 PASSED (properly detected horizontal slip)!\n")
		print("=== ALL 8 TEST MATRIX STAGES (POSITIVE AND NEGATIVE) PASSED WITH FLYING COLORS! ===")
		get_tree().quit(0)
		return

	# Advance to next stage
	test_matrix_stage += 1
	test_stage_timer = 0.0
	_setup_test_stage(test_matrix_stage)

func _advance_tour(t: float) -> void:
	if t < 2.5:
		# Stage 1: Idle, Game View, Day
		if resident.current_state != LabResident.AnimState.IDLE or current_view != ViewAngle.GAME_VIEW:
			set_resident_state(LabResident.AnimState.IDLE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
			if is_night: toggle_day_night()
	elif t < 6.5:
		# Stage 2: Walk Move, Game View, 1x
		if resident.current_state != LabResident.AnimState.WALK_MOVE or current_view != ViewAngle.GAME_VIEW:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 9.5:
		# Stage 3: Walk Move, Character Front view
		if current_view != ViewAngle.CHARACTER_FRONT:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.CHARACTER_FRONT)
	elif t < 12.5:
		# Stage 4: Walk Move, Right Profile view
		if current_view != ViewAngle.CHARACTER_RIGHT_PROFILE:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.CHARACTER_RIGHT_PROFILE)
	elif t < 15.5:
		# Stage 5: Walk Move, Left Profile view
		if current_view != ViewAngle.CHARACTER_LEFT_PROFILE:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.CHARACTER_LEFT_PROFILE)
	elif t < 18.5:
		# Stage 6: Walk Move, Back view
		if current_view != ViewAngle.CHARACTER_BACK:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.CHARACTER_BACK)
	elif t < 22.5:
		# Stage 7: Carry Walk with socket cargo, Game View, 1x
		if resident.current_state != LabResident.AnimState.CARRY_WALK or current_view != ViewAngle.GAME_VIEW:
			set_resident_state(LabResident.AnimState.CARRY_WALK)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 26.0:
		# Stage 8: Work / Gather clay, Game View, 1x
		if resident.current_state != LabResident.AnimState.WORK_GATHER:
			set_resident_state(LabResident.AnimState.WORK_GATHER)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 30.0:
		# Stage 9: Night campfire illumination with 3D flame mesh & embers
		if not is_night or resident.current_state != LabResident.AnimState.IDLE:
			set_resident_state(LabResident.AnimState.IDLE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
			if not is_night: toggle_day_night()
	else:
		if tour_quit:
			get_tree().quit(0)

func _update_ui_text() -> void:
	if not state_label:
		return

	var state_name = "Idle"
	if resident:
		match resident.current_state:
			LabResident.AnimState.IDLE: state_name = "Idle (Standing)"
			LabResident.AnimState.WALK_IN_PLACE: state_name = "Walk (In-Place)"
			LabResident.AnimState.WALK_MOVE: state_name = "Walk (Moving along path)"
			LabResident.AnimState.CARRY_IDLE: state_name = "Carry Idle (Holding clay in socket)"
			LabResident.AnimState.CARRY_WALK: state_name = "Carry Walk (Walking with socket cargo)"
			LabResident.AnimState.WORK_GATHER: state_name = "Work / Gather (Scooping clay)"

	var pause_str = " [PAUSED]" if resident and resident.is_paused else ""
	var mismatch_str = " [NEGATIVE TEST: MISMATCH]" if resident and resident.test_mismatch_mode else ""
	var elev_str = " [NEGATIVE TEST: ELEVATED]" if resident and resident.test_elevated_mode else ""

	state_label.text = "State: %s%s%s%s [1-6, Space: Pause, T: Test]" % [state_name, pause_str, mismatch_str, elev_str]
	speed_label.text = "Speed: %.2fx [Q: 0.25x | W: 1x | E: 5x]" % (resident.speed_scale if resident else 1.0)

	var angle_name = "Game View"
	match current_view:
		ViewAngle.GAME_VIEW: angle_name = "Game View 58° (G)"
		ViewAngle.CHARACTER_FRONT: angle_name = "Character Front (A)"
		ViewAngle.CHARACTER_RIGHT_PROFILE: angle_name = "Right Profile (S)"
		ViewAngle.CHARACTER_BACK: angle_name = "Character Back (D)"
		ViewAngle.CHARACTER_LEFT_PROFILE: angle_name = "Left Profile (F)"
	view_label.text = "Camera: %s" % angle_name
	lighting_label.text = "Lighting: %s [N: Toggle]" % ("Night (Campfire light)" if is_night else "Day (Sunlight)")

func _update_live_metrics() -> void:
	if not metrics_label or not resident:
		return

	var status = resident.current_grounding_status
	var slip_mm = resident.last_completed_slip_mm
	var slip_pct = resident.last_completed_slip_pct
	var v_err_mm = resident.last_completed_v_err_mm
	var pen_mm = resident.last_completed_pen_mm
	var count = resident.completed_stance_count
	var stance_info = resident.current_stance_name

	metrics_label.text = "Foot Grounding 3-Component Verification:\n  Active phase: %s\n  Completed phases: %d\n  Contact error: %.1f mm (<= 2.5 mm)\n  Penetration: %.1f mm (< 2.0 mm)\n  Horizontal slip: %.1f mm (%.1f%%, < 10.0%%)\n  Status: [%s]" % [
		stance_info, count, v_err_mm, pen_mm, slip_mm, slip_pct, status
	]
