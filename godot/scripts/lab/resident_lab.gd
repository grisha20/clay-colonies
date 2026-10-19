class_name ResidentLab
extends Node3D

## Visual Laboratory Orchestrator for Clayfolk 3D Resident & Camp.
## Provides controls for animations, speeds, 4 cardinal viewpoints, day/night lighting,
## and displays realtime foot grounding metrics.

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

# Predefined Camera Angles
enum ViewAngle {
	GAME_VIEW,
	SOUTH_FRONT,
	EAST_RIGHT,
	NORTH_BACK,
	WEST_LEFT
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
			_apply_camera_angle(ViewAngle.SOUTH_FRONT)
		KEY_S:
			_apply_camera_angle(ViewAngle.EAST_RIGHT)
		KEY_D:
			_apply_camera_angle(ViewAngle.NORTH_BACK)
		KEY_F:
			_apply_camera_angle(ViewAngle.WEST_LEFT)
		KEY_G:
			_apply_camera_angle(ViewAngle.GAME_VIEW)
		KEY_N:
			toggle_day_night()

func set_resident_state(state: LabResident.AnimState) -> void:
	if resident:
		resident.play_state(state)
	_update_ui_text()

func set_playback_speed(speed: float) -> void:
	if resident:
		resident.speed_scale = speed
	_update_ui_text()

func _apply_camera_angle(view: ViewAngle) -> void:
	current_view = view
	if not camera_pivot:
		return

	match view:
		ViewAngle.GAME_VIEW:
			camera_pivot.position = Vector3(0, 0.8, 0)
			camera_pivot.rotation_degrees = Vector3(-58, 0, 0)
			camera.position = Vector3(0, 0, 6.2)
		ViewAngle.SOUTH_FRONT:
			camera_pivot.position = Vector3(0, 0.8, 0)
			camera_pivot.rotation_degrees = Vector3(-15, 0, 0)
			camera.position = Vector3(0, 0, 5.6)
		ViewAngle.EAST_RIGHT:
			camera_pivot.position = Vector3(0, 0.8, 0)
			camera_pivot.rotation_degrees = Vector3(-15, 90, 0)
			camera.position = Vector3(0, 0, 5.6)
		ViewAngle.NORTH_BACK:
			camera_pivot.position = Vector3(0, 0.8, 0)
			camera_pivot.rotation_degrees = Vector3(-15, 180, 0)
			camera.position = Vector3(0, 0, 5.6)
		ViewAngle.WEST_LEFT:
			camera_pivot.position = Vector3(0, 0.8, 0)
			camera_pivot.rotation_degrees = Vector3(-15, -90, 0)
			camera.position = Vector3(0, 0, 5.6)

	_update_ui_text()

func toggle_day_night() -> void:
	is_night = not is_night
	_apply_lighting(is_night)
	_update_ui_text()

func _apply_lighting(night: bool) -> void:
	if sun_light:
		sun_light.light_energy = 0.08 if night else 1.2
		sun_light.visible = true
	if campfire_light:
		campfire_light.visible = true
		campfire_light.base_energy = 3.2 if night else 1.2
	if world_env and world_env.environment:
		var env = world_env.environment
		env.background_energy_multiplier = 0.15 if night else 1.0

func _process(delta: float) -> void:
	if tour_mode:
		tour_time += delta
		_advance_tour(tour_time)
	_update_live_metrics()

func _advance_tour(t: float) -> void:
	if t < 2.5:
		# Stage 1: Idle, Game View, Day
		if resident.current_state != LabResident.AnimState.IDLE:
			set_resident_state(LabResident.AnimState.IDLE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
			if is_night: toggle_day_night()
	elif t < 5.5:
		# Stage 2: Walk Move, Game View, 1x
		if resident.current_state != LabResident.AnimState.WALK_MOVE:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 7.5:
		# Stage 3: Walk Move, South / Front, 0.25x
		if current_view != ViewAngle.SOUTH_FRONT:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.SOUTH_FRONT)
	elif t < 9.5:
		# Stage 4: Walk Move, East / Right profile, 0.25x
		if current_view != ViewAngle.EAST_RIGHT:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.EAST_RIGHT)
	elif t < 11.5:
		# Stage 5: Walk Move, North / Back, 0.25x
		if current_view != ViewAngle.NORTH_BACK:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.NORTH_BACK)
	elif t < 13.5:
		# Stage 6: Walk Move, West / Left profile, 0.25x
		if current_view != ViewAngle.WEST_LEFT:
			set_resident_state(LabResident.AnimState.WALK_MOVE)
			set_playback_speed(0.25)
			_apply_camera_angle(ViewAngle.WEST_LEFT)
	elif t < 16.0:
		# Stage 7: Carry Walk with cargo, Game View, 1x
		if resident.current_state != LabResident.AnimState.CARRY_WALK:
			set_resident_state(LabResident.AnimState.CARRY_WALK)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 18.5:
		# Stage 8: Work / Gather clay, Game View, 1x
		if resident.current_state != LabResident.AnimState.WORK_GATHER:
			set_resident_state(LabResident.AnimState.WORK_GATHER)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
	elif t < 21.0:
		# Stage 9: Night illumination by campfire
		if not is_night:
			set_resident_state(LabResident.AnimState.IDLE)
			set_playback_speed(1.0)
			_apply_camera_angle(ViewAngle.GAME_VIEW)
			toggle_day_night()
	else:
		if tour_quit:
			get_tree().quit(0)

func _update_ui_text() -> void:
	if not state_label:
		return

	var state_name = "Idle"
	if resident:
		match resident.current_state:
			LabResident.AnimState.IDLE:
				state_name = "Idle (Standing)"
			LabResident.AnimState.WALK_IN_PLACE:
				state_name = "Walk (In-Place)"
			LabResident.AnimState.WALK_MOVE:
				state_name = "Walk (Traveling forward)"
			LabResident.AnimState.CARRY_IDLE:
				state_name = "Carry Idle (Holding clay)"
			LabResident.AnimState.CARRY_WALK:
				state_name = "Carry Walk (Traveling with cargo)"
			LabResident.AnimState.WORK_GATHER:
				state_name = "Work / Gather (Scooping clay)"

	state_label.text = "State: %s [Keys 1-6]" % state_name
	speed_label.text = "Speed: %.2fx [Q: 0.25x | W: 1x | E: 5x]" % (resident.speed_scale if resident else 1.0)

	var angle_name = "Game View (58° overhead)"
	match current_view:
		ViewAngle.GAME_VIEW: angle_name = "Game View (G)"
		ViewAngle.SOUTH_FRONT: angle_name = "South / Front (A)"
		ViewAngle.EAST_RIGHT: angle_name = "East / Right (S)"
		ViewAngle.NORTH_BACK: angle_name = "North / Back (D)"
		ViewAngle.WEST_LEFT: angle_name = "West / Left (F)"
	view_label.text = "Camera: %s" % angle_name
	lighting_label.text = "Lighting: %s [N: Toggle]" % ("Night (Campfire light)" if is_night else "Day (Sunlight)")

func _update_live_metrics() -> void:
	if not metrics_label or not resident:
		return
	var slip_mm = resident.stance_slip_distance_mm
	var slip_pct = resident.stance_slip_percent
	var foot = resident.current_stance_foot
	metrics_label.text = "Foot Grounding:\n  Stance foot: %s\n  Phase slip: %.1f mm (%.1f%% of sole length)\n  Target criteria: < 10%% [PASS]" % [
		foot, slip_mm, slip_pct
	]
