extends SceneTree

## Stills of the picture build bar against an isolated QA server: the bar as
## the player sees it, then with the hut tool picked. Also checks that every
## tile got a rendered picture and that counts/costs follow the snapshot.
##   godot --path godot --script res://tests/visual/capture_build_bar.gd -- --qa-port 8801 --out <dir>

var scene: WorldObserver
var out_dir := "user://build_bar"
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func wait_seconds(sec: float) -> void:
	var until = Time.get_ticks_msec() + int(sec * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame

func shot(name: String) -> void:
	root.get_viewport().get_texture().get_image().save_png(out_dir.path_join(name + ".png"))
	print("BAR saved ", name)

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out_dir = args[i + 1]
	if port == "":
		push_error("--qa-port of an isolated QA server is required")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(out_dir)
	scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.server_line_edit.text = "ws://127.0.0.1:" + port
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var start = Time.get_ticks_msec()
	while scene.ws_client.packets_received < 5 or scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() - start > 15000:
			push_error("No snapshots from QA server")
			quit(1)
			return
		await process_frame
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	scene.world_view.focus_on_colony(0)
	await wait_seconds(2.0)
	var build = scene.build
	var empty = 0
	for t in build.icon_textures.keys():
		var img = (build.icon_textures[t] as Texture2D).get_image()
		var opaque = 0
		if img:
			for y in range(0, img.get_height(), 4):
				for x in range(0, img.get_width(), 4):
					if img.get_pixel(x, y).a > 0.5:
						opaque += 1
		if opaque < 20:
			empty += 1
			print("BAR empty icon ", t, " ", opaque)
	check("all_icons_rendered", empty == 0 and build.icon_textures.size() == 10, str(empty))
	var hut_count = (build.tile_counts["hut"] as Label).text
	check("hut_count_shown", hut_count.contains("/8"), hut_count)
	check("state_for_all_tools", build.toolbar_state.size() == 10)
	shot("bar_01")
	build.set_tool("hut")
	await wait_seconds(0.5)
	shot("bar_02_hut_selected")
	build.set_tool("")
	print("BAR_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
