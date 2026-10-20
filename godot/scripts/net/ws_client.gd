class_name WSClient
extends Node

## Passive WebSocket client for observing Clayfolk simulation snapshots.
## Complies with Clayfolk Protocol v21. Strictly observer-only: never sends
## mutating game commands to the server.

signal connected
signal disconnected
signal snapshot_received(snapshot: Dictionary)
signal connection_error(message: String)
signal state_changed(new_state: int, status_text: String)

enum ClientState {
	DISCONNECTED,
	CONNECTING,
	WAITING_FOR_SNAPSHOT,
	CONNECTED,
	ERROR
}

const EXPECTED_SNAPSHOT_VERSION: int = 21
const EXPECTED_PROTOCOL_VERSION: int = 21

@export var server_url: String = "ws://127.0.0.1:8787"
@export var auto_reconnect: bool = false
@export var reconnect_interval: float = 2.0

var current_state: ClientState = ClientState.DISCONNECTED
var peer: WebSocketPeer = WebSocketPeer.new()
var status_message: String = "Disconnected"
var last_snapshot_tick: int = -1
var last_packet_time: float = 0.0
var reconnect_timer: float = 0.0
var has_received_valid_snapshot: bool = false

# Received metrics
var packets_received: int = 0
var bytes_received: int = 0

func _ready() -> void:
	if current_state == ClientState.DISCONNECTED:
		_set_state(ClientState.DISCONNECTED, "Ready to connect")

func _process(delta: float) -> void:
	if current_state == ClientState.DISCONNECTED and auto_reconnect:
		reconnect_timer += delta
		if reconnect_timer >= reconnect_interval:
			reconnect_timer = 0.0
			connect_to_server(server_url)

	if current_state == ClientState.DISCONNECTED or current_state == ClientState.ERROR:
		return

	peer.poll()
	var peer_state = peer.get_ready_state()

	match peer_state:
		WebSocketPeer.STATE_OPEN:
			if current_state == ClientState.CONNECTING:
				_set_state(ClientState.WAITING_FOR_SNAPSHOT, "Connected to %s, waiting for snapshot..." % server_url)

			while peer.get_available_packet_count() > 0:
				_process_packet()
				if current_state == ClientState.ERROR:
					break

		WebSocketPeer.STATE_CONNECTING:
			if current_state != ClientState.CONNECTING:
				_set_state(ClientState.CONNECTING, "Connecting to %s..." % server_url)

		WebSocketPeer.STATE_CLOSING:
			pass

		WebSocketPeer.STATE_CLOSED:
			var code = peer.get_close_code()
			var reason = peer.get_close_reason()
			var msg = "Connection closed (code %d: %s)" % [code, reason]
			if current_state == ClientState.CONNECTED or current_state == ClientState.WAITING_FOR_SNAPSHOT:
				_set_state(ClientState.DISCONNECTED, msg)
				disconnected.emit()
			elif current_state == ClientState.CONNECTING:
				_set_state(ClientState.ERROR, "Failed to connect to %s" % server_url)
				connection_error.emit(status_message)

func connect_to_server(target_url: String = "") -> Error:
	if target_url != "":
		server_url = target_url

	if current_state == ClientState.CONNECTED or current_state == ClientState.WAITING_FOR_SNAPSHOT:
		disconnect_from_server()

	has_received_valid_snapshot = false
	peer = WebSocketPeer.new()
	peer.inbound_buffer_size = 4 * 1024 * 1024
	peer.max_queued_packets = 2048
	var err = peer.connect_to_url(server_url)
	if err != OK:
		_set_state(ClientState.ERROR, "Cannot open socket to %s (error %d)" % [server_url, err])
		connection_error.emit(status_message)
		return err

	_set_state(ClientState.CONNECTING, "Connecting to %s..." % server_url)
	return OK

func disconnect_from_server() -> void:
	if peer and (peer.get_ready_state() == WebSocketPeer.STATE_OPEN or peer.get_ready_state() == WebSocketPeer.STATE_CONNECTING):
		peer.close(1000, "Client disconnect")
	if current_state != ClientState.ERROR:
		_set_state(ClientState.DISCONNECTED, "Disconnected by user")
		disconnected.emit()

func send_command(cmd: Dictionary) -> Error:
	if peer and peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var json_str = JSON.stringify(cmd)
		return peer.send_text(json_str)
	return ERR_UNCONFIGURED

static func decode_and_validate_packet(text: String) -> Dictionary:
	if text.strip_edges().is_empty():
		return { "ok": false, "error": "Empty packet text" }

	var parsed = JSON.parse_string(text)
	if parsed == null:
		return { "ok": false, "error": "Invalid JSON syntax" }

	if typeof(parsed) != TYPE_DICTIONARY:
		return { "ok": false, "error": "Root packet must be a JSON dictionary" }

	var snap: Dictionary = parsed

	# 1. snapshotVersion check (must be exact integer equal to EXPECTED_SNAPSHOT_VERSION)
	if not snap.has("snapshotVersion"):
		return { "ok": false, "error": "Missing mandatory field 'snapshotVersion'" }
	var sv = snap["snapshotVersion"]
	if typeof(sv) == TYPE_FLOAT:
		if not is_finite(sv) or floor(sv) != sv or int(sv) != EXPECTED_SNAPSHOT_VERSION:
			return { "ok": false, "error": "snapshotVersion must be exact integer %d, got %s" % [EXPECTED_SNAPSHOT_VERSION, str(sv)] }
	elif typeof(sv) == TYPE_INT:
		if sv != EXPECTED_SNAPSHOT_VERSION:
			return { "ok": false, "error": "Incompatible snapshotVersion: received %d, expected %d" % [sv, EXPECTED_SNAPSHOT_VERSION] }
	else:
		return { "ok": false, "error": "snapshotVersion must be a number, got %s" % typeof(sv) }

	# 2. protocolVersion check (must be exact integer equal to EXPECTED_PROTOCOL_VERSION)
	if not snap.has("protocolVersion"):
		return { "ok": false, "error": "Missing mandatory field 'protocolVersion'" }
	var pv = snap["protocolVersion"]
	if typeof(pv) == TYPE_FLOAT:
		if not is_finite(pv) or floor(pv) != pv or int(pv) != EXPECTED_PROTOCOL_VERSION:
			return { "ok": false, "error": "protocolVersion must be exact integer %d, got %s" % [EXPECTED_PROTOCOL_VERSION, str(pv)] }
	elif typeof(pv) == TYPE_INT:
		if pv != EXPECTED_PROTOCOL_VERSION:
			return { "ok": false, "error": "Incompatible protocolVersion: received %d, expected %d" % [pv, EXPECTED_PROTOCOL_VERSION] }
	else:
		return { "ok": false, "error": "protocolVersion must be a number, got %s" % typeof(pv) }

	# 3. tick check (must be finite non-negative integer)
	if not snap.has("tick"):
		return { "ok": false, "error": "Missing mandatory field 'tick'" }
	var tick = snap["tick"]
	if typeof(tick) == TYPE_FLOAT:
		if not is_finite(tick) or floor(tick) != tick or tick < 0:
			return { "ok": false, "error": "tick must be finite non-negative integer, got %s" % str(tick) }
	elif typeof(tick) == TYPE_INT:
		if tick < 0:
			return { "ok": false, "error": "tick must be a non-negative integer, got %d" % tick }
	else:
		return { "ok": false, "error": "tick must be a number, got %s" % typeof(tick) }

	# 4. colonies check (must be Array)
	if not snap.has("colonies") or typeof(snap["colonies"]) != TYPE_ARRAY:
		return { "ok": false, "error": "Missing or non-array 'colonies'" }

	# 5. ants check (must be Array)
	if not snap.has("ants") or typeof(snap["ants"]) != TYPE_ARRAY:
		return { "ok": false, "error": "Missing or non-array 'ants'" }

	# 6. surface check (must be Dictionary)
	if not snap.has("surface") or typeof(snap["surface"]) != TYPE_DICTIONARY:
		return { "ok": false, "error": "Missing or non-dictionary 'surface'" }

	# 7. session check (must be Dictionary)
	if not snap.has("session") or typeof(snap["session"]) != TYPE_DICTIONARY:
		return { "ok": false, "error": "Missing or non-dictionary 'session'" }
	var session: Dictionary = snap["session"]
	if session.has("speed"):
		var sp = session["speed"]
		if (typeof(sp) != TYPE_INT and typeof(sp) != TYPE_FLOAT) or not is_finite(sp):
			return { "ok": false, "error": "session.speed must be a finite number" }

	# 8. Validate each ant structure and check for duplicate IDs
	var seen_ant_ids: Dictionary = {}
	for ant in snap["ants"]:
		if typeof(ant) != TYPE_DICTIONARY:
			return { "ok": false, "error": "Ant element in 'ants' array must be a dictionary" }
		if not ant.has("id") or str(ant["id"]).is_empty():
			return { "ok": false, "error": "Ant element missing non-empty 'id'" }
		var aid = str(ant["id"])
		if seen_ant_ids.has(aid):
			return { "ok": false, "error": "Duplicate ant ID '%s' detected in snapshot" % aid }
		seen_ant_ids[aid] = true

		if not ant.has("pos") or typeof(ant["pos"]) != TYPE_DICTIONARY:
			return { "ok": false, "error": "Ant element '%s' missing 'pos' dictionary" % aid }
		var pos = ant["pos"]
		if not pos.has("x") or not pos.has("y"):
			return { "ok": false, "error": "Ant element '%s' pos missing x or y coordinates" % aid }
		var px = pos["x"]
		var py = pos["y"]
		if (typeof(px) != TYPE_INT and typeof(px) != TYPE_FLOAT) or (typeof(py) != TYPE_INT and typeof(py) != TYPE_FLOAT):
			return { "ok": false, "error": "Ant element '%s' pos coordinates must be numbers" % aid }
		if not is_finite(px) or not is_finite(py):
			return { "ok": false, "error": "Ant element '%s' pos coordinates must be finite" % aid }

	return { "ok": true, "snapshot": snap }

func _process_packet() -> void:
	var packet = peer.get_packet()
	bytes_received += packet.size()
	packets_received += 1
	last_packet_time = Time.get_ticks_msec() / 1000.0

	var text = packet.get_string_from_utf8()
	var val_res = decode_and_validate_packet(text)
	if not val_res.get("ok", false):
		var err_msg = "Packet validation failed: " + str(val_res.get("error", "Unknown error"))
		push_error("[WSClient] " + err_msg)
		_set_state(ClientState.ERROR, err_msg)
		connection_error.emit(err_msg)
		if peer.get_ready_state() == WebSocketPeer.STATE_OPEN or peer.get_ready_state() == WebSocketPeer.STATE_CONNECTING:
			peer.close(1002, "Protocol error")
		return

	var snapshot: Dictionary = val_res["snapshot"]
	last_snapshot_tick = snapshot.get("tick", -1)

	# Transition to CONNECTED state only upon successfully verifying the first valid snapshot
	if not has_received_valid_snapshot:
		has_received_valid_snapshot = true
		_set_state(ClientState.CONNECTED, "Connected (Protocol v%d)" % EXPECTED_PROTOCOL_VERSION)
		connected.emit()

	snapshot_received.emit(snapshot)

func _set_state(new_state: ClientState, msg: String) -> void:
	current_state = new_state
	status_message = msg
	state_changed.emit(current_state, status_message)

func get_status_text() -> String:
	return status_message
