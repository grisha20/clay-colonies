class_name ResidentLab
extends Node3D

## Visual Laboratory Orchestrator for Clayfolk 3D Resident & Camp.
## Controls animations, speeds, relative viewpoints, pause, day/night lighting,
## and displays verified foot grounding metrics with negative test support.

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
var test_phase_1_checked: bool = false
var test_phase_2_started: bool = false
var test_phase_1_slip_mm: float = 0.0
var test_phase_1_slip_pct: float = 0.0

# Predefined Camera Angles relative to character
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
	if not camera_pivot:
		return

	match view:
		ViewAngle.GAME_VIEW:
			# Fixed 58° overhead isometric angle
			camera_pivot.rotation = Vector3(-deg_to_rad(58.0), 0.0, 0.0)
			camera_pivot.position = Vector3(0.0, 0.8, 0.0)
			camera.position = Vector3(0.0, 0.0, 6.2)
		ViewAngle.CHARACTER_FRONT:
			# Looking straight at character's face (-Y in character space)
			camera_pivot.rotation = Vector3(-deg_to_rad(8.0), 0.0, 0.0)
			camera_pivot.position = Vector3(0.0, 0.7, 0.0)
			camera.position = Vector3(0.0, 0.0, 3.2)
		ViewAngle.CHARACTER_BACK:
			# Looking at character's back (+Y in character space)
			camera_pivot.rotation = Vector3(-deg_to_rad(8.0), deg_to_rad(180.0), 0.0)
			camera_pivot.position = Vector3(0.0, 0.7, 0.0)
			camera.position = Vector3(0.0, 0.0, 3.2)
		ViewAngle.CHARACTER_LEFT_PROFILE:
			# Looking at character's left side (-X)
			camera_pivot.rotation = Vector3(-deg_to_rad(8.0), -deg_to_rad(90.0), 0.0)
			camera_pivot.position = Vector3(0.0, 0.7, 0.0)
			camera.position = Vector3(0.0, 0.0, 3.2)
		ViewAngle.CHARACTER_RIGHT_PROFILE:
			# Looking at character's right side (+X)
			camera_pivot.rotation = Vector3(-deg_to_rad(8.0), deg_to_rad(90.0), 0.0)
			camera_pivot.position = Vector3(0.0, 0.7, 0.0)
			camera.position = Vector3(0.0, 0.0, 3.2)

	_update_ui_text()

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
	if test_grounding_mode:
		test_grounding_timer += delta
		_run_grounding_test_step(test_grounding_timer)
		_update_live_metrics()
		return

	# Update camera pivot to track resident X position while preserving angle
	if current_view != ViewAngle.GAME_VIEW and resident:
		camera_pivot.position.x = resident.position.x

	if tour_mode:
		tour_time += delta
		_advance_tour(tour_time)
	_update_live_metrics()

func _run_grounding_test_step(t: float) -> void:
	if t < 0.2:
		if resident.current_state != LabResident.AnimState.WALK_MOVE:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
	elif t < 3.0:
		pass
	elif t < 3.2:
		if not test_phase_1_checked:
			test_phase_1_checked = true
			test_phase_1_slip_mm = resident.last_completed_slip_mm
			test_phase_1_slip_pct = resident.last_completed_slip_pct
			print("[TEST_GROUNDING] Phase 1 (Calibrated Walk 1x):")
			print("  Completed stances: %d" % resident.completed_stance_count)
			print("  Measured slip: %.2f mm (%.2f%% sole length)" % [test_phase_1_slip_mm, test_phase_1_slip_pct])
			print("  Grounding status: [%s]" % resident.current_grounding_status)
			if resident.completed_stance_count < 2 or resident.current_grounding_status != "PASS":
				push_error("[TEST_GROUNDING] FAILED Phase 1: Expected >= 2 completed stances with PASS status, got %s!" % resident.current_grounding_status)
				get_tree().quit(1)
				return
	elif t < 3.3:
		if not test_phase_2_started:
			test_phase_2_started = true
			print("[TEST_GROUNDING] Phase 2: Starting negative test with artificial speed mismatch (2.2x)...")
			resident.toggle_mismatch_test()
	elif t < 6.0:
		pass
	else:
		var p2_slip_mm = resident.last_completed_slip_mm
		var p2_slip_pct = resident.last_completed_slip_pct
		print("[TEST_GROUNDING] Phase 2 (Mismatched Speed 2.2x):")
		print("  Completed stances: %d" % resident.completed_stance_count)
		print("  Measured slip: %.2f mm (%.2f%% sole length)" % [p2_slip_mm, p2_slip_pct])
		print("  Grounding status: [%s]" % resident.current_grounding_status)
		if resident.completed_stance_count < 2 or resident.current_grounding_status != "FAIL":
			push_error("[TEST_GROUNDING] FAILED Phase 2: Expected >= 2 completed stances with FAIL status, got %s!" % resident.current_grounding_status)
			get_tree().quit(1)
			return
		print("[TEST_GROUNDING] ALL GROUNDING VERIFICATION TESTS (NORMAL PASS & NEGATIVE FAIL) PASSED SUCCESSFULLY!")
		get_tree().quit(0)

func _advance_tour(t: float) -> void:
	if t < 3.0:
		# Stage 1: Idle, Game View, Day
		if resident.current_state != LabResident.AnimState.IDLE or current_view != ViewAngle.GAME_VIEW:
			set_resident_state(LabResident.AnimState.IDLE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
			if is_night: toggle_day_night()
	elif t < 8.0:
		# Stage 2: Walk Move, Game View, 1x
		if resident.current_state != LabResident.AnimState.WALK_MOVE or current_view != ViewAngle.GAME_VIEW:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 13.0:
		# Stage 3: Walk Move, Character Left Profile, 0.25x (5 seconds = 1.25 full cycles)
		if current_view != ViewAngle.CHARACTER_LEFT_PROFILE or resident.speed_scale != 0.25:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.CHARACTER_LEFT_PROFILE)
	elif t < 18.0:
		# Stage 4: Walk Move, Character Right Profile, 0.25x
		if current_view != ViewAngle.CHARACTER_RIGHT_PROFILE:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.CHARACTER_RIGHT_PROFILE)
	elif t < 23.0:
		# Stage 5: Walk Move, Character Front, 0.25x
		if current_view != ViewAngle.CHARACTER_FRONT:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.CHARACTER_FRONT)
	elif t < 28.0:
		# Stage 6: Walk Move, Character Back, 0.25x
		if current_view != ViewAngle.CHARACTER_BACK:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.CHARACTER_BACK)
	elif t < 33.0:
		# Stage 7: Carry Walk with socket cargo, Game View, 1x
		if resident.current_state != LabResident.AnimState.CARRY_WALK or current_view != ViewAngle.GAME_VIEW:
			set_resident_state(LabResident.AnimState.CARRY_WALK)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 37.0:
		# Stage 8: Work / Gather clay, Game View, 1x
		if resident.current_state != LabResident.AnimState.WORK_GATHER:
			set_resident_state(LabResident.AnimState.WORK_GATHER)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 41.0:
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

	state_label.text = "State: %s%s%s [1-6, Space: Pause, T: Test]" % [state_name, pause_str, mismatch_str]
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
	var count = resident.completed_stance_count
	var stance_info = resident.current_stance_name

	metrics_label.text = "Foot Grounding Verification:\n  Active phase: %s\n  Completed phases: %d\n  Measured stance slip: %.1f mm (%.1f%% sole length)\n  Threshold criteria: < 10.0%% -> Status: [%s]" % [
		stance_info, count, slip_mm, slip_pct, status
	]
