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
var mode_button: Button
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


func _ready() -> void:
	name = "PriorityPanel"
	add_theme_stylebox_override("panel", GameHud.parchment())
	theme = GameHud.ink_theme()
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_force_pass_scroll_events = false
	var box = VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	add_child(box)
	var toggle = GameHud.header_button("Работы ▾")
	toggle.tooltip_text = "Свернуть или развернуть работы"
	box.add_child(toggle)
	# Everything under the title folds away with it.
	body = VBoxContainer.new()
	body.add_theme_constant_override("separation", 4)
	box.add_child(body)
	toggle.pressed.connect(func():
		body.visible = not body.visible
		toggle.text = "Работы ▾" if body.visible else "Работы ▸")
	box = body
	header = Label.new()
	header.add_theme_font_size_override("font_size", 13)
	box.add_child(header)
	# «Праматерь решает»: the tribe AI sets the targets (colony.autoManage);
	# any +/- hands them to the player (the server switches to manual).
	mode_button = Button.new()
	mode_button.name = "ModeButton"
	mode_button.focus_mode = Control.FOCUS_NONE
	mode_button.add_theme_font_size_override("font_size", 14)
	mode_button.pressed.connect(func(): auto_manage_requested.emit(not auto_manage))
	_icon(mode_button, "job_mother_auto")
	box.add_child(mode_button)
	mode_hint = Label.new()
	mode_hint.add_theme_font_size_override("font_size", 12)
	mode_hint.add_theme_color_override("font_color", GameHud.INK.lightened(0.3))
	mode_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	mode_hint.custom_minimum_size = Vector2(240, 0)
	# The hint lives in the button's tooltip; the label stays for the 2D parity.
	mode_hint.visible = false
	box.add_child(mode_hint)
	_update_mode()
	firing_row = HBoxContainer.new()
	firing_row.name = "FiringRow"
	firing_label = Label.new()
	firing_label.add_theme_font_size_override("font_size", 13)
	firing_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	firing_row.add_child(firing_label)
	firing_button = Button.new()
	firing_button.focus_mode = Control.FOCUS_NONE
	firing_button.add_theme_font_size_override("font_size", 13)
	firing_button.pressed.connect(func(): firing_requested.emit(not firing_paused))
	_icon(firing_button, "job_firing")
	firing_row.add_child(firing_button)
	firing_row.visible = false
	box.add_child(firing_row)
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
	warrior_button.tooltip_text = "Стражник у костра проходит посвящение: сильнее бьёт, меньше получает урона, носит копьё и перья. Праматерь посвящает сама, когда племени грозят."
	warrior_button.pressed.connect(func(): warrior_requested.emit())
	_icon(warrior_button, "job_warrior")
	box.add_child(warrior_button)
	rows_box = GridContainer.new()
	rows_box.columns = 1
	rows_box.add_theme_constant_override("v_separation", 2)
	rows_box.add_theme_constant_override("h_separation", 22)
	box.add_child(rows_box)


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
	header.text = "Жителей %d · свободно %d · на еде %d" % [population, free_for_plus, int(counts.food)]
	for c in rows_box.get_children():
		c.queue_free()
	for k in KEYS:
		var target = int(priorities[k])
		var row = HBoxContainer.new()
		row.add_theme_constant_override("separation", 4)
		var job_pic = HudArt.tex("job_" + k)
		if job_pic:
			row.add_child(GameHud.icon_rect(job_pic, 26))
		var label = Label.new()
		label.text = LABELS[k]
		label.add_theme_font_size_override("font_size", 15)
		label.custom_minimum_size = Vector2(72, 0)
		row.add_child(label)
		var minus = _button("−", target <= 0)
		minus.pressed.connect(func(): _change(k, -1))
		row.add_child(minus)
		var value = Label.new()
		value.text = str(target)
		value.custom_minimum_size = Vector2(22, 0)
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		row.add_child(value)
		var plus = _button("+", free_for_plus <= 0)
		plus.pressed.connect(func(): _change(k, 1))
		row.add_child(plus)
		# Busy now, then the tools in store: short, with the words in the tooltip.
		var actual = Label.new()
		actual.text = " → %d" % int(counts[k])
		actual.add_theme_font_size_override("font_size", 14)
		actual.custom_minimum_size = Vector2(34, 0)
		row.add_child(actual)
		var tip = "%s: просим %d, заняты %d" % [LABELS[k], target, int(counts[k])]
		if tools.has(k):
			var tool_word = {"wood": "топоры", "stone": "кирки", "fish": "удочки", "hunt": "копья"}[k]
			var tool_pic = HudArt.tex({"wood": "tool_axe", "stone": "tool_pickaxe", "fish": "tool_rod", "hunt": "tool_spear"}[k])
			if tool_pic:
				row.add_child(GameHud.icon_rect(tool_pic, 18))
			var t = Label.new()
			t.text = str(tools[k]) if tool_pic else "  %s: %d" % [tool_word, tools[k]]
			t.add_theme_font_size_override("font_size", 13)
			t.add_theme_color_override("font_color", GameHud.INK.lightened(0.3))
			row.add_child(t)
			tip += " · %s: %d" % [tool_word, tools[k]]
		var unit = VBoxContainer.new()
		unit.add_theme_constant_override("separation", 0)
		unit.add_child(row)
		rows_box.add_child(unit)
		var reason = unmet_reason(k, target, int(counts[k]), alive, alarm, population, food, tools, loose_stone)
		if reason != "":
			# A yellow dot on the row; the reason itself is in the tooltip.
			var dot = HudArt.tex("ui_dot_yellow")
			var r = Label.new()
			r.text = "    " + reason
			r.add_theme_font_size_override("font_size", 12)
			r.add_theme_color_override("font_color", Color(0.56, 0.32, 0.18))
			unit.add_child(r)
			if dot:
				r.visible = false
				row.add_child(GameHud.icon_rect(dot, 16))
			tip += "
" + reason
		unit.tooltip_text = tip


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
	firing_label.text = "Обожжено %d из %d%s" % [fired, total, " · печь горит" if burning > 0 else ""]
	firing_button.text = "Обжиг на паузе" if firing_paused else "Обжиг идёт"


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


func _update_mode() -> void:
	if mode_button == null:
		return
	mode_button.text = "Праматерь решает" if auto_manage else "Вручную · вернуть Праматери"
	mode_button.tooltip_text = "Праматерь сама расставляет жителей. Нажмите ± — и работы ваши." if auto_manage else "Вы распределяете жителей сами. Нажмите, чтобы вернуть Праматери."
	_icon(mode_button, "job_mother_auto" if auto_manage else "job_manual")
	mode_hint.text = "Праматерь сама расставляет жителей. Нажмите ± — и работы ваши." if auto_manage else "Вы распределяете жителей сами."


func _button(text: String, disabled: bool) -> Button:
	var b = Button.new()
	b.text = text
	b.disabled = disabled
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(28, 28)
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
## the whole text in the tooltip (kept in sync by _sync_tips).
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
