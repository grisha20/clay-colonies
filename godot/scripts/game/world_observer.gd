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
		elif all_args[i] == "--test-recording":
			is_tour_mode = true

	if custom_url != "":
		server_line_edit.text = custom_url
		ws_client.connect_to_server(custom_url)
	elif ws_client.server_url != "":
		server_line_edit.text = ws_client.server_url

func _setup_hud() -> void:
	var canvas = CanvasLayer.new()
	canvas.name = "HUD"
	add_child(canvas)

	# Main HUD Control panel at top
	var top_panel = PanelContainer.new()
	top_panel.mouse_force_pass_scroll_events = false
	top_panel.position = Vector2(16, 16)
	top_panel.custom_minimum_size = Vector2(480, 110)
	canvas.add_child(top_panel)

	var vbox = VBoxContainer.new()
	top_panel.add_child(vbox)

	# Row 1: Connection & URL
	var row_conn = HBoxContainer.new()
	vbox.add_child(row_conn)

	server_line_edit = LineEdit.new()
	server_line_edit.text = ws_client.server_url
	server_line_edit.custom_minimum_size = Vector2(220, 30)
	row_conn.add_child(server_line_edit)

	connect_button = Button.new()
	connect_button.text = "Подключиться"
	connect_button.pressed.connect(_on_connect_button_pressed)
	row_conn.add_child(connect_button)

	status_label = Label.new()
	status_label.text = "Нет соединения"
	row_conn.add_child(status_label)

	# Row 2: Telemetry
	var row_telemetry = HBoxContainer.new()
	vbox.add_child(row_telemetry)

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
	row_nav.add_child(btn_cycle)

	# Separate selection from camera following; keep the inspector on screen.
	var insp_panel = PanelContainer.new()
	insp_panel.mouse_force_pass_scroll_events = false
	insp_panel.name = "ResidentInspector"
	insp_panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	insp_panel.offset_left = -376
	insp_panel.offset_top = -220
	insp_panel.offset_right = -16
	insp_panel.offset_bottom = -16
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
	var help_label = Label.new()
	help_label.text = "WASD / стрелки — камера · Колесо — масштаб · ЛКМ — выбрать"
	help_label.position = Vector2(16, 140)
	help_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(help_label)
	_update_inspector()

func _connect_signals() -> void:
	ws_client.snapshot_received.connect(_on_snapshot_received)
	ws_client.connected.connect(_on_connected)
	ws_client.disconnected.connect(_on_disconnected)
	ws_client.connection_error.connect(_on_connection_error)
	ws_client.state_changed.connect(_on_state_changed)
	entity_registry.population_updated.connect(_on_population_updated)
	entity_registry.resident_despawned.connect(_on_resident_despawned)

func _process(delta: float) -> void:
	_update_inspector()
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
	entity_registry.update_from_snapshot(snapshot)
	world_view.update_world_entities(snapshot)

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
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		select_resident(resident_at_screen(event.position))
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			select_resident(null)
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_F:
			_toggle_follow_selected()
			get_viewport().set_input_as_handled()

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

func _update_inspector() -> void:
	if not inspector_label:
		return
	var target = entity_registry.get_resident(selected_resident_id)
	var valid = is_instance_valid(target)
	follow_button.disabled = not valid
	clear_selection_button.disabled = not valid
	if not valid:
		inspector_label.text = "Житель не выбран\nЩёлкните по жителю, чтобы узнать его занятие и груз."
		return
	follow_button.text = "Не следовать (F)" if world_view.focused_target == target else "Следовать (F)"
	var tasks = {"idle": "отдых", "forage": "поиск еды", "nurse": "уход за потомством", "dig": "копание", "carryDirt": "перенос грунта", "harvest": "добыча", "build": "строительство", "guard": "охрана", "fish": "рыбалка"}
	var resources = {"clay": "глина", "wood": "дерево", "stone": "камень", "water": "вода", "food": "еда", "fish": "рыба", "meat": "мясо"}
	var cargo = "нет"
	if target.carrying_amount > 0:
		cargo = "%s (%d)" % [resources.get(target.carry_kind, target.carry_kind if not target.carry_kind.is_empty() else "ресурс не указан"), target.carrying_amount]
	var tribe = "A" if target.colony_id in ["colony-1", "0"] else "B"
	inspector_label.text = "Житель %s · Племя %s\nРоль: %s\nЗанятие: %s\nГруз: %s\nПозиция: %.1f, %.1f" % [
		target.ant_id, tribe, "рабочий" if target.role == "worker" else target.role,
		tasks.get(target.job_name, target.job_name if not target.job_name.is_empty() else "нет"),
		cargo, target.position.x, target.position.z]
