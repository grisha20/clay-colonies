extends SceneTree

## Same frozen QA snapshot and camera before/after, plus 48 huts to stress the
## asset rather than server timing. No commands or saves; logs go to tmp/qa.
func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var args = OS.get_cmdline_user_args()
	var port = ""
	var label = "baseline"
	var mix = "huts"
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
		if args[i] == "--label" and i + 1 < args.size(): label = args[i + 1]
		if args[i] == "--mix" and i + 1 < args.size(): mix = args[i + 1]
	if not port.begins_with("88"):
		push_error("Explicit isolated QA 88xx required"); quit(2); return
	var path = "res://../tmp/qa/buildings_v2_measure_snapshot.json"
	if mix!="huts":path="res://../tmp/qa/buildings_v2_"+mix+"_measure_snapshot.json"
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	scene.set_ui_scale(100, false)
	var until = Time.get_ticks_msec() + 20000
	while scene.world_view.last_snapshot.is_empty():
		if Time.get_ticks_msec() > until: quit(2); return
		await process_frame
	var snapshot: Dictionary
	if label == "baseline":
		snapshot = scene.world_view.last_snapshot.duplicate(true)
		var camp = snapshot.surface.entrances[0]
		snapshot.surface.buildings = []
		var columns=8 if mix=="huts" else 6
		for y in range(6):
			for x in range(columns):
				var type="hut" if mix=="huts" else ["hut","storage","workshop"][x%3]
				snapshot.surface.buildings.append({"id":"bench-%d-%d" % [x,y], "type":type, "level":2 if mix!="huts" and type=="hut" else 1,"stage":"built", "colonyId":"colony-1", "hp":100,"pos":{"x":float(camp.x)+(x-(columns-1)*.5)*9,"y":float(camp.y)+(y-2.5)*6}})
		var file = FileAccess.open(path, FileAccess.WRITE)
		file.store_string(JSON.stringify(snapshot)); file.close()
	else:
		snapshot = JSON.parse_string(FileAccess.get_file_as_string(path))
	scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
	scene.ws_client.disconnect_from_server()
	scene._on_snapshot_received(snapshot)
	scene.close_start_menu()
	scene.world_view.focus_on_colony(0)
	scene.world_view.target_camera_distance = 52
	scene.world_view.camera_distance = 52
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	for i in range(240):
		Engine.max_fps = 0
		await process_frame
	var deltas: Array[float] = []
	var last = Time.get_ticks_usec()
	var start = Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < 15000:
		Engine.max_fps = 0
		await process_frame
		var now = Time.get_ticks_usec()
		deltas.append(float(now - last) / 1000.0); last = now
	var average = 0.0
	for d in deltas: average += d
	average /= deltas.size()
	deltas.sort()
	print("BUILDINGS_PERF label=%s mix=%s buildings=%d resolution=%s avg_ms=%.3f p50_ms=%.3f p95_ms=%.3f frames=%d render=%s" % [label,mix,snapshot.surface.buildings.size(),root.size,average,deltas[deltas.size()/2],deltas[int(deltas.size()*.95)],deltas.size(),RenderingServer.get_current_rendering_method()])
	scene.free()
	await process_frame
	quit()
