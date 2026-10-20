extends SceneTree

const Nav = preload("res://scripts/world/surface_navigation.gd")

func _initialize() -> void:
	call_deferred("audit")

func audit() -> void:
	# Wall ends are beyond the local search window, but a map-wide route exists.
	var walls: Array = []
	for y in range(196,226,2):
		walls.append({"id":"wall-"+str(y),"type":"wall","stage":"built","colonyId":"colony-1","pos":{"x":200,"y":y}})
	var from_p = Vector2(197,211)
	var goal = Vector2(205,211)
	var start = Time.get_ticks_usec()
	var route = Nav.surface_route(from_p,goal,"colony-1",walls,[])
	print("OC_LONG_WALL route=",route," elapsed_ms=",(Time.get_ticks_usec()-start)/1000.0)
	var all_open = true
	var previous=from_p
	for p in route:
		if not Nav.surface_line_open(previous,p,"colony-1",walls,[]):all_open=false
		previous=p
	print("OC_LONG_WALL every_segment_open=",all_open)
	var actor = NetworkResident.new()
	root.add_child(actor)
	actor.set_process(false)
	actor.anim_player.callback_mode_process=AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	actor.update_from_ant_data({"id":"audit","colonyId":"colony-1","pos":{"x":197,"y":211}},0.1,1,"playing",walls,[])
	actor.update_from_ant_data({"id":"audit","colonyId":"colony-1","pos":{"x":205,"y":211}},0.1,1,"playing",walls,[])
	actor._process(0.05)
	print("OC_LONG_WALL actor_midpoint=",actor.position," point_open=",Nav.surface_point_open(Vector2(actor.position.x,actor.position.z),"colony-1",walls,[]))
	actor.free()
	# There is no path out of a sealed enclosure: failure must not mean direct transit.
	var closed: Array = []
	for y in range(206,216,2):
		for x in [194,200]:
			closed.append({"id":"side-%s-%s"%[x,y],"type":"wall","stage":"built","colonyId":"colony-1","pos":{"x":x,"y":y}})
	for x in [196,198]:
		for y in [206,214]:
			closed.append({"id":"cap-%s-%s"%[x,y],"type":"wall","stage":"built","colonyId":"colony-1","pos":{"x":x,"y":y}})
	var failed_route=Nav.surface_route(Vector2(197,211),Vector2(205,211),"colony-1",closed,[])
	var failed_open=Nav.surface_line_open(Vector2(197,211),failed_route[-1],"colony-1",closed,[])
	print("OC_SEALED_ENCLOSURE returned_route=",failed_route," safe_to_last=",failed_open)
	var sealed=NetworkResident.new()
	root.add_child(sealed)
	sealed.set_process(false)
	sealed.update_from_ant_data({"id":"audit","colonyId":"colony-1","pos":{"x":197,"y":211}},0.1,1,"playing",closed,[])
	sealed.update_from_ant_data({"id":"audit","colonyId":"colony-1","pos":{"x":205,"y":211}},0.1,1,"playing",closed,[])
	sealed._process(0.05)
	print("OC_SEALED_ENCLOSURE actor_midpoint=",sealed.position," point_open=",Nav.surface_point_open(Vector2(sealed.position.x,sealed.position.z),"colony-1",closed,[]))
	sealed.free()
	# Delay after a 100ms packet: root must not revert to the old move/stop rhythm.
	var r=NetworkResident.new()
	root.add_child(r)
	r.set_process(false)
	r.anim_player.callback_mode_process=AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	r.update_from_ant_data({"id":"jitter","pos":{"x":10,"y":10}},0.1,1)
	r.update_from_ant_data({"id":"jitter","pos":{"x":10.1,"y":10}},0.1,1)
	var steps: Array = []
	for i in range(10):
		var old_x=r.position.x
		r._process(0.016)
		steps.append({"mm":snapped((r.position.x-old_x)*1000.0,0.001),"state":r.current_anim_state})
	print("OC_160MS_GAP steps=",JSON.stringify(steps))
	print("OC_MAP_BOUNDS negative_open=",Nav.surface_point_open(Vector2(-5,10),"colony-1",[],[]))
	r.free()
	await process_frame
	quit(0)
