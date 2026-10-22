class_name GameHud
extends Control

## Player-facing HUD over the world: the controlled tribe's stores, match
## tasks, danger/weather alerts, speed and alarm controls and a hover tooltip.
## Reads snapshots only; controls emit commands that WorldObserver sends.

signal speed_requested(value: int)
signal alarm_requested(on: bool)

const PARCHMENT := Color(0.95, 0.89, 0.74, 0.94)
const INK := Color(0.30, 0.20, 0.12)
const BORDER := Color(0.55, 0.38, 0.22)

var resource_labels: Dictionary = {}
var weather_label: Label
var tasks_box: VBoxContainer
var tasks_panel: PanelContainer
var alert_panel: PanelContainer
var alert_label: Label
var tooltip_panel: PanelContainer
var tooltip_label: Label
var speed_buttons: Dictionary = {}
var alarm_button: Button
var alarm_on: bool = false
var tasks_signature: String = ""


func _ready() -> void:
	name = "GameHud"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_top_bar()
	_build_tasks()
	_build_alert()
	_build_tooltip()


## Dark ink labels for parchment panels (other panels reuse it).
static func ink_theme() -> Theme:
	var t = Theme.new()
	t.set_color("font_color", "Label", INK)
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


func _label(text: String, size: int = 18, color: Color = INK) -> Label:
	var l = Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _build_top_bar() -> void:
	var bar = PanelContainer.new()
	bar.name = "ResourceBar"
	bar.add_theme_stylebox_override("panel", panel_style())
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
		var icon = TextureRect.new()
		icon.texture = make_icon(spec[0])
		icon.custom_minimum_size = Vector2(28, 28)
		icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		cell.add_child(icon)
		var value = _label("0", 22)
		cell.add_child(value)
		resource_labels[spec[0]] = value
		row.add_child(cell)
	row.add_child(VSeparator.new())
	weather_label = _label("День · ясно", 18)
	row.add_child(weather_label)
	row.add_child(VSeparator.new())
	for spec in [[0, "Пауза"], [1, "1×"], [5, "5×"], [20, "20×"]]:
		var b = Button.new()
		b.text = spec[1]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		var v: int = spec[0]
		b.pressed.connect(func(): speed_requested.emit(v))
		row.add_child(b)
		speed_buttons[v] = b
	alarm_button = Button.new()
	alarm_button.text = "Тревога"
	alarm_button.toggle_mode = true
	alarm_button.focus_mode = Control.FOCUS_NONE
	alarm_button.tooltip_text = "Все жители бросают работу и бегут защищать лагерь"
	alarm_button.pressed.connect(func(): alarm_requested.emit(not alarm_on))
	row.add_child(alarm_button)


func _build_tasks() -> void:
	tasks_panel = PanelContainer.new()
	tasks_panel.name = "TasksPanel"
	tasks_panel.add_theme_stylebox_override("panel", panel_style())
	tasks_panel.position = Vector2(16, 16)
	tasks_panel.custom_minimum_size = Vector2(300, 0)
	tasks_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	tasks_panel.mouse_force_pass_scroll_events = false
	add_child(tasks_panel)
	var box = VBoxContainer.new()
	tasks_panel.add_child(box)
	box.add_child(_label("Задачи", 22))
	tasks_box = VBoxContainer.new()
	tasks_box.add_theme_constant_override("separation", 6)
	box.add_child(tasks_box)


func _build_alert() -> void:
	alert_panel = PanelContainer.new()
	alert_panel.name = "AlertPanel"
	alert_panel.add_theme_stylebox_override("panel", panel_style(Color(0.62, 0.20, 0.14, 0.92)))
	alert_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	alert_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	alert_panel.position.y = 70
	alert_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	alert_panel.visible = false
	add_child(alert_panel)
	alert_label = _label("", 20, Color(1, 0.95, 0.85))
	alert_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	alert_panel.add_child(alert_label)


func _build_tooltip() -> void:
	tooltip_panel = PanelContainer.new()
	tooltip_panel.name = "WorldTooltip"
	tooltip_panel.add_theme_stylebox_override("panel", panel_style())
	tooltip_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tooltip_panel.visible = false
	add_child(tooltip_panel)
	tooltip_label = _label("", 16)
	tooltip_panel.add_child(tooltip_label)


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
	alarm_on = bool(colony.get("alarm", false))
	alarm_button.button_pressed = alarm_on

	var speed = int(round(float(session.get("speed", 1.0))))
	for v in speed_buttons.keys():
		speed_buttons[v].button_pressed = v == speed

	var tick = int(snapshot.get("tick", 0))
	var weather = snapshot.get("weather", {})
	var wstate = str(weather.get("state", "clear")) if typeof(weather) == TYPE_DICTIONARY else "clear"
	var phase = day_phase(tick)
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
	var shown = 0
	for o in objectives:
		if typeof(o) != TYPE_DICTIONARY or shown >= 7:
			continue
		var done = bool(o.get("done", false))
		var target = maxf(1.0, float(o.get("target", 1)))
		var progress = clampf(float(o.get("progress", 0)), 0.0, target)
		var row = VBoxContainer.new()
		var prefix = "★ " if bool(o.get("victory", false)) else ""
		var title = _label(("✓ " if done else prefix) + str(o.get("text", "")), 16, Color(0.35, 0.45, 0.2) if done else INK)
		title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		title.custom_minimum_size = Vector2(280, 0)
		row.add_child(title)
		if target > 1.0 and not done:
			var bar = ProgressBar.new()
			bar.max_value = target
			bar.value = progress
			bar.show_percentage = false
			bar.custom_minimum_size = Vector2(280, 8)
			row.add_child(bar)
			row.add_child(_label("%d / %d" % [int(progress), int(target)], 13, INK.lightened(0.25)))
		tasks_box.add_child(row)
		shown += 1


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


## Small hand-drawn resource icons (no texture assets needed).
static func make_icon(kind: String) -> ImageTexture:
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
