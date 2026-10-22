class_name NetworkResident
extends Node3D

const BuildingGeometry = preload("res://scripts/world/building_geometry.gd")
const SurfaceNavigation = preload("res://scripts/world/surface_navigation.gd")
const SnapshotTimeline = preload("res://scripts/world/snapshot_timeline.gd")

## Visual 3D actor representing a Clayfolk resident driven by network snapshots.
## Manages skeletal animation, step frequency tied to ground distance,
## smooth position/rotation interpolation, colony material modulation,
## and bone-socket cargo attachment.

signal selected(resident: NetworkResident)

const SELECTION_LAYER: int = 1 << 2

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
var was_stalled_pending_rebase: bool = false
var is_sim_paused: bool = false

# Bounded Snapshot Timeline with display delay
var timeline = SnapshotTimeline.new()

# Obstacle avoidance waypoints and full route polyline
var has_waypoint: bool = false
var intermediate_waypoint: Vector3 = Vector3.ZERO
var route_points: Array[Vector2] = []
var prev_pos_2d: Vector2 = Vector2.ZERO

# Visual nodes
var model_instance: Node3D
## Resident v3 (Hunyuan, approved by the owner 22.10.2026) is the default;
## --resident-legacy loads the previous procedural model. Per-instance override
## lets review scenes display both together.
var use_resident_v3: bool = not "--resident-legacy" in OS.get_cmdline_user_args()
var anim_player: AnimationPlayer
var skeleton: Skeleton3D
var mesh_instance: MeshInstance3D
var bone_attachment_cargo: BoneAttachment3D
var cargo_prop: Node3D
var cargo_load: MeshInstance3D
var cargo_load_kind: String = "-"
var tool_prop: MeshInstance3D
var tool_kind: String = ""
## Current visible work from EntityRegistry.work_for ({} = none).
var work: Dictionary = {}
var colony_color_applied: String = ""
## Kiln-fired: darker, redder, glazed clay (server Ant.fired).
var fired: bool = false
## Initiated warrior (server Ant.warrior).
var warrior: bool = false
var kiln_called: bool = false
const FIRED_TINT := Color(0.50, 0.21, 0.12)
var chips: CPUParticles3D
var chips_kind: String = ""
const CHIP_COLORS = {
	"chop": Color(0.70, 0.52, 0.30),
	"mine": Color(0.62, 0.61, 0.58),
	"dig": Color(0.72, 0.38, 0.24),
	"build": Color(0.80, 0.68, 0.48),
}
var current_anim_state: AnimState = AnimState.IDLE
var selection_ring: MeshInstance3D

var is_first_update: bool = true

# Color palette by colony
# Both tribes are clay; they differ by clay tone and the colour of their cord belt.
const COLONY_COLORS = {
	"colony-1": Color(0.90, 0.56, 0.36, 1.0), # Light terracotta
	"colony-2": Color(0.62, 0.32, 0.24, 1.0), # Dark red-brown clay
	"default": Color(0.80, 0.55, 0.40, 1.0)
}
const COLONY_CORDS = {
	"colony-1": Color(0.95, 0.78, 0.28, 1.0), # Ochre yellow
	"colony-2": Color(0.24, 0.55, 0.80, 1.0), # River blue
	"default": Color(0.82, 0.76, 0.57, 1.0)
}

func _init(candidate_v3: int = -1) -> void:
	if candidate_v3 >= 0:
		use_resident_v3 = candidate_v3 == 1
	_setup_visuals()
	_setup_selection()

func _setup_selection() -> void:
	# Query-only area: picking cannot push residents or replace server navigation.
	var area = Area3D.new()
	area.name = "ResidentPickArea"
	area.collision_layer = SELECTION_LAYER
	area.collision_mask = 0
	area.monitoring = false
	area.input_ray_pickable = false
	var collider = CollisionShape3D.new()
	var shape = CapsuleShape3D.new()
	shape.radius = 0.32
	shape.height = 1.1
	collider.shape = shape
	collider.position.y = 0.55
	area.add_child(collider)
	add_child(area)

	selection_ring = MeshInstance3D.new()
	selection_ring.name = "SelectionRing"
	var ring = TorusMesh.new()
	ring.inner_radius = 0.38
	ring.outer_radius = 0.44
	ring.rings = 24
	ring.ring_segments = 8
	selection_ring.mesh = ring
	selection_ring.position.y = 0.04
	selection_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material = StandardMaterial3D.new()
	material.albedo_color = Color(1.0, 0.88, 0.35)
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	selection_ring.material_override = material
	selection_ring.visible = false
	add_child(selection_ring)

func set_selected(value: bool) -> void:
	selection_ring.visible = value

func _ready() -> void:
	if not model_instance:
		_setup_visuals()

func _setup_visuals() -> void:
	# Load resident GLB model
	var resident_scene = load("res://assets/models/resident_v3.glb" if use_resident_v3 else "res://assets/models/resident.glb") as PackedScene
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

## v3: a woven basket against the back, below the overhanging head, its top
## leaning in like the back does (0.30 m deep at the waist, 0.20 m at the
## shoulders); rope straps over the shoulders. Model space (Godot): back is -Z.
const BASKET_CENTER := Vector3(0.0, 0.70, -0.39)
const BASKET_TILT := 0.16

func _setup_cargo_prop() -> void:
	if use_resident_v3 and skeleton.find_bone("Spine") >= 0:
		_setup_back_basket()
	else:
		_setup_head_cargo()
	var tool_bone_idx = skeleton.find_bone("Socket_Tool_R")
	if tool_bone_idx >= 0:
		var tool_attachment = BoneAttachment3D.new()
		tool_attachment.name = "ToolAttachment"
		tool_attachment.bone_name = "Socket_Tool_R"
		skeleton.add_child(tool_attachment)
		tool_prop = MeshInstance3D.new()
		tool_prop.name = "Tool"
		tool_prop.visible = false
		tool_attachment.add_child(tool_prop)

func _setup_back_basket() -> void:
	var spine = skeleton.find_bone("Spine")
	bone_attachment_cargo = BoneAttachment3D.new()
	bone_attachment_cargo.name = "CargoAttachment"
	bone_attachment_cargo.bone_name = "Spine"
	skeleton.add_child(bone_attachment_cargo)
	# Undo the bone's rest frame so the basket stands upright in model space.
	var rest_inv = skeleton.get_bone_global_rest(spine).affine_inverse()
	var basket = Node3D.new()
	basket.name = "Basket"
	basket.transform = rest_inv * Transform3D(Basis(Vector3.RIGHT, BASKET_TILT), BASKET_CENTER)
	bone_attachment_cargo.add_child(basket)
	var weave = MeshInstance3D.new()
	weave.name = "Weave"
	weave.mesh = PropFactory.back_basket()
	basket.add_child(weave)
	var straps = MeshInstance3D.new()
	straps.name = "Straps"
	straps.mesh = PropFactory.basket_straps()
	straps.transform = rest_inv
	bone_attachment_cargo.add_child(straps)
	cargo_prop = Node3D.new()
	cargo_prop.name = "CargoProp"
	basket.add_child(cargo_prop)
	cargo_prop.visible = false
	cargo_load = MeshInstance3D.new()
	cargo_load.name = "Load"
	cargo_load.position = Vector3(0, PropFactory.BASKET_HEIGHT * 0.5, 0)
	cargo_prop.add_child(cargo_load)
	_refresh_cargo_load()

func _setup_head_cargo() -> void:
	# Legacy model: loads ride on the head; the camera looks down from the south,
	# so anything held at the chest vanishes behind the round body.
	var cargo_bone_idx = skeleton.find_bone("Socket_Head")
	if cargo_bone_idx < 0:
		cargo_bone_idx = skeleton.find_bone("Socket_Cargo")
	if cargo_bone_idx >= 0:
		bone_attachment_cargo = BoneAttachment3D.new()
		bone_attachment_cargo.name = "CargoAttachment"
		bone_attachment_cargo.bone_name = skeleton.get_bone_name(cargo_bone_idx)
		skeleton.add_child(bone_attachment_cargo)

		# The load mesh follows what is carried (logs, stone, clay, berries, fish, meat).
		cargo_prop = Node3D.new()
		cargo_prop.name = "CargoProp"
		bone_attachment_cargo.add_child(cargo_prop)
		cargo_prop.visible = false
		cargo_load = MeshInstance3D.new()
		cargo_load.name = "Load"
		# Seated on top of the head, a bit larger than life for the far camera.
		var rest = skeleton.get_bone_global_rest(cargo_bone_idx)
		cargo_load.basis = rest.basis.inverse().scaled(Vector3.ONE * 1.3)
		cargo_load.position = (rest.basis.inverse() * Vector3.UP) * 0.12
		cargo_prop.add_child(cargo_load)
		_refresh_cargo_load()
	else:
		push_warning("[NetworkResident] Socket_Cargo bone not found in Skeleton3D")

func _refresh_cargo_load() -> void:
	var kind = carry_kind
	if kind == "fruit" or kind == "":
		kind = "food"
	if not cargo_load or kind == cargo_load_kind:
		return
	cargo_load_kind = kind
	if not use_resident_v3:
		cargo_load.mesh = PropFactory.carry_load(kind)
	elif kind == "wood":
		cargo_load.mesh = PropFactory.basket_firewood()
		cargo_load.transform = Transform3D(Basis(), Vector3(0, PropFactory.BASKET_HEIGHT * 0.5, 0))
	else:
		# Heaped over the rim, larger than life for the far camera.
		cargo_load.mesh = PropFactory.carry_load(kind)
		cargo_load.transform = Transform3D(Basis().scaled(Vector3.ONE * 1.35), Vector3(0, PropFactory.BASKET_HEIGHT * 0.5 + 0.07, 0))

## Visible work from EntityRegistry.work_for: pose, facing and tool.
func set_work(w: Dictionary) -> void:
	work = w

func _apply_colony_color() -> void:
	var key = "%s:%s" % [colony_id, fired]
	if not mesh_instance or colony_color_applied == key:
		return
	colony_color_applied = key
	var body: Color = COLONY_COLORS.get(colony_id, COLONY_COLORS["default"])
	if fired:
		body = body.lerp(FIRED_TINT, 0.5)
	_tint_surface(0, body, 0.42 if fired else -1.0)
	if mesh_instance.mesh and mesh_instance.mesh.get_surface_count() > 2:
		_tint_surface(2, COLONY_CORDS.get(colony_id, COLONY_CORDS["default"]))

func _tint_surface(index: int, col: Color, roughness: float = -1.0) -> void:
	var mat = mesh_instance.mesh.surface_get_material(index)
	if mat and mat is StandardMaterial3D:
		var custom_mat = mat.duplicate() as StandardMaterial3D
		if use_resident_v3:
			# Source texture already contains tribe A's clay/ochre. A stays at
			# unity; other tribes use a relative tint, preserving baked detail.
			var reference: Color = COLONY_COLORS["colony-1"] if index == 0 else COLONY_CORDS["colony-1"]
			col = Color(col.r / reference.r, col.g / reference.g, col.b / reference.b)
		custom_mat.albedo_color = col
		if roughness >= 0.0:
			custom_mat.roughness = roughness
		mesh_instance.set_surface_override_material(index, custom_mat)

func update_from_ant_data(data: Dictionary, tick_interval_sec: float, speed_scale: float, sim_status: String = "playing", buildings: Array = [], entrances: Array = []) -> void:
	ant_id = data.get("id", ant_id)
	var new_colony = data.get("colonyId", colony_id)
	if new_colony != colony_id:
		colony_id = new_colony
	fired = bool(data.get("fired", false))
	kiln_called = str(data.get("kilnId", "")) != ""
	# Also on the first update: the registry sets colony_id before spawning.
	_apply_colony_color()

	role = data.get("role", "worker")
	job_name = data.get("job", "")
	warrior = bool(data.get("warrior", false))
	# Hunters and warriors are the strong ones of the tribe: a head taller.
	var big = 1.15 if (job_name == "hunt" or warrior) and use_resident_v3 else 1.0
	if model_instance and not is_equal_approx(model_instance.scale.x, big):
		model_instance.scale = Vector3.ONE * big
	state_name = data.get("state", "idle")
	var raw_carrying = data.get("carrying", 0)
	if typeof(raw_carrying) in [TYPE_INT, TYPE_FLOAT]:
		carrying_amount = int(raw_carrying)
	elif typeof(raw_carrying) == TYPE_DICTIONARY:
		carrying_amount = int(raw_carrying.get("amount", 0))
	carry_kind = str(data.get("carryKind", ""))
	if carry_kind.is_empty() and typeof(raw_carrying) == TYPE_DICTIONARY:
		carry_kind = str(raw_carrying.get("resource", ""))

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

	timeline.colony_id = colony_id

	if is_sim_paused:
		_update_movement_and_animation(0.0)
		return

	# If initial placement, extreme teleport (>50m), stall recovery, or speed/status change, rebase directly.
	var max_legit_travel: float = maxf(12.0, 3.0 * speed_scale * maxf(0.05, tick_interval_sec))
	# Horizontal distance: the node rides the hills, server positions are flat.
	var is_extreme_teleport = (Vector2(position.x, position.z).distance_to(Vector2(new_target.x, new_target.z)) > max_legit_travel)
	var was_stalled = is_network_stalled or was_stalled_pending_rebase
	var is_speed_or_status_changed = false
	if timeline.is_initialized and not timeline.samples.is_empty():
		var prev_sample = timeline.samples[-1]
		if absf(prev_sample.sim_speed - speed_scale) > 0.001 or prev_sample.sim_status != sim_status:
			is_speed_or_status_changed = true

	if is_first_update or is_extreme_teleport or was_stalled or is_speed_or_status_changed:
		is_first_update = false
		is_network_stalled = false
		was_stalled_pending_rebase = false
		timeline.reset(new_target)
		timeline.push_sample(data, tick_interval_sec, speed_scale, sim_status, buildings, entrances)
		_apply_timeline_rebase()
		return

	var did_rebase = timeline.push_sample(data, tick_interval_sec, speed_scale, sim_status, buildings, entrances)
	if did_rebase:
		_apply_timeline_rebase()
		return

	if not timeline.samples.is_empty():
		var latest = timeline.samples[-1]
		target_pos = latest.pos
		route_points = latest.route_points
		if route_points.size() > 1:
			has_waypoint = true
			intermediate_waypoint = Vector3(route_points[0].x, 0.0, route_points[0].y)
		else:
			has_waypoint = false
			intermediate_waypoint = Vector3.ZERO

	is_network_stalled = false
	was_stalled_pending_rebase = false

func _apply_timeline_rebase() -> void:
	# Authoritative correction at snapshot receipt, never a rendered movement step.
	position = _on_ground(timeline.current_pos)
	current_pos = timeline.current_pos
	prev_pos = current_pos
	target_pos = current_pos
	prev_pos_2d = Vector2(position.x, position.z)
	route_points = [prev_pos_2d] as Array[Vector2]
	has_waypoint = false
	intermediate_waypoint = Vector3.ZERO
	current_heading = timeline.current_heading
	if not timeline.samples.is_empty():
		var sample = timeline.samples[0]
		state_name = sample.state_name
		carrying_amount = sample.carrying_amount
		carry_kind = sample.carrying_resource
	_update_movement_and_animation(0.0)

## Timeline positions live on the flat server plane; the model stands on the
## visual ground height (hills). Legacy maps are flat, so this is a no-op there.
func _on_ground(flat: Vector3) -> Vector3:
	return Vector3(flat.x, SurfaceTerrain.height_at(flat.x, flat.z), flat.z)

func _process(delta: float) -> void:
	if is_network_stalled or is_sim_paused:
		_update_movement_and_animation(0.0)
		return

	var sample_res = timeline.advance_and_sample(delta, is_sim_paused, is_network_stalled)
	current_pos = sample_res["position"]
	position = _on_ground(current_pos)
	var ground_speed = sample_res["ground_speed"]
	current_heading = sample_res["heading"]
	state_name = sample_res["state_name"]
	carrying_amount = sample_res["carrying_amount"]
	carry_kind = sample_res.get("carry_kind", carry_kind)

	# Face movement direction; while working the resident faces its target instead.
	var working_here = not work.is_empty() and carrying_amount <= 0 and ground_speed < 0.05
	if current_heading.length_squared() > 0.001 and not working_here:
		rotation.y = atan2(current_heading.x, current_heading.z)

	_update_movement_and_animation(ground_speed)

func _update_movement_and_animation(ground_speed: float) -> void:
	var is_carrying = (carrying_amount > 0)
	if cargo_prop:
		cargo_prop.visible = is_carrying
		if is_carrying:
			_refresh_cargo_load()
	var working = not is_carrying and not work.is_empty() and ground_speed < 0.05
	_update_tool(working)
	_update_chips(working and not is_sim_paused and not is_network_stalled)

	if is_sim_paused or is_network_stalled:
		# FREEZE the active animation clip in place without changing animation state.
		# Switching clips to IDLE during pause or stall abruptly alters bone positions
		# (e.g. Foot.R jumping 65mm). Freezing speed_scale = 0 keeps the exact pose intact.
		if anim_player:
			anim_player.speed_scale = 0.0
		return

	var target_state = AnimState.IDLE
	if working:
		target_state = AnimState.WORK_GATHER if _work_clip() != "idle" else AnimState.IDLE
		# Face the tree, rock, pit, site or fishing spot being worked.
		var to = work.target - Vector3(position.x, 0.0, position.z)
		to.y = 0.0
		if to.length_squared() > 0.0004:
			rotation.y = lerp_angle(rotation.y, atan2(to.x, to.z), 0.35)
	elif ground_speed < 0.05:
		target_state = AnimState.CARRY_IDLE if is_carrying else AnimState.IDLE
	else:
		target_state = AnimState.CARRY_WALK if is_carrying else AnimState.WALK

	if current_anim_state != target_state or (target_state == AnimState.WORK_GATHER and anim_player and anim_player.current_animation != _work_clip()):
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

## Little bits flying from the worked spot: wood chips, rock grit, clay, dust.
func _update_chips(working: bool) -> void:
	var kind = str(work.get("kind", "")) if working else ""
	if kind == "fish" or kind == "gather":
		kind = ""
	if kind == "":
		if chips:
			chips.emitting = false
		return
	if not chips:
		chips = CPUParticles3D.new()
		chips.name = "WorkChips"
		chips.top_level = true
		chips.amount = 10
		chips.lifetime = 0.7
		chips.explosiveness = 0.15
		chips.direction = Vector3(0, 1, 0)
		chips.spread = 55.0
		chips.initial_velocity_min = 1.4
		chips.initial_velocity_max = 2.6
		chips.gravity = Vector3(0, -7.0, 0)
		chips.scale_amount_min = 0.5
		chips.scale_amount_max = 1.0
		var quad = BoxMesh.new()
		quad.size = Vector3(0.07, 0.05, 0.06)
		chips.mesh = quad
		var mat = StandardMaterial3D.new()
		mat.vertex_color_use_as_albedo = true
		mat.vertex_color_is_srgb = true
		mat.roughness = 0.9
		chips.material_override = mat
		add_child(chips)
	if kind != chips_kind:
		chips_kind = kind
		chips.color = CHIP_COLORS.get(kind, Color.WHITE)
	var target: Vector3 = work.target
	var height = 0.9 if kind == "chop" else 0.35
	chips.global_position = Vector3(target.x, SurfaceTerrain.height_at(target.x, target.z) + height, target.z).lerp(Vector3(position.x, position.y + height, position.z), 0.35)
	chips.emitting = true

func _update_tool(working: bool) -> void:
	if not tool_prop:
		return
	var kind = str(work.get("kind", "")) if working else ""
	if kind == "dig" or kind == "gather":
		kind = ""  # Clay, sticks and pebbles are taken with bare hands.
	# A hunter keeps the spear in hand while stalking, not only when throwing.
	if kind == "" and job_name == "hunt" and carrying_amount <= 0:
		kind = "hunt"
	if kind != tool_kind:
		tool_kind = kind
		tool_prop.mesh = PropFactory.tool(kind) if kind != "" else null
	tool_prop.visible = kind != ""

## One clip per job when the model has it (v3: work_chop, work_mine, work_build,
## work_dig, work_gather, work_fish); the legacy model swings work_gather for
## everything and just stands while fishing.
func _work_clip() -> String:
	var kind = str(work.get("kind", ""))
	if kind == "hunt":
		kind = "chop"  # the spear throw reuses the overhead swing
	if anim_player and anim_player.has_animation("work_" + kind):
		return "work_" + kind
	return "idle" if kind == "fish" else "work_gather"

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
		# Loads ride on the head, so carriers keep the free-arm clips; the
		# chest-hold carry clips would show hands clutching nothing.
		AnimState.CARRY_IDLE:
			clip_name = "idle"
		AnimState.CARRY_WALK:
			clip_name = "walk"
		AnimState.WORK_GATHER:
			clip_name = _work_clip()

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
	was_stalled_pending_rebase = true
	_update_movement_and_animation(0.0)

func on_network_resumed() -> void:
	is_network_stalled = false
