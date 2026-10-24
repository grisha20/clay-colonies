extends SceneTree

## Every capture requires an explicitly isolated QA port; no settings/saves changed.
var scene: WorldObserver
var phase := "stage1"
var output: String

func _initialize() -> void:
	call_deferred("run")

func frames(count: int) -> void:
	for i in range(count): await process_frame

func capture(label: String) -> void:
	await frames(15)
	await RenderingServer.frame_post_draw
	var path=output.path_join(label+".png")
	var result=root.get_texture().get_image().save_png(path)
	if result!=OK: push_error("Capture save failed: "+path); quit(3)
	print("POLISH_CAPTURE ",label)

func run() -> void:
	var port=""
	var args=OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i]=="--qa-port" and i+1<args.size():port=args[i+1]
		if args[i]=="--phase" and i+1<args.size():phase=args[i+1]
	if not port.begins_with("88"):push_error("QA 88xx required");quit(2);return
	output=ProjectSettings.globalize_path("res://../docs/godot/screenshots/hud_layout")
	scene=load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	scene.set_ui_scale(100,false)
	var deadline=Time.get_ticks_msec()+20000
	while scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec()>deadline:quit(2);return
		await process_frame
	scene.close_start_menu()
	scene.select_resident(null)
	await frames(30)
	if phase=="stage1":
		await capture("polish_stage1_bell")
		scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
		scene.hud.alarm_button.icon=HudArt.tex("glyph_alarm_on")
		scene.hud.alarm_button.button_pressed=true
		await capture("polish_stage1_bell_on")
	elif phase=="resident":
		var selected: NetworkResident=scene.entity_registry.residents.values()[0]
		scene.select_resident(selected)
		await frames(30)
		await capture("polish_stage2_resident")
		# Presentation-only water example, disconnected from subsequent snapshots.
		scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
		scene.set_process(false)
		var card=scene.insp_panel as ResidentCard
		var fixture={"ants":[{"id":selected.ant_id,"energy":540,"waterExposure":48}],"surface":{}}
		card.update_resident(selected,fixture,WorldObserver.resident_name(selected.ant_id),false)
		await capture("polish_stage2_resident_wet_example")
	elif phase=="menus":
		scene.settings_panel.visible=true
		await capture("polish_stage3_settings")
		scene.set_ui_scale(115,false)
		await capture("polish_stage3_settings_115")
		scene.set_ui_scale(100,false)
		scene.settings_panel.visible=false
		scene.open_pause_menu()
		await capture("polish_stage3_pause")
		scene.close_pause_menu()
		scene.open_start_menu()
		await capture("polish_stage3_start")
		scene.start_menu.saves_panel.visible=true
		await capture("polish_stage3_saves")
	elif phase=="map":
		await capture("polish_stage4_minimap")
		# Isolated presentation example: add an enemy and totem only to the map
		# snapshot, never to the server or the world's entity registry.
		scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
		scene.set_process(false)
		var terrain_before=scene.minimap.terrain_tex
		var example=scene.minimap.snapshot.duplicate(true)
		example["surface"]["buildings"].append({"type":"totem","pos":{"x":245,"y":250},"colonyId":"colony-1"})
		example["enemies"].append({"hp":10,"pos":{"x":280,"y":140}})
		scene.minimap.update_from_snapshot(example)
		await capture("polish_stage4_minimap_markers_example")
		if scene.minimap.terrain_tex!=terrain_before:
			push_error("Overlay update unexpectedly rebuilt terrain");quit(3);return
		print("PASS minimap marker overlay reuses terrain texture")
	scene.ws_client.disconnect_from_server()
	scene.free()
	await process_frame
	quit(0)
