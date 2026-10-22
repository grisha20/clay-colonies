class_name BottomDock
extends PanelContainer

## Stronghold-style bottom panel, moulded in clay in a wooden frame:
##  - a clay slab with category tabs: the build groups of BuildController and
##    the «Работы» panel; hovering a tile writes its description on the slab;
##  - a narrow column of game buttons (pause, speeds, alarm, settings);
##  - a clay tablet with the tribe's key numbers;
##  - the mother's portrait in the corner (her speech bubble rises above the
##    panel on the right).
## The pieces are built by their owners (BuildController, PriorityPanel,
## GameHud, MotherSpeaker) and re-parented here, so their logic is unchanged.

signal tab_changed(index: int)

const WOOD := Color(0.36, 0.23, 0.14, 0.97)
const WOOD_LIGHT := Color(0.55, 0.38, 0.22)
const SLAB := Color(0.93, 0.85, 0.68, 0.98)
const TABLET := Color(0.80, 0.56, 0.38)
const ROPE := Color(0.78, 0.66, 0.42)

var slab: PanelContainer
var tabs_row: HBoxContainer
var pages: Array[Control] = []
## Pages that show the slab description on the right (build tabs, not works).
var page_hints: Array[bool] = []
var tab_buttons: Array[Button] = []
var current_tab := 0
var hint_label: Label
var column: GridContainer
var tablet_labels: Dictionary = {}
var portrait_slot: Control
var pages_box: Control
const PHASES = {"day": "день", "dusk": "вечер", "night": "ночь", "dawn": "утро"}
var default_hint := "Наведите на постройку — здесь будет её описание"


func _init() -> void:
	name = "BottomDock"
	add_theme_stylebox_override("panel", _wood_style())
	theme = GameHud.ink_theme()
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_force_pass_scroll_events = false
	set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	grow_vertical = Control.GROW_DIRECTION_BEGIN
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	add_child(row)
	# Clay slab: tabs on top, the page and the description below.
	slab = PanelContainer.new()
	slab.name = "Slab"
	slab.add_theme_stylebox_override("panel", _slab_style())
	slab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(slab)
	var slab_box = VBoxContainer.new()
	slab_box.add_theme_constant_override("separation", 4)
	slab.add_child(slab_box)
	tabs_row = HBoxContainer.new()
	tabs_row.add_theme_constant_override("separation", 4)
	slab_box.add_child(tabs_row)
	var page_row = HBoxContainer.new()
	page_row.name = "PageRow"
	page_row.add_theme_constant_override("separation", 12)
	slab_box.add_child(page_row)
	pages_box = Control.new()
	pages_box.name = "Pages"
	pages_box.size_flags_horizontal = Control.SIZE_FILL
	page_row.add_child(pages_box)
	hint_label = Label.new()
	hint_label.name = "SlabHint"
	hint_label.text = default_hint
	hint_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint_label.custom_minimum_size = Vector2(240, 0)
	hint_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hint_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	hint_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	hint_label.add_theme_font_size_override("font_size", 15)
	hint_label.add_theme_color_override("font_color", GameHud.INK.lightened(0.1))
	page_row.add_child(hint_label)
	# Game buttons.
	column = GridContainer.new()
	column.columns = 2
	column.name = "Buttons"
	column.add_theme_constant_override("h_separation", 4)
	column.add_theme_constant_override("v_separation", 4)
	column.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(column)
	# Clay tablet with the key numbers.
	var tablet = PanelContainer.new()
	tablet.name = "Tablet"
	var ts = StyleBoxFlat.new()
	ts.bg_color = TABLET
	ts.border_color = TABLET.darkened(0.35)
	ts.set_border_width_all(2)
	ts.set_corner_radius_all(14)
	ts.content_margin_left = 12; ts.content_margin_right = 12; ts.content_margin_top = 8; ts.content_margin_bottom = 8
	ts.shadow_color = Color(0, 0, 0, 0.3); ts.shadow_size = 3
	tablet.add_theme_stylebox_override("panel", ts)
	tablet.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	tablet.custom_minimum_size = Vector2(150, 0)
	row.add_child(tablet)
	var tbox = VBoxContainer.new()
	tbox.add_theme_constant_override("separation", 2)
	tablet.add_child(tbox)
	for spec in [["people", "Жители"], ["food", "Еда"], ["special", "Особая глина"], ["day", "День"]]:
		var l = Label.new()
		l.add_theme_font_size_override("font_size", 16 if spec[0] != "day" else 13)
		l.add_theme_color_override("font_color", Color(0.22, 0.12, 0.07))
		l.text = spec[1]
		tbox.add_child(l)
		tablet_labels[spec[0]] = l
	# Room for the mother's portrait in the corner.
	portrait_slot = CenterContainer.new()
	portrait_slot.name = "PortraitSlot"
	row.add_child(portrait_slot)


static func _wood_style() -> StyleBoxFlat:
	var sb = StyleBoxFlat.new()
	sb.bg_color = WOOD
	sb.border_color = WOOD_LIGHT
	sb.set_border_width_all(3)
	sb.border_width_top = 5
	sb.corner_radius_top_left = 12
	sb.corner_radius_top_right = 12
	sb.content_margin_left = 12; sb.content_margin_right = 10; sb.content_margin_top = 8; sb.content_margin_bottom = 8
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_size = 6
	return sb


static func _slab_style() -> StyleBoxFlat:
	var sb = StyleBoxFlat.new()
	sb.bg_color = SLAB
	sb.border_color = Color(0.62, 0.45, 0.28)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(9)
	sb.content_margin_left = 10; sb.content_margin_right = 10; sb.content_margin_top = 6; sb.content_margin_bottom = 6
	return sb


## Wood grain and rope knots on the frame.
func _draw() -> void:
	var r = Rect2(Vector2.ZERO, size)
	for i in range(6):
		var y = 6.0 + (r.size.y - 12.0) * float(i) / 5.0
		draw_line(Vector2(6, y), Vector2(r.size.x - 6, y + sin(i * 1.7) * 2.0), Color(0.28, 0.17, 0.10, 0.35), 1.0)
	for x in [10.0, r.size.x - 10.0]:
		for k in range(3):
			draw_circle(Vector2(x, 4.0 + k * 5.0), 3.2, ROPE.darkened(0.1 * k))
	for k in range(int(r.size.x / 46.0)):
		draw_circle(Vector2(30.0 + k * 46.0, 2.5), 2.0, ROPE)


## A page under a tab: the control is moved onto the slab.
func add_page(title: String, page: Control, with_hint := true) -> void:
	page_hints.append(with_hint)
	if page.get_parent():
		page.get_parent().remove_child(page)
	pages_box.add_child(page)
	page.visible = pages.is_empty()
	pages.append(page)
	var b = Button.new()
	b.text = title
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.button_pressed = tab_buttons.is_empty()
	var index = tab_buttons.size()
	b.pressed.connect(func(): select_tab(index))
	tabs_row.add_child(b)
	tab_buttons.append(b)
	_fit_pages()


func select_tab(index: int) -> void:
	current_tab = clampi(index, 0, pages.size() - 1)
	for i in range(pages.size()):
		pages[i].visible = i == current_tab
		tab_buttons[i].set_pressed_no_signal(i == current_tab)
	hint_label.text = default_hint
	hint_label.visible = page_hints[current_tab]
	_fit_pages()
	tab_changed.emit(current_tab)


## The slab grows to the shown page (the works page is taller than tiles).
func _fit_pages() -> void:
	if pages.is_empty():
		return
	var page = pages[current_tab]
	var want = page.get_combined_minimum_size()
	pages_box.custom_minimum_size = want
	page.position = Vector2.ZERO
	page.size = want
	call_deferred("_stick_to_bottom")


## Full screen width, glued to the bottom edge, as tall as its content.
func _stick_to_bottom() -> void:
	anchor_left = 0.0
	anchor_right = 1.0
	anchor_top = 1.0
	anchor_bottom = 1.0
	offset_left = 0.0
	offset_right = 0.0
	offset_bottom = 0.0
	offset_top = -get_combined_minimum_size().y


func add_button(b: Control) -> void:
	if b.get_parent():
		b.get_parent().remove_child(b)
	column.add_child(b)


func set_portrait(frame: Control) -> void:
	if frame.get_parent():
		frame.get_parent().remove_child(frame)
	portrait_slot.add_child(frame)


## Stronghold writes the hovered building's description on the slab.
func show_hint(text: String) -> void:
	hint_label.text = text if text != "" else default_hint


func owns(control: Control) -> bool:
	return control != null and slab.is_ancestor_of(control)


func update_from_snapshot(snapshot: Dictionary, player: int) -> void:
	var colonies = snapshot.get("colonies", [])
	if typeof(colonies) != TYPE_ARRAY or player >= colonies.size():
		return
	var colony: Dictionary = colonies[player].get("colony", {})
	var colony_id = str(colonies[player].get("id", "colony-%d" % (player + 1)))
	var people = 0
	for ant in snapshot.get("ants", []):
		if typeof(ant) == TYPE_DICTIONARY and str(ant.get("colonyId", "")) == colony_id and str(ant.get("state", "")) != "dead":
			people += 1
	var room = int(colony.get("nestCapacity", 0))
	tablet_labels.people.text = "Жители %d%s" % [people, "/%d" % room if room > 0 else ""]
	var food = float(colony.get("food", 0.0))
	var stock = colony.get("foodStock", {})
	if typeof(stock) == TYPE_DICTIONARY and not stock.is_empty():
		food = 0.0
		for v in stock.values():
			food += float(v)
	tablet_labels.food.text = "Еда %d" % int(food)
	tablet_labels.special.text = "Особая глина %d" % int(float(colony.get("specialClay", 0)))
	var tick = int(snapshot.get("tick", 0))
	tablet_labels.day.text = "День %d · %s" % [tick / GameHud.DAY_TICKS + 1, PHASES.get(GameHud.day_phase(tick), "")]
	# Pages change size with their content (work rows, short-resource notes).
	_fit_pages()
	queue_redraw()


func _process(_delta: float) -> void:
	var hovered = get_viewport().gui_get_hovered_control() if get_viewport() else null
	if hovered and owns(hovered):
		var c: Node = hovered
		while c is Control and c != slab:
			if (c as Control).tooltip_text != "":
				show_hint((c as Control).tooltip_text)
				return
			c = c.get_parent()
