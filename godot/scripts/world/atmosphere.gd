class_name Atmosphere
extends Node3D

## Time of day and weather for the 3D surface, driven by the server's tick and
## weather (shared/dayCycle.ts, server/src/sim/weather.ts). Visual only.
## Night: the sun fades into blue moonlight, campfires grow brighter and wider,
## hut doorways glow. Clouds dim the day; rain adds falling streaks around the
## camera, wet glossy ground with drop rings, lake ripples, stronger wind, haze.

# shared/dayCycle.ts
const DAY_TICKS := 6000
const NIGHT_START := 4200

const SUN_DAY := Color(1.0, 0.93, 0.80)
const SUN_DUSK := Color(1.0, 0.62, 0.38)
const MOON := Color(0.55, 0.66, 1.0)
const SKY_TOP_DAY := Color(0.45, 0.62, 0.82)
const SKY_TOP_NIGHT := Color(0.04, 0.06, 0.14)
const SKY_TOP_RAIN := Color(0.38, 0.42, 0.47)
const SKY_HORIZON_DAY := Color(0.80, 0.82, 0.78)
const SKY_HORIZON_NIGHT := Color(0.10, 0.12, 0.22)
const SKY_HORIZON_RAIN := Color(0.55, 0.57, 0.58)

var sun: DirectionalLight3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var ground_material: ShaderMaterial
var water_material: ShaderMaterial
var grass_material: ShaderMaterial
var follow: Node3D            # camera pivot: rain falls around it
var camera_distance_source: Callable

## Inputs from the latest snapshot.
var snapshot_tick: int = 0
var snapshot_time: float = 0.0
var sim_speed: float = 1.0
var weather_state: String = "clear"

## Smoothed outputs (0..1), read by WorldView for fire and hut lights.
var darkness: float = 0.0
var cloud: float = 0.0
var rain: float = 0.0
var rain_particles: GPUParticles3D
var _initialized: bool = false
var _streak: QuadMesh
var _streak_mat: StandardMaterial3D
var _streak_scale: float = 1.0
var _clock: float = 0.0


static func day_darkness(tick: float) -> float:
	var t = fposmod(tick, float(DAY_TICKS))
	if t < NIGHT_START - 300:
		return 0.0
	if t < NIGHT_START:
		return (t - NIGHT_START + 300.0) / 300.0
	if t < DAY_TICKS - 300:
		return 1.0
	return (DAY_TICKS - t) / 300.0


func _ready() -> void:
	name = "Atmosphere"
	_build_rain()


func _build_rain() -> void:
	rain_particles = GPUParticles3D.new()
	rain_particles.name = "Rain"
	rain_particles.amount = 6000
	rain_particles.lifetime = 1.0
	rain_particles.local_coords = false
	rain_particles.emitting = false
	rain_particles.visibility_aabb = AABB(Vector3(-80, -80, -80), Vector3(160, 160, 160))
	rain_particles.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var pm = ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(20, 0.5, 20)
	pm.direction = Vector3(0.12, -1, 0.05)
	pm.spread = 3.0
	pm.initial_velocity_min = 26.0
	pm.initial_velocity_max = 32.0
	pm.gravity = Vector3(0, -6, 0)
	rain_particles.process_material = pm
	var streak = QuadMesh.new()
	streak.size = Vector2(0.03, 0.75)
	_streak = streak
	var mat = StandardMaterial3D.new()
	_streak_mat = mat
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(0.78, 0.84, 0.92, 0.42)
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	mat.billboard_keep_scale = true
	streak.material = mat
	rain_particles.draw_pass_1 = streak
	add_child(rain_particles)


func on_snapshot(snapshot: Dictionary) -> void:
	snapshot_tick = int(snapshot.get("tick", 0))
	snapshot_time = _clock
	var session = snapshot.get("session", {})
	sim_speed = float(session.get("speed", 1.0)) if typeof(session) == TYPE_DICTIONARY else 1.0
	if typeof(session) == TYPE_DICTIONARY and str(session.get("status", "playing")) != "playing":
		sim_speed = 0.0
	var weather = snapshot.get("weather", {})
	weather_state = str(weather.get("state", "clear")) if typeof(weather) == TYPE_DICTIONARY else "clear"
	if not _initialized:
		# Connecting at night or in the rain: start there instead of fading in.
		_initialized = true
		darkness = day_darkness(snapshot_tick)
		cloud = 1.0 if weather_state != "clear" else 0.0
		rain = 1.0 if weather_state == "rain" else 0.0


## Ticks keep advancing between snapshots (10 per second at 1×) so dusk and
## dawn glide instead of stepping every 100 ms; never more than half a second ahead.
func estimated_tick() -> float:
	return float(snapshot_tick) + minf(_clock - snapshot_time, 0.5) * 10.0 * sim_speed


func advance(delta: float) -> void:
	_clock += delta
	var k_fast = 1.0 - exp(-3.0 * delta)
	var k_slow = 1.0 - exp(-0.6 * delta)
	darkness = lerpf(darkness, day_darkness(estimated_tick()), k_fast)
	cloud = lerpf(cloud, 1.0 if weather_state != "clear" else 0.0, k_slow)
	rain = lerpf(rain, 1.0 if weather_state == "rain" else 0.0, k_slow)
	_apply()


func _apply() -> void:
	var dusk = clampf(1.0 - absf(darkness - 0.5) * 2.0, 0.0, 1.0)
	if sun:
		var sun_col = SUN_DAY.lerp(SUN_DUSK, dusk * 0.8).lerp(MOON, smoothstep(0.5, 1.0, darkness))
		sun.light_color = sun_col
		# Moonlight keeps a readable night instead of a black screen.
		sun.light_energy = lerpf(1.35, 0.32, darkness) * lerpf(1.0, 0.55, cloud)
		sun.shadow_opacity = lerpf(1.0, 0.45, maxf(cloud, darkness * 0.6))
	if sky_mat:
		var top = SKY_TOP_DAY.lerp(SKY_TOP_RAIN, cloud).lerp(SKY_TOP_NIGHT, darkness)
		var horizon = SKY_HORIZON_DAY.lerp(SKY_HORIZON_RAIN, cloud).lerp(SKY_HORIZON_NIGHT, darkness)
		sky_mat.sky_top_color = top
		sky_mat.sky_horizon_color = horizon
		sky_mat.ground_horizon_color = Color(0.62, 0.66, 0.50).lerp(Color(0.12, 0.14, 0.2), darkness).lerp(Color(0.45, 0.48, 0.45), cloud * (1.0 - darkness))
		sky_mat.ground_bottom_color = Color(0.30, 0.38, 0.20).lerp(Color(0.05, 0.06, 0.1), darkness)
	if env:
		env.ambient_light_energy = lerpf(0.9, 0.55, darkness) * lerpf(1.0, 0.8, cloud)
		env.adjustment_saturation = lerpf(1.0, 0.72, maxf(darkness * 0.8, rain * 0.6))
		env.adjustment_brightness = lerpf(1.0, 0.92, cloud)
		env.fog_enabled = rain > 0.02
		env.fog_light_color = Color(0.55, 0.58, 0.62).lerp(Color(0.1, 0.12, 0.2), darkness)
		env.fog_density = 0.006 * rain
		env.fog_sky_affect = 0.3
	if ground_material:
		ground_material.set_shader_parameter("wetness", rain)
		ground_material.set_shader_parameter("rain_time", _clock)
	if water_material:
		water_material.set_shader_parameter("rain", rain)
	if grass_material:
		grass_material.set_shader_parameter("wind_strength", lerpf(0.12, 0.26, cloud))
		grass_material.set_shader_parameter("wind_speed", lerpf(1.3, 2.4, rain))
	if rain_particles:
		rain_particles.emitting = rain > 0.05
		rain_particles.amount_ratio = clampf(rain, 0.0, 1.0) * 0.6
		if follow:
			var d = 14.0
			if camera_distance_source.is_valid():
				d = float(camera_distance_source.call())
			var height = d * 0.9 + 8.0
			rain_particles.global_position = follow.global_position + Vector3(0, height, d * 0.35)
			var pm := rain_particles.process_material as ParticleProcessMaterial
			pm.emission_box_extents = Vector3(d * 1.1 + 6.0, 0.5, d * 0.9 + 6.0)
			# Far out a true-size streak is thinner than a pixel: widen drops with zoom.
			var want = clampf(pow(d / 14.0, 0.55), 1.0, 3.0)
			if absf(want - _streak_scale) > 0.1:
				_streak_scale = want
				_streak.size = Vector2(0.03 * want, 0.75 * sqrt(want))
			# Changing lifetime restarts the emitter: only follow big zoom changes.
			if absf(rain_particles.lifetime - height / 30.0) > 0.25:
				rain_particles.lifetime = height / 30.0
		if _streak_mat:
			# Slightly brighter than the night around it so rain still reads in the dark.
			_streak_mat.albedo_color = Color(0.80, 0.85, 0.92, 0.26).lerp(Color(0.55, 0.62, 0.78, 0.22), darkness)
