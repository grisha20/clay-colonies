extends SceneTree

## Find a lawful layout for a dedicated disposable QA fixture. Only writes
## the plan below tmp/qa; no commands are sent to the connected QA server.
func _initialize() -> void:call_deferred("run")
func run() -> void:
	var args=OS.get_cmdline_user_args();var port=""
	for i in range(args.size()):
		if args[i]=="--qa-port" and i+1<args.size():port=args[i+1]
	if not port.begins_with("88"):push_error("Isolated QA required");quit(2);return
	var scene=load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	var until=Time.get_ticks_msec()+20000
	while scene.world_view.last_snapshot.is_empty():
		if Time.get_ticks_msec()>until:quit(2);return
		await process_frame
	var surface=scene.world_view.last_snapshot.surface.duplicate(true)
	scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
	var camp=Vector2(float(surface.entrances[0].x),float(surface.entrances[0].y))
	surface.buildings=surface.buildings.filter(func(b):return b.colonyId!="colony-1")
	var plan=[]
	for spec in [["hut",1,Vector2(-11,-8)],["hut",2,Vector2(11,-8)],["storage",1,Vector2(-11,9)],
		["workshop",1,Vector2(11,9)],["kiln",1,Vector2(0,12)],["idol",1,Vector2(-7,-17)],["totem",1,Vector2(7,-17)]]:
		var selected=Vector2.INF
		for ring in range(9):
			for k in range(1 if ring==0 else 16):
				var p=camp+spec[2]+Vector2.from_angle(TAU*k/16)*ring
				if BuildRules.point_building_placement(surface,"colony-1",spec[0],p)=="":selected=p;break
			if selected!=Vector2.INF:break
		if selected==Vector2.INF:push_error("No lawful slot for "+spec[0]);quit(3);return
		var b={"id":"review-%d" % plan.size(),"type":spec[0],"level":spec[1],"stage":"built","colonyId":"colony-1","pos":{"x":selected.x,"y":selected.y},"hp":150,"maxHp":150,"progress":1}
		surface.buildings.append(b);plan.append(b)
		print("LAWFUL_SLOT ",JSON.stringify(b))
	var path=ProjectSettings.globalize_path("res://../tmp/qa/buildings_v2_settlement_plan.json")
	var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(JSON.stringify(plan));file.close()
	scene.ws_client.disconnect_from_server();scene.free();await process_frame;quit()
