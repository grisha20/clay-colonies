class_name PriorityPanel
extends PanelContainer

## Work priorities of the controlled tribe (client/src/main.ts priority panel):
## target workers per job (clay, wood, stone, build, guard, fish), who actually
## does it now, free hands, people on food, tools, and why a target is unmet.
## The server is the authority (colony.priorities); buttons emit setPriorities.

signal priorities_requested(priorities: Dictionary)
signal auto_manage_requested(enabled: bool)
signal firing_requested(paused: bool)
signal water_requested
signal warrior_requested

const KEYS = ["clay", "wood", "stone", "build", "guard", "fish", "hunt"]
const LABELS = {"clay": "Глина", "wood": "Дерево", "stone": "Камень", "build": "Стройка", "guard": "Стража", "fish": "Рыбалка", "hunt": "Охота"}

var header: Label
var mother_seg: Button
var manual_seg: Button
var firing_bar: ProgressBar
var mode_hint: Label
var auto_manage := false
## Kiln firing: "обожжено N из M" and a pause button (colony.firingPaused).
var firing_row: HBoxContainer
var firing_label: Label
var firing_button: Button
var firing_paused := false
## Water shooting for the guards (colony.waterWeapons, trainWaterWeapons command).
var water_button: Button
## Warrior initiation (server/src/sim/warriors.ts; same cost and cap rules).
var warrior_button: Button
const WARRIOR_COST := {"specialClay": 4, "spears": 1}
const WARRIORS_PER_RESIDENTS := 8
const WATER_COST := {"wood": 6, "stone": 4}
const WARRIOR_TIP := "Стражник у костра проходит посвящение: сильнее бьёт, меньше получает урона, носит копьё и перья. Праматерь посвящает сама, когда племени грозят."
## One unit (row + its "why not" note) per job.
var rows_box: GridContainer
var priorities: Dictionary = {}
var free_for_plus: int = 0
var signature: String = ""
var body: VBoxContainer


## Laid out like the owner's mock-up: «Работы» with an icon, «Жители · Свободно»,
## a «Праматерь | Вручную» switch, the job list on an inset, the kiln bar at the
## bottom. Details (busy now, tools, why a job is short) are in row tooltips.
func _ready() -> void:
	name = "PriorityPanel"
	add_theme_stylebox_override("panel", GameHud.parchment([16, 12, 16, 14]))
	theme = GameHud.ink_theme()
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_force_pass_scroll_events = false
	custom_minimum_size = Vector2(372, 0)
	var box = VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	add_child(box)
	var title_row = HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 8)
	box.add_child(title_row)
	var works_pic = HudArt.tex("icon_works")
	if works_pic == null:
		works_pic = HudArt.tex("res_people")
	if works_pic:
		title_row.add_child(GameHud.icon_rect(works_pic, 38))
	var toggle = Button.new()
	toggle.name = "WorksToggle"
	toggle.text = "Работы"
	toggle.flat = true
	toggle.focus_mode = Control.FOCUS_NONE
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.add_theme_font_size_override("font_size", 26)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		toggle.add_theme_color_override(state, GameHud.INK)
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		toggle.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	toggle.add_theme_font_override("font", preload("res://assets/fonts/nunito_hud_heading.tres"))
	toggle.tooltip_text = "Свернуть или развернуть работы"
	title_row.add_child(toggle)
	# Everything under the title folds away with it.
	body = VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	box.add_child(body)
	toggle.pressed.connect(func(): body.visible = not body.visible)
	box = body
	var people_row = HBoxContainer.new()
	people_row.add_theme_constant_override("separation", 6)
	box.add_child(people_row)
	var person = HudArt.tex("icon_person")
	if person:
		people_row.add_child(GameHud.icon_rect(person, 22))
	header = Label.new()
	header.add_theme_font_size_override("font_size", 18)
	people_row.add_child(header)
	# «Праматерь | Вручную»: the tribe AI sets the targets (colony.autoManage);
	# any +/- hands them to the player (the server switches to manual).
	var switch = HBoxContainer.new()
	switch.add_theme_constant_override("separation", 0)
	box.add_child(switch)
	mother_seg = _segment("Праматерь", "left")
	mother_seg.pressed.connect(func():
		if not auto_manage:
			auto_manage_requested.emit(true)
		_update_mode())
	switch.add_child(mother_seg)
	manual_seg = _segment("Вручную", "right")
	manual_seg.pressed.connect(func():
		if auto_manage:
			auto_manage_requested.emit(false)
		_update_mode())
	switch.add_child(manual_seg)
	mode_hint = Label.new()
	mode_hint.visible = false
	box.add_child(mode_hint)
	_update_mode()
	# The job list sits on a slightly darker inset.
	var list = PanelContainer.new()
	list.name = "JobList"
	var inset = HudArt.box("ui_list_bg", [8, 6, 8, 6])
	if inset == null:
		var flat = StyleBoxFlat.new()
		flat.bg_color = Color(0.94, 0.87, 0.74, 0.55)
		flat.set_corner_radius_all(10)
		flat.content_margin_left = 8
		flat.content_margin_right = 8
		flat.content_margin_top = 6
		flat.content_margin_bottom = 6
		inset = flat
	list.add_theme_stylebox_override("panel", inset)
	box.add_child(list)
	rows_box = GridContainer.new()
	rows_box.columns = 1
	rows_box.add_theme_constant_override("v_separation", 3)
	list.add_child(rows_box)
	# Kiln: picture, orange bar, «Обжиг · N из M», pause button.
	firing_row = HBoxContainer.new()
	firing_row.name = "FiringRow"
	firing_row.add_theme_constant_override("separation", 10)
	var kiln_pic = HudArt.tex("icon_kiln")
	if kiln_pic == null:
		kiln_pic = HudArt.tex("build_kiln")
	if kiln_pic:
		firing_row.add_child(GameHud.icon_rect(kiln_pic, 62))
	var kiln_box = VBoxContainer.new()
	kiln_box.add_theme_constant_override("separation", 2)
	kiln_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	kiln_box.alignment = BoxContainer.ALIGNMENT_CENTER
	firing_row.add_child(kiln_box)
	firing_bar = ProgressBar.new()
	firing_bar.show_percentage = false
	firing_bar.custom_minimum_size = Vector2(0, 22)
	GameHud.skin_bar(firing_bar, "ui_bar_fill_amber")
	kiln_box.add_child(firing_bar)
	firing_label = Label.new()
	firing_label.add_theme_font_size_override("font_size", 14)
	GameHud.bold(firing_label)
	kiln_box.add_child(firing_label)
	firing_button = Button.new()
	firing_button.focus_mode = Control.FOCUS_NONE
	firing_button.custom_minimum_size = Vector2(34, 34)
	firing_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	HudArt.glyph_button(firing_button, "glyph_pause", 20)
	firing_button.pressed.connect(func(): firing_requested.emit(not firing_paused))
	firing_row.add_child(firing_button)
	firing_row.visible = false
	box.add_child(firing_row)
	# Water shooting and warriors only show when there is something to do.
	water_button = Button.new()
	water_button.name = "WaterButton"
	water_button.focus_mode = Control.FOCUS_NONE
	_compact(water_button)
	water_button.pressed.connect(func(): water_requested.emit())
	_icon(water_button, "job_water_shot")
	box.add_child(water_button)
	warrior_button = Button.new()
	warrior_button.name = "WarriorButton"
	warrior_button.focus_mode = Control.FOCUS_NONE
	_compact(warrior_button)
	warrior_button.tooltip_text = WARRIOR_TIP
	warrior_button.pressed.connect(func(): warrior_requested.emit())
	_icon(warrior_button, "job_warrior")
	box.add_child(warrior_button)


## One half of the «Праматерь | Вручную» switch; orange when active.
func _segment(text: String, side: String) -> Button:
	var b = Button.new()
	b.text = text
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.custom_minimum_size = Vector2(0, 42)
	b.add_theme_font_size_override("font_size", 17)
	var idle = HudArt.box("ui_segment_%s_normal" % side, [10, 4, 10, 4])
	var active = HudArt.box("ui_segment_%s_active" % side, [10, 4, 10, 4])
	if idle == null or active == null:
		idle = _flat_segment(side, Color(0.98, 0.94, 0.86), Color(0.86, 0.76, 0.60))
		active = _flat_segment(side, Color(0.93, 0.52, 0.16), Color(0.79, 0.40, 0.10))
	for state in ["normal", "hover", "disabled"]:
		b.add_theme_stylebox_override(state, idle)
	b.add_theme_stylebox_override("pressed", active)
	b.add_theme_stylebox_override("hover_pressed", active)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_color_override("font_color", GameHud.INK)
	b.add_theme_color_override("font_hover_color", GameHud.INK)
	b.add_theme_color_override("font_pressed_color", Color.WHITE)
	b.add_theme_color_override("font_hover_pressed_color", Color.WHITE)
	return b


static func _flat_segment(side: String, fill: Color, border: Color) -> StyleBoxFlat:
	var sb = StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = border
	sb.set_border_width_all(1)
	var r = 10
	sb.corner_radius_top_left = r if side == "left" else 0
	sb.corner_radius_bottom_left = r if side == "left" else 0
	sb.corner_radius_top_right = r if side == "right" else 0
	sb.corner_radius_bottom_right = r if side == "right" else 0
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	return sb


static func count_jobs(snapshot: Dictionary, colony_id: String) -> Dictionary:
	var counts = {"clay": 0, "wood": 0, "stone": 0, "build": 0, "guard": 0, "fish": 0, "hunt": 0, "food": 0}
	var nodes: Dictionary = {}
	var surface = snapshot.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		for n in surface.get("resourceNodes", []):
			nodes[str(n.get("id", ""))] = str(n.get("kind", ""))
	for ant in snapshot.get("ants", []):
		if typeof(ant) != TYPE_DICTIONARY or str(ant.get("colonyId", "")) != colony_id:
			continue
		match str(ant.get("job", "")):
			"build":
				counts.build += 1
			"guard":
				counts.guard += 1
			"fish":
				counts.fish += 1
			"hunt":
				counts.hunt += 1
			"harvest":
				var kind = str(ant.get("carryKind", ""))
				if not kind in ["clay", "wood", "stone"]:
					kind = node_yield(str(nodes.get(str(ant.get("harvestNodeId", "")), "")))
				if kind in ["clay", "wood", "stone"]:
					counts[kind] += 1
			_:
				counts.food += 1
	return counts


## shared/types.ts resourceNodeYield.
static func node_yield(kind: String) -> String:
	if kind == "tree" or kind == "stick":
		return "wood"
	if kind == "stone" or kind == "loose-stone":
		return "stone"
	if kind == "clay":
		return "clay"
	return ""


func update_from_snapshot(snapshot: Dictionary, player: int) -> void:
	var colonies = snapshot.get("colonies", [])
	if typeof(colonies) != TYPE_ARRAY or player >= colonies.size():
		return
	var colony: Dictionary = colonies[player].get("colony", {})
	var colony_id = "colony-2" if player == 1 else "colony-1"
	priorities = colony.get("priorities", {}).duplicate()
	for k in KEYS:
		priorities[k] = int(priorities.get(k, 0))
	var counts = count_jobs(snapshot, colony_id)
	var population = 0
	var scouts = 0
	for ant in snapshot.get("ants", []):
		if typeof(ant) == TYPE_DICTIONARY and str(ant.get("colonyId", "")) == colony_id:
			population += 1
			if str(ant.get("forageRole", "")) == "scout":
				scouts += 1
	var assigned = 0
	for k in KEYS:
		assigned += int(priorities[k])
	free_for_plus = maxi(0, population - scouts - assigned)
	var alive = {"clay": false, "wood": false, "stone": false, "fish": false, "hunt": false}
	var loose_stone = false
	var surface = snapshot.get("surface", {})
	for n in surface.get("resourceNodes", []):
		if float(n.get("amount", 0.0)) > 0.0:
			var y = node_yield(str(n.get("kind", "")))
			if y != "":
				alive[y] = true
			if str(n.get("kind", "")) == "loose-stone":
				loose_stone = true
	for f in surface.get("fish", []):
		if str(f.get("state", "")) != "respawning":
			alive.fish = true
	for a in surface.get("animals", []):
		if str(a.get("state", "")) != "dead":
			alive.hunt = true
	var food = float(colony.get("food", 0.0))
	var alarm = bool(colony.get("alarm", false))
	var tools = {"wood": int(colony.get("axes", 0)), "stone": int(colony.get("picks", 0)), "fish": int(colony.get("rods", 0)), "hunt": int(colony.get("spears", 0))}
	_update_firing(snapshot, colony, colony_id)
	_update_water(snapshot, colony, colony_id)
	_update_warrior(snapshot, colony, colony_id)
	var auto = bool(colony.get("autoManage", false))
	if auto != auto_manage:
		auto_manage = auto
		_update_mode()
	var sig = JSON.stringify([priorities, counts, alive, free_for_plus, population, tools, food < 30.0, food < 15.0, alarm, loose_stone])
	if sig == signature:
		return
	signature = sig
	header.text = "Жители %d · Свободно %d" % [population, free_for_plus]
	header.tooltip_text = "На еде %d" % int(counts.food)
	for c in rows_box.get_children():
		c.queue_free()
	for k in KEYS:
		var target = int(priorities[k])
		var row = HBoxContainer.new()
		row.custom_minimum_size.y = 44
		row.add_theme_constant_override("separation", 8)
		var job_pic = HudArt.tex("job_" + k)
		if job_pic:
			row.add_child(GameHud.icon_rect(job_pic, 40))
		var label = Label.new()
		label.text = LABELS[k]
		label.add_theme_font_size_override("font_size", 18)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(label)
		var tip = "%s: просим %d, заняты %d" % [LABELS[k], target, int(counts[k])]
		if tools.has(k):
			tip += " · %s: %d" % [{"wood": "топоры", "stone": "кирки", "fish": "удочки", "hunt": "копья"}[k], tools[k]]
		var reason = unmet_reason(k, target, int(counts[k]), alive, alarm, population, food, tools, loose_stone)
		if reason != "":
			# A small dot on the row; the reason itself is in the tooltip.
			var dot = HudArt.tex("ui_dot_yellow")
			if dot:
				var d = GameHud.icon_rect(dot, 12)
				d.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				d.visible = false # The reason remains in the row tooltip.
				row.add_child(d)
			tip += "\n" + reason
		var minus = _button("−", target <= 0)
		minus.pressed.connect(func(): _change(k, -1))
		row.add_child(minus)
		var value = Label.new()
		value.text = str(target)
		value.custom_minimum_size = Vector2(42, 0)
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		value.add_theme_font_size_override("font_size", 17)
		GameHud.bold(value)
		row.add_child(value)
		var plus = _button("+", free_for_plus <= 0)
		plus.pressed.connect(func(): _change(k, 1))
		row.add_child(plus)
		var unit = VBoxContainer.new()
		unit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		unit.add_theme_constant_override("separation", 0)
		unit.add_child(row)
		unit.tooltip_text = tip
		rows_box.add_child(unit)
		if reason != "":
			# Kept (hidden) for the 2D-parity tests that read the reasons.
			var r = Label.new()
			r.text = "    " + reason
			r.visible = false
			unit.add_child(r)


## Why a job has fewer workers than asked (same order as the 2D panel).
static func unmet_reason(k: String, target: int, count: int, alive: Dictionary, alarm: bool, population: int, food: float, tools: Dictionary, loose_stone: bool) -> String:
	if target <= count:
		return ""
	var gather = k in ["clay", "wood", "stone"]
	if alarm and k != "guard":
		return "Тревога: рабочие у костра"
	if (gather or k == "fish") and not bool(alive.get(k, true)):
		return "Источник иссяк"
	if k == "hunt" and not bool(alive.get(k, true)):
		return "Дичи поблизости нет"
	if gather and population < 8:
		return "Для добычи нужно 8 жителей"
	if gather and food < 30.0:
		return "Добыча ждёт запаса 30 еды"
	if k == "build" and food < 15.0:
		return "Стройка ждёт запаса 15 еды"
	if k == "fish" and int(tools.get("fish", 0)) < target:
		return "Не хватает удочек"
	if k == "hunt" and int(tools.get("hunt", 0)) < target:
		return "Не хватает копий: их делает мастерская"
	if k == "stone" and int(tools.get("stone", 0)) == 0 and not loose_stone:
		return "Нужна кирка из мастерской"
	return "Нет фронта работ или свободных жителей" if k == "build" else "Ждёт свободного жителя или сдачи груза"


func _update_firing(snapshot: Dictionary, colony: Dictionary, colony_id: String) -> void:
	var kilns = 0
	var burning = 0
	var surface = snapshot.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		for b in surface.get("buildings", []):
			if typeof(b) == TYPE_DICTIONARY and str(b.get("type", "")) == "kiln" and str(b.get("stage", "")) == "built" and str(b.get("colonyId", "")) == colony_id:
				kilns += 1
				var f = b.get("firing")
				if typeof(f) == TYPE_DICTIONARY and bool(f.get("paid", false)):
					burning += 1
	var total = 0
	var fired = 0
	for ant in snapshot.get("ants", []):
		if typeof(ant) == TYPE_DICTIONARY and str(ant.get("colonyId", "")) == colony_id:
			total += 1
			if bool(ant.get("fired", false)):
				fired += 1
	firing_paused = bool(colony.get("firingPaused", false))
	firing_row.visible = kilns > 0
	firing_label.text = "Обжиг · %d из %d%s" % [fired, total, " · печь горит" if burning > 0 else ""]
	firing_bar.max_value = maxi(1, total)
	firing_bar.value = fired
	var glyph = HudArt.tex("glyph_play" if firing_paused else "glyph_pause")
	if glyph:
		firing_button.icon = glyph
	else:
		firing_button.text = "▶" if firing_paused else "⏸"
	firing_button.tooltip_text = "Обжиг на паузе — нажмите, чтобы продолжить" if firing_paused else "Обжиг идёт — нажмите, чтобы приостановить"


func _update_water(snapshot: Dictionary, colony: Dictionary, colony_id: String) -> void:
	var shop = false
	var surface = snapshot.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		for b in surface.get("buildings", []):
			if typeof(b) == TYPE_DICTIONARY and str(b.get("type", "")) == "workshop" and str(b.get("stage", "")) == "built" and str(b.get("colonyId", "")) == colony_id:
				shop = true
	var trained = bool(colony.get("waterWeapons", false))
	water_button.visible = shop or trained
	if trained:
		water_button.text = "Стража стреляет водой"
		water_button.disabled = true
	else:
		water_button.text = "Обучить стражу водяной стрельбе (%d дерево, %d камень)" % [WATER_COST.wood, WATER_COST.stone]
		water_button.disabled = float(colony.get("wood", 0)) < WATER_COST.wood or float(colony.get("stone", 0)) < WATER_COST.stone
	water_button.tooltip_text = water_button.text


## Mirrors warriorRefusal: cap 1 + one per 8 residents, special clay, a spear, a guard.
static func warrior_refusal(snapshot: Dictionary, colony: Dictionary, colony_id: String) -> String:
	var alive = 0
	var warriors = 0
	var guards = 0
	for ant in snapshot.get("ants", []):
		if typeof(ant) != TYPE_DICTIONARY or str(ant.get("colonyId", "")) != colony_id or str(ant.get("state", "")) == "dead":
			continue
		alive += 1
		if bool(ant.get("warrior", false)):
			warriors += 1
		elif str(ant.get("job", "")) == "guard":
			guards += 1
	if warriors >= 1 + alive / WARRIORS_PER_RESIDENTS:
		return "Воинов столько, сколько племя может прокормить"
	if float(colony.get("specialClay", 0)) < WARRIOR_COST.specialClay:
		return "Нужно %d особой глины" % WARRIOR_COST.specialClay
	if int(colony.get("spears", 0)) < WARRIOR_COST.spears:
		return "Нужно копьё из мастерской"
	if guards == 0:
		return "Нет стражника для посвящения"
	return ""


func _update_warrior(snapshot: Dictionary, colony: Dictionary, colony_id: String) -> void:
	var warriors = 0
	for ant in snapshot.get("ants", []):
		if typeof(ant) == TYPE_DICTIONARY and str(ant.get("colonyId", "")) == colony_id and bool(ant.get("warrior", false)) and str(ant.get("state", "")) != "dead":
			warriors += 1
	var reason = warrior_refusal(snapshot, colony, colony_id)
	warrior_button.disabled = reason != ""
	warrior_button.text = ("Посвятить воина (%d особой глины, копьё) · воинов: %d" % [WARRIOR_COST.specialClay, warriors]) if reason == "" else ("Воинов: %d · %s" % [warriors, reason])
	warrior_button.tooltip_text = warrior_button.text + "
" + WARRIOR_TIP
	warrior_button.visible = reason == ""


func _update_mode() -> void:
	if mother_seg == null:
		return
	mother_seg.button_pressed = auto_manage
	manual_seg.button_pressed = not auto_manage
	mother_seg.tooltip_text = "Праматерь сама расставляет жителей. Нажмите ± — и работы ваши."
	manual_seg.tooltip_text = "Вы распределяете жителей сами."
	mode_hint.text = mother_seg.tooltip_text if auto_manage else manual_seg.tooltip_text


func _button(text: String, disabled: bool) -> Button:
	var b = Button.new()
	b.text = text
	b.disabled = disabled
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(38, 38)
	b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	# Painted ± buttons: frame from art/hud plus the glyph; text stays as fallback.
	var family = "ui_btn_plus" if text == "+" else "ui_btn_minus"
	var glyph = HudArt.tex("glyph_plus" if text == "+" else "glyph_minus")
	if glyph and HudArt.skin_button(b, family, [4, 4, 4, 4]):
		b.text = ""
		b.icon = glyph
		b.expand_icon = true
		b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		b.add_theme_constant_override("icon_max_width", 18)
		b.modulate = Color(1, 1, 1, 0.55) if disabled else Color.WHITE
	return b


## Long-text button kept to one short line: smaller font, cut with «…»,
## the whole text in the tooltip.
static func _compact(b: Button) -> void:
	b.add_theme_font_size_override("font_size", 13)
	b.clip_text = true
	b.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	b.custom_minimum_size = Vector2(240, 0)


## Small picture at the left of a wide button.
static func _icon(b: Button, picture: String) -> void:
	var t = HudArt.tex(picture)
	if t == null:
		return
	b.icon = t
	b.expand_icon = true
	b.add_theme_constant_override("icon_max_width", 24)


func _change(k: String, delta: int) -> void:
	if delta > 0 and free_for_plus <= 0:
		return
	var next = priorities.duplicate()
	next[k] = maxi(0, int(next.get(k, 0)) + delta)
	priorities_requested.emit(next)
