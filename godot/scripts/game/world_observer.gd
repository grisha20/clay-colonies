class_name WorldObserver
extends Node3D

## Network observer with local camera and resident inspection controls.
## Connects WSClient to EntityRegistry, manages HUD telemetry,
## camera navigation, and connection status.

@onready var ws_client: WSClient = $WSClient
@onready var entity_registry: EntityRegistry = $EntityRegistry
@onready var world_view: WorldView = $WorldView

# HUD UI Nodes
var status_label: Label
var tick_label: Label
var speed_label: Label
var pop_label: Label
var inspector_label: Label
var server_line_edit: LineEdit
var connect_button: Button
var follow_button: Button
var clear_selection_button: Button
var start_menu: StartMenu
var hud: GameHud
var build: BuildController
var priority_panel: PriorityPanel
var advice_feed: AdviceFeed
## The mother's head over the map, speaking her advice (replaces the advice list on screen).
var mother_speaker: MotherSpeaker
## Settings menu behind the ⚙ button (connection, camp and lake shortcuts, save, controls).
var settings_panel: PanelContainer
var insp_panel: PanelContainer
## Framed minimap in the bottom-right corner; the mother sits on top of it.
var minimap: Minimap
var population_counts: Array[int] = [0, 0]
var player_colony: int = 0

var selected_resident_id: String = ""
var last_snapshot_time: float = 0.0

# Automated tour recording state
var is_tour_mode: bool = false
var tour_time: float = 0.0
var tour_stage: int = 0

## A minimised or background observer has nothing to show; without a cap the
## engine keeps rendering as fast as it can and spins the fans up.
const BACKGROUND_MAX_FPS: int = 20

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		Engine.max_fps = BACKGROUND_MAX_FPS
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN:
		Engine.max_fps = 0

func _ready() -> void:
	_setup_hud()
	_connect_signals()

	# Process command line arguments
	var all_args = OS.get_cmdline_args() + OS.get_cmdline_user_args()
	var custom_url = ""
	for i in range(all_args.size()):
		if all_args[i] == "--connect" and i + 1 < all_args.size():
			custom_url = all_args[i + 1]
		elif all_args[i] == "--qa-port" and i + 1 < all_args.size():
			custom_url = "ws://127.0.0.1:" + all_args[i + 1]
		elif all_args[i] == "--menu-address" and i + 1 < all_args.size():
			# Start menu pointed at a specific (e.g. isolated QA) server.
			ws_client.server_url = all_args[i + 1]
		elif all_args[i] == "--test-recording":
			is_tour_mode = true

	if custom_url != "":
		server_line_edit.text = custom_url
		ws_client.connect_to_server(custom_url)
	elif ws_client.server_url != "":
		server_line_edit.text = ws_client.server_url
	# The start menu greets a normal launch (main scene, no explicit server);
	# tests and recordings that instantiate the observer directly skip it.
	call_deferred("_maybe_open_start_menu", custom_url == "")

func _maybe_open_start_menu(no_explicit_server: bool) -> void:
	if no_explicit_server and get_tree().current_scene == self:
		open_start_menu()
		if ws_client.current_state == WSClient.ClientState.DISCONNECTED:
			ws_client.connect_to_server(server_line_edit.text)

func open_start_menu() -> void:
	start_menu.address_edit.text = server_line_edit.text
	start_menu.visible = true

func close_start_menu() -> void:
	start_menu.visible = false

var pause_menu: PauseMenu
## Speed before the pause menu stopped the match; restored when it closes.
var speed_before_pause := 0

func open_pause_menu() -> void:
	speed_before_pause = int(round(entity_registry.current_sim_speed))
	if speed_before_pause > 0:
		ws_client.send_command({"type": "setSpeed", "value": 0})
	pause_menu.open()

func close_pause_menu() -> void:
	if not pause_menu.visible:
		return
	pause_menu.close()
	if speed_before_pause > 0:
		ws_client.send_command({"type": "setSpeed", "value": speed_before_pause})
	speed_before_pause = 0

## Esc steps back one layer: menu, settings, selection; with nothing open it
## brings up the pause menu.
func _on_escape() -> void:
	if pause_menu.visible:
		close_pause_menu()
	elif start_menu.visible:
		close_start_menu()
	elif settings_panel.visible:
		settings_panel.visible = false
	elif selected_resident_id != "":
		select_resident(null)
	else:
		open_pause_menu()

func _on_menu_new_game(classic: bool) -> void:
	# Keep the running match: autosave it to a slot before the server replaces it.
	ws_client.send_command({"type": "saveGame", "name": "Перед новой игрой"})
	ws_client.send_command({"type": "newGame", "classic": classic})
	select_resident(null)
	close_start_menu()

func _on_menu_load(save_id: String) -> void:
	ws_client.send_command({"type": "loadGame", "id": save_id})
	select_resident(null)
	close_start_menu()

func _on_menu_address(url: String) -> void:
	server_line_edit.text = url
	ws_client.disconnect_from_server()
	ws_client.connect_to_server(url)

func _setup_hud() -> void:
	var canvas = CanvasLayer.new()
	canvas.name = "HUD"
	add_child(canvas)

	# Settings menu (2D-style ⚙): connection, camp and lake shortcuts, save and
	# the controls help. Hidden until the ⚙ button in the quick panel opens it.
	var top_panel = PanelContainer.new()
	top_panel.mouse_force_pass_scroll_events = false
	top_panel.name = "ObserverPanel"
	top_panel.theme = GameHud.ink_theme()
	top_panel.add_theme_stylebox_override("panel", GameHud.parchment())
	top_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	top_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	top_panel.offset_right = -16
	top_panel.offset_top = 66
	top_panel.custom_minimum_size = Vector2(0, 0)
	top_panel.visible = false
	settings_panel = top_panel

	var vbox = VBoxContainer.new()
	top_panel.add_child(vbox)

	# Row 1: Connection & URL
	var row_conn = HBoxContainer.new()
	vbox.add_child(row_conn)

	server_line_edit = LineEdit.new()
	server_line_edit.text = ws_client.server_url
	server_line_edit.custom_minimum_size = Vector2(170, 30)
	row_conn.add_child(server_line_edit)

	connect_button = Button.new()
	connect_button.text = "Подключиться"
	connect_button.pressed.connect(_on_connect_button_pressed)
	row_conn.add_child(connect_button)

	status_label = Label.new()
	status_label.text = "Нет соединения"
	status_label.clip_text = true
	status_label.custom_minimum_size = Vector2(150, 0)
	row_conn.add_child(status_label)

	# Row 2: Telemetry
	var row_telemetry = HBoxContainer.new()
	vbox.add_child(row_telemetry)
	# Tick/speed/population now live in the player HUD; keep the labels for
	# diagnostics and tests but out of the way.
	row_telemetry.visible = false

	tick_label = Label.new()
	tick_label.text = "Шаг: 0"
	row_telemetry.add_child(tick_label)

	row_telemetry.add_child(VSeparator.new())

	speed_label = Label.new()
	speed_label.text = "Скорость: —"
	row_telemetry.add_child(speed_label)

	row_telemetry.add_child(VSeparator.new())

	pop_label = Label.new()
	pop_label.text = "Племя A: 0 | Племя B: 0"
	row_telemetry.add_child(pop_label)

	# Row 3: Navigation buttons
	var row_nav = HBoxContainer.new()
	vbox.add_child(row_nav)

	var btn_c1 = Button.new()
	btn_c1.text = "Лагерь A"
	btn_c1.pressed.connect(func(): world_view.focus_on_colony(0))
	row_nav.add_child(btn_c1)

	var btn_c2 = Button.new()
	btn_c2.text = "Лагерь B"
	btn_c2.pressed.connect(func(): world_view.focus_on_colony(1))
	row_nav.add_child(btn_c2)

	var btn_lake_n = Button.new()
	btn_lake_n.text = "Северное озеро"
	btn_lake_n.pressed.connect(func(): world_view.focus_on_lake("north"))
	row_nav.add_child(btn_lake_n)

	var btn_lake_s = Button.new()
	btn_lake_s.text = "Южное озеро"
	btn_lake_s.pressed.connect(func(): world_view.focus_on_lake("south"))
	row_nav.add_child(btn_lake_s)

	var btn_cycle = Button.new()
	btn_cycle.text = "Следующий житель"
	btn_cycle.pressed.connect(_cycle_resident_focus)
	# Second row keeps the panel narrow enough to sit beside the resource bar.
	var row_nav2 = HBoxContainer.new()
	vbox.add_child(row_nav2)
	row_nav2.add_child(btn_cycle)

	var btn_save = Button.new()
	btn_save.text = "Сохранить"
	btn_save.pressed.connect(func():
		ws_client.send_command({"type": "saveGame"})
		status_label.text = "Сохранено")
	row_nav2.add_child(btn_save)

	var btn_menu = Button.new()
	btn_menu.text = "Меню"
	btn_menu.pressed.connect(open_start_menu)
	row_nav2.add_child(btn_menu)

	# Resident card at the bottom left above the build bar, as in 2D; shown
	# only while a resident is selected.
	insp_panel = PanelContainer.new()
	insp_panel.mouse_force_pass_scroll_events = false
	insp_panel.name = "ResidentInspector"
	insp_panel.add_theme_stylebox_override("panel", GameHud.parchment())
	insp_panel.theme = GameHud.ink_theme()
	insp_panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	insp_panel.offset_left = 16
	# Above the bottom dock (build bar + minimap).
	insp_panel.offset_top = -428
	insp_panel.offset_right = 376
	insp_panel.offset_bottom = -224
	canvas.add_child(insp_panel)
	var inspector_box = VBoxContainer.new()
	insp_panel.add_child(inspector_box)

	inspector_label = Label.new()
	inspector_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	inspector_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	inspector_box.add_child(inspector_label)
	var inspector_actions = HBoxContainer.new()
	inspector_box.add_child(inspector_actions)
	follow_button = Button.new()
	follow_button.text = "Следовать (F)"
	follow_button.pressed.connect(_toggle_follow_selected)
	inspector_actions.add_child(follow_button)
	clear_selection_button = Button.new()
	clear_selection_button.text = "Снять выбор (Esc)"
	clear_selection_button.pressed.connect(func(): select_resident(null))
	inspector_actions.add_child(clear_selection_button)

	hud = GameHud.new()
	canvas.add_child(hud)
	hud.speed_requested.connect(func(v): ws_client.send_command({"type": "setSpeed", "value": v}))
	hud.alarm_requested.connect(func(on): ws_client.send_command({"type": "setAlarm", "colony": player_colony, "value": on}))
	hud.settings_requested.connect(func(): settings_panel.visible = not settings_panel.visible)

	priority_panel = PriorityPanel.new()
	canvas.add_child(priority_panel)
	# Works on the right under the quick panel, like the 2D priorities.
	priority_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	priority_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	priority_panel.offset_right = -16
	priority_panel.offset_top = 66
	priority_panel.priorities_requested.connect(func(pr): ws_client.send_command({"type": "setPriorities", "colony": player_colony, "priorities": pr}))
	priority_panel.auto_manage_requested.connect(func(on): ws_client.send_command({"type": "setAutoManage", "colony": player_colony, "value": on}))
	priority_panel.firing_requested.connect(func(paused): ws_client.send_command({"type": "setFiring", "colony": player_colony, "paused": paused}))
	priority_panel.water_requested.connect(func(): ws_client.send_command({"type": "trainWaterWeapons", "colony": player_colony}))
	priority_panel.warrior_requested.connect(func(): ws_client.send_command({"type": "initiateWarrior", "colony": player_colony}))

	minimap = Minimap.new()
	canvas.add_child(minimap)
	minimap.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	minimap.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	minimap.grow_vertical = Control.GROW_DIRECTION_BEGIN
	minimap.offset_right = -BuildController.DOCK_EDGE
	minimap.offset_bottom = -BuildController.DOCK_EDGE
	minimap.focus_requested.connect(func(p): world_view.focus_on_point(p))
	# The mother perches on the minimap and speaks from there.
	mother_speaker = MotherSpeaker.new()
	mother_speaker.perched = true
	canvas.add_child(mother_speaker)
	mother_speaker.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	mother_speaker.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	mother_speaker.grow_vertical = Control.GROW_DIRECTION_BEGIN
	mother_speaker.show_requested.connect(func(p): world_view.focus_on_point(p))
	# Her painted hands rest on the minimap's top edge, in front of her.
	var hands_tex = HudArt.tex("minimap_mother_hands")
	if hands_tex:
		mother_hands = GameHud.icon_rect(hands_tex, 0)
		mother_hands.name = "MotherHands"
		mother_hands.custom_minimum_size = HANDS_SIZE
		canvas.add_child(mother_hands)
		mother_hands.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	# The settings menu opens above the works panel.
	canvas.add_child(settings_panel)

	build = BuildController.new()
	build.name = "BuildController"
	add_child(build)
	build.setup(self, world_view, ws_client, hud, canvas)
	HudArt.install_cursors()
	build.tool_changed.connect(func(t): HudArt.set_cursor(Input.CURSOR_CROSS, TOOL_CURSORS.get(t, "cursor_build")))

	start_menu = StartMenu.new()
	start_menu.visible = false
	canvas.add_child(start_menu)
	start_menu.continue_requested.connect(close_start_menu)
	start_menu.new_game_requested.connect(_on_menu_new_game)
	start_menu.load_requested.connect(_on_menu_load)
	pause_menu = PauseMenu.new()
	canvas.add_child(pause_menu)
	pause_menu.continue_requested.connect(close_pause_menu)
	pause_menu.save_requested.connect(func():
		ws_client.send_command({"type": "saveGame"})
		pause_menu.status_label.text = "Сохранено")
	pause_menu.load_requested.connect(func():
		close_pause_menu()
		open_start_menu()
		start_menu.saves_panel.visible = true)
	pause_menu.main_menu_requested.connect(func():
		close_pause_menu()
		open_start_menu())
	pause_menu.quit_requested.connect(func(): get_tree().quit())
	start_menu.address_submitted.connect(_on_menu_address)
	var help_label = Label.new()
	help_label.name = "ControlsHelp"
	help_label.text = "WASD, зажатое колесо — камера · зажатая ПКМ — поворот\nколесо — масштаб · Home — север вверх · ЛКМ — выбрать\n1–9, 0 — стройка и зоны · Esc/ПКМ — отмена"
	help_label.add_theme_font_size_override("font_size", 14)
	vbox.add_child(HSeparator.new())
	vbox.add_child(help_label)
	# Interface size: on big screens the HUD grows with the window; this shrinks it.
	var scale_row = HBoxContainer.new()
	scale_row.add_theme_constant_override("separation", 4)
	var scale_label = Label.new()
	scale_label.text = "Интерфейс"
	scale_row.add_child(scale_label)
	for pct in UI_SCALES:
		var sb = Button.new()
		sb.text = "%d%%" % pct
		sb.toggle_mode = true
		sb.focus_mode = Control.FOCUS_NONE
		sb.custom_minimum_size = Vector2(54, 0)
		sb.pressed.connect(func(): set_ui_scale(pct))
		scale_row.add_child(sb)
		ui_scale_buttons[pct] = sb
	vbox.add_child(scale_row)
	set_ui_scale(_load_ui_scale(), false)
	_update_inspector()

const UI_SCALES = [75, 85, 100, 115]
const SETTINGS_PATH := "user://settings.cfg"
var ui_scale_buttons: Dictionary = {}

## Scales the whole 2D interface (not the 3D world) and remembers the choice.
func set_ui_scale(pct: int, remember: bool = true) -> void:
	get_tree().root.content_scale_factor = pct / 100.0
	for k in ui_scale_buttons.keys():
		ui_scale_buttons[k].button_pressed = k == pct
	if not remember:
		return
	var cfg = ConfigFile.new()
	cfg.load(SETTINGS_PATH)
	cfg.set_value("ui", "scale", pct)
	cfg.save(SETTINGS_PATH)

func _load_ui_scale() -> int:
	var cfg = ConfigFile.new()
	if cfg.load(SETTINGS_PATH) == OK:
		var v = int(cfg.get_value("ui", "scale", 100))
		if v in UI_SCALES:
			return v
	# First run: a little smaller on screens above Full HD.
	return 85 if DisplayServer.get_name() != "headless" and DisplayServer.screen_get_size().y > 1200 else 100

## The mother sits on the minimap's top edge: her portrait centred over it,
## sunk a little so her arms rest on the frame; the bubble opens to the left.
const PERCH_OVERLAP := 30.0
const HANDS_SIZE := Vector2(170, 43)
var mother_hands: TextureRect

func _place_mother() -> void:
	if not minimap or not mother_speaker:
		return
	var portrait_w = MotherSpeaker.PERCH_SIZE.x
	var bottom = minimap.offset_bottom - minimap.size.y + PERCH_OVERLAP
	mother_speaker.offset_bottom = bottom
	mother_speaker.offset_top = bottom
	mother_speaker.offset_right = minimap.offset_right - (minimap.size.x - portrait_w) * 0.5
	mother_speaker.offset_left = mother_speaker.offset_right
	if mother_hands:
		var edge = minimap.offset_bottom - minimap.size.y
		mother_hands.offset_bottom = edge + HANDS_SIZE.y * 0.7
		mother_hands.offset_top = mother_hands.offset_bottom - HANDS_SIZE.y
		mother_hands.offset_right = minimap.offset_right - (minimap.size.x - HANDS_SIZE.x) * 0.5
		mother_hands.offset_left = mother_hands.offset_right - HANDS_SIZE.x
		mother_hands.visible = mother_speaker.visible

func _connect_signals() -> void:
	ws_client.snapshot_received.connect(_on_snapshot_received)
	ws_client.connected.connect(_on_connected)
	ws_client.disconnected.connect(_on_disconnected)
	ws_client.connection_error.connect(_on_connection_error)
	ws_client.state_changed.connect(_on_state_changed)
	entity_registry.population_updated.connect(_on_population_updated)
	entity_registry.resident_despawned.connect(_on_resident_despawned)

## Build tool -> painted cursor over the world (buildings get the stake).
const TOOL_CURSORS = {"wall": "cursor_brush", "erase": "cursor_brush", "harvest": "cursor_harvest", "forbid": "cursor_forbid"}
var cursor_shape := -1

## Cursor over the world (the HUD keeps the arrow): camera drag and turn,
## the build tool, a refused spot, something under the mouse.
func _update_cursor() -> void:
	var shape = Input.CURSOR_ARROW
	if world_view._mmb_down:
		shape = Input.CURSOR_DRAG
	elif world_view._rmb_down and world_view._rmb_rotated:
		shape = Input.CURSOR_MOVE
	elif build and build.tool != "":
		shape = Input.CURSOR_FORBIDDEN if build.last_reason != "" else Input.CURSOR_CROSS
	elif hud and hud.tooltip_panel.visible:
		shape = Input.CURSOR_POINTING_HAND
	if shape != cursor_shape:
		cursor_shape = shape
		Input.set_default_cursor_shape(shape)

func _process(delta: float) -> void:
	_place_mother()
	_update_cursor()
	if minimap and world_view.camera:
		var vp = get_viewport().get_visible_rect().size
		var quad = PackedVector2Array()
		for corner in [Vector2.ZERO, Vector2(vp.x, 0), vp, Vector2(0, vp.y)]:
			var p = ground_point_at(corner)
			if p == Vector2.INF:
				quad.clear()
				break
			quad.append(p)
		minimap.set_view_quad(quad)
	var t0 = Time.get_ticks_usec()
	_update_inspector()
	FramePerf.add("frame.inspector", t0)
	t0 = Time.get_ticks_usec()
	_update_world_tooltip()
	FramePerf.add("frame.tooltip", t0)
	if is_tour_mode:
		_process_tour(delta)

	if ws_client.current_state == WSClient.ClientState.CONNECTED:
		var now = Time.get_ticks_msec() / 1000.0
		# If no snapshot received for > 0.6 seconds, stall movement
		if now - last_snapshot_time > 0.6 and last_snapshot_time > 0.0:
			entity_registry.on_network_stalled()
			status_label.text = "Соединение есть, ожидаем снимок…"

func _process_tour(delta: float) -> void:
	tour_time += delta
	if tour_time < 4.0:
		if tour_stage != 1:
			tour_stage = 1
			print("[TOUR STAGE 1] Colony 1 Camp overview at 1.0x speed...")
			world_view.focus_on_colony(0)
	elif tour_time < 8.0:
		if tour_stage != 2:
			tour_stage = 2
			print("[TOUR STAGE 2] Tracking resident movement & cargo carrying...")
			_focus_on_carrying_resident()
		else:
			var curr = world_view.focused_target as NetworkResident
			if not is_instance_valid(curr) or curr.carrying_amount <= 0:
				_focus_on_carrying_resident()
	elif tour_time < 12.0:
		if tour_stage != 3:
			tour_stage = 3
			print("[TOUR STAGE 3] North Lake shoreline & obstacle terrain...")
			world_view.focus_on_lake("north")
	elif tour_time < 16.0:
		if tour_time < 13.5:
			if tour_stage != 4:
				tour_stage = 4
				print("[TOUR STAGE 4A] Colony 2 Camp overview...")
				world_view.focus_on_colony(1)
		else:
			if tour_stage != 41:
				tour_stage = 41
				print("[TOUR STAGE 4B] Colony 2 resident stride close-up...")
				_focus_on_colony_resident(1)
	elif tour_time < 20.0:
		if tour_stage != 5:
			tour_stage = 5
			print("[TOUR STAGE 5] Server simulation pause (0x) confirmed via snapshot...")
			ws_client.send_command({"type": "setSpeed", "value": 0})
			_focus_on_carrying_resident()
		if entity_registry.current_sim_speed > 0.0 and tour_time > 17.5:
			tour_time = 17.5

	elif tour_time < 22.0:
		if tour_stage != 6:
			tour_stage = 6
			print("[TOUR STAGE 6] Demonstrating disconnect status & stall protection...")
			ws_client.send_command({"type": "setSpeed", "value": 1})
			ws_client.disconnect_from_server()
	elif tour_time < 25.0:
		if tour_stage != 7:
			tour_stage = 7
			print("[TOUR STAGE 7] Demonstrating reconnect & zero duplicate recovery...")
			ws_client.connect_to_server()
			world_view.focus_on_colony(0)
	else:
		print("=== M2 OBSERVER TOUR COMPLETED SUCCESSFULLY! ===")
		get_tree().quit(0)

func _focus_on_colony_resident(colony_idx: int) -> void:
	var target_cid = "colony-%d" % (colony_idx + 1)
	var alt_cid = str(colony_idx)
	for r in entity_registry.residents.values():
		if is_instance_valid(r):
			if r.colony_id == target_cid or r.colony_id == alt_cid:
				select_resident(r)
				world_view.focus_on_resident(r)
				return

func _focus_on_carrying_resident() -> void:
	for r in entity_registry.residents.values():
		if is_instance_valid(r) and r.carrying_amount > 0:
			select_resident(r)
			world_view.focus_on_resident(r)
			return
	for r in entity_registry.residents.values():
		if is_instance_valid(r) and r.state_name in ["carry", "return"]:
			select_resident(r)
			world_view.focus_on_resident(r)
			return
	if not entity_registry.residents.is_empty():
		var first_r = entity_registry.residents.values()[0]
		select_resident(first_r)
		world_view.focus_on_resident(first_r)


func _on_connect_button_pressed() -> void:
	if ws_client.current_state == WSClient.ClientState.CONNECTED:
		ws_client.disconnect_from_server()
	else:
		ws_client.connect_to_server(server_line_edit.text)

func _on_connected() -> void:
	connect_button.text = "Отключиться"
	status_label.text = "Подключено"
	select_resident(null)
	entity_registry.clear_all() # Clean start: guarantee zero duplicate IDs

func _on_disconnected() -> void:
	connect_button.text = "Подключиться"
	status_label.text = "Нет соединения"
	entity_registry.on_network_stalled()

func _on_connection_error(msg: String) -> void:
	status_label.text = "Ошибка: " + msg
	entity_registry.on_network_stalled()

func _on_state_changed(new_state: int, status_text: String) -> void:
	if start_menu:
		var texts = {WSClient.ClientState.DISCONNECTED: "Нет соединения с сервером. Запустите игру (Запуск.bat) или проверьте адрес.", WSClient.ClientState.CONNECTING: "Подключаемся…", WSClient.ClientState.WAITING_FOR_SNAPSHOT: "Ожидаем состояние мира…", WSClient.ClientState.CONNECTED: "Мир загружен."}
		start_menu.set_connected(new_state == WSClient.ClientState.CONNECTED, texts.get(new_state, status_text))
	match new_state:
		WSClient.ClientState.DISCONNECTED:
			status_label.text = "Нет соединения"
		WSClient.ClientState.CONNECTING:
			status_label.text = "Подключаемся…"
		WSClient.ClientState.WAITING_FOR_SNAPSHOT:
			status_label.text = "Ожидаем состояние мира…"
		WSClient.ClientState.CONNECTED:
			status_label.text = "Подключено"
		_:
			status_label.text = status_text

func _on_snapshot_received(snapshot: Dictionary) -> void:
	if int(snapshot.get("tick", 0)) < entity_registry.last_snapshot_tick:
		select_resident(null)
	last_snapshot_time = Time.get_ticks_msec() / 1000.0
	entity_registry.on_network_resumed()
	# Terrain first: resident navigation and the world view both read it.
	var surface = snapshot.get("surface", {})
	var terrain = surface.get("terrain") if typeof(surface) == TYPE_DICTIONARY else null
	if SurfaceTerrain.differs(terrain):
		# Meadow dressing threads read the terrain: stop them before swapping it.
		world_view.ground_decor.stop_workers()
		SurfaceTerrain.set_terrain(terrain)
		world_view.apply_terrain()
	var t0 = Time.get_ticks_usec()
	entity_registry.update_from_snapshot(snapshot)
	FramePerf.add("snap.registry", t0)
	t0 = Time.get_ticks_usec()
	world_view.update_world_entities(snapshot)
	FramePerf.add("snap.world_view", t0)
	t0 = Time.get_ticks_usec()
	world_view.set_worked_targets(entity_registry.worked_targets)
	if start_menu:
		start_menu.set_saves(snapshot.get("saves", []))
	if hud:
		var session_d = snapshot.get("session", {})
		player_colony = clampi(int(session_d.get("playerColonyIndex", 0)) if typeof(session_d) == TYPE_DICTIONARY else 0, 0, 1)
		hud.update_from_snapshot(snapshot, population_counts[player_colony])
	if priority_panel:
		priority_panel.update_from_snapshot(snapshot, player_colony)
	if advice_feed:
		advice_feed.update_from_snapshot(snapshot, player_colony)
	if mother_speaker:
		mother_speaker.update_from_snapshot(snapshot, player_colony)
	if minimap:
		minimap.update_from_snapshot(snapshot)
	if build:
		build.update_from_snapshot(snapshot, player_colony)
	FramePerf.add("snap.panels", t0)

	var tick = int(snapshot.get("tick", 0))
	var session = snapshot.get("session", {})
	var speed = float(session.get("speed", 1.0))
	tick_label.text = "Шаг: %d" % tick
	if speed <= 0.0:
		speed_label.text = "Пауза"
	else:
		speed_label.text = "Скорость: %.0f×" % speed

	_update_inspector()

func _on_population_updated(col1: int, col2: int) -> void:
	population_counts = [col1, col2]
	pop_label.text = "Племя A: %d | Племя B: %d (Всего: %d)" % [col1, col2, col1 + col2]

func _cycle_resident_focus() -> void:
	var ids = entity_registry.residents.keys()
	if ids.is_empty():
		return
	var next_index = (ids.find(selected_resident_id) + 1) % ids.size()
	var target = entity_registry.get_resident(str(ids[next_index]))
	if is_instance_valid(target):
		select_resident(target)
		world_view.focus_on_resident(target)

func _unhandled_input(event: InputEvent) -> void:
	if build and build.handle_input(event, ground_point_at):
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		select_resident(resident_at_screen(event.position))
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			_on_escape()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_F:
			_toggle_follow_selected()
			get_viewport().set_input_as_handled()

## Ground point (x, z) under a screen position, or INF. The ground plane is
## close enough for picking: hills are gentle swells.
func ground_point_at(screen: Vector2) -> Vector2:
	var cam = world_view.camera
	if not cam:
		return Vector2.INF
	var origin = cam.project_ray_origin(screen)
	var dir = cam.project_ray_normal(screen)
	return ray_ground_hit(origin, dir)


## Where a ray meets the visible ground, raised by SurfaceTerrain.height_at
## like the terrain mesh: march between the planes of the highest hill and
## y=0, then bisect. A flat-plane hit was metres off on a hillside.
static func ray_ground_hit(origin: Vector3, dir: Vector3) -> Vector2:
	if dir.y > -0.01:
		return Vector2.INF
	const TOP := 16.0
	var t0 = maxf(0.0, (TOP - origin.y) / dir.y)
	var t1 = -origin.y / dir.y
	var above = func(t: float) -> bool:
		var p = origin + dir * t
		return p.y > SurfaceTerrain.height_at(p.x, p.z)
	var steps = 48
	var prev = t0
	var hit_t = t1
	for i in range(1, steps + 1):
		var t = lerpf(t0, t1, float(i) / float(steps))
		if not above.call(t):
			var lo = prev
			var hi = t
			for k in range(12):
				var mid = (lo + hi) * 0.5
				if above.call(mid):
					lo = mid
				else:
					hi = mid
			hit_t = hi
			break
		prev = t
	var hit = origin + dir * hit_t
	return Vector2(hit.x, hit.z)

## Hover text for whatever lies under the mouse (trees, quarries, buildings,
## creatures), or the build preview when a build tool is active.
func _update_world_tooltip() -> void:
	if not hud or not world_view.camera:
		return
	var vp = get_viewport()
	var mouse = vp.get_mouse_position()
	var hovered = vp.gui_get_hovered_control()
	var over_ui = (start_menu and start_menu.visible) or hovered != null or not vp.get_visible_rect().has_point(mouse)
	# HUD hints (build tiles, buttons, resource cells) go through the same
	# panel as world hover text: Godot's own tooltip popup did not show up.
	var ui_tip = _ui_tooltip(hovered)
	if ui_tip != "":
		if build:
			build.update_preview(Vector2.INF)
		hud.show_tooltip(ui_tip, mouse)
		return
	var p = Vector2.INF if over_ui else ground_point_at(mouse)
	if build:
		build.update_preview(p)
		if build.tool != "":
			if p == Vector2.INF:
				hud.show_tooltip("", mouse)
			return
	if p == Vector2.INF:
		hud.show_tooltip("", mouse)
		return
	hud.show_tooltip(world_view.describe_at(p), mouse)

## Tooltip text of the hovered control or its nearest ancestor that has one.
static func _ui_tooltip(control: Control) -> String:
	var c: Node = control
	while c is Control:
		var tip = (c as Control).tooltip_text
		if tip != "":
			return tip
		c = c.get_parent()
	return ""

func resident_at_screen(screen_position: Vector2) -> NetworkResident:
	var camera = world_view.camera
	var origin = camera.project_ray_origin(screen_position)
	var end = origin + camera.project_ray_normal(screen_position) * camera.far
	var query = PhysicsRayQueryParameters3D.create(origin, end, NetworkResident.SELECTION_LAYER)
	query.collide_with_areas = true
	query.collide_with_bodies = false
	var hit = get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return null
	var target = hit.collider.get_parent() as NetworkResident
	if is_instance_valid(target) and not target.is_queued_for_deletion() and entity_registry.get_resident(target.ant_id) == target:
		return target
	return null

func select_resident(target: NetworkResident) -> void:
	var previous = entity_registry.get_resident(selected_resident_id)
	if is_instance_valid(previous):
		previous.set_selected(false)
	var new_id = target.ant_id if is_instance_valid(target) else ""
	if selected_resident_id != new_id:
		world_view.focused_target = null
	selected_resident_id = new_id
	if is_instance_valid(target):
		target.set_selected(true)
	_update_inspector()

func _toggle_follow_selected() -> void:
	var target = entity_registry.get_resident(selected_resident_id)
	if is_instance_valid(target):
		if world_view.focused_target == target:
			world_view.focused_target = null
		else:
			world_view.focus_on_resident(target)
	_update_inspector()

func _on_resident_despawned(id: String) -> void:
	if selected_resident_id == id:
		select_resident(null)
		world_view.focused_target = null

## Named residents, deterministic by id (client/src/main.ts antName): a match
## is remembered by its "Brave Little One".
const FIRST_NAMES = ["Комок", "Малой", "Глинко", "Круглый", "Шмяк", "Лепень", "Тюха", "Крепыш", "Юркий", "Пузырь"]
const TRAITS = ["Храбрый", "Кривой", "Сонный", "Шустрый", "Упрямый", "Тихий", "Весёлый", "Ворчливый"]

static func resident_name(id: String) -> String:
	var tail = id.replace("ant-", "")
	var numeric = int(tail) if tail.is_valid_int() else 0
	return "%s %s" % [TRAITS[int(numeric / FIRST_NAMES.size()) % TRAITS.size()], FIRST_NAMES[numeric % FIRST_NAMES.size()]]

func _update_inspector() -> void:
	if not inspector_label:
		return
	var target = entity_registry.get_resident(selected_resident_id)
	var valid = is_instance_valid(target)
	follow_button.disabled = not valid
	clear_selection_button.disabled = not valid
	insp_panel.visible = valid
	if not valid:
		inspector_label.text = "Житель не выбран\nЩёлкните по жителю, чтобы узнать его занятие и груз."
		return
	follow_button.text = "Не следовать (F)" if world_view.focused_target == target else "Следовать (F)"
	var tasks = {"idle": "отдых", "forage": "поиск еды", "nurse": "уход за потомством", "dig": "копание", "carryDirt": "перенос грунта", "harvest": "добыча", "build": "строительство", "guard": "охрана", "fish": "рыбалка", "hunt": "охота с копьём"}
	var resources = {"clay": "глина", "wood": "дерево", "stone": "камень", "water": "вода", "food": "еда", "fish": "рыба", "meat": "мясо"}
	var cargo = "нет"
	if target.carrying_amount > 0:
		cargo = "%s (%d)" % [resources.get(target.carry_kind, target.carry_kind if not target.carry_kind.is_empty() else "ресурс не указан"), target.carrying_amount]
	var tribe = "A" if target.colony_id in ["colony-1", "0"] else "B"
	var clay_state = "обожжён — дождь не страшен" if target.fired else "сырая — боится дождя и воды"
	if target.kiln_called:
		clay_state = "идёт к печи на обжиг"
	var rank = " · воин" if target.warrior else (" · охотник" if target.job_name == "hunt" else "")
	inspector_label.text = "%s%s · племя %s (%s)\nГлина: %s\nЗанятие: %s\nГруз: %s\nПозиция: %.1f, %.1f" % [
		resident_name(target.ant_id), rank, tribe, target.ant_id, clay_state,
		tasks.get(target.job_name, target.job_name if not target.job_name.is_empty() else "нет"),
		cargo, target.position.x, target.position.z]
