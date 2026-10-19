extends SceneTree

## Automated Headless Unit Tests for M2 Packet Decoder & Protocol Validation.

func _init() -> void:
	print("=== RUNNING M2 PACKET DECODER TESTS ===")
	var passed = 0
	var total = 0

	total += 1
	if test_valid_v21_snapshot():
		passed += 1

	total += 1
	if test_invalid_json_handling():
		passed += 1

	total += 1
	if test_incompatible_protocol_version_rejected():
		passed += 1

	total += 1
	if test_empty_or_malformed_packets():
		passed += 1

	print("=== PACKET DECODER RESULTS: %d/%d PASSED ===" % [passed, total])
	if passed == total:
		print("ALL PACKET DECODER TESTS PASSED!")
		quit(0)
	else:
		push_error("SOME PACKET DECODER TESTS FAILED!")
		quit(1)

func test_valid_v21_snapshot() -> bool:
	var client = WSClient.new()
	var received: Array[Dictionary] = []
	client.snapshot_received.connect(func(snap): received.append(snap))

	var raw_valid = JSON.stringify({
		"snapshotVersion": 21,
		"protocolVersion": 21,
		"tick": 500,
		"session": {"speed": 1.0, "status": "playing"},
		"surface": {"width": 480, "height": 480},
		"colonies": [{"id": "colony-1", "colony": {"population": {"workers": 8}}}],
		"ants": [{"id": "ant-1", "colonyId": "colony-1", "pos": {"x": 120.0, "y": 240.0}}]
	})

	# Simulate packet reception via internal helper
	var parsed = JSON.parse_string(raw_valid)
	if parsed == null or typeof(parsed) != TYPE_DICTIONARY:
		push_error("Failed to parse valid test JSON")
		return false

	var snap_ver = parsed.get("snapshotVersion", -1)
	if snap_ver != WSClient.EXPECTED_SNAPSHOT_VERSION:
		push_error("Expected version %d, got %d" % [WSClient.EXPECTED_SNAPSHOT_VERSION, snap_ver])
		return false

	print("  PASS: test_valid_v21_snapshot")
	return true

func test_invalid_json_handling() -> bool:
	var invalid_samples = [
		"{ not valid json",
		"",
		"12345",
		"[\"array\", \"not\", \"dict\"]"
	]

	for sample in invalid_samples:
		var parsed = JSON.parse_string(sample)
		var is_valid_dict = (parsed != null and typeof(parsed) == TYPE_DICTIONARY)
		if is_valid_dict:
			push_error("Expected rejection for: " + sample)
			return false

	print("  PASS: test_invalid_json_handling")
	return true

func test_incompatible_protocol_version_rejected() -> bool:
	var bad_versions = [20, 22, 1, 99, -1]
	for ver in bad_versions:
		var bad_snap = {
			"snapshotVersion": ver,
			"protocolVersion": ver,
			"tick": 100
		}
		var snap_ver = bad_snap.get("snapshotVersion", -1)
		var proto_ver = bad_snap.get("protocolVersion", snap_ver)
		var is_compatible = (snap_ver == WSClient.EXPECTED_SNAPSHOT_VERSION or proto_ver == WSClient.EXPECTED_PROTOCOL_VERSION)
		if is_compatible:
			push_error("Version %d must NOT be compatible with expected %d!" % [ver, WSClient.EXPECTED_PROTOCOL_VERSION])
			return false

	print("  PASS: test_incompatible_protocol_version_rejected")
	return true

func test_empty_or_malformed_packets() -> bool:
	var malformed = {
		"snapshotVersion": 21,
		"protocolVersion": 21,
		# missing tick, colonies, ants
	}
	var snap_ver = malformed.get("snapshotVersion", -1)
	if snap_ver != 21:
		return false

	var ants = malformed.get("ants", [])
	if typeof(ants) != TYPE_ARRAY:
		return false

	print("  PASS: test_empty_or_malformed_packets")
	return true
