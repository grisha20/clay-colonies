class_name HudArt
extends RefCounted

## Painted HUD pictures from res://assets/ui (copied from art/hud by
## scripts/godot/sync_hud_art.py). Every getter returns null when a picture is
## missing, so callers keep their drawn-by-code fallback.

const DIR := "res://assets/ui/"

static var _cache: Dictionary = {}
static var _meta: Dictionary = {}


static func tex(name: String) -> Texture2D:
	if _cache.has(name):
		return _cache[name]
	var path = DIR + name + ".png"
	var t: Texture2D = load(path) as Texture2D if ResourceLoader.exists(path) else null
	_cache[name] = t
	return t


static func meta() -> Dictionary:
	if _meta.is_empty():
		var f = FileAccess.open(DIR + "ui_meta.json", FileAccess.READ)
		var parsed = JSON.parse_string(f.get_as_text()) if f else null
		_meta = parsed if typeof(parsed) == TYPE_DICTIONARY else {"slice": {}, "hotspot": {}}
	return _meta


## 9-slice box from a picture; `pad` is the content margin (L, T, R, B), by
## default the slice margins themselves.
static func box(name: String, pad: Variant = null) -> StyleBoxTexture:
	var t = tex(name)
	if t == null:
		return null
	var sb = StyleBoxTexture.new()
	sb.texture = t
	var s: Array = meta().get("slice", {}).get(name, [0, 0, 0, 0])
	sb.texture_margin_left = s[0]
	sb.texture_margin_top = s[1]
	sb.texture_margin_right = s[2]
	sb.texture_margin_bottom = s[3]
	var p: Array = pad if pad != null else s
	sb.content_margin_left = p[0]
	sb.content_margin_top = p[1]
	sb.content_margin_right = p[2]
	sb.content_margin_bottom = p[3]
	return sb


## Gives a button the four painted states of `family` (e.g. "btn_square",
## "ui_button_wide"). Returns false when the pictures are missing.
static func skin_button(b: BaseButton, family: String, pad: Variant = null) -> bool:
	var normal = box(family + "_normal", pad)
	if normal == null:
		return false
	var hover = box(family + "_hover", pad)
	var pressed = box(family + "_pressed", pad)
	var disabled = box(family + "_disabled", pad)
	b.add_theme_stylebox_override("normal", normal)
	b.add_theme_stylebox_override("hover", hover if hover else normal)
	b.add_theme_stylebox_override("pressed", pressed if pressed else normal)
	b.add_theme_stylebox_override("hover_pressed", pressed if pressed else normal)
	b.add_theme_stylebox_override("disabled", disabled if disabled else normal)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	return true


## Dark-ink text that stays readable on the parchment buttons.
static func ink_button_text(b: Button, ink: Color) -> void:
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(state, ink)
	b.add_theme_color_override("font_disabled_color", Color(ink, 0.45))


## A menu's primary/pending action uses the same orange as the HUD selection.
static func menu_action(b: Button, highlighted: bool) -> void:
	skin_button(b, "ui_button_wide", [18, 10, 18, 10])
	if highlighted:
		b.add_theme_stylebox_override("normal", box("ui_button_wide_pressed", [18, 10, 18, 10]))
		b.add_theme_stylebox_override("hover", box("ui_button_wide_pressed", [18, 10, 18, 10]))
	ink_button_text(b, GameHud.INK)


## Parchment address field; keyboard editing/focus behavior stays native.
static func skin_field(field: LineEdit) -> void:
	field.add_theme_stylebox_override("normal", box("ui_button_wide_normal", [14, 8, 14, 8]))
	var focus = StyleBoxFlat.new()
	focus.bg_color = Color.TRANSPARENT
	focus.border_color = Color("df8d38")
	focus.set_border_width_all(2)
	focus.set_corner_radius_all(10)
	field.add_theme_stylebox_override("focus", focus)
	field.add_theme_color_override("font_color", GameHud.INK)
	field.add_theme_color_override("caret_color", GameHud.INK)
	field.add_theme_color_override("selection_color", Color("ebbe83"))


## Square icon button: painted frame plus a glyph. Keeps the text as the
## fallback when the glyph is missing.
static func glyph_button(b: Button, glyph: String, size: int = 30) -> void:
	# The stretched icon fills the content height, so the margins set its size.
	var pad = maxi(6, int((b.custom_minimum_size.y - size) / 2.0))
	skin_button(b, "btn_square", [pad, pad, pad, pad])
	var g = tex(glyph)
	if g == null:
		return
	b.icon = g
	b.text = ""
	b.expand_icon = true
	b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b.add_theme_constant_override("icon_max_width", size)


## Mouse cursor shapes -> painted cursors; null keeps the system arrow.
const CURSORS = {
	Input.CURSOR_ARROW: "cursor_default",
	Input.CURSOR_POINTING_HAND: "cursor_hover",
	Input.CURSOR_FORBIDDEN: "cursor_forbid",
	Input.CURSOR_DRAG: "cursor_grab",
	Input.CURSOR_MOVE: "cursor_rotate",
	Input.CURSOR_BUSY: "cursor_wait",
	Input.CURSOR_WAIT: "cursor_wait",
	Input.CURSOR_CROSS: "cursor_build",
}

## Cursors are drawn at 64 px for 4K; the OS shows them at this size.
const CURSOR_SIZE := 40


static func install_cursors() -> void:
	if DisplayServer.get_name() == "headless":
		return
	for shape in CURSORS.keys():
		set_cursor(shape, CURSORS[shape])


## Free generated cursor textures before RenderingServer shuts down.
static func release_cursors() -> void:
	if DisplayServer.get_name() == "headless":
		return
	for shape in CURSORS:
		Input.set_custom_mouse_cursor(null, shape)
	for key in _cache.keys():
		if str(key).begins_with("_cursor_"):
			_cache.erase(key)


## Sets one cursor shape to a painted cursor (scaled to CURSOR_SIZE).
static func set_cursor(shape: int, name: String) -> void:
	if DisplayServer.get_name() == "headless":
		return
	var t = tex(name)
	if t == null:
		Input.set_custom_mouse_cursor(null, shape)
		return
	var key = "_cursor_" + name
	if not _cache.has(key):
		var img = t.get_image()
		var k = float(CURSOR_SIZE) / float(img.get_width())
		img.resize(CURSOR_SIZE, int(round(img.get_height() * k)), Image.INTERPOLATE_LANCZOS)
		var hs: Array = meta().get("hotspot", {}).get(name, [0, 0])
		_cache[key] = [ImageTexture.create_from_image(img), Vector2(round(hs[0] * k), round(hs[1] * k))]
	var c: Array = _cache[key]
	Input.set_custom_mouse_cursor(c[0], shape, c[1])
