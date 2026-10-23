extends SceneTree

## Isolated QA capture. Display-only fixture fills HUD panels; world/commands/saves
## remain those of the explicitly supplied QA server. No settings are saved.
var scene: WorldObserver
var latest: Dictionary = {}
var out: String

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size(): port = args[i + 1]
	if not port.begins_with("88"):
		push_error("Explicit isolated QA --qa-port 88xx required")
		quit(2); return
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/hud_layout")
	DirAccess.make_dir_recursive_absolute(out)
	scene = load("res://scenes/game/world_observer.tscn").instantiate()
	root.add_child(scene)
	scene.ws_client.snapshot_received.connect(func(s): latest = s)
	scene.set_ui_scale(100, false)
	var deadline = Time.get_ticks_msec() + 20000
	while scene.entity_registry.residents.is_empty() or latest.is_empty():
		if Time.get_ticks_msec() > deadline: quit(2); return
		await process_frame
	scene.close_start_menu()
	scene.select_resident(null)
	await frames(30)
	# Freeze presentation only, after the real QA world has loaded.
	scene.ws_client.snapshot_received.disconnect(scene._on_snapshot_received)
	var fixture = latest.duplicate(true)
	fixture["tick"] = 36001
	fixture["session"] = {"speed": 1, "playerColonyIndex": 0}
	fixture["weather"] = {"state": "clear"}
	var colony = fixture.colonies[0].colony
	colony.merge({"clay":130,"specialClay":0,"food":593,"foodStock":{},"wood":78,"stone":80,"autoManage":false,
		"priorities":{"clay":1,"wood":8,"stone":0,"build":5,"guard":2,"fish":3,"hunt":0},
		"advice":[{"key":"huts","severity":"warn","text":"Нам тесно — построй ещё хижину","pos":{"x":100,"y":100}}]},true)
	fixture["ants"] = []
	for i in range(39): fixture.ants.append({"id":"visual-%d"%i,"colonyId":"colony-1","fired":i<31})
	fixture["objectives"] = [{"id":"settle","text":"Построить поселение","done":true},{"id":"ritual","text":"Завершить ритуал","done":true}]
	fixture["surface"] = {"buildings":[{"type":"kiln","stage":"built","colonyId":"colony-1"}],"resourceNodes":[],"fish":[],"animals":[]}
	scene.hud.update_from_snapshot(fixture,39)
	scene.hud.tasks_done = 12
	scene.hud.tasks_total = 12
	scene.hud._update_tasks_title()
	scene.priority_panel.update_from_snapshot(fixture,0)
	scene.build.update_from_snapshot(fixture,0)
	scene.build.buttons.hut.button_pressed = true
	scene.build._style_key("hut",true)
	scene.mother_speaker.update_from_snapshot(fixture,0)
	scene.mother_speaker.text_label.visible_ratio = 1
	scene.hud.show_toast("Ритуал Идола завершён","check",120)
	await frames(80)
	await RenderingServer.frame_post_draw
	var shot = root.get_viewport().get_texture().get_image()
	shot.save_png(out.path_join("target_ingame.png"))
	var rects: Dictionary = {}
	for node in [scene.hud,scene.priority_panel,scene.minimap,scene.mother_speaker,scene.build.toolbar]: collect_rects(node,rects)
	var file = FileAccess.open(out.path_join("target_rects.json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(rects,"\t")); file.close()
	var compared = await compare(shot)
	if compared: print("TARGET_CAPTURE_OK ",shot.get_size()," DISPLAY_FIXTURE_ONLY")
	scene.ws_client.disconnect_from_server(); scene.free()
	await process_frame
	# Custom cursor images are cached statically; release them while RS is alive.
	for shape in HudArt.CURSORS:
		Input.set_custom_mouse_cursor(null,shape)
	HudArt._cache.clear()
	await process_frame
	quit(0 if compared else 3)

func collect_rects(node: Node, rects: Dictionary) -> void:
	if node is Control and node.is_visible_in_tree():
		var r = node.get_global_rect()
		rects[str(node.get_path())] = [r.position.x,r.position.y,r.size.x,r.size.y]
	for child in node.get_children(): collect_rects(child,rects)

func compare(shot: Image) -> bool:
	var target = Image.load_from_file(ProjectSettings.globalize_path("res://../docs/godot/reference/hud_target.png"))
	target.convert(Image.FORMAT_RGBA8)
	target.resize(1920,1080,Image.INTERPOLATE_LANCZOS)
	var game = shot.duplicate()
	game.convert(Image.FORMAT_RGBA8)
	game.resize(1920,1080,Image.INTERPOLATE_LANCZOS)
	# Left always target, right always actual. Four corners and dock at 2x below.
	var board = Image.create(3840,2840,false,Image.FORMAT_RGBA8)
	board.fill(Color("e8dfcf"))
	board.blit_rect(target,Rect2i(0,0,1920,1080),Vector2i.ZERO)
	board.blit_rect(game,Rect2i(0,0,1920,1080),Vector2i(1920,0))
	var cuts = [Rect2i(0,0,390,230),Rect2i(1500,0,420,660),Rect2i(0,820,480,260),Rect2i(1390,690,530,390),Rect2i(450,835,1020,245)]
	var slots = [Rect2i(0,1080,1920,460),Rect2i(1920,1080,1920,1320),Rect2i(0,1540,1920,520),Rect2i(0,2060,1920,780),Rect2i(1920,2400,1920,440)]
	for i in range(cuts.size()):
		for side in range(2):
			var crop = (target if side==0 else game).get_region(cuts[i])
			var slot: Rect2i = slots[i]
			var scale_by = minf(960.0/crop.get_width(),float(slot.size.y)/crop.get_height())
			crop.resize(roundi(crop.get_width()*scale_by),roundi(crop.get_height()*scale_by),Image.INTERPOLATE_LANCZOS)
			board.blit_rect(crop,Rect2i(Vector2i.ZERO,crop.get_size()),slot.position+Vector2i(side*960,0))
	var pending = out.path_join("target_compare_pending.png")
	if board.save_png(pending) != OK: return false
	# Desktop image previews can briefly hold a Windows read handle on the old
	# PNG. Replace atomically once that handle is released.
	for attempt in range(50):
		if DirAccess.rename_absolute(pending,out.path_join("target_compare.png")) == OK: return true
		await create_timer(0.1).timeout
	push_error("Comparison PNG could not be saved")
	return false
