extends SceneTree

const Geo = preload("res://scripts/world/building_geometry.gd")

func _initialize() -> void:
	call_deferred("audit")

func actor(from_p: Vector2, to_p: Vector2, buildings: Array = []) -> NetworkResident:
	var r = NetworkResident.new()
	root.add_child(r)
	r.set_process(false)
	r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	r.update_from_ant_data({"id":"audit","pos":{"x":from_p.x,"y":from_p.y}},0.1,1,"playing",buildings,[])
	r.update_from_ant_data({"id":"audit","pos":{"x":to_p.x,"y":to_p.y}},0.1,1,"playing",buildings,[])
	return r

func audit() -> void:
	# Empty world must not contain the building from a reviewer example.
	var empty = actor(Vector2(95,100.5),Vector2(105,100.5))
	empty._process(0.05)
	print("EA_EMPTY_WORLD has_waypoint=",empty.has_waypoint," midpoint=",empty.position)
	empty.free()
	# Check the ENTIRE generated route for an actual building at another location.
	var hut = {"id":"actual-hut","type":"hut","stage":"built","pos":{"x":200,"y":200}}
	var f = Geo.get_building_footprint(hut)
	var r = actor(Vector2(195,200.5),Vector2(205,200.5),[hut])
	var inside_count = 0
	for i in range(120):
		r._process(0.1/120.0)
		if Geo.inside_footprint(r.position.x,r.position.z,f):inside_count+=1
	print("EA_REAL_HUT_ROUTE inside_samples=",inside_count,"/120 waypoint=",r.intermediate_waypoint," target=",r.target_pos)
	r.free()
	# Last authoritative endpoint is safe; prediction must not enter a nearby solid.
	var predicted = actor(Vector2(190,200.5),Vector2(195.9,200.5),[hut])
	for i in range(11):predicted._process(0.016)
	print("EA_EXTRAPOLATION inside=",Geo.inside_footprint(predicted.position.x,predicted.position.z,f)," position=",predicted.position)
	predicted.free()
	# A wall is a real obstacle even though it is not a building ellipse.
	var wall={"id":"actual-wall","type":"wall","stage":"built","pos":{"x":200,"y":220},"colonyId":"colony-1"}
	var through_wall=actor(Vector2(197,221),Vector2(205,221),[wall])
	through_wall._process(0.05)
	print("EA_WALL_CHORD has_waypoint=",through_wall.has_waypoint," midpoint=",through_wall.position)
	through_wall.free()
	# Both shore endpoints are dry; the chord crosses the lake.
	var water=actor(Vector2(265,114),Vector2(262,111))
	water._process(0.05)
	print("EA_WATER_CHORD from_water=",SurfaceTerrain.is_water_at(265,114)," to_water=",SurfaceTerrain.is_water_at(262,111)," midpoint_water=",SurfaceTerrain.is_water_at(water.position.x,water.position.z)," midpoint=",water.position)
	water.free()
	# Prediction must reconcile a subsequent stop without reversing over old motion.
	var stop=actor(Vector2(10,10),Vector2(10.1,10))
	for i in range(10):stop._process(0.016)
	var predicted_x=stop.position.x
	stop.update_from_ant_data({"id":"audit","pos":{"x":10.1,"y":10}},0.1,1)
	stop._process(0.05)
	print("EA_STOP_RECONCILE predicted_x=",predicted_x," corrected_x=",stop.position.x," delta=",stop.position.x-predicted_x)
	stop.free()
	await process_frame
	quit(0)
