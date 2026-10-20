class_name SnapshotTimeline
extends RefCounted

## Bounded Snapshot Timeline with display delay for network interpolation.
## Stores chronological server snapshots, decouples arrival time from render cursor,
## and samples continuous position along precomputed safe polylines.

class Sample:
	var server_time: float = 0.0
	var tick: int = -1
	var pos: Vector3 = Vector3.ZERO
	var pos_2d: Vector2 = Vector2.ZERO
	var heading: Vector3 = Vector3.FORWARD
	var state_name: String = "idle"
	var carrying_amount: int = 0
	var carrying_resource: String = ""
	var route_points: Array[Vector2] = []
	var sim_speed: float = 1.0
	var sim_status: String = "playing"

var samples: Array[Sample] = []
const MAX_SAMPLES: int = 48
var target_delay: float = 0.100 # Nominal 100ms display delay (1 server broadcast period)
var render_time: float = 0.0
var current_pos: Vector3 = Vector3.ZERO
var current_heading: Vector3 = Vector3.FORWARD
var is_initialized: bool = false
var colony_id: String = ""

func reset(pos: Vector3) -> void:
	samples.clear()
	current_pos = pos
	current_heading = Vector3.FORWARD
	render_time = 0.0
	is_initialized = false

func push_sample(data: Dictionary, tick_interval_sec: float, speed_scale: float = 1.0, sim_status: String = "playing", buildings: Array = [], entrances: Array = []) -> void:
	var pos_dict = data.get("pos", {})
	var target_2d = Vector2(float(pos_dict.get("x", 0.0)), float(pos_dict.get("y", 0.0)))
	var target_3d = Vector3(target_2d.x, 0.0, target_2d.y)
	var tick = int(data.get("tick", -1))
	var st_name = str(data.get("state", "idle"))
	var raw_carrying = data.get("carrying", 0)
	var c_amt: int = 0
	if typeof(raw_carrying) in [TYPE_INT, TYPE_FLOAT]:
		c_amt = int(raw_carrying)
	elif typeof(raw_carrying) == TYPE_DICTIONARY:
		c_amt = int(raw_carrying.get("amount", 0))

	var c_res: String = ""
	if data.has("carryKind"):
		c_res = str(data.get("carryKind", ""))
	elif typeof(raw_carrying) == TYPE_DICTIONARY and raw_carrying.has("resource"):
		c_res = str(raw_carrying.get("resource", ""))

	var head_dict = data.get("heading", {})
	var head_vec = Vector3.FORWARD
	if typeof(head_dict) == TYPE_DICTIONARY and head_dict.has("x") and head_dict.has("y"):
		var hx = float(head_dict.get("x", 0.0))
		var hy = float(head_dict.get("y", 1.0))
		if Vector2(hx, hy).length_squared() > 0.001:
			head_vec = Vector3(hx, 0.0, hy).normalized()

	# 1. First sample initialization
	if not is_initialized or samples.is_empty():
		var s0 = Sample.new()
		s0.server_time = 0.0
		s0.tick = tick
		s0.pos = target_3d
		s0.pos_2d = target_2d
		s0.heading = head_vec
		s0.state_name = st_name
		s0.carrying_amount = c_amt
		s0.carrying_resource = c_res
		s0.route_points = [target_2d] as Array[Vector2]
		s0.sim_speed = speed_scale
		s0.sim_status = sim_status
		samples.append(s0)
		current_pos = target_3d
		current_heading = head_vec
		render_time = 0.0
		is_initialized = true
		return

	var prev = samples[-1]

	# 2. Discontinuity detection: tick regression, extreme tick gap (>100 ticks), extreme teleport (>50m), speed change, or status change
	var is_tick_regression = (tick >= 0 and prev.tick >= 0 and tick < prev.tick)
	var is_extreme_tick_gap = (tick >= 0 and prev.tick >= 0 and (tick - prev.tick) > 100)
	var is_extreme_teleport = target_3d.distance_to(prev.pos) > 50.0
	var is_speed_change = (absf(prev.sim_speed - speed_scale) > 0.001)
	var is_status_change = (prev.sim_status != sim_status)
	if is_tick_regression or is_extreme_tick_gap or is_extreme_teleport or is_speed_change or is_status_change:
		samples.clear()
		var s_reset = Sample.new()
		s_reset.server_time = 0.0
		s_reset.tick = tick
		s_reset.pos = target_3d
		s_reset.pos_2d = target_2d
		s_reset.heading = head_vec
		s_reset.state_name = st_name
		s_reset.carrying_amount = c_amt
		s_reset.carrying_resource = c_res
		s_reset.route_points = [target_2d] as Array[Vector2]
		s_reset.sim_speed = speed_scale
		s_reset.sim_status = sim_status
		samples.append(s_reset)
		current_pos = target_3d
		current_heading = head_vec
		render_time = 0.0
		return

	# 3. Calculate simulation time delta between previous sample and this sample
	var step_time = 0.100 / maxf(0.001, speed_scale)
	var dt = step_time
	if tick >= 0 and prev.tick >= 0 and tick > prev.tick:
		var td = tick - prev.tick
		dt = float(td) * step_time
	elif tick_interval_sec > 0.0:
		dt = tick_interval_sec

	var s_new = Sample.new()
	s_new.server_time = prev.server_time + dt
	s_new.tick = tick
	s_new.heading = head_vec
	s_new.state_name = st_name
	s_new.carrying_amount = c_amt
	s_new.carrying_resource = c_res
	s_new.sim_speed = speed_scale
	s_new.sim_status = sim_status

	# 4. Safe route generation along precomputed polyline
	var from_2d = Vector2(prev.pos.x, prev.pos.z)
	var route = SurfaceNavigation.surface_route(from_2d, target_2d, colony_id, buildings, entrances)
	if route.is_empty():
		# Safe route failure: hold at safe position!
		s_new.pos = prev.pos
		s_new.pos_2d = from_2d
		s_new.route_points = [from_2d] as Array[Vector2]
	else:
		s_new.pos = Vector3(route[-1].x, 0.0, route[-1].y)
		s_new.pos_2d = route[-1]
		s_new.route_points = route

	samples.append(s_new)

	# Bounded memory: keep at most MAX_SAMPLES
	if samples.size() > MAX_SAMPLES:
		var prune_count = samples.size() - MAX_SAMPLES
		samples = samples.slice(prune_count)

func advance_and_sample(delta: float, is_sim_paused: bool, is_network_stalled: bool) -> Dictionary:
	var res = {
		"position": current_pos,
		"ground_speed": 0.0,
		"step_dist": 0.0,
		"heading": current_heading,
		"state_name": "idle",
		"carrying_amount": 0,
		"carry_kind": "",
		"is_stalled": false
	}

	if not samples.is_empty():
		var s_last = samples[-1]
		res["state_name"] = s_last.state_name
		res["carrying_amount"] = s_last.carrying_amount
		res["carry_kind"] = s_last.carrying_resource

	if is_sim_paused or is_network_stalled or samples.is_empty():
		res["is_stalled"] = true
		return res

	if samples.size() < 2:
		current_pos = samples[0].pos
		res["position"] = current_pos
		res["state_name"] = samples[0].state_name
		res["carrying_amount"] = samples[0].carrying_amount
		res["carry_kind"] = samples[0].carrying_resource
		return res

	var t_head = samples[-1].server_time
	var lag = t_head - render_time

	var rate = 1.0
	if samples.size() > 2 and lag > target_delay + 0.080:
		rate = 1.0 + minf(0.15, (lag - (target_delay + 0.080)) * 0.5)

	render_time += delta * rate
	render_time = minf(render_time, t_head)

	# Locate enclosing samples
	var i = 0
	while i < samples.size() - 2 and samples[i + 1].server_time < render_time:
		i += 1

	var A = samples[i]
	var B = samples[i + 1]
	var dur = maxf(0.0001, B.server_time - A.server_time)
	var alpha = clampf((render_time - A.server_time) / dur, 0.0, 1.0)

	# Interpolate along safe route
	var p2d = SurfaceNavigation.route_point(A.pos_2d, B.route_points, alpha)
	var new_pos = Vector3(p2d.x, 0.0, p2d.y)

	var step_dist = current_pos.distance_to(new_pos)
	var ground_speed = step_dist / delta if delta > 0.0001 else 0.0

	# Align heading with displacement or target heading
	var disp = new_pos - current_pos
	disp.y = 0.0
	if disp.length_squared() > 0.001:
		current_heading = current_heading.lerp(disp.normalized(), minf(1.0, delta * 14.0))
	elif B.heading.length_squared() > 0.01:
		current_heading = current_heading.lerp(B.heading, minf(1.0, delta * 8.0))

	current_pos = new_pos

	# Prune consumed samples
	if i > 1:
		samples = samples.slice(i)

	var active_sample = B if alpha >= 0.999 else A
	res["position"] = current_pos
	res["ground_speed"] = ground_speed
	res["step_dist"] = step_dist
	res["heading"] = current_heading
	res["state_name"] = active_sample.state_name
	res["carrying_amount"] = active_sample.carrying_amount
	res["carry_kind"] = active_sample.carrying_resource
	return res
