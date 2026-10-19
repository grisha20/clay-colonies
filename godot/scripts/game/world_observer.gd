class_name WorldObserver
extends Node3D

## Main controller for the M2 Network Observer Client.
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

var selected_resident_idx: int = 0
var last_snapshot_time: float = 0.0

# Automated tour recording state
var is_tour_mode: bool = false
var tour_time: float = 0.0
var tour_stage: int = 0

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
	connect_button.text = "Connect"
	connect_button.pressed.connect(_on_connect_button_pressed)
	row_conn.add_child(connect_button)

	status_label = Label.new()
	status_label.text = "Status: Disconnected"
	row_conn.add_child(status_label)

	# Row 2: Telemetry
	var row_telemetry = HBoxContainer.new()
	vbox.add_child(row_telemetry)

	tick_label = Label.new()
	tick_label.text = "Tick: 0"
	row_telemetry.add_child(tick_label)

	row_telemetry.add_child(VSeparator.new())

	speed_label = Label.new()
	speed_label.text = "Speed: 1.0x"
	row_telemetry.add_child(speed_label)

	row_telemetry.add_child(VSeparator.new())

	pop_label = Label.new()
	pop_label.text = "Colony 1: 0 | Colony 2: 0"
	row_telemetry.add_child(pop_label)

	# Row 3: Navigation buttons
	var row_nav = HBoxContainer.new()
	vbox.add_child(row_nav)

	var btn_c1 = Button.new()
	btn_c1.text = "Colony 1"
	btn_c1.pressed.connect(func(): world_view.focus_on_colony(0))
	row_nav.add_child(btn_c1)

	var btn_c2 = Button.new()
	btn_c2.text = "Colony 2"
	btn_c2.pressed.connect(func(): world_view.focus_on_colony(1))
	row_nav.add_child(btn_c2)

	var btn_lake_n = Button.new()
	btn_lake_n.text = "North Lake"
	btn_lake_n.pressed.connect(func(): world_view.focus_on_lake("north"))
	row_nav.add_child(btn_lake_n)

	var btn_lake_s = Button.new()
	btn_lake_s.text = "South Lake"
	btn_lake_s.pressed.connect(func(): world_view.focus_on_lake("south"))
	row_nav.add_child(btn_lake_s)

	var btn_cycle = Button.new()
	btn_cycle.text = "Cycle Ant"
	btn_cycle.pressed.connect(_cycle_resident_focus)
	row_nav.add_child(btn_cycle)

	# Bottom Inspector Panel
	var insp_panel = PanelContainer.new()
	insp_panel.position = Vector2(16, 140)
	insp_panel.custom_minimum_size = Vector2(360, 80)
	canvas.add_child(insp_panel)

	inspector_label = Label.new()
	inspector_label.text = "Selected Resident: None\n(Use 'Cycle Ant' or click an ant to inspect)"
	insp_panel.add_child(inspector_label)

func _connect_signals() -> void:
	ws_client.snapshot_received.connect(_on_snapshot_received)
	ws_client.connected.connect(_on_connected)
	ws_client.disconnected.connect(_on_disconnected)
	ws_client.connection_error.connect(_on_connection_error)
	ws_client.state_changed.connect(_on_state_changed)
	entity_registry.population_updated.connect(_on_population_updated)

func _process(delta: float) -> void:
	if is_tour_mode:
		_process_tour(delta)

	if ws_client.current_state == WSClient.ClientState.CONNECTED:
		var now = Time.get_ticks_msec() / 1000.0
		# If no snapshot received for > 0.6 seconds, stall movement
		if now - last_snapshot_time > 0.6 and last_snapshot_time > 0.0:
			entity_registry.on_network_stalled()
			status_label.text = "Status: Connected (Stalled...)"

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
				world_view.focus_on_resident(r)
				_update_inspector(r)
				return

func _focus_on_carrying_resident() -> void:
	for r in entity_registry.residents.values():
		if is_instance_valid(r) and r.carrying_amount > 0:
			world_view.focus_on_resident(r)
			_update_inspector(r)
			return
	for r in entity_registry.residents.values():
		if is_instance_valid(r) and r.state_name in ["carry", "return"]:
			world_view.focus_on_resident(r)
			_update_inspector(r)
			return
	if not entity_registry.residents.is_empty():
		var first_r = entity_registry.residents.values()[0]
		world_view.focus_on_resident(first_r)
		_update_inspector(first_r)


func _on_connect_button_pressed() -> void:
	if ws_client.current_state == WSClient.ClientState.CONNECTED:
		ws_client.disconnect_from_server()
	else:
		ws_client.connect_to_server(server_line_edit.text)

func _on_connected() -> void:
	connect_button.text = "Disconnect"
	status_label.text = "Status: CONNECTED (Protocol v%d)" % WSClient.EXPECTED_PROTOCOL_VERSION
	entity_registry.clear_all() # Clean start: guarantee zero duplicate IDs

func _on_disconnected() -> void:
	connect_button.text = "Connect"
	status_label.text = "Status: DISCONNECTED"
	entity_registry.on_network_stalled()

func _on_connection_error(msg: String) -> void:
	status_label.text = "Status: ERROR (" + msg + ")"
	entity_registry.on_network_stalled()

func _on_state_changed(_new_state: int, status_text: String) -> void:
	status_label.text = "Status: " + status_text

func _on_snapshot_received(snapshot: Dictionary) -> void:
	last_snapshot_time = Time.get_ticks_msec() / 1000.0
	entity_registry.on_network_resumed()
	entity_registry.update_from_snapshot(snapshot)
	world_view.update_world_entities(snapshot)

	var tick = int(snapshot.get("tick", 0))
	var session = snapshot.get("session", {})
	var speed = float(session.get("speed", 1.0))
	var weather = snapshot.get("weather", {})
	var weather_state = str(weather.get("state", "clear"))

	tick_label.text = "Tick: %d" % tick
	if speed <= 0.0:
		speed_label.text = "Speed: PAUSED (0x)"
	else:
		speed_label.text = "Speed: %.1fx (%s)" % [speed, weather_state]

	_update_inspector()

func _on_population_updated(col1: int, col2: int) -> void:
	pop_label.text = "Colony 1: %d | Colony 2: %d (Total: %d)" % [col1, col2, col1 + col2]

func _cycle_resident_focus() -> void:
	var res_list = entity_registry.residents.values()
	if res_list.is_empty():
		return
	selected_resident_idx = (selected_resident_idx + 1) % res_list.size()
	var target = res_list[selected_resident_idx] as NetworkResident
	if is_instance_valid(target):
		world_view.focus_on_resident(target)
		_update_inspector(target)

func _update_inspector(target: NetworkResident = null) -> void:
	if not target:
		if is_instance_valid(world_view.focused_target) and world_view.focused_target is NetworkResident:
			target = world_view.focused_target as NetworkResident
		elif not entity_registry.residents.is_empty():
			var keys = entity_registry.residents.keys()
			var safe_idx = min(selected_resident_idx, keys.size() - 1)
			target = entity_registry.residents[keys[safe_idx]]

	if is_instance_valid(target):
		var carry_str = "None"
		if target.carrying_amount > 0:
			carry_str = "%s (%d)" % [target.carry_kind if target.carry_kind != "" else "clay", target.carrying_amount]
		inspector_label.text = "ID: %s | Colony: %s | State: %s\nJob: %s | Carrying: %s\nPos: (%.1f, %.1f)" % [
			target.ant_id, target.colony_id, target.state_name,
			target.job_name if target.job_name != "" else "wander",
			carry_str,
			target.global_position.x, target.global_position.z
		]
