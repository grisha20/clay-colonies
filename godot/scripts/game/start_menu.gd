class_name StartMenu
extends Control

## Start / pause menu over the live world: Continue, New game (random or
## classic map), Load a save slot. It only emits intents; WorldObserver turns
## them into server commands. The world keeps rendering behind the dim layer.

signal continue_requested
signal new_game_requested(classic: bool)
signal load_requested(save_id: String)
signal address_submitted(url: String)

var address_edit: LineEdit
var status_label: Label
var continue_button: Button
var new_random_button: Button
var new_classic_button: Button
var load_button: Button
var saves_box: VBoxContainer
var saves_panel: PanelContainer
var confirm_label: Label
var pending_new_game: int = -1  # -1 none, 0 random, 1 classic
var saves: Array = []
var connected: bool = false


func _ready() -> void:
	name = "StartMenu"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP

	var dim = ColorRect.new()
	dim.color = Color(0.08, 0.06, 0.04, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)
	# Painted sandbox scene behind the menu (art/hud menu_background); the
	# menu sits on its calm left side, like the mock-up.
	var painted = HudArt.tex("menu_background")
	if painted:
		var bg = TextureRect.new()
		bg.name = "MenuBackground"
		bg.texture = painted
		bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(bg)
	theme = GameHud.ink_theme()

	var center = CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	if painted:
		center.set_anchors_preset(Control.PRESET_LEFT_WIDE)
		center.offset_left = 80
		center.offset_right = 80 + 820
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)

	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	center.add_child(row)

	var panel = PanelContainer.new()
	panel.custom_minimum_size = Vector2(380, 0)
	var panel_box = HudArt.box("menu_panel", [30, 26, 30, 26])
	if panel_box:
		panel.add_theme_stylebox_override("panel", panel_box)
	row.add_child(panel)
	var box = VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)

	var logo = HudArt.tex("logo_hud")
	if logo:
		var pic = GameHud.icon_rect(logo, 0)
		pic.custom_minimum_size = Vector2(320, 90)
		box.add_child(pic)
	else:
		var title = Label.new()
		title.text = "Clayfolk"
		title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		title.add_theme_font_size_override("font_size", 40)
		box.add_child(title)
	var subtitle = Label.new()
	subtitle.text = "Глиняный народец"
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(subtitle)

	continue_button = _button(box, "Продолжить", func(): continue_requested.emit())
	HudArt.menu_action(continue_button, true)
	new_random_button = _button(box, "Новая игра — случайная карта", func(): _ask_new_game(0))
	new_classic_button = _button(box, "Новая игра — классическая карта", func(): _ask_new_game(1))
	load_button = _button(box, "Загрузить сохранение", func(): saves_panel.visible = not saves_panel.visible)

	confirm_label = Label.new()
	confirm_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	confirm_label.visible = false
	box.add_child(confirm_label)

	box.add_child(HSeparator.new())
	var addr_row = HBoxContainer.new()
	box.add_child(addr_row)
	var addr_label = Label.new()
	addr_label.text = "Сервер"
	addr_row.add_child(addr_label)
	address_edit = LineEdit.new()
	HudArt.skin_field(address_edit)
	address_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	address_edit.text_submitted.connect(func(t): address_submitted.emit(t))
	addr_row.add_child(address_edit)
	status_label = Label.new()
	status_label.text = "Подключаемся…"
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status_label.add_theme_font_size_override("font_size", 14)
	box.add_child(status_label)

	saves_panel = PanelContainer.new()
	saves_panel.custom_minimum_size = Vector2(360, 0)
	if panel_box:
		saves_panel.add_theme_stylebox_override("panel", HudArt.box("menu_panel", [30, 26, 30, 26]))
	saves_panel.visible = false
	row.add_child(saves_panel)
	var saves_outer = VBoxContainer.new()
	saves_panel.add_child(saves_outer)
	var saves_title = Label.new()
	saves_title.text = "Сохранения"
	saves_title.add_theme_font_size_override("font_size", 22)
	GameHud.bold(saves_title)
	saves_outer.add_child(saves_title)
	var scroll = ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(330, 440)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	saves_outer.add_child(scroll)
	saves_box = VBoxContainer.new()
	saves_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	saves_box.add_theme_constant_override("separation", 10)
	scroll.add_child(saves_box)
	_refresh_buttons()
	_rebuild_saves()


func _button(parent: Control, text: String, action: Callable) -> Button:
	var b = Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, 48)
	b.add_theme_font_size_override("font_size", 18)
	HudArt.menu_action(b, false)
	b.pressed.connect(action)
	parent.add_child(b)
	return b


func _ask_new_game(kind: int) -> void:
	# The running match is autosaved to a slot first, so nothing is lost by a misclick.
	if pending_new_game == kind:
		pending_new_game = -1
		confirm_label.visible = false
		_refresh_highlights()
		new_game_requested.emit(kind == 1)
		return
	pending_new_game = kind
	confirm_label.text = "Нажмите ещё раз, чтобы начать новую партию. Текущая будет сохранена в «Сохранения»."
	confirm_label.visible = true
	_refresh_highlights()


func _refresh_highlights() -> void:
	HudArt.menu_action(continue_button, pending_new_game == -1)
	HudArt.menu_action(new_random_button, pending_new_game == 0)
	HudArt.menu_action(new_classic_button, pending_new_game == 1)


func set_connected(value: bool, text: String) -> void:
	connected = value
	status_label.text = text
	_refresh_buttons()


func _refresh_buttons() -> void:
	if not continue_button:
		return
	for b in [continue_button, new_random_button, new_classic_button, load_button]:
		b.disabled = not connected
	load_button.text = "Загрузить сохранение (%d)" % saves.size() if connected else "Загрузить сохранение"


func set_saves(list: Variant) -> void:
	var next: Array = list if typeof(list) == TYPE_ARRAY else []
	if JSON.stringify(next) == JSON.stringify(saves):
		return
	saves = next
	_refresh_buttons()
	_rebuild_saves()


func _rebuild_saves() -> void:
	if not saves_box:
		return
	for c in saves_box.get_children():
		c.queue_free()
	if saves.is_empty():
		var empty = Label.new()
		empty.text = "Пока нет сохранений. Откройте ⚙ → Игра → Сохранить."
		empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		saves_box.add_child(empty)
		return
	for meta in saves:
		if typeof(meta) != TYPE_DICTIONARY:
			continue
		# savedAt is UTC milliseconds; show the player's local time.
		var local_unix = int(float(meta.get("savedAt", 0)) / 1000.0) + int(Time.get_time_zone_from_system().get("bias", 0)) * 60
		var when = Time.get_datetime_string_from_unix_time(local_unix, true).substr(0, 16)
		var pop: Array = meta.get("population", [])
		var map_name = "классическая карта" if int(meta.get("mapSeed", 0)) == 0 else "карта #%d" % int(meta.get("mapSeed", 0))
		var id = str(meta.get("id", ""))
		var b = _button(saves_box, "", func(): load_requested.emit(id))
		b.custom_minimum_size = Vector2(0, 110)
		b.tooltip_text = map_name
		for state in ["normal", "hover", "pressed"]:
			b.add_theme_stylebox_override(state, HudArt.box("card_build_pressed" if state == "pressed" else "card_build_normal", [14, 10, 14, 10]))
		# Labels ignore mouse input, so the entire save card still loads its slot.
		var margin = MarginContainer.new()
		margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		for side in ["left", "right"]: margin.add_theme_constant_override("margin_" + side, 16)
		for side in ["top", "bottom"]: margin.add_theme_constant_override("margin_" + side, 12)
		margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(margin)
		var details = VBoxContainer.new()
		details.mouse_filter = Control.MOUSE_FILTER_IGNORE
		margin.add_child(details)
		var title = Label.new()
		title.text = str(meta.get("name", "Сохранение"))
		title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		title.add_theme_font_size_override("font_size", 18)
		GameHud.bold(title)
		details.add_child(title)
		var date = Label.new()
		date.text = when
		date.add_theme_font_size_override("font_size", 14)
		details.add_child(date)
		var info = Label.new()
		info.text = "День %d · Жители %s" % [int(int(meta.get("tick", 0)) / GameHud.DAY_TICKS) + 1, " / ".join(pop.map(func(v): return str(int(v))))]
		info.add_theme_font_size_override("font_size", 15)
		details.add_child(info)
		for label in details.get_children(): label.mouse_filter = Control.MOUSE_FILTER_IGNORE
