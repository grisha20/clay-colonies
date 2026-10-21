extends SceneTree

## Close-ups of residents at work and carrying, from an isolated QA server.
## Waits until it has seen each kind of work (or a timeout), frames the
## resident and saves a PNG per kind plus a carrier and a tribe comparison.
##   godot --path godot --script res://tests/visual/capture_work_closeups.gd -- --server-port 8794 --out <dir> [--seconds 90]

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var port = ""
	var out = "user://work"
	var seconds = 90.0
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out = args[i + 1]
		elif args[i] == "--seconds" and i + 1 < args.size():
			seconds = float(args[i + 1])
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	while scene.entity_registry.residents.is_empty():
		await process_frame
	scene.ws_client.send_command({"type": "setSpeed", "value": 5})
	var wanted = {"chop": false, "mine": false, "dig": false, "build": false, "carry": false}
	for i in range(args.size()):
		if args[i] == "--only" and i + 1 < args.size():
			for k in wanted.keys():
				wanted[k] = k != args[i + 1]
	var wv = scene.world_view
	var until = Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until and wanted.values().has(false):
		await process_frame
		for r in scene.entity_registry.residents.values():
			var kind = ""
			if r.carrying_amount > 0 and r.carry_kind != "" and not wanted.carry:
				kind = "carry"
			elif not r.work.is_empty() and wanted.has(r.work.kind) and not wanted[r.work.kind] and r.current_anim_state == NetworkResident.AnimState.WORK_GATHER:
				kind = r.work.kind
			if kind == "":
				continue
			wanted[kind] = true
			scene.ws_client.send_command({"type": "setSpeed", "value": 1})
			wv.focus_on_resident(r)
			wv.target_camera_distance = 4.5
			wv.camera_distance = 4.5
			for f in range(45):
				await process_frame
			root.get_viewport().get_texture().get_image().save_png(out.path_join("work_%s.png" % kind))
			print("WORK shot ", kind, " carry_kind=", r.carry_kind, " colony=", r.colony_id)
			scene.ws_client.send_command({"type": "setSpeed", "value": 5})
			break
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	print("WORK seen ", wanted)
	scene.ws_client.disconnect_from_server()
	await process_frame
	quit(0)
