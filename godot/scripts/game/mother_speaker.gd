class_name MotherSpeaker
extends Control

## The tribe mother above the map: a live 3D portrait of the same clay figure
## that molds residents at the hearth, and a speech bubble with her advice
## (colony.advice from server/src/sim/advisor.ts). A new piece of advice is
## spoken — typed out while her mouth moves and her head nods; "где" moves the
## camera there, arrows page through what she has said.
##
## Voice: when res://audio/mother/<advice key>.ogg (or .wav/.mp3) exists, it is
## played as she speaks; `spoke` is emitted either way for other listeners.

signal show_requested(pos: Vector2)
signal spoke(key: String, text: String)

const SEVERITY_BORDER = {"danger": Color(0.72, 0.18, 0.12), "warn": Color(0.78, 0.48, 0.10), "info": Color(0.55, 0.38, 0.22)}
## Portrait diameter; set before adding to the tree (the bottom dock uses a bigger one).
var portrait_size := 132
## Perched on the minimap (2D reference layout): no round frame, the figure is
## shown to the waist with her arms on the map's edge, and the speech bubble
## has a tail pointing at her mouth. Set before adding to the tree.
var perched := false
const PERCH_SIZE := Vector2(200, 190)
var tail: Control
const TYPE_CHARS_PER_SEC := 55.0
const VOICE_DIR := "res://audio/mother/"

var portrait_frame: PanelContainer
var viewport: SubViewport
var head_pivot: Node3D
var mouth: MeshInstance3D
var bubble: PanelContainer
var bubble_style: StyleBoxFlat
var painted_bubble: StyleBoxTexture
var severity_icon: TextureRect
var mother_icon: Texture2D
const SEVERITY_DOT = {"danger": "ui_dot_red", "warn": "ui_dot_yellow", "info": "ui_dot_green"}
var name_label: Label
var text_label: Label
var where_button: Button
var prev_button: Button
var next_button: Button
var count_label: Label
var voice: AudioStreamPlayer
var row: HBoxContainer

var advice: Array = []
var index := 0
var spoken_keys: Dictionary = {}
var first_update := true
var signature := ""
var talk_left := 0.0
var nod_phase := 0.0
var time := 0.0


func _ready() -> void:
	name = "MotherSpeaker"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	row.alignment = BoxContainer.ALIGNMENT_END
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.minimum_size_changed.connect(update_minimum_size)
	add_child(row)
	if perched:
		row.alignment = BoxContainer.ALIGNMENT_END
		_build_bubble(row)
		tail = BubbleTail.new()
		tail.custom_minimum_size = Vector2(20, 0)
		tail.size_flags_vertical = Control.SIZE_FILL
		row.add_child(tail)
		_build_portrait(row)
		bubble.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	else:
		_build_portrait(row)
		_build_bubble(row)
	voice = AudioStreamPlayer.new()
	voice.name = "MotherVoice"
	add_child(voice)
	_show_current()


## Sized by what is shown (the portrait may live in the bottom dock instead).
func _get_minimum_size() -> Vector2:
	return row.get_combined_minimum_size() if row else Vector2.ZERO


func _build_portrait(parent: Control) -> void:
	portrait_frame = PanelContainer.new()
	portrait_frame.name = "Portrait"
	var sb = GameHud.panel_style(Color(0.86, 0.72, 0.52, 0.96))
	sb.set_corner_radius_all(portrait_size / 2 + 6)
	sb.set_border_width_all(3)
	sb.content_margin_left = 4; sb.content_margin_right = 4; sb.content_margin_top = 4; sb.content_margin_bottom = 4
	portrait_frame.add_theme_stylebox_override("panel", StyleBoxEmpty.new() if perched else sb)
	if not perched:
		# Clip the square 3D view to the round frame.
		portrait_frame.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
	portrait_frame.mouse_filter = Control.MOUSE_FILTER_STOP
	portrait_frame.tooltip_text = "Праматерь — подсказывает, чего не хватает племени"
	parent.add_child(portrait_frame)
	var container = SubViewportContainer.new()
	container.stretch = true
	var view_size = PERCH_SIZE if perched else Vector2(portrait_size, portrait_size)
	container.custom_minimum_size = view_size
	container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	portrait_frame.add_child(container)
	viewport = SubViewport.new()
	viewport.own_world_3d = true
	viewport.transparent_bg = true
	viewport.size = Vector2i(view_size)
	viewport.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE
	container.add_child(viewport)
	var env = WorldEnvironment.new()
	var e = Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.85, 0.78, 0.7)
	e.ambient_light_energy = 0.7
	env.environment = e
	viewport.add_child(env)
	var sun = DirectionalLight3D.new()
	sun.rotation = Vector3(deg_to_rad(-35), deg_to_rad(25), 0)
	sun.light_energy = 1.3
	viewport.add_child(sun)
	var fire = OmniLight3D.new()
	fire.position = Vector3(0.6, 1.4, 1.2)
	fire.light_color = Color(1.0, 0.62, 0.3)
	fire.light_energy = 0.8
	fire.omni_range = 4.0
	viewport.add_child(fire)
	head_pivot = Node3D.new()
	head_pivot.position = Vector3(0, 1.7, 0)
	viewport.add_child(head_pivot)
	var body = MeshInstance3D.new()
	body.mesh = PropFactory.mother(Color(0.80, 0.50, 0.33), Color(0.95, 0.78, 0.28))
	body.position = Vector3(0, -1.7, 0)
	head_pivot.add_child(body)
	# The world figure has no mouth: the portrait gets one that opens as she speaks.
	mouth = MeshInstance3D.new()
	var m = SphereMesh.new()
	m.radius = 0.09
	m.height = 0.1
	var mm = StandardMaterial3D.new()
	mm.albedo_color = Color(0.25, 0.09, 0.07)
	mm.roughness = 0.6
	m.material = mm
	mouth.mesh = m
	mouth.position = Vector3(0, 1.9 - 1.7, 0.4)
	mouth.scale = Vector3(1.3, 0.25, 0.5)
	head_pivot.add_child(mouth)
	var cam = Camera3D.new()
	cam.fov = 30.0
	cam.position = Vector3(0, 2.12, 2.35)
	if perched:
		# To the waist: her forward-reaching arms rest on the bottom edge.
		cam.fov = 30.0
		cam.position = Vector3(0, 2.3, 3.1)
	viewport.add_child(cam)
	cam.look_at(Vector3(0, 1.95 if perched else 1.98, 0), Vector3.UP)


func _build_bubble(parent: Control) -> void:
	bubble = PanelContainer.new()
	bubble.name = "SpeechBubble"
	bubble_style = GameHud.panel_style(Color(0.98, 0.94, 0.84, 0.97))
	bubble_style.set_corner_radius_all(14)
	bubble_style.corner_radius_top_left = 4
	bubble_style.content_margin_left = 14
	bubble_style.content_margin_right = 12
	painted_bubble = _painted_bubble()
	bubble.add_theme_stylebox_override("panel", painted_bubble if painted_bubble else bubble_style)
	bubble.theme = GameHud.ink_theme()
	bubble.mouse_filter = Control.MOUSE_FILTER_STOP
	bubble.mouse_force_pass_scroll_events = false
	bubble.custom_minimum_size = Vector2(380, 0)
	bubble.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	parent.add_child(bubble)
	var box = VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	bubble.add_child(box)
	var head = HBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	box.add_child(head)
	severity_icon = GameHud.icon_rect(null, 18)
	severity_icon.visible = painted_bubble != null
	# The mock-up shows her little head by the name; without it, a severity dot.
	mother_icon = HudArt.tex("icon_mother")
	head.add_child(severity_icon)
	name_label = Label.new()
	name_label.text = "Праматерь"
	name_label.add_theme_font_size_override("font_size", 15)
	GameHud.bold(name_label)
	name_label.add_theme_color_override("font_color", GameHud.INK.lightened(0.25))
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(name_label)
	prev_button = _small_button("‹", func(): _page(-1))
	head.add_child(prev_button)
	count_label = Label.new()
	count_label.add_theme_font_size_override("font_size", 13)
	head.add_child(count_label)
	next_button = _small_button("›", func(): _page(1))
	head.add_child(next_button)
	var line = HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	box.add_child(line)
	text_label = Label.new()
	text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text_label.custom_minimum_size = Vector2(300, 0)
	text_label.add_theme_font_size_override("font_size", 17)
	line.add_child(text_label)
	where_button = _small_button("где", func(): _show_where())
	where_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	where_button.tooltip_text = "Показать, где это"
	_pin_style(where_button)
	line.add_child(where_button)


func _small_button(text: String, action: Callable) -> Button:
	var b = Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(action)
	return b


func update_from_snapshot(snapshot: Dictionary, player: int) -> void:
	var colonies = snapshot.get("colonies", [])
	if typeof(colonies) != TYPE_ARRAY or player >= colonies.size():
		return
	var list = colonies[player].get("colony", {}).get("advice", [])
	if typeof(list) != TYPE_ARRAY:
		list = []
	var sig = JSON.stringify(list)
	if sig == signature:
		return
	signature = sig
	var current_key = str(advice[index].get("key", "")) if index < advice.size() else ""
	advice = list.filter(func(a): return typeof(a) == TYPE_DICTIONARY)
	# Speak the newest unspoken line; otherwise stay on what was shown.
	var fresh = -1
	var keys: Dictionary = {}
	for i in range(advice.size()):
		var key = str(advice[i].get("key", ""))
		keys[key] = true
		if not spoken_keys.has(key) and fresh < 0:
			fresh = i
	for key in spoken_keys.keys():
		if not keys.has(key):
			spoken_keys.erase(key)
	if fresh >= 0:
		index = fresh
		for key in keys.keys():
			if first_update:
				spoken_keys[key] = true
		spoken_keys[str(advice[fresh].get("key", ""))] = true
		_show_current()
		if not first_update:
			_speak(advice[fresh])
	else:
		index = 0
		for i in range(advice.size()):
			if str(advice[i].get("key", "")) == current_key:
				index = i
		_show_current()
	first_update = false


func _page(step: int) -> void:
	if advice.is_empty():
		return
	index = posmod(index + step, advice.size())
	_show_current()
	text_label.visible_ratio = 1.0


func _show_current() -> void:
	var has = not advice.is_empty()
	bubble.visible = has
	if tail:
		tail.visible = has and painted_bubble == null
	modulate.a = 1.0 if has else 0.75
	if not has:
		return
	var a: Dictionary = advice[index]
	text_label.text = str(a.get("text", ""))
	bubble_style.border_color = SEVERITY_BORDER.get(str(a.get("severity", "info")), SEVERITY_BORDER.info)
	if severity_icon.visible:
		severity_icon.texture = mother_icon if mother_icon else HudArt.tex(SEVERITY_DOT.get(str(a.get("severity", "info")), "ui_dot_green"))
	if tail:
		(tail as BubbleTail).border = bubble_style.border_color
		# The painted bubble has its own tail.
		tail.visible = painted_bubble == null
		tail.queue_redraw()
	where_button.visible = typeof(a.get("pos")) == TYPE_DICTIONARY
	var many = advice.size() > 1
	prev_button.visible = many
	next_button.visible = many
	count_label.visible = many
	count_label.text = "%d/%d" % [index + 1, advice.size()]


func _show_where() -> void:
	if index >= advice.size():
		return
	var pos = advice[index].get("pos")
	if typeof(pos) == TYPE_DICTIONARY:
		show_requested.emit(Vector2(float(pos.get("x", 0.0)), float(pos.get("y", 0.0))))


## Type the line out, move the mouth and nod; play a recorded line if there is one.
func _speak(a: Dictionary) -> void:
	var text = str(a.get("text", ""))
	text_label.visible_ratio = 0.0
	talk_left = maxf(0.6, text.length() / TYPE_CHARS_PER_SEC)
	nod_phase = 0.0
	var key = str(a.get("key", ""))
	var stream = voice_stream(key)
	if stream:
		voice.stream = stream
		voice.play()
	spoke.emit(key, text)


static func voice_stream(key: String) -> AudioStream:
	var base = key.split(":")[0]
	for k in [key, base]:
		for ext in ["ogg", "wav", "mp3"]:
			var path = "%s%s.%s" % [VOICE_DIR, k, ext]
			if ResourceLoader.exists(path):
				return load(path) as AudioStream
	return null


## The bubble's tail: a little triangle from the bubble to her mouth.
class BubbleTail extends Control:
	var border := Color(0.55, 0.38, 0.22)
	func _draw() -> void:
		# From the bubble's side (its middle) down to her mouth.
		var y = 46.0
		var pts = PackedVector2Array([Vector2(-3, y - 11), Vector2(size.x + 2, y + 50), Vector2(-3, y + 11)])
		draw_colored_polygon(pts, Color(0.98, 0.94, 0.84, 0.97))
		draw_polyline(PackedVector2Array([pts[0], pts[1], pts[2]]), border, 2.0)


func _process(delta: float) -> void:
	time += delta
	if not head_pivot:
		return
	var talking = talk_left > 0.0
	if talking:
		talk_left -= delta
		nod_phase += delta
		text_label.visible_ratio = minf(1.0, text_label.visible_ratio + delta * TYPE_CHARS_PER_SEC / maxf(1.0, text_label.text.length()))
	# Breathing when silent; a nodding, swaying head while she talks.
	var nod = sin(nod_phase * 7.0) * 0.07 if talking else 0.0
	head_pivot.rotation = Vector3(nod + sin(time * 1.1) * 0.015, sin(time * 0.5) * 0.08 + (sin(nod_phase * 3.0) * 0.08 if talking else 0.0), 0)
	var open = (0.35 + 0.65 * absf(sin(time * 14.0))) if talking else 0.25
	mouth.scale = Vector3(1.3, open, 0.5)


## Painted speech bubble (art/hud mother_bubble), mirrored so its tail points
## right and down, to her mouth; null keeps the flat bubble and drawn tail.
static func _painted_bubble() -> StyleBoxTexture:
	var t = HudArt.tex("mother_bubble")
	if t == null:
		return null
	var img = t.get_image()
	img.flip_x()
	var s: Array = HudArt.meta().get("slice", {}).get("mother_bubble", [96, 32, 64, 48])
	var sb = StyleBoxTexture.new()
	sb.texture = ImageTexture.create_from_image(img)
	sb.texture_margin_left = s[2]
	sb.texture_margin_top = s[1]
	sb.texture_margin_right = s[0]
	sb.texture_margin_bottom = s[3]
	sb.content_margin_left = 18
	sb.content_margin_top = 12
	sb.content_margin_right = 18
	sb.content_margin_bottom = 34
	return sb


## «Где» as the mock-up's round orange pin button (art/hud btn_pin_*), or an
## orange pill with the word when the pictures are missing.
static func _pin_style(b: Button) -> void:
	var normal = HudArt.box("btn_pin_normal", [0, 0, 0, 0])
	if normal:
		b.text = ""
		b.custom_minimum_size = Vector2(34, 34)
		b.add_theme_stylebox_override("normal", normal)
		b.add_theme_stylebox_override("hover", HudArt.box("btn_pin_hover", [0, 0, 0, 0]))
		b.add_theme_stylebox_override("pressed", HudArt.box("btn_pin_pressed", [0, 0, 0, 0]))
		b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		return
	for state in ["normal", "hover", "pressed"]:
		var sb = StyleBoxFlat.new()
		sb.bg_color = Color(0.93, 0.52, 0.16).lightened(0.1 if state == "hover" else 0.0).darkened(0.1 if state == "pressed" else 0.0)
		sb.set_corner_radius_all(14)
		sb.content_margin_left = 10
		sb.content_margin_right = 10
		sb.content_margin_top = 3
		sb.content_margin_bottom = 3
		b.add_theme_stylebox_override(state, sb)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	for state in ["font_color", "font_hover_color", "font_pressed_color"]:
		b.add_theme_color_override(state, Color.WHITE)
