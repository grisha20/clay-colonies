extends SceneTree

## Day/night and weather: the dayCycle port, smooth transitions, rain effects
## and lights that answer the dark (hearths brighter and wider, hut doors glow).

var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(tick: int, weather: String) -> Dictionary:
	return {
		"tick": tick,
		"session": {"speed": 1, "status": "playing"},
		"weather": {"state": weather},
		"colonies": [{"colony": {"fire": 1.0}}, {"colony": {"fire": 1.0}}],
		"ants": [],
		"enemies": [],
		"surface": {
			"entrances": [{"x": 120, "y": 240}, {"x": 360, "y": 240}],
			"buildings": [{"id": "h1", "colonyId": "colony-1", "type": "hut", "stage": "built", "pos": {"x": 109, "y": 232}}],
			"resourceNodes": [], "foodSources": [], "carrion": [], "fish": [], "deposits": [],
		},
	}

func run() -> void:
	# shared/dayCycle.ts reference points.
	check("noon_is_light", Atmosphere.day_darkness(1000) == 0.0)
	check("dusk_ramps", is_equal_approx(Atmosphere.day_darkness(4050), 0.5))
	check("night_is_dark", Atmosphere.day_darkness(5000) == 1.0)
	check("dawn_ramps", is_equal_approx(Atmosphere.day_darkness(5850), 0.5))
	check("next_day_light", Atmosphere.day_darkness(6100) == 0.0)

	var view = WorldView.new()
	root.add_child(view)
	view.set_process(false)
	await process_frame
	var atmo = view.atmosphere

	# Connecting at noon in clear weather.
	view.update_world_entities(snap(1000, "clear"))
	view._animate_world(0.016)
	var day_sun = atmo.sun.light_energy
	var camp = view.active_campfires[0]
	var day_fire_range = (camp.get_node("FireLight") as OmniLight3D).omni_range
	check("day_sun_bright", day_sun > 1.2, "energy=%.2f" % day_sun)
	check("no_rain_by_day", not atmo.rain_particles.emitting)
	check("hut_door_dark_by_day", not view.hut_lights[0].visible)

	# Night arrives gradually (no jump on a single snapshot).
	view.update_world_entities(snap(5000, "clear"))
	view._animate_world(0.05)
	check("night_fades_in", atmo.darkness > 0.05 and atmo.darkness < 0.6, "darkness=%.2f" % atmo.darkness)
	for i in range(200):
		view._animate_world(0.05)
	check("night_reached", atmo.darkness > 0.95)
	check("moonlight_dim_not_black", atmo.sun.light_energy < 0.5 and atmo.sun.light_energy > 0.15, "energy=%.2f" % atmo.sun.light_energy)
	check("moonlight_is_blue", atmo.sun.light_color.b > atmo.sun.light_color.r)
	var night_light = camp.get_node("FireLight") as OmniLight3D
	check("hearth_wider_at_night", night_light.omni_range > day_fire_range + 4.0, "range %.1f -> %.1f" % [day_fire_range, night_light.omni_range])
	check("hut_door_glows_at_night", view.hut_lights[0].visible and view.hut_lights[0].light_energy > 0.9)

	# Rain rolls in slowly and soaks the world.
	view.update_world_entities(snap(5100, "rain"))
	view._animate_world(0.05)
	check("rain_starts_gradually", atmo.rain < 0.2)
	for i in range(300):
		view._animate_world(0.05)
	check("rain_falls", atmo.rain > 0.9 and atmo.rain_particles.emitting)
	check("ground_wet", float(view.ground_material.get_shader_parameter("wetness")) > 0.9)
	check("lake_rippled", float(view.water_material.get_shader_parameter("rain")) > 0.9)
	check("wind_stronger", float(view.ground_decor.grass_material.get_shader_parameter("wind_strength")) > 0.2)
	check("haze_in_rain", atmo.env.fog_enabled)
	var rain_pos = atmo.rain_particles.global_position
	check("rain_follows_camera", Vector2(rain_pos.x, rain_pos.z).distance_to(Vector2(view.camera_pivot.position.x, view.camera_pivot.position.z)) < view.camera_distance)

	# Clear again: rain stops, ground dries.
	view.update_world_entities(snap(5200, "clear"))
	for i in range(400):
		view._animate_world(0.05)
	check("rain_stops", atmo.rain < 0.05 and not atmo.rain_particles.emitting)

	# Joining a match that is already at night in the rain starts there.
	var view2 = WorldView.new()
	root.add_child(view2)
	view2.set_process(false)
	await process_frame
	view2.update_world_entities(snap(4900, "rain"))
	view2._animate_world(0.016)
	check("join_at_night_in_rain", view2.atmosphere.darkness > 0.95 and view2.atmosphere.rain > 0.95)

	view.queue_free()
	view2.queue_free()
	await process_frame
	print("ATMOSPHERE_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
