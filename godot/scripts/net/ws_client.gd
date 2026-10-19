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
	CONNECTED,
	ERROR
}

const EXPECTED_SNAPSHOT_VERSION: int = 21
const EXPECTED_PROTOCOL_VERSION: int = 21

@export var server_url: String = "ws://localhost:8787"
@export var auto_reconnect: bool = false
@export var reconnect_interval: float = 2.0

var current_state: ClientState = ClientState.DISCONNECTED
var peer: WebSocketPeer = WebSocketPeer.new()
var status_message: String = "Disconnected"
var last_snapshot_tick: int = -1
var last_packet_time: float = 0.0
var reconnect_timer: float = 0.0

# Received metrics
var packets_received: int = 0
var bytes_received: int = 0

func _ready() -> void:
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
				_set_state(ClientState.CONNECTED, "Connected to %s" % server_url)
				connected.emit()

			while peer.get_available_packet_count() > 0:
				_process_packet()

		WebSocketPeer.STATE_CONNECTING:
			if current_state != ClientState.CONNECTING:
				_set_state(ClientState.CONNECTING, "Connecting to %s..." % server_url)

		WebSocketPeer.STATE_CLOSING:
			pass

		WebSocketPeer.STATE_CLOSED:
			var code = peer.get_close_code()
			var reason = peer.get_close_reason()
			var msg = "Connection closed (code %d: %s)" % [code, reason]
			if current_state == ClientState.CONNECTED:
				_set_state(ClientState.DISCONNECTED, msg)
				disconnected.emit()
			elif current_state == ClientState.CONNECTING:
				_set_state(ClientState.ERROR, "Failed to connect to %s" % server_url)
				connection_error.emit(status_message)

func connect_to_server(target_url: String = "") -> Error:
	if target_url != "":
		server_url = target_url

	if current_state == ClientState.CONNECTED:
		disconnect_from_server()

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
	if peer.get_ready_state() == WebSocketPeer.STATE_OPEN or peer.get_ready_state() == WebSocketPeer.STATE_CONNECTING:
		peer.close(1000, "Client disconnect")
	_set_state(ClientState.DISCONNECTED, "Disconnected by user")
	disconnected.emit()

func _process_packet() -> void:
	var packet = peer.get_packet()
	bytes_received += packet.size()
	packets_received += 1
	last_packet_time = Time.get_ticks_msec() / 1000.0

	var text = packet.get_string_from_utf8()
	if text.is_empty():
		return

	var parse_result = JSON.parse_string(text)
	if parse_result == null or typeof(parse_result) != TYPE_DICTIONARY:
		push_warning("[WSClient] Received non-dictionary or invalid JSON packet")
		return

	var snapshot: Dictionary = parse_result

	# Protocol and Snapshot Version Validation
	var snap_ver = snapshot.get("snapshotVersion", -1)
	var proto_ver = snapshot.get("protocolVersion", snap_ver)

	if snap_ver != EXPECTED_SNAPSHOT_VERSION and proto_ver != EXPECTED_PROTOCOL_VERSION:
		var err_msg = "Несовместимая версия протокола: получено snapshot=%s/proto=%s, ожидается %d. Отключение." % [
			str(snap_ver), str(proto_ver), EXPECTED_PROTOCOL_VERSION
		]
		push_error("[WSClient] " + err_msg)
		_set_state(ClientState.ERROR, err_msg)
		connection_error.emit(err_msg)
		disconnect_from_server()
		return

	last_snapshot_tick = snapshot.get("tick", -1)
	snapshot_received.emit(snapshot)

func _set_state(new_state: ClientState, msg: String) -> void:
	current_state = new_state
	status_message = msg
	state_changed.emit(current_state, status_message)

func get_status_text() -> String:
	return status_message
