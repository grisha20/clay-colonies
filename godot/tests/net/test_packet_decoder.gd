extends SceneTree

## Comprehensive Automated Unit Tests for Production WSClient Packet Decoder & Schema Validator.
## Verifies:
## 1. Valid snapshot with protocol 21 passes validation.
## 2. Asymmetric version mismatch (21/999 and 999/21) are BOTH strictly rejected.
## 3. Version type checks (strings, booleans, nulls) are rejected.
## 4. Missing mandatory fields (tick, colonies, ants) are rejected.
## 5. Corrupt ant data (missing id, invalid pos, non-numeric coords) are rejected.
## 6. Empty text, non-dictionary JSON, syntax errors are rejected.
## 7. WSClient state transitions and persistent ERROR status preservation.

func _init() -> void:
	print("=== RUNNING PRODUCTION M2 PACKET DECODER TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_valid_v21_snapshot():
		passed += 1

	total += 1
	if test_asymmetric_version_rejections():
		passed += 1

	total += 1
	if test_version_type_validations():
		passed += 1

	total += 1
	if test_mandatory_fields_validation():
		passed += 1

	total += 1
	if test_ant_schema_validation():
		passed += 1

	total += 1
	if test_malformed_json_and_syntax():
		passed += 1

	total += 1
	if test_client_error_state_persistence():
		passed += 1

	print("=== PACKET DECODER RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL PACKET DECODER TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME PACKET DECODER TESTS FAILED!")
		quit(1)

func _get_valid_sample_dict() -> Dictionary:
	return {
		"snapshotVersion": 21,
		"protocolVersion": 21,
		"tick": 100,
		"session": {"mode": "match", "speed": 1.0, "status": "playing"},
		"colonies": [{"id": "colony-1", "color": "#e06030", "ants": []}],
		"ants": [
			{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}, "state": "search"}
		]
	}

func test_valid_v21_snapshot() -> bool:
	var valid_json = JSON.stringify(_get_valid_sample_dict())
	var res = WSClient.decode_and_validate_packet(valid_json)

	if not res.get("ok", false):
		push_error("Valid snapshot was rejected! Error: %s" % str(res.get("error")))
		return false

	var snap = res.get("snapshot", {})
	if snap.get("tick") != 100:
		push_error("Decoded snapshot tick mismatch!")
		return false

	print("  PASS: test_valid_v21_snapshot")
	return true

func test_asymmetric_version_rejections() -> bool:
	# Case 1: snapshotVersion=21, protocolVersion=999
	var d1 = _get_valid_sample_dict()
	d1["protocolVersion"] = 999
	var r1 = WSClient.decode_and_validate_packet(JSON.stringify(d1))
	if r1.get("ok", false):
		push_error("Accepted packet with invalid protocolVersion=999!")
		return false

	# Case 2: snapshotVersion=999, protocolVersion=21
	var d2 = _get_valid_sample_dict()
	d2["snapshotVersion"] = 999
	var r2 = WSClient.decode_and_validate_packet(JSON.stringify(d2))
	if r2.get("ok", false):
		push_error("Accepted packet with invalid snapshotVersion=999!")
		return false

	print("  PASS: test_asymmetric_version_rejections (both 21/999 and 999/21 rejected)")
	return true

func test_version_type_validations() -> bool:
	# String instead of int
	var d1 = _get_valid_sample_dict()
	d1["snapshotVersion"] = "21"
	var r1 = WSClient.decode_and_validate_packet(JSON.stringify(d1))
	if r1.get("ok", false):
		push_error("Accepted string '21' as snapshotVersion!")
		return false

	# Boolean instead of int
	var d2 = _get_valid_sample_dict()
	d2["protocolVersion"] = true
	var r2 = WSClient.decode_and_validate_packet(JSON.stringify(d2))
	if r2.get("ok", false):
		push_error("Accepted boolean true as protocolVersion!")
		return false

	# Null version
	var d3 = _get_valid_sample_dict()
	d3["protocolVersion"] = null
	var r3 = WSClient.decode_and_validate_packet(JSON.stringify(d3))
	if r3.get("ok", false):
		push_error("Accepted null protocolVersion!")
		return false

	print("  PASS: test_version_type_validations (non-numeric types strictly rejected)")
	return true

func test_mandatory_fields_validation() -> bool:
	# Missing tick
	var d1 = _get_valid_sample_dict()
	d1.erase("tick")
	if WSClient.decode_and_validate_packet(JSON.stringify(d1)).get("ok", false):
		push_error("Accepted packet missing 'tick'!")
		return false

	# Negative tick
	var d2 = _get_valid_sample_dict()
	d2["tick"] = -5
	if WSClient.decode_and_validate_packet(JSON.stringify(d2)).get("ok", false):
		push_error("Accepted packet with negative tick!")
		return false

	# Missing colonies
	var d3 = _get_valid_sample_dict()
	d3.erase("colonies")
	if WSClient.decode_and_validate_packet(JSON.stringify(d3)).get("ok", false):
		push_error("Accepted packet missing 'colonies'!")
		return false

	# Missing ants
	var d4 = _get_valid_sample_dict()
	d4.erase("ants")
	if WSClient.decode_and_validate_packet(JSON.stringify(d4)).get("ok", false):
		push_error("Accepted packet missing 'ants'!")
		return false

	print("  PASS: test_mandatory_fields_validation (missing tick, negative tick, missing colonies/ants caught)")
	return true

func test_ant_schema_validation() -> bool:
	# Ant missing id
	var d1 = _get_valid_sample_dict()
	d1["ants"] = [{"pos": {"x": 10.0, "y": 20.0}}]
	if WSClient.decode_and_validate_packet(JSON.stringify(d1)).get("ok", false):
		push_error("Accepted ant missing 'id'!")
		return false

	# Ant missing pos
	var d2 = _get_valid_sample_dict()
	d2["ants"] = [{"id": "ant-1"}]
	if WSClient.decode_and_validate_packet(JSON.stringify(d2)).get("ok", false):
		push_error("Accepted ant missing 'pos'!")
		return false

	# Ant pos coordinates non-numeric
	var d3 = _get_valid_sample_dict()
	d3["ants"] = [{"id": "ant-1", "pos": {"x": "corrupt", "y": 20.0}}]
	if WSClient.decode_and_validate_packet(JSON.stringify(d3)).get("ok", false):
		push_error("Accepted ant with non-numeric pos.x coordinate!")
		return false

	print("  PASS: test_ant_schema_validation (invalid ant structures caught)")
	return true

func test_malformed_json_and_syntax() -> bool:
	# Empty string
	if WSClient.decode_and_validate_packet("").get("ok", false):
		push_error("Accepted empty string!")
		return false

	# Syntax error
	if WSClient.decode_and_validate_packet("{bad_json: 123}").get("ok", false):
		push_error("Accepted invalid JSON syntax!")
		return false

	# Array root instead of Dictionary
	if WSClient.decode_and_validate_packet("[1, 2, 3]").get("ok", false):
		push_error("Accepted array as root packet!")
		return false

	print("  PASS: test_malformed_json_and_syntax")
	return true

func test_client_error_state_persistence() -> bool:
	var client = WSClient.new()

	# Start in connecting
	client._set_state(WSClient.ClientState.CONNECTING, "Connecting...")

	# Simulate validation error
	var err_msg = "Packet validation failed: Incompatible protocolVersion"
	client._set_state(WSClient.ClientState.ERROR, err_msg)

	# User/system calls disconnect_from_server()
	client.disconnect_from_server()

	# The state MUST REMAIN ERROR, and the message must not be wiped by 'Disconnected by user'!
	if client.current_state != WSClient.ClientState.ERROR:
		push_error("disconnect_from_server overwrote ERROR state to %d!" % client.current_state)
		client.free()
		return false

	if client.get_status_text() != err_msg:
		push_error("disconnect_from_server overwrote error message '%s' with '%s'!" % [err_msg, client.get_status_text()])
		client.free()
		return false

	client.free()
	print("  PASS: test_client_error_state_persistence (ERROR state persists without overwrite)")
	return true
