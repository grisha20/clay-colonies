class_name AdviceFeed
extends PanelContainer

## «Праматерь говорит»: advice of the tribe mother (colony.advice from
## server/src/sim/advisor.ts), like the advisor in Stronghold. Each line says
## what needs the player; "где" moves the camera to the place. A new line
## flashes once. The server decides when advice appears and goes away.

signal show_requested(pos: Vector2)

const SEVERITY_COLORS = {"danger": Color(0.72, 0.18, 0.12), "warn": Color(0.78, 0.48, 0.10), "info": Color(0.32, 0.42, 0.30)}

var rows: VBoxContainer
var signature := ""
var known_keys: Dictionary = {}
var first_update := true
var last_new: Array[String] = []


func _ready() -> void:
	name = "AdviceFeed"
	add_theme_stylebox_override("panel", GameHud.panel_style())
	theme = GameHud.ink_theme()
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_force_pass_scroll_events = false
	custom_minimum_size = Vector2(360, 0)
	visible = false
	var box = VBoxContainer.new()
	add_child(box)
	var title = Label.new()
	title.text = "Праматерь говорит"
	title.add_theme_font_size_override("font_size", 18)
	box.add_child(title)
	rows = VBoxContainer.new()
	rows.add_theme_constant_override("separation", 4)
	box.add_child(rows)


func update_from_snapshot(snapshot: Dictionary, player: int) -> void:
	var colonies = snapshot.get("colonies", [])
	if typeof(colonies) != TYPE_ARRAY or player >= colonies.size():
		return
	var advice = colonies[player].get("colony", {}).get("advice", [])
	if typeof(advice) != TYPE_ARRAY:
		advice = []
	var sig = JSON.stringify(advice)
	if sig == signature:
		return
	signature = sig
	last_new.clear()
	var keys: Dictionary = {}
	for c in rows.get_children():
		c.queue_free()
	for a in advice:
		if typeof(a) != TYPE_DICTIONARY:
			continue
		var key = str(a.get("key", ""))
		keys[key] = true
		var row = _row(a)
		rows.add_child(row)
		if not first_update and not known_keys.has(key):
			last_new.append(key)
			_flash(row)
	known_keys = keys
	first_update = false
	visible = rows.get_child_count() > 0


func _row(a: Dictionary) -> Control:
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var dot = ColorRect.new()
	dot.color = SEVERITY_COLORS.get(str(a.get("severity", "info")), SEVERITY_COLORS.info)
	dot.custom_minimum_size = Vector2(8, 22)
	row.add_child(dot)
	var text = Label.new()
	text.text = str(a.get("text", ""))
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.custom_minimum_size = Vector2(250, 0)
	text.add_theme_font_size_override("font_size", 15)
	row.add_child(text)
	var pos = a.get("pos")
	if typeof(pos) == TYPE_DICTIONARY:
		var where = Button.new()
		where.text = "где"
		where.focus_mode = Control.FOCUS_NONE
		var p = Vector2(float(pos.get("x", 0.0)), float(pos.get("y", 0.0)))
		where.pressed.connect(func(): show_requested.emit(p))
		row.add_child(where)
	return row


func _flash(row: Control) -> void:
	row.modulate = Color(1.6, 1.3, 0.9)
	var tween = row.create_tween()
	tween.tween_property(row, "modulate", Color.WHITE, 1.6).set_trans(Tween.TRANS_SINE)
