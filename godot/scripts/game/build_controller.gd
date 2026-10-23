class_name BuildController
extends Node

## Build and zone tools: a toolbar, a live placement preview that turns red
## exactly where the server would refuse (BuildRules = shared TS rules), and
## the commands the 2D client sends (placeBuilding, placeGate, paintWall,
## paintZone, eraseZone, eraseBuild). Also draws the player's zones on the ground.
##
## Point buildings: click (Shift keeps the tool). Fence: drag a brush line.
## Gate: click, R rotates. Zones and eraser: drag a rectangle. Esc/RMB cancels.

signal tool_changed(tool: String)

const TOOLS = [
	["hut", "Хижина", "1"], ["storage", "Склад", "2"], ["workshop", "Мастерская", "3"], ["idol", "Идол", "4"], ["kiln", "Печь обжига", "Q"],
	["wall", "Ограда", "5"], ["gate", "Ворота", "6"],
	["harvest", "Зона добычи", "7"], ["forbid", "Запрет", "8"], ["erase", "Ластик", "9"],
	["post", "Пост обороны", "0"],
	["totem", "Тотем рода", "T"],
	["house", "Дом рода", "U"],
]
const HINTS = {
	"hut": "Хижина: +4 к пределу жителей",
	"storage": "Склад: запасы ближе к работе",
	"workshop": "Мастерская: топоры, кирки, удочки",
	"kiln": "Печь обжига: сырые жители становятся обожжёнными — дождь им не страшен, вода почти не берёт; топится дровами",
	"idol": "Идол: ритуал победы у живого костра",
	"wall": "Ограда: тяните линию",
	"gate": "Ворота: свои проходят, чужие нет · R — поворот",
	"harvest": "Зона добычи: жители добывают только здесь · тяните прямоугольник",
	"forbid": "Запрет: жители сюда не ходят · тяните прямоугольник",
	"erase": "Ластик: снимает зоны и недостроенную ограду",
	"post": "Пост обороны: стража ждёт здесь, у ворот или у берега",
	"house": "Дом рода: щёлкните по своей хижине — вдвое больше мест для жителей; нужна особая глина",
	"totem": "Тотем рода: раздвигает землю племени — строить можно только на своей земле; источник особой глины на своей земле питает ритуал Идола",
}
const OK_COLOR := Color(0.35, 0.85, 0.4, 0.45)
const BAD_COLOR := Color(0.95, 0.25, 0.2, 0.5)

var observer: Node            # WorldObserver
var world_view: WorldView
var ws_client: Node
var hud: GameHud

var tool: String = ""
var gate_axis: String = "horizontal"
var drag_start: Vector2 = Vector2.INF
var mouse_world: Vector2 = Vector2.INF
var buttons: Dictionary = {}
var toolbar: PanelContainer

var ghost_root: Node3D
var ghost_building: Node3D
var ghost_ring: MeshInstance3D
var brush_marks: MultiMeshInstance3D
var rect_mesh: MeshInstance3D
var zone_overlay: MultiMeshInstance3D
var zone_version: String = ""
var last_reason: String = ""
var _overlay_ok: StandardMaterial3D
var _overlay_bad: StandardMaterial3D


func setup(p_observer: Node, p_world_view: WorldView, p_ws: Node, p_hud: GameHud, canvas: CanvasLayer) -> void:
	observer = p_observer
	world_view = p_world_view
	ws_client = p_ws
	hud = p_hud
	_overlay_ok = _flat_material(OK_COLOR)
	_overlay_bad = _flat_material(BAD_COLOR)
	_build_toolbar(canvas)
	_build_ghosts()


static func _flat_material(c: Color) -> StandardMaterial3D:
	var m = StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = c
	m.no_depth_test = false
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


## Tabs of the build bar: [title, tools in key order 1.., tab icon, fallback icon].
const TABS = [
	["Поселение", ["hut", "house", "storage", "workshop", "kiln", "idol"], "tab_settlement", "group_home"],
	["Оборона", ["wall", "gate", "post"], "tab_defense", "group_defense"],
	["Земля", ["totem", "harvest", "forbid", "erase"], "tab_land", "group_land"],
]
const TILE_TEXT := Color(0.98, 0.93, 0.82)
const CARD_SIZE := Vector2(150, 164)
## Orange of the active tab and selected card (mock-up).
const ACTIVE_TEXT := Color(0.85, 0.44, 0.12)
## Gap between the bar / minimap and the screen edge (WorldObserver uses it too).
const BAR_EDGE := 9
const DOCK_EDGE := 14
var tab_buttons: Array = []
var active_tab := 0
var tile_tab: Dictionary = {}   # tool -> tab index
var tile_keys: Dictionary = {}  # tool -> hotkey badge
## Short captions under the pictures; the tooltip carries the full name.
const TILE_NAMES = {"kiln": "Печь", "post": "Пост", "totem": "Тотем", "harvest": "Добыча", "house": "Дом рода"}
const COST_SHORT := Color(1.0, 0.55, 0.45)
const RES_GENITIVE = {"clay": "глины", "wood": "дерева", "stone": "камня", "special": "особой глины"}
var tile_costs: Dictionary = {}    # tool -> {res: Label}
var tile_counts: Dictionary = {}   # tool -> Label
var tile_icons: Dictionary = {}    # tool -> TextureRect
var icon_textures: Dictionary = {}
var toolbar_state: Dictionary = {} # tool -> {"short": [res], "full": bool}
## Text colours on the tiles: light on the old dark tiles, ink on painted parchment cards.
var tile_text: Color = TILE_TEXT
var cost_short: Color = COST_SHORT
var painted_cards: bool = false


static func _tile_style(fill: Color, border: Color, width: int) -> StyleBoxFlat:
	var sb = StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = border
	sb.set_border_width_all(width)
	sb.set_corner_radius_all(7)
	sb.shadow_color = Color(0, 0, 0, 0.25)
	sb.shadow_size = 2
	sb.content_margin_left = 4
	sb.content_margin_right = 4
	sb.content_margin_top = 3
	sb.content_margin_bottom = 3
	return sb


## Build bar like the owner's mock-up (docs/godot/reference/hud_target.png):
## tabs «Поселение / Оборона / Земля» above one row of cards; only the active
## tab's cards show. Keys 1–6 pick a card of the active tab, Tab switches tabs.
## A card: hotkey badge, picture, name, cost as resource icons (short ones red);
## a reached limit greys the card (update_from_snapshot).
func _build_toolbar(canvas: CanvasLayer) -> void:
	toolbar = PanelContainer.new()
	toolbar.name = "BuildToolbar"
	toolbar.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	toolbar.theme = GameHud.ink_theme()
	toolbar.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	toolbar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	toolbar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	toolbar.offset_bottom = -BAR_EDGE
	toolbar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(toolbar)
	canvas.move_child(toolbar, 0)
	# Painted cards (art/hud build_*); a building without one is rendered from its model.
	painted_cards = HudArt.tex("card_build_normal") != null
	if painted_cards:
		tile_text = GameHud.INK
		cost_short = Color(0.78, 0.18, 0.10)
	var kinds: Array = []
	for spec in TOOLS:
		var painted = HudArt.tex("build_" + spec[0])
		if painted:
			icon_textures[spec[0]] = painted
		else:
			kinds.append(spec[0])
	icon_textures.merge(BuildIcons.create(self, kinds))
	var column = VBoxContainer.new()
	column.add_theme_constant_override("separation", -4)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toolbar.add_child(column)
	# The tab strip sticks up from the card panel, centred.
	var tab_panel = PanelContainer.new()
	tab_panel.name = "BuildTabs"
	tab_panel.custom_minimum_size.x = 780
	var strip = HudArt.box("ui_tabbar", [18, 6, 18, 6])
	tab_panel.add_theme_stylebox_override("panel", strip if strip else GameHud.parchment([18, 6, 18, 6]))
	tab_panel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	tab_panel.mouse_force_pass_scroll_events = false
	column.add_child(tab_panel)
	var tab_row = HBoxContainer.new()
	tab_row.add_theme_constant_override("separation", 6)
	tab_panel.add_child(tab_row)
	for i in range(TABS.size()):
		if i > 0:
			var sep = VSeparator.new()
			sep.add_theme_constant_override("separation", 14)
			tab_row.add_child(sep)
		tab_row.add_child(_make_tab(i))
	var cards_panel = PanelContainer.new()
	cards_panel.name = "BuildCards"
	cards_panel.add_theme_stylebox_override("panel", GameHud.parchment([14, 12, 14, 12]))
	cards_panel.mouse_force_pass_scroll_events = false
	column.add_child(cards_panel)
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.custom_minimum_size = Vector2(CARD_SIZE.x * 6 + 8 * 5, 0)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	cards_panel.add_child(row)
	var specs: Dictionary = {}
	for spec in TOOLS:
		specs[spec[0]] = spec
	for i in range(TABS.size()):
		var tools: Array = TABS[i][1]
		for n in range(tools.size()):
			var tile = _make_tile(specs[tools[n]], n + 1)
			tile_tab[tools[n]] = i
			row.add_child(tile)
	show_tab(0)


func _make_tab(i: int) -> Button:
	var b = Button.new()
	b.name = "Tab_%d" % i
	b.text = TABS[i][0]
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.add_theme_font_size_override("font_size", 19)
	GameHud.bold(b)
	b.add_theme_color_override("font_color", GameHud.INK.lightened(0.15))
	b.add_theme_color_override("font_hover_color", GameHud.INK)
	for state in ["font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(state, ACTIVE_TEXT)
	var icon = HudArt.tex(TABS[i][2])
	if icon == null:
		icon = HudArt.tex(TABS[i][3])
	if icon:
		b.text = ""
		b.tooltip_text = TABS[i][0]
		b.custom_minimum_size.y = 38
		var center = CenterContainer.new()
		center.name = "Contents"
		center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		center.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(center)
		var contents = HBoxContainer.new()
		contents.name = "Row"
		contents.add_theme_constant_override("separation", 8)
		contents.mouse_filter = Control.MOUSE_FILTER_IGNORE
		center.add_child(contents)
		contents.add_child(GameHud.icon_rect(icon, 26))
		var caption = _plain_label(TABS[i][0], 19, GameHud.INK)
		caption.name = "Caption"
		GameHud.bold(caption)
		contents.add_child(caption)
	var idle = StyleBoxEmpty.new()
	idle.content_margin_left = 14
	idle.content_margin_right = 14
	idle.content_margin_top = 4
	idle.content_margin_bottom = 7
	# Active tab: an orange line under it, like the mock-up.
	var line = StyleBoxFlat.new()
	line.bg_color = Color.TRANSPARENT
	line.border_color = ACTIVE_TEXT
	line.border_width_bottom = 3
	line.content_margin_left = 14
	line.content_margin_right = 14
	line.content_margin_top = 4
	line.content_margin_bottom = 7
	for state in ["normal", "hover", "disabled"]:
		b.add_theme_stylebox_override(state, idle)
	b.add_theme_stylebox_override("pressed", line)
	b.add_theme_stylebox_override("hover_pressed", line)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.pressed.connect(func(): show_tab(i))
	tab_buttons.append(b)
	return b


## Shows one tab's cards (and leaves the tool alone).
func show_tab(i: int) -> void:
	active_tab = i
	for n in range(tab_buttons.size()):
		tab_buttons[n].button_pressed = n == i
		var caption = tab_buttons[n].get_node_or_null("Contents/Row/Caption")
		if caption:
			caption.add_theme_color_override("font_color", ACTIVE_TEXT if n == i else GameHud.INK)
	for t in buttons.keys():
		buttons[t].visible = int(tile_tab.get(t, 0)) == i


func _plain_label(text: String, size: int, color: Color) -> Label:
	var l = Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _make_tile(spec: Array, slot: int) -> Button:
	var t: String = spec[0]
	var b = Button.new()
	b.name = "Tool_" + t
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = CARD_SIZE
	b.tooltip_text = "%s  [%d]" % [HINTS[t], slot]
	if not (painted_cards and HudArt.skin_button(b, "card_build", [6, 6, 6, 6])):
		b.add_theme_stylebox_override("normal", _tile_style(Color(0.45, 0.34, 0.23), Color(0.27, 0.19, 0.12), 2))
		b.add_theme_stylebox_override("hover", _tile_style(Color(0.53, 0.41, 0.28), Color(0.33, 0.24, 0.15), 2))
		b.add_theme_stylebox_override("pressed", _tile_style(Color(0.58, 0.45, 0.28), Color(0.98, 0.80, 0.30), 3))
		b.add_theme_stylebox_override("hover_pressed", _tile_style(Color(0.62, 0.48, 0.30), Color(0.98, 0.80, 0.30), 3))
	b.pressed.connect(func(): set_tool("" if tool == t else t))
	var box = VBoxContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	box.offset_left = 6
	box.offset_right = -6
	box.offset_top = 8
	box.offset_bottom = -8
	box.add_theme_constant_override("separation", 0)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(box)
	var pic = TextureRect.new()
	pic.texture = icon_textures.get(t)
	pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	pic.custom_minimum_size = Vector2(CARD_SIZE.x - 22, 82)
	pic.size_flags_vertical = Control.SIZE_EXPAND_FILL
	pic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(pic)
	tile_icons[t] = pic
	var sign = null if HudArt.tex("build_" + t) else BuildIcons.sign_for(t)
	if sign:
		var s = TextureRect.new()
		s.texture = sign
		s.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
		s.offset_left = -30
		s.offset_top = -30
		s.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		s.mouse_filter = Control.MOUSE_FILTER_IGNORE
		pic.add_child(s)
	var name_label = _plain_label(TILE_NAMES.get(t, spec[1]), 16, tile_text)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.clip_text = true
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	box.add_child(name_label)
	var cost_row = HBoxContainer.new()
	cost_row.alignment = BoxContainer.ALIGNMENT_CENTER
	cost_row.add_theme_constant_override("separation", 3)
	cost_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(cost_row)
	var costs: Dictionary = {}
	var cost: Dictionary = BuildRules.COSTS.get(t, {})
	for res in ["clay", "wood", "stone", "special"]:
		if int(cost.get(res, 0)) <= 0:
			continue
		if not costs.is_empty():
			cost_row.add_child(_spacer(3))
		cost_row.add_child(GameHud.icon_rect(GameHud.make_icon(res), 18))
		var n = _plain_label(str(int(cost[res])), 15, tile_text)
		cost_row.add_child(n)
		costs[res] = n
	if costs.is_empty():
		cost_row.add_child(_plain_label("даром", 15, tile_text.lightened(0.25) if painted_cards else tile_text.darkened(0.2)))
	tile_costs[t] = costs
	var key = _plain_label(str(slot), 13, GameHud.INK)
	key.name = "Key"
	key.position = Vector2(7, 6)
	key.custom_minimum_size = Vector2(26, 26)
	key.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	key.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	b.add_child(key)
	tile_keys[t] = key
	_style_key(t, false)
	if BuildRules.LIMITS.has(t):
		# Built / limit lives in the tooltip; the label is kept for the tests and shots.
		var count = _plain_label("", 12, tile_text)
		count.visible = false
		b.add_child(count)
		tile_counts[t] = count
	buttons[t] = b
	return b


func _spacer(w: float) -> Control:
	var c = Control.new()
	c.custom_minimum_size = Vector2(w, 0)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c


## Hotkey badge in the card corner: orange on the selected card.
func _style_key(t: String, active: bool) -> void:
	var key: Label = tile_keys.get(t)
	if key == null:
		return
	var sb = HudArt.box("ui_key_badge_active" if active else "ui_key_badge_normal", [0, 0, 0, 0])
	if sb == null:
		var flat = StyleBoxFlat.new()
		flat.bg_color = Color(0.95, 0.60, 0.22) if active else Color(0.98, 0.93, 0.84)
		flat.border_color = Color(0.79, 0.40, 0.10) if active else Color(0.86, 0.76, 0.60)
		flat.set_border_width_all(1)
		flat.set_corner_radius_all(5)
		sb = flat
	key.add_theme_stylebox_override("normal", sb)
	# A Label draws its skin behind glyphs only when its full rect is expanded.
	key.size = key.custom_minimum_size
	GameHud.bold(key)
	key.add_theme_color_override("font_color", Color.WHITE if active else GameHud.INK)


## Resources and building counts of the player's tribe: short costs go red,
## a reached limit greys the picture and says so in the tooltip.
func update_from_snapshot(snapshot: Dictionary, player: int) -> void:
	var colonies = snapshot.get("colonies", [])
	if typeof(colonies) != TYPE_ARRAY or player >= colonies.size():
		return
	var colony: Dictionary = colonies[player].get("colony", {})
	var owner = "colony-2" if player == 1 else "colony-1"
	var built: Dictionary = {}
	var surface = snapshot.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		for bd in surface.get("buildings", []):
			if typeof(bd) == TYPE_DICTIONARY and str(bd.get("colonyId", "")) == owner:
				var bt = str(bd.get("type", ""))
				built[bt] = int(built.get(bt, 0)) + 1
	for spec in TOOLS:
		var t: String = spec[0]
		var short: Array = []
		var cost: Dictionary = BuildRules.COSTS.get(t, {})
		for res in tile_costs[t].keys():
			var lack = float(colony.get("specialClay" if res == "special" else res, 0.0)) < float(cost.get(res, 0))
			if lack:
				short.append(res)
			(tile_costs[t][res] as Label).add_theme_color_override("font_color", cost_short if lack else tile_text)
		var full = false
		if tile_counts.has(t):
			var n = int(built.get(t, 0))
			var limit = int(BuildRules.LIMITS[t])
			full = n >= limit
			(tile_counts[t] as Label).text = "%d/%d" % [n, limit]
		(tile_icons[t] as TextureRect).modulate = Color(0.45, 0.45, 0.45) if full else (Color(0.8, 0.75, 0.72) if not short.is_empty() else Color.WHITE)
		if painted_cards and full != bool(toolbar_state.get(t, {}).get("full", false)):
			var card = HudArt.box("card_build_disabled" if full else "card_build_normal", [6, 6, 6, 6])
			if card:
				(buttons[t] as Button).add_theme_stylebox_override("normal", card)
		var slot = (TABS[int(tile_tab.get(t, 0))][1] as Array).find(t) + 1
		var tip = "%s  [%d]" % [HINTS[t], slot]
		if tile_counts.has(t):
			tip += "
Построено " + (tile_counts[t] as Label).text
		if full:
			tip += "\nДостигнут предел этих построек"
		elif not short.is_empty():
			tip += "\nНе хватает: " + ", ".join(short.map(func(r): return RES_GENITIVE[r]))
		(buttons[t] as Button).tooltip_text = tip
		toolbar_state[t] = {"short": short, "full": full}


func _build_ghosts() -> void:
	ghost_root = Node3D.new()
	ghost_root.name = "BuildGhost"
	world_view.add_child(ghost_root)
	ghost_ring = MeshInstance3D.new()
	var ring = TorusMesh.new()
	ring.inner_radius = 0.92
	ring.outer_radius = 1.0
	ring.rings = 48
	ring.ring_segments = 4
	ghost_ring.mesh = ring
	ghost_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ghost_root.add_child(ghost_ring)
	brush_marks = MultiMeshInstance3D.new()
	var mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var mark = BoxMesh.new()
	mark.size = Vector3(1.7, 0.5, 1.7)
	var mat = _flat_material(Color.WHITE)
	mat.vertex_color_use_as_albedo = true
	mark.material = mat
	mm.mesh = mark
	brush_marks.multimesh = mm
	brush_marks.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ghost_root.add_child(brush_marks)
	rect_mesh = MeshInstance3D.new()
	rect_mesh.mesh = PlaneMesh.new()
	rect_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ghost_root.add_child(rect_mesh)
	zone_overlay = MultiMeshInstance3D.new()
	zone_overlay.name = "ZoneOverlay"
	var zmm = MultiMesh.new()
	zmm.transform_format = MultiMesh.TRANSFORM_3D
	zmm.use_colors = true
	var quad = PlaneMesh.new()
	quad.size = Vector2(3.8, 3.8)
	var zmat = _flat_material(Color.WHITE)
	zmat.vertex_color_use_as_albedo = true
	quad.material = zmat
	zmm.mesh = quad
	zone_overlay.multimesh = zmm
	zone_overlay.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world_view.add_child(zone_overlay)
	_hide_ghosts()


func set_tool(t: String) -> void:
	tool = t
	last_reason = ""
	drag_start = Vector2.INF
	for k in buttons.keys():
		buttons[k].button_pressed = k == t
		_style_key(k, k == t)
	if t != "" and tile_tab.has(t) and int(tile_tab[t]) != active_tab:
		show_tab(int(tile_tab[t]))
	if ghost_building:
		ghost_building.queue_free()
		ghost_building = null
	if t in ["hut", "storage", "workshop", "idol", "kiln", "totem", "gate", "post"]:
		ghost_building = _make_ghost(t)
		ghost_root.add_child(ghost_building)
	_hide_ghosts()
	tool_changed.emit(t)


func _make_ghost(t: String) -> Node3D:
	var node: Node3D
	match t:
		"hut":
			node = Node3D.new()
			var scene = load("res://assets/models/hut.glb") as PackedScene
			if scene:
				var hut = scene.instantiate() as Node3D
				hut.scale = WorldView.HUT_SCALE
				hut.position = Vector3(0, 0, 0.5)
				node.add_child(hut)
		"storage":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.storage()
		"workshop":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.workshop()
		"kiln":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.kiln()
		"totem":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.totem(WorldView.POST_COLORS[1 if _owner() == "colony-2" else 0])
		"idol":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.idol()
		"post":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.post_pole()
		_:
			node = MeshInstance3D.new()
			node.mesh = PropFactory.gate(float(BuildRules.GATE_SPAN) * BuildRules.WALL_CELL_SIZE, false)
	return node


func _set_ghost_tint(node: Node, ok: bool) -> void:
	if node is GeometryInstance3D:
		node.material_overlay = _overlay_ok if ok else _overlay_bad
		node.transparency = 0.35
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in node.get_children():
		_set_ghost_tint(c, ok)


func _hide_ghosts() -> void:
	if ghost_building:
		ghost_building.visible = false
	ghost_ring.visible = false
	brush_marks.multimesh.instance_count = 0
	rect_mesh.visible = false


func _surface() -> Dictionary:
	var s = world_view.last_snapshot.get("surface", {})
	return s if typeof(s) == TYPE_DICTIONARY else {}


func _owner() -> String:
	return "colony-1" if int(observer.player_colony) == 0 else "colony-2"


func _ground(p: Vector2, lift: float = 0.0) -> Vector3:
	return Vector3(p.x, SurfaceTerrain.height_at(p.x, p.y) + lift, p.y)


## Called every frame with the mouse ground point (INF when over UI).
func update_preview(p: Vector2) -> void:
	mouse_world = p
	update_zone_overlay()
	if tool == "" or p == Vector2.INF:
		_hide_ghosts()
		return
	var surface = _surface()
	var owner = _owner()
	match tool:
		"hut", "storage", "workshop", "idol", "kiln", "totem":
			last_reason = BuildRules.point_building_placement(surface, owner, tool, p)
			ghost_building.visible = true
			ghost_building.position = _ground(p)
			_set_ghost_tint(ghost_building, last_reason == "")
			var f = BuildingGeometry.get_building_footprint({"type": tool, "stage": "built", "pos": {"x": p.x, "y": p.y}})
			ghost_ring.visible = true
			ghost_ring.position = _ground(Vector2(f.x, f.y), 0.08)
			ghost_ring.scale = Vector3(float(f.rx), 1.0, float(f.ry))
			ghost_ring.material_override = _overlay_ok if last_reason == "" else _overlay_bad
			_hint(last_reason, tool)
		"post":
			last_reason = BuildRules.post_placement(surface, owner, p)
			ghost_building.visible = true
			ghost_building.position = _ground(p)
			_set_ghost_tint(ghost_building, last_reason == "")
			hud.show_tooltip(HINTS.post if last_reason == "" else "Пост обороны: " + last_reason, observer.get_viewport().get_mouse_position())
		"gate":
			last_reason = BuildRules.gate_placement(surface, owner, p, gate_axis)
			var snapped = BuildRules.snap_fence_position(p)
			ghost_building.visible = true
			ghost_building.position = _ground(snapped)
			ghost_building.rotation.y = PI * 0.5 if gate_axis == "vertical" else 0.0
			_set_ghost_tint(ghost_building, last_reason == "")
			_set_marks(BuildRules.gate_cell_centers(p, gate_axis).map(func(c): return [c, BuildRules.fence_placement(surface, owner, c, true) == ""]))
			_hint(last_reason, tool)
		"wall":
			var cells = BuildRules.wall_line_cells(surface, drag_start if drag_start != Vector2.INF else p, p)
			var marks = []
			var ok_count = 0
			for idx in cells:
				var c = BuildRules.cell_center(surface, idx, BuildRules.WALL_CELL_SIZE)
				var ok = BuildRules.fence_placement(surface, owner, c) == ""
				ok_count += int(ok)
				marks.append([c, ok])
			_set_marks(marks)
			hud.show_tooltip("Ограда · %d секц. · %s" % [ok_count, _cost_times("wall", ok_count)] if drag_start != Vector2.INF else HINTS.wall, observer.get_viewport().get_mouse_position())
		"house":
			var target = BuildRules.house_target(surface, observer.world_view.last_snapshot.get("colonies", [{}])[observer.player_colony].get("colony", {}), owner, p)
			last_reason = target[1]
			var hut: Dictionary = target[0]
			ghost_ring.visible = not hut.is_empty()
			if not hut.is_empty():
				var hp = BuildRules._pos(hut.get("pos"))
				ghost_ring.position = _ground(Vector2(hp.x, hp.y + 0.5), 0.08)
				ghost_ring.scale = Vector3(4.6, 1.0, 2.9)
				ghost_ring.material_override = _overlay_ok if last_reason == "" else _overlay_bad
			hud.show_tooltip("Дом рода · %s" % BuildRules.cost_text("house") if last_reason == "" else "Дом рода: " + last_reason, observer.get_viewport().get_mouse_position())
		"harvest", "forbid", "erase":
			var a = drag_start if drag_start != Vector2.INF else p
			_show_rect(a, p)
			var n = BuildRules.rect_cells(surface, a, p, BuildRules.ZONE_CELL_SIZE).size()
			hud.show_tooltip(HINTS[tool] if drag_start == Vector2.INF else "%s · %d клеток" % [{"harvest": "Зона добычи", "forbid": "Запрет", "erase": "Ластик"}[tool], n], observer.get_viewport().get_mouse_position())


func _cost_times(kind: String, n: int) -> String:
	var c: Dictionary = BuildRules.COSTS.get(kind, {})
	var parts: PackedStringArray = []
	for res in [["clay", "глина"], ["wood", "дерево"], ["stone", "камень"]]:
		if int(c.get(res[0], 0)) > 0:
			parts.append("%d %s" % [int(c[res[0]]) * n, res[1]])
	return ", ".join(parts)


func _hint(reason: String, kind: String) -> void:
	var name = {"hut": "Хижина", "storage": "Склад", "workshop": "Мастерская", "idol": "Идол", "kiln": "Печь обжига", "totem": "Тотем рода", "gate": "Ворота"}.get(kind, "")
	var text = "%s · %s" % [name, BuildRules.cost_text(kind)] if reason == "" else "%s: %s" % [name, reason]
	hud.show_tooltip(text, observer.get_viewport().get_mouse_position())


func _set_marks(marks: Array) -> void:
	var mm = brush_marks.multimesh
	mm.instance_count = marks.size()
	for i in range(marks.size()):
		var c: Vector2 = marks[i][0]
		mm.set_instance_transform(i, Transform3D(Basis(), _ground(c, 0.25)))
		mm.set_instance_color(i, OK_COLOR if marks[i][1] else BAD_COLOR)


func _show_rect(a: Vector2, b: Vector2) -> void:
	var lo = Vector2(floor(minf(a.x, b.x) / 4.0) * 4.0, floor(minf(a.y, b.y) / 4.0) * 4.0)
	var hi = Vector2(floor(maxf(a.x, b.x) / 4.0) * 4.0 + 4.0, floor(maxf(a.y, b.y) / 4.0) * 4.0 + 4.0)
	var plane = rect_mesh.mesh as PlaneMesh
	plane.size = hi - lo
	rect_mesh.visible = true
	var centre = (lo + hi) * 0.5
	rect_mesh.position = _ground(centre, 0.15)
	var col = {"harvest": Color(0.35, 0.85, 0.4, 0.3), "forbid": Color(0.95, 0.3, 0.2, 0.35), "erase": Color(0.85, 0.85, 0.85, 0.3)}[tool]
	rect_mesh.material_override = _flat_material(col)


## Player's zones from colonies[player].colony.zones, rebuilt when they change.
func update_zone_overlay() -> void:
	var colonies = world_view.last_snapshot.get("colonies", [])
	var idx = int(observer.player_colony)
	var zones = {}
	if typeof(colonies) == TYPE_ARRAY and idx < colonies.size() and typeof(colonies[idx]) == TYPE_DICTIONARY:
		var c = colonies[idx].get("colony", {})
		if typeof(c) == TYPE_DICTIONARY and typeof(c.get("zones")) == TYPE_DICTIONARY:
			zones = c.zones
	var harvest: Array = zones.get("harvest", [])
	var forbid: Array = zones.get("forbid", [])
	var version = "%s:%d:%d:%d" % [str(zones.get("version", "")), idx, harvest.size(), forbid.size()]
	if version == zone_version:
		return
	zone_version = version
	var surface = _surface()
	var mm = zone_overlay.multimesh
	mm.instance_count = harvest.size() + forbid.size()
	var i = 0
	for list in [[harvest, Color(0.4, 0.85, 0.35, 0.22)], [forbid, Color(0.95, 0.3, 0.2, 0.28)]]:
		for cell in list[0]:
			var c = BuildRules.cell_center(surface, int(cell), BuildRules.ZONE_CELL_SIZE)
			mm.set_instance_transform(i, Transform3D(Basis(), _ground(c, 0.07)))
			mm.set_instance_color(i, list[1])
			i += 1


## Returns true when the event belongs to the active tool.
func handle_input(event: InputEvent, ground_point: Callable) -> bool:
	if event is InputEventKey and event.pressed and not event.echo:
		# 1–6: a card of the active tab; Tab / Shift+Tab: next / previous tab.
		if event.keycode == KEY_TAB:
			show_tab(posmod(active_tab + (-1 if event.shift_pressed else 1), TABS.size()))
			return true
		var n = event.keycode - KEY_1
		var tools: Array = TABS[active_tab][1]
		if n >= 0 and n < tools.size():
			set_tool("" if tool == tools[n] else tools[n])
			return true
		if tool == "":
			return false
		if event.keycode == KEY_ESCAPE:
			set_tool("")
			return true
		if event.keycode == KEY_R and tool == "gate":
			gate_axis = "vertical" if gate_axis == "horizontal" else "horizontal"
			return true
		return false
	if tool == "" or not (event is InputEventMouseButton):
		return false
	# Right click cancels on release: a held right button turns the camera, and
	# WorldView swallows the release when it did.
	if event.button_index == MOUSE_BUTTON_RIGHT:
		if not event.pressed:
			set_tool("")
		return true
	if event.button_index != MOUSE_BUTTON_LEFT:
		return false
	var p: Vector2 = ground_point.call(event.position)
	if p == Vector2.INF:
		return true
	if tool in ["hut", "storage", "workshop", "idol", "kiln", "totem", "gate", "post", "house"]:
		if event.pressed:
			_place_point(p, event.shift_pressed)
		return true
	if event.pressed:
		drag_start = p
	elif drag_start != Vector2.INF:
		_commit_drag(drag_start, p)
		drag_start = Vector2.INF
	return true


## Digits by keycode; letters by physical key so a Russian layout works too.
static func _hotkey_matches(event: InputEventKey, key: String) -> bool:
	if key.is_valid_int():
		return event.keycode == KEY_0 + int(key)
	var code = OS.find_keycode_from_string(key)
	return event.physical_keycode == code or event.keycode == code


func _place_point(p: Vector2, keep_tool: bool) -> void:
	var surface = _surface()
	var colony = int(observer.player_colony)
	if tool == "house":
		var target = BuildRules.house_target(surface, observer.world_view.last_snapshot.get("colonies", [{}])[colony].get("colony", {}), _owner(), p)
		if target[1] != "":
			return
		ws_client.send_command({"type": "upgradeHut", "buildingId": str(target[0].get("id", "")), "colony": colony})
		if not keep_tool:
			set_tool("")
		return
	if tool == "post":
		if BuildRules.post_placement(surface, _owner(), p) != "":
			return
		ws_client.send_command({"type": "setDefensePost", "x": p.x, "y": p.y, "colony": colony})
		set_tool("")
		return
	if tool == "gate":
		if BuildRules.gate_placement(surface, _owner(), p, gate_axis) != "":
			return
		var snapped = BuildRules.snap_fence_position(p)
		ws_client.send_command({"type": "placeGate", "x": snapped.x, "y": snapped.y, "axis": gate_axis, "colony": colony})
	else:
		if BuildRules.point_building_placement(surface, _owner(), tool, p) != "":
			return
		ws_client.send_command({"type": "placeBuilding", "building": tool, "x": p.x, "y": p.y, "colony": colony})
	if not keep_tool:
		set_tool("")


func _send_chunked(type: String, cells: Array, extra: Dictionary, chunk: int) -> void:
	for start in range(0, cells.size(), chunk):
		var cmd = {"type": type, "cells": cells.slice(start, start + chunk), "colony": int(observer.player_colony)}
		cmd.merge(extra)
		ws_client.send_command(cmd)


func _commit_drag(a: Vector2, b: Vector2) -> void:
	var surface = _surface()
	match tool:
		"wall":
			var owner = _owner()
			var dry = BuildRules.wall_line_cells(surface, a, b).filter(func(idx): return BuildRules.fence_placement(surface, owner, BuildRules.cell_center(surface, idx, BuildRules.WALL_CELL_SIZE)) == "")
			if not dry.is_empty():
				_send_chunked("paintWall", dry, {}, 500)
		"harvest", "forbid":
			_send_chunked("paintZone", BuildRules.rect_cells(surface, a, b, BuildRules.ZONE_CELL_SIZE), {"zone": tool}, 4000)
		"erase":
			_send_chunked("eraseZone", BuildRules.rect_cells(surface, a, b, BuildRules.ZONE_CELL_SIZE), {}, 4000)
			_send_chunked("eraseBuild", BuildRules.rect_cells(surface, a, b, BuildRules.WALL_CELL_SIZE), {}, 500)
