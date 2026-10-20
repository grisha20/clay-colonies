extends SceneTree

func _initialize() -> void:
	call_deferred("audit")

func ant_at(x: float, y: float) -> Dictionary:
	return {"id": "audit", "colonyId": "colony-1", "pos": {"x": x, "y": y}}

func snap(tick: int, x: float, y: float, status: String = "playing") -> Dictionary:
	return {"snapshotVersion":21,"protocolVersion":21,"tick":tick,"ants":[ant_at(x,y)],"colonies":[],"session":{"speed":1,"status":status},"surface":{"width":480,"height":480,"entrances":[],"buildings":[],"resourceNodes":[],"foodSources":[],"fish":[]},"enemies":[]}

func audit() -> void:
	var registry = EntityRegistry.new()
	root.add_child(registry)
	registry.set_process(false)
	registry.update_from_snapshot(snap(100,95,100.5))
	var r = registry.get_resident("audit")
	r.set_process(false)
	r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	registry.update_from_snapshot(snap(101,105,100.5))
	r._process(0.05)
	print("AUDIT_BUILDING_CHORD midpoint=",r.position," ellipse_inside=",pow((r.position.x-100)/4,2)+pow((r.position.z-100.5)/2.3,2)<1)
	registry.update_from_snapshot(snap(102,106,100.5,"defeat"))
	var before = r.position
	r._process(0.05)
	print("AUDIT_ENDED_SESSION root_movement_m=",before.distance_to(r.position)," paused=",r.is_sim_paused)
	var instance_id = r.get_instance_id()
	registry.update_from_snapshot(snap(0,107,100.5))
	print("AUDIT_TICK_REGRESSION same_actor=",instance_id==registry.get_resident("audit").get_instance_id()," position=",r.position," target=",r.target_pos," progress=",r.interp_progress)
	r.update_from_ant_data(ant_at(110,100.5),0.1,1)
	var zeros = 0
	for i in range(10):
		var p = r.position
		r._process(0.016)
		if p.distance_to(r.position)<0.0001:zeros+=1
	print("AUDIT_160MS_DELIVERY_GAP idle_frames=",zeros,"/10")
	var view = WorldView.new()
	root.add_child(view)
	view.set_process(false)
	var world = snap(1,100,100)
	world.surface.entrances=[{"x":120,"y":240}]
	world.surface.fish=[{"id":"fish-audit","pos":{"x":230,"y":140},"state":"swim"}]
	world.surface.buildings=[{"id":"wall-audit","type":"wall","stage":"built","pos":{"x":100,"y":100}}]
	view.update_world_entities(world)
	print("AUDIT_FISH input=1 markers=",view.active_world_nodes.size())
	var wall = view.active_buildings["wall-audit"] as MeshInstance3D
	print("AUDIT_WALL base_y=",wall.position.y-wall.mesh.get_aabb().size.y/2.0)
	world.surface.entrances=[]
	view.update_world_entities(world)
	print("AUDIT_CAMP_DESPAWN input=0 nodes=",view.active_campfires.size())
	var fraction = snap(1,100,100)
	fraction.protocolVersion=21.9
	print("AUDIT_FRACTIONAL_VERSION accepted=",WSClient.decode_and_validate_packet(JSON.stringify(fraction)).ok)
	var bad_surface = snap(1,100,100)
	bad_surface.surface=[]
	print("AUDIT_BAD_SURFACE accepted=",WSClient.decode_and_validate_packet(JSON.stringify(bad_surface)).ok)
	var bad_session = snap(1,100,100)
	bad_session.session=[]
	print("AUDIT_BAD_SESSION accepted=",WSClient.decode_and_validate_packet(JSON.stringify(bad_session)).ok)
	var nonfinite = snap(1,100,100)
	var raw=JSON.stringify(nonfinite).replace('"x":100.0','"x":1e309').replace('"x":100,','"x":1e309,')
	var parsed_nonfinite = JSON.parse_string(raw)
	print("AUDIT_INFINITE_POSITION input_is_inf=",is_inf(float(parsed_nonfinite.ants[0].pos.x))," accepted=",WSClient.decode_and_validate_packet(raw).ok)
	print("AUDIT_WATER_BOUNDARY godot=",SurfaceTerrain.is_water_at(284,140))
	view.free()
	registry.free()
	await process_frame
	quit(0)
