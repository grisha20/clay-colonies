extends SceneTree

## Review shots of the mother speaking over the map HUD: idle, then a new
## piece of advice typed out, then paging.
##   godot_console --path godot --script tests/visual/capture_mother_speaker.gd
var out: String

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n): await process_frame

func snap(advice: Array) -> Dictionary:
	return {"colonies": [{"colony": {"advice": advice}}]}

func shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().get_region(Rect2i(0, 0, 900, 260)).save_png(out.path_join(name + ".png"))
	print("MOTHER_CAPTURE ", name)

func run() -> void:
	out = ProjectSettings.globalize_path("res://../docs/godot/screenshots/mother_speaker")
	DirAccess.make_dir_recursive_absolute(out)
	var bg = ColorRect.new()
	bg.color = Color(0.42, 0.58, 0.3)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(bg)
	var m = MotherSpeaker.new()
	root.add_child(m)
	m.position = Vector2(40, 30)
	m.update_from_snapshot(snap([]), 0)
	await frames(10)
	await shot("mother_idle")
	m.update_from_snapshot(snap([{"key": "huts", "severity": "warn", "text": "Хижин мало — жители спят под открытым небом", "pos": {"x": 100, "y": 100}}]), 0)
	await frames(5)
	m.update_from_snapshot(snap([
		{"key": "huts", "severity": "warn", "text": "Хижин мало — жители спят под открытым небом", "pos": {"x": 100, "y": 100}},
		{"key": "spider", "severity": "danger", "text": "Паук у костра! Стража и свободные — к Праматери", "pos": {"x": 120, "y": 120}}]), 0)
	await frames(12)
	await shot("mother_talking")
	await frames(90)
	await shot("mother_said")
	m._page(1)
	await frames(5)
	await shot("mother_paged")
	quit(0)
