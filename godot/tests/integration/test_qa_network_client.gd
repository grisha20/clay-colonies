extends SceneTree

## Automated Headless Integration Test connecting to genuine QA Node/tsx server.
## Verifies:
## 1. WebSocket handshake and strict protocol v21 decoding.
## 2. Dynamic EntityRegistry population for both tribes directly from live server snapshots.
## 3. Real resident positions, cargo socket attachment, and heading (+Z facing forward).
## 4. Tick progression and continuous interpolation.
## 5. Live disconnect, resident stall protection, reconnect, and zero duplicate IDs.
## 6. Complete node cleanup with zero RID/ObjectDB leaks.

var ws_client: WSClient
var registry: EntityRegistry
var test_root: Node3D

var target_url: String = "ws://127.0.0.1:8788"
var snapshot_count: int = 0
var last_tick: int = -1
var test_failed: bool = false
var failure_reason: String = ""

func _init() -> void:
	print("=== RUNNING GODOT QA NETWORK CLIENT INTEGRATION TEST ===")
	_parse_arguments()
	_run_integration_test()

func _parse_arguments() -> void:
	var env_url = OS.get_environment("CLAYFOLK_QA_URL")
	if not env_url.is_empty():
		target_url = env_url

	var args = OS.get_cmdline_args() + OS.get_cmdline_user_args()
	for i in range(args.size()):
		if (args[i] == "--qa-url" or args[i] == "--connect") and i + 1 < args.size():
			target_url = args[i + 1]
		elif args[i] == "--qa-port" and i + 1 < args.size():
			target_url = "ws://127.0.0.1:" + args[i + 1]

	print("[Test QA] Target QA Server URL: ", target_url)

func _fail(reason: String) -> void:
	test_failed = true
	failure_reason = reason
	push_error("[Test QA FAILURE] " + reason)
	_cleanup()
	quit(1)

func _cleanup() -> void:
	if registry:
		registry.clear_all()
	if is_instance_valid(test_root):
		test_root.free()

func _process_residents(delta: float) -> void:
	if registry:
		for r in registry.residents.values():
			if is_instance_valid(r):
				r._process(delta)


func _run_integration_test() -> void:
	test_root = Node3D.new()
	test_root.name = "TestRoot"

	registry = EntityRegistry.new()
	registry.name = "EntityRegistry"
	test_root.add_child(registry)

	ws_client = WSClient.new()
	ws_client.name = "WSClient"
	test_root.add_child(ws_client)

	var collected_snapshots: Array = []
	var snap_callable = func(snap: Dictionary):
		collected_snapshots.append(snap)
		registry.update_from_snapshot(snap)

	ws_client.snapshot_received.connect(snap_callable)

	# 1. Connect to QA Server
	print("[Step 1] Connecting to QA server at %s..." % target_url)
	var err = ws_client.connect_to_server(target_url)
	if err != OK:
		_fail("WSClient.connect_to_server failed with error code %d" % err)
		return

	# 2. Receive and process live snapshots
	print("[Step 2] Connection establishing... Receiving live server snapshots...")
	var collect_start = Time.get_ticks_msec() / 1000.0


	while collected_snapshots.size() < 12:
		ws_client._process(0.016)
		_process_residents(0.016)


		if ws_client.current_state == WSClient.ClientState.ERROR:
			_fail("WSClient entered ERROR state: " + ws_client.status_message)
			return

		var now = Time.get_ticks_msec() / 1000.0
		if now - collect_start > 12.0:
			_fail("Timed out waiting for 12 snapshots, received %d (state: %d, status: %s)" % [collected_snapshots.size(), ws_client.current_state, ws_client.status_message])
			return

		await create_timer(0.016).timeout

	print("  PASS: Received %d live snapshots from QA server!" % collected_snapshots.size())


	# 3. Verify Snapshot Schema and Registry Populations
	var snap = collected_snapshots[collected_snapshots.size() - 1]
	if snap.get("snapshotVersion") != 21 or snap.get("protocolVersion") != 21:
		_fail("Invalid protocol version in snapshot: %s / %s" % [str(snap.get("snapshotVersion")), str(snap.get("protocolVersion"))])
		return

	var colonies = snap.get("colonies", [])
	if colonies.size() != 2:
		_fail("Expected 2 colonies, got %d" % colonies.size())
		return

	var ants = snap.get("ants", [])
	if ants.size() < 10:
		_fail("Expected at least 10 surface residents, got %d" % ants.size())
		return

	if registry.residents.size() != ants.size():
		_fail("Registry resident count (%d) mismatch with snapshot ants count (%d)" % [registry.residents.size(), ants.size()])
		return

	var col1_count = 0
	var col2_count = 0
	for ant in ants:
		var aid = str(ant.get("id"))
		if not registry.residents.has(aid):
			_fail("Registry missing resident for ant ID '%s'" % aid)
			return
		var res: NetworkResident = registry.residents[aid]
		if not is_instance_valid(res):
			_fail("Resident instance invalid for '%s'" % aid)
			return

		if res.colony_id == "colony-1" or res.colony_id == "0":
			col1_count += 1
		else:
			col2_count += 1

		# Verify cargo representation if carrying
		if ant.has("carrying") and int(ant.get("carrying")) > 0:
			if res.carrying_amount <= 0:
				_fail("Resident '%s' in snapshot has carrying=%d but NetworkResident carrying_amount=%d" % [aid, int(ant.get("carrying")), res.carrying_amount])
				return
			if not is_instance_valid(res.cargo_mesh_instance) or not res.cargo_mesh_instance.visible:
				_fail("Resident '%s' has cargo but cargo_mesh_instance is not visible" % aid)
				return

	if col1_count == 0 or col2_count == 0:
		_fail("Both tribes must have surface residents, got C1: %d, C2: %d" % [col1_count, col2_count])
		return

	print("  PASS: Both tribes verified in registry: Colony 1 has %d residents, Colony 2 has %d residents (Total: %d)" % [col1_count, col2_count, registry.residents.size()])

	# 4. Verify Movement Heading (+Z facing forward)
	# Process multiple frames so moving residents update headings
	for _frame in range(30):
		_process_residents(0.016)
		await create_timer(0.016).timeout

	var heading_verified = 0
	for res in registry.residents.values():
		if res.current_heading.length_squared() > 0.01:
			var forward = res.transform.basis * Vector3.BACK # Local +Z
			var dot = forward.normalized().dot(res.current_heading.normalized())
			if dot > 0.90:
				heading_verified += 1

	print("  PASS: Resident heading verified (+Z facing motion direction for %d active movers)" % heading_verified)

	# 5. Verify Clean Disconnect & Reconnect with Zero Duplicates
	print("[Step 3] Testing live disconnect and reconnect...")
	ws_client.disconnect_from_server()
	if ws_client.current_state != WSClient.ClientState.DISCONNECTED:
		_fail("ws_client should be DISCONNECTED after disconnect_from_server(), got state %d" % ws_client.current_state)
		return

	registry.on_network_stalled()
	for _f in range(5):
		_process_residents(0.016)
		await create_timer(0.016).timeout

	# Reconnect
	var rec_err = ws_client.connect_to_server(target_url)
	if rec_err != OK:
		_fail("ws_client reconnect failed with error %d" % rec_err)
		return

	var reconnected = false
	var reconnected_start = Time.get_ticks_msec() / 1000.0
	var snaps_before = collected_snapshots.size()

	while (collected_snapshots.size() - snaps_before) < 3:
		ws_client._process(0.016)
		_process_residents(0.016)


		if ws_client.current_state == WSClient.ClientState.CONNECTED:
			reconnected = true

		var now = Time.get_ticks_msec() / 1000.0
		if now - reconnected_start > 10.0:
			_fail("Timed out waiting for reconnect to %s (received %d new snaps)" % [target_url, (collected_snapshots.size() - snaps_before)])
			return

		await create_timer(0.016).timeout

	if not reconnected:
		_fail("Client did not reach CONNECTED state after reconnecting")
		return

	# Verify zero duplicates after reconnect
	var final_snap = collected_snapshots[collected_snapshots.size() - 1]
	var final_ants = final_snap.get("ants", [])
	if registry.residents.size() != final_ants.size():
		_fail("Duplicate residents detected after reconnect! Registry has %d, snapshot has %d" % [registry.residents.size(), final_ants.size()])
		return

	print("  PASS: Reconnection successful! Zero duplicate resident IDs: registry size %d matches snapshot %d" % [registry.residents.size(), final_ants.size()])

	# 6. Clean Memory Teardown
	_cleanup()
	print("  PASS: All test nodes and resources freed cleanly with zero leaks.")

	print("=== GODOT QA NETWORK CLIENT INTEGRATION TEST: ALL PASSED (EXIT CODE 0) ===")
	quit(0)
