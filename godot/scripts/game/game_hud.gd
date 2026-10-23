class_name GameHud
extends Control

## Player-facing HUD over the world: the controlled tribe's stores, match
## tasks, danger/weather alerts, speed and alarm controls and a hover tooltip.
## Reads snapshots only; controls emit commands that WorldObserver sends.

signal speed_requested(value: int)
signal alarm_requested(on: bool)
signal settings_requested

const PARCHMENT := Color(0.95, 0.89, 0.74, 0.94)
const INK := Color(0.30, 0.20, 0.12)
const BORDER := Color(0.55, 0.38, 0.22)

var resource_labels: Dictionary = {}
var weather_label: Label
var time_icon: TextureRect
var weather_icon: TextureRect
var tasks_box: VBoxContainer
var tasks_panel: PanelContainer
var alert_panel: PanelContainer
var alert_label: Label
var alert_icon: TextureRect
var tooltip_panel: PanelContainer
var tooltip_label: Label
var speed_buttons: Dictionary = {}
var alarm_button: Button
var settings_button: Button
var quick_panel: PanelContainer
var alarm_on: bool = false
var tasks_signature: String = ""
var tasks_toggle: Button
var tasks_done := 0
var tasks_total := 0
const TASKS_SHOWN := 4
## Growth shown next to the stores (2D reference): +N over the last RATE_WINDOW ticks.
const RATE_WINDOW := 1200
var rate_labels: Dictionary = {}
var history: Array = []


func _ready() -> void:
	name = "GameHud"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_brand()
	_build_top_bar()
	_build_tasks()
	_build_alert()
	_build_tooltip()


## Dark ink labels for parchment panels (other panels reuse it).
static func ink_theme() -> Theme:
	var t = Theme.new()
	t.set_color("font_color", "Label", INK)
	# Painted wide buttons for every text button on the parchment panels.
	var pad = [14, 6, 14, 6]
	if HudArt.box("ui_button_wide_normal", pad):
		t.set_stylebox("normal", "Button", HudArt.box("ui_button_wide_normal", pad))
		t.set_stylebox("hover", "Button", HudArt.box("ui_button_wide_hover", pad))
		t.set_stylebox("pressed", "Button", HudArt.box("ui_button_wide_pressed", pad))
		t.set_stylebox("hover_pressed", "Button", HudArt.box("ui_button_wide_pressed", pad))
		t.set_stylebox("disabled", "Button", HudArt.box("ui_button_wide_disabled", pad))
		t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			t.set_color(state, "Button", INK)
		t.set_color("font_disabled_color", "Button", Color(INK, 0.55))
	var bg = HudArt.box("ui_bar_bg", [0, 0, 0, 0])
	if bg:
		t.set_stylebox("background", "ProgressBar", bg)
		t.set_stylebox("fill", "ProgressBar", HudArt.box("ui_bar_fill_green", [0, 0, 0, 0]))
	var grab = HudArt.box("ui_scroll_grabber", [0, 0, 0, 0])
	if grab:
		t.set_stylebox("scroll", "VScrollBar", HudArt.box("ui_scroll_track", [0, 0, 0, 0]))
		t.set_stylebox("grabber", "VScrollBar", grab)
		t.set_stylebox("grabber_highlight", "VScrollBar", HudArt.box("ui_scroll_grabber", [0, 0, 0, 0]))
		t.set_stylebox("grabber_pressed", "VScrollBar", HudArt.box("ui_scroll_grabber", [0, 0, 0, 0]))
	var sep = HudArt.tex("ui_separator_h")
	if sep:
		var line = StyleBoxTexture.new()
		line.texture = sep
		line.texture_margin_left = 4
		line.texture_margin_right = 4
		t.set_stylebox("separator", "HSeparator", line)
	return t


static func panel_style(fill: Color = PARCHMENT) -> StyleBoxFlat:
	var sb = StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = BORDER
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	sb.shadow_color = Color(0, 0, 0, 0.25)
	sb.shadow_size = 3
	return sb


## Painted parchment panel (art/hud ui_panel); the flat style if it is missing.
static func parchment(pad: Array = [14, 10, 14, 10], picture: String = "ui_panel") -> StyleBox:
	var sb = HudArt.box(picture, pad)
	return sb if sb else panel_style()


## Icon picture of a fixed on-screen size (the painted ones are 4× larger).
static func icon_rect(texture: Texture2D, size: float) -> TextureRect:
	var r = TextureRect.new()
	r.texture = texture
	r.custom_minimum_size = Vector2(size, size)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r


## Panel title on the painted header strip ("Задачи", "Работы").
static func header(text: String, size: int = 20) -> Control:
	var l = Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", INK)
	var sb = HudArt.box("ui_header", [14, 3, 14, 3])
	if sb:
		l.add_theme_stylebox_override("normal", sb)
	return l


## Painted track and fill for a progress bar.
static func skin_bar(bar: ProgressBar, fill: String = "ui_bar_fill_green") -> void:
	var bg = HudArt.box("ui_bar_bg", [0, 0, 0, 0])
	var fg = HudArt.box(fill, [0, 0, 0, 0])
	if bg and fg:
		bar.add_theme_stylebox_override("background", bg)
		bar.add_theme_stylebox_override("fill", fg)


## server/src/sim/objectives.ts id -> task picture.
static func _task_picture(id: String) -> String:
	if id.begins_with("clay"):
		return "task_clay"
	if id.begins_with("stone"):
		return "task_stone"
	if id.begins_with("hut") or id.begins_with("workshop") or id.begins_with("kiln") or id.begins_with("wall"):
		return "task_build_hut"
	if id.begins_with("pop") or id.begins_with("fired"):
		return "task_population"
	if id.begins_with("totem") or id.begins_with("spring"):
		return "task_territory"
	if id == "win-spider":
		return "task_survive_raid"
	if id == "win-idol":
		return "task_idol_ritual"
	return "ui_dot_yellow"


func _label(text: String, size: int = 18, color: Color = INK) -> Label:
	var l = Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


## Name plate at the top left, like the 2D reference.
func _build_brand() -> void:
	var brand = PanelContainer.new()
	brand.name = "Brand"
	brand.add_theme_stylebox_override("panel", parchment([16, 8, 16, 8], "brand_plate"))
	brand.position = Vector2(16, 12)
	brand.custom_minimum_size = Vector2(300, 0)
	brand.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(brand)
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	brand.add_child(row)
	row.add_child(icon_rect(make_icon("people"), 36))
	row.add_child(_label("Clayfolk", 26))


func _build_top_bar() -> void:
	var bar = PanelContainer.new()
	bar.name = "ResourceBar"
	bar.add_theme_stylebox_override("panel", parchment([18, 8, 18, 8]))
	bar.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	bar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	bar.position.y = 12
	bar.mouse_filter = Control.MOUSE_FILTER_STOP
	bar.mouse_force_pass_scroll_events = false
	add_child(bar)
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	bar.add_child(row)
	for spec in [["clay", "Глина"], ["special", "Особая глина — питает ритуал Идола; её дают источники на своей земле"], ["food", "Еда"], ["wood", "Дерево"], ["stone", "Камень"], ["people", "Жители"]]:
		var cell = HBoxContainer.new()
		cell.tooltip_text = spec[1]
		cell.add_child(icon_rect(make_icon(spec[0]), 36))
		var value = _label("0", 22)
		cell.add_child(value)
		resource_labels[spec[0]] = value
		if spec[0] in ["clay", "food", "wood", "stone"]:
			var rate = _label("", 15, Color(0.30, 0.55, 0.20))
			cell.add_child(rate)
			rate_labels[spec[0]] = rate
		row.add_child(cell)
	row.add_child(VSeparator.new())
	time_icon = icon_rect(HudArt.tex("time_day"), 28)
	row.add_child(time_icon)
	weather_icon = icon_rect(HudArt.tex("weather_clear"), 28)
	row.add_child(weather_icon)
	weather_label = _label("День · ясно", 18)
	row.add_child(weather_label)
	# Like the 2D client: pause, speed, alarm and the settings menu sit in their
	# own small panel at the top right; the stores stay in the middle.
	quick_panel = PanelContainer.new()
	quick_panel.name = "QuickPanel"
	quick_panel.add_theme_stylebox_override("panel", parchment([10, 8, 10, 8]))
	quick_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	quick_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	quick_panel.offset_right = -16
	quick_panel.offset_top = 12
	quick_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	quick_panel.mouse_force_pass_scroll_events = false
	add_child(quick_panel)
	row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	quick_panel.add_child(row)
	for spec in [[0, "Пауза", "glyph_pause", "Пауза"], [1, "1×", "glyph_play", "Обычная скорость"], [5, "5×", "glyph_fast", "Скорость 5×"], [20, "20×", "glyph_faster", "Скорость 20×"]]:
		var b = Button.new()
		b.text = spec[1]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(48, 48)
		b.tooltip_text = spec[3]
		HudArt.glyph_button(b, spec[2])
		var v: int = spec[0]
		b.pressed.connect(func(): speed_requested.emit(v))
		row.add_child(b)
		speed_buttons[v] = b
	alarm_button = Button.new()
	alarm_button.text = "Тревога"
	alarm_button.toggle_mode = true
	alarm_button.focus_mode = Control.FOCUS_NONE
	alarm_button.custom_minimum_size = Vector2(48, 48)
	alarm_button.tooltip_text = "Тревога: все жители бросают работу и бегут защищать лагерь"
	HudArt.glyph_button(alarm_button, "glyph_alarm", 34)
	alarm_button.pressed.connect(func(): alarm_requested.emit(not alarm_on))
	row.add_child(alarm_button)
	settings_button = Button.new()
	settings_button.text = "⚙"
	settings_button.custom_minimum_size = Vector2(48, 48)
	settings_button.add_theme_font_size_override("font_size", 22)
	settings_button.focus_mode = Control.FOCUS_NONE
	settings_button.tooltip_text = "Меню: сохранить, лагеря и озёра, сервер, управление"
	HudArt.glyph_button(settings_button, "glyph_settings")
	settings_button.pressed.connect(func(): settings_requested.emit())
	row.add_child(settings_button)


func _build_tasks() -> void:
	tasks_panel = PanelContainer.new()
	tasks_panel.name = "TasksPanel"
	tasks_panel.add_theme_stylebox_override("panel", parchment())
	tasks_panel.position = Vector2(16, 76)
	tasks_panel.custom_minimum_size = Vector2(280, 0)
	tasks_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	tasks_panel.mouse_force_pass_scroll_events = false
	add_child(tasks_panel)
	var box = VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	tasks_panel.add_child(box)
	tasks_toggle = header_button("Задачи")
	tasks_toggle.tooltip_text = "Свернуть или развернуть задачи"
	tasks_toggle.pressed.connect(func():
		tasks_box.visible = not tasks_box.visible
		_update_tasks_title())
	box.add_child(tasks_toggle)
	tasks_box = VBoxContainer.new()
	tasks_box.add_theme_constant_override("separation", 5)
	box.add_child(tasks_box)


## Clickable panel title on the header strip: folds its panel (▾ open, ▸ folded).
static func header_button(text: String, size: int = 18) -> Button:
	var b = Button.new()
	b.text = text
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", size)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(state, INK)
	var sb = HudArt.box("ui_header", [12, 2, 12, 2])
	if sb:
		for state in ["normal", "hover", "pressed", "hover_pressed"]:
			b.add_theme_stylebox_override(state, sb)
		b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	return b


func _update_tasks_title() -> void:
	tasks_toggle.text = ("Задачи ▾" if tasks_box.visible else "Задачи ▸") + ("   %d / %d" % [tasks_done, tasks_total] if tasks_total > 0 else "")


func _build_alert() -> void:
	alert_panel = PanelContainer.new()
	alert_panel.name = "AlertPanel"
	alert_panel.add_theme_stylebox_override("panel", panel_style(Color(0.62, 0.20, 0.14, 0.92)))
	alert_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	alert_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	# Under the resource bar at the top centre.
	alert_panel.position.y = 70
	alert_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	alert_panel.visible = false
	add_child(alert_panel)
	alert_label = _label("", 20, Color(1, 0.95, 0.85))
	alert_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	alert_panel.add_child(row)
	alert_icon = icon_rect(null, 44)
	row.add_child(alert_icon)
	row.add_child(alert_label)


func _build_tooltip() -> void:
	tooltip_panel = PanelContainer.new()
	tooltip_panel.name = "WorldTooltip"
	tooltip_panel.add_theme_stylebox_override("panel", parchment([12, 8, 12, 8], "ui_tooltip"))
	tooltip_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tooltip_panel.visible = false
	add_child(tooltip_panel)
	tooltip_label = _label("", 16)
	tooltip_panel.add_child(tooltip_label)


## "+12" / "−5" next to a store: change over the last RATE_WINDOW ticks.
func _update_rates(tick: int, values: Dictionary) -> void:
	if not history.is_empty() and tick < int(history[-1][0]):
		history.clear()  # new match or loaded save
	history.append([tick, values])
	while history.size() > 2 and tick - int(history[1][0]) >= RATE_WINDOW:
		history.pop_front()
	var old = history[0]
	var span = tick - int(old[0])
	for k in rate_labels.keys():
		var l: Label = rate_labels[k]
		var delta = int(round(float(values[k]) - float(old[1][k])))
		if span < RATE_WINDOW / 4 or delta == 0:
			l.text = ""
			continue
		l.text = ("+%d" % delta) if delta > 0 else ("−%d" % -delta)
		l.add_theme_color_override("font_color", Color(0.30, 0.55, 0.20) if delta > 0 else Color(0.70, 0.25, 0.16))


## Updates every widget from one snapshot.
func update_from_snapshot(snapshot: Dictionary, population: int) -> void:
	var session = snapshot.get("session", {})
	if typeof(session) != TYPE_DICTIONARY:
		session = {}
	var player = int(session.get("playerColonyIndex", 0))
	var colonies = snapshot.get("colonies", [])
	var colony: Dictionary = {}
	if typeof(colonies) == TYPE_ARRAY and player < colonies.size() and typeof(colonies[player]) == TYPE_DICTIONARY:
		colony = colonies[player].get("colony", {})
	var stock = colony.get("foodStock", {})
	var food = float(colony.get("food", 0.0))
	if typeof(stock) == TYPE_DICTIONARY and not stock.is_empty():
		food = 0.0
		for v in stock.values():
			food += float(v)
	resource_labels.clay.text = str(int(float(colony.get("clay", 0))))
	resource_labels.special.text = str(int(float(colony.get("specialClay", 0))))
	resource_labels.food.text = str(int(food))
	resource_labels.wood.text = str(int(float(colony.get("wood", 0))))
	resource_labels.stone.text = str(int(float(colony.get("stone", 0))))
	resource_labels.people.text = str(population)
	_update_rates(int(snapshot.get("tick", 0)), {"clay": float(colony.get("clay", 0)), "food": food, "wood": float(colony.get("wood", 0)), "stone": float(colony.get("stone", 0))})
	alarm_on = bool(colony.get("alarm", false))
	alarm_button.button_pressed = alarm_on
	var horn = HudArt.tex("glyph_alarm_on" if alarm_on else "glyph_alarm")
	if horn:
		alarm_button.icon = horn

	var speed = int(round(float(session.get("speed", 1.0))))
	for v in speed_buttons.keys():
		speed_buttons[v].button_pressed = v == speed

	var tick = int(snapshot.get("tick", 0))
	var weather = snapshot.get("weather", {})
	var wstate = str(weather.get("state", "clear")) if typeof(weather) == TYPE_DICTIONARY else "clear"
	var phase = day_phase(tick)
	var tt = HudArt.tex("time_" + phase)
	if tt:
		time_icon.texture = tt
	var wt = HudArt.tex({"clear": "weather_clear", "warning": "weather_clouds", "rain": "weather_rain"}.get(wstate, "weather_clear"))
	if wt:
		weather_icon.texture = wt
	# A clear day would show two suns: the weather icon only when it is not clear.
	weather_icon.visible = wstate != "clear"
	weather_label.text = "День %d · %s · %s" % [int(tick / DAY_TICKS) + 1, {"day": "день", "dusk": "сумерки", "night": "ночь", "dawn": "рассвет"}[phase], {"clear": "ясно", "warning": "тучи", "rain": "дождь"}.get(wstate, wstate)]

	_update_tasks(snapshot.get("objectives", []))
	_update_alert(session, weather, tick, colony)


## server/src/config.ts dominanceTicks: holding two springs this long wins.
const DOMINANCE_TICKS := 12000

## shared/dayCycle.ts: a 6000-tick day, night from 4200, 300-tick dusk/dawn.
const DAY_TICKS := 6000
const NIGHT_START := 4200

static func day_phase(tick: int) -> String:
	var t = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS
	if t < NIGHT_START - 300:
		return "day"
	if t < NIGHT_START:
		return "dusk"
	if t < DAY_TICKS - 300:
		return "night"
	return "dawn"


func _update_tasks(objectives: Variant) -> void:
	if typeof(objectives) != TYPE_ARRAY:
		objectives = []
	var sig = JSON.stringify(objectives)
	if sig == tasks_signature:
		return
	tasks_signature = sig
	for c in tasks_box.get_children():
		c.queue_free()
	# Only open tasks (up to TASKS_SHOWN); finished ones fold into one line.
	var shown = 0
	tasks_done = 0
	tasks_total = 0
	for o in objectives:
		if typeof(o) != TYPE_DICTIONARY:
			continue
		tasks_total += 1
		if bool(o.get("done", false)):
			tasks_done += 1
			continue
		if shown >= TASKS_SHOWN:
			continue
		var done = false
		var target = maxf(1.0, float(o.get("target", 1)))
		var progress = clampf(float(o.get("progress", 0)), 0.0, target)
		var victory = bool(o.get("victory", false))
		var line = HBoxContainer.new()
		line.add_theme_constant_override("separation", 8)
		var pic = HudArt.tex("ui_check" if done else ("ui_star" if victory else _task_picture(str(o.get("id", "")))))
		var row = VBoxContainer.new()
		row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var prefix = "★ " if victory else ""
		var text = str(o.get("text", "")) if pic else ("✓ " if done else prefix) + str(o.get("text", ""))
		var title = _label(text, 15, INK)
		title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		title.custom_minimum_size = Vector2(220 if pic else 260, 0)
		row.add_child(title)
		if target > 1.0 and not done:
			var bar = ProgressBar.new()
			bar.max_value = target
			bar.value = progress
			bar.show_percentage = false
			bar.custom_minimum_size = Vector2(220 if pic else 260, 10 if pic else 8)
			skin_bar(bar, "ui_bar_fill_amber" if victory else "ui_bar_fill_green")
			row.add_child(bar)
			row.add_child(_label("%d / %d" % [int(progress), int(target)], 13, INK.lightened(0.25)))
		if pic:
			var holder = icon_rect(pic, 32)
			holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			line.add_child(holder)
		line.add_child(row)
		tasks_box.add_child(line)
		shown += 1
	if tasks_done > 0:
		var summary = HBoxContainer.new()
		summary.add_theme_constant_override("separation", 8)
		var check_pic = HudArt.tex("ui_check")
		if check_pic:
			summary.add_child(icon_rect(check_pic, 24))
		summary.add_child(_label(("Выполнено: %d" if check_pic else "✓ Выполнено: %d") % tasks_done, 14, Color(0.35, 0.45, 0.2)))
		tasks_box.add_child(summary)
	_update_tasks_title()


func _update_alert(session: Dictionary, weather: Variant, tick: int, colony: Dictionary) -> void:
	var lines: Array[String] = []
	var raid = session.get("raid", {})
	if typeof(raid) == TYPE_DICTIONARY:
		match str(raid.get("phase", "peace")):
			"warning":
				var left = maxi(0, int(raid.get("at", tick)) - tick)
				lines.append("Пауки готовят набег! Через %d с. Стройте ограду и собирайте воинов." % int(left / 10))
			"attack":
				lines.append("Набег пауков! Включите тревогу, чтобы все защищали лагерь.")
	if typeof(weather) == TYPE_DICTIONARY:
		match str(weather.get("state", "clear")):
			"warning":
				lines.append("Собираются тучи — скоро дождь размоет глину.")
			"rain":
				lines.append("Дождь: жители прячутся, стены размокают.")
		if weather.has("bigRainAt") and not bool(weather.get("bigRainDone", false)):
			var to_big = int(weather.get("bigRainAt", 0)) - tick
			if to_big > 0 and to_big < 1800:
				lines.append("Великий ливень — финал партии — через %d с." % int(to_big / 10))
		var scores = session.get("finaleScores", [])
		if bool(weather.get("bigRainActive", false)) and typeof(scores) == TYPE_ARRAY and scores.size() >= 2:
			lines.append("Великий ливень! Счёт племён: A %d — B %d. Сильнейший победит." % [int(scores[0]), int(scores[1])])
	var dom = session.get("dominance")
	if typeof(dom) == TYPE_DICTIONARY:
		var left = maxi(0, int(dom.get("required", DOMINANCE_TICKS)) - (tick - int(dom.get("since", tick))))
		var player = int(session.get("playerColonyIndex", 0))
		var mine = str(dom.get("holder", "")) == ("colony-2" if player == 1 else "colony-1")
		var count = int(dom.get("count", 2))
		lines.append(("Мы держим %d источника: победа через %d с." if mine else "Соседи держат %d источника: поражение через %d с. Осадите их тотем!") % [count, int(left / 10)])
	if bool(colony.get("alarm", false)):
		lines.append("Тревога включена: работа остановлена.")
	if str(session.get("status", "playing")) != "playing":
		lines = ["Партия окончена: %s" % str(session.get("reason", ""))]
	var raid_phase = str(raid.get("phase", "peace")) if typeof(raid) == TYPE_DICTIONARY else "peace"
	var wdict: Dictionary = weather if typeof(weather) == TYPE_DICTIONARY else {}
	var pic = ""
	var status = str(session.get("status", "playing"))
	if status != "playing":
		pic = "alert_victory" if status == "victory" else "alert_defeat"
	elif raid_phase == "attack":
		pic = "alert_spider"
	elif raid_phase == "warning":
		pic = "alert_raid"
	elif bool(wdict.get("bigRainActive", false)) or (lines.size() > 0 and lines.any(func(l): return l.begins_with("Великий ливень"))):
		pic = "alert_big_rain"
	elif str(wdict.get("state", "")) == "rain":
		pic = "alert_rain"
	elif str(wdict.get("state", "")) == "warning":
		pic = "alert_clouds"
	elif bool(colony.get("alarm", false)):
		pic = "alert_alarm"
	elif typeof(dom) == TYPE_DICTIONARY:
		pic = "task_territory"
	alert_icon.texture = HudArt.tex(pic) if pic != "" else null
	alert_icon.visible = alert_icon.texture != null
	alert_label.text = "\n".join(lines)
	alert_panel.visible = not lines.is_empty()


func show_tooltip(text: String, screen_pos: Vector2) -> void:
	if text.is_empty():
		tooltip_panel.visible = false
		return
	tooltip_label.text = text
	tooltip_panel.visible = true
	tooltip_panel.reset_size()
	# Keep it on screen: near the right or bottom edge (build bar, inspector)
	# it opens to the left / above the cursor instead.
	var view = get_viewport().get_visible_rect().size if get_viewport() else Vector2(1920, 1080)
	var size = tooltip_panel.size
	var pos = screen_pos + Vector2(18, 18)
	if pos.x + size.x > view.x - 4:
		pos.x = screen_pos.x - size.x - 12
	if pos.y + size.y > view.y - 4:
		pos.y = screen_pos.y - size.y - 12
	tooltip_panel.position = Vector2(maxf(4, pos.x), maxf(4, pos.y))


## Resource icon: the painted res_<kind> picture, or a small one drawn by code.
static func make_icon(kind: String) -> Texture2D:
	var painted = HudArt.tex("res_" + kind)
	if painted:
		return painted
	var img = Image.create(28, 28, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	match kind:
		"clay":
			_disc(img, Vector2(14, 16), 9.0, Color(0.74, 0.38, 0.22))
			_disc(img, Vector2(11, 13), 3.0, Color(0.86, 0.52, 0.34))
		"food":
			_disc(img, Vector2(9, 17), 5.5, Color(0.85, 0.15, 0.12))
			_disc(img, Vector2(18, 17), 5.5, Color(0.78, 0.12, 0.10))
			_disc(img, Vector2(14, 10), 5.5, Color(0.90, 0.20, 0.15))
			_disc(img, Vector2(17, 5), 2.5, Color(0.30, 0.55, 0.20))
		"wood":
			for k in range(3):
				for x in range(4, 25):
					for t in range(-2, 3):
						var y = 8 + k * 6 + t + int(float(x - 4) * 0.15)
						if y >= 0 and y < 28:
							img.set_pixel(x, y, Color(0.55, 0.36, 0.20) if t != 0 else Color(0.70, 0.50, 0.30))
		"special":
			_disc(img, Vector2(14, 16), 9.0, Color(0.62, 0.15, 0.11))
			_disc(img, Vector2(11, 13), 3.2, Color(0.95, 0.45, 0.32))
			_disc(img, Vector2(19, 9), 2.0, Color(1.0, 0.85, 0.55))
		"stone":
			_disc(img, Vector2(12, 17), 8.0, Color(0.58, 0.57, 0.53))
			_disc(img, Vector2(19, 19), 6.0, Color(0.48, 0.47, 0.44))
			_disc(img, Vector2(10, 14), 2.5, Color(0.72, 0.71, 0.68))
		"people":
			_disc(img, Vector2(14, 8), 5.5, Color(0.88, 0.56, 0.36))
			_disc(img, Vector2(14, 20), 7.5, Color(0.88, 0.56, 0.36))
			for x in range(7, 22):
				img.set_pixel(x, 20, Color(0.95, 0.78, 0.28))
	return ImageTexture.create_from_image(img)


static func _disc(img: Image, c: Vector2, r: float, col: Color) -> void:
	for y in range(28):
		for x in range(28):
			var d = Vector2(x + 0.5, y + 0.5).distance_to(c)
			if d <= r:
				var shade = 1.0 - 0.18 * clampf((Vector2(x, y) - c).dot(Vector2(0.6, 0.8)) / r, 0.0, 1.0)
				img.set_pixel(x, y, Color(col.r * shade, col.g * shade, col.b * shade, 1.0))
