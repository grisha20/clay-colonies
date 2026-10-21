extends SceneTree

## Hunts the occasional hitches in normal play against an isolated QA server.
## Plays at the given speed with the camera on the camp (as a player would),
## logs every frame over the threshold with the client sections that ran in it
## (FramePerf), the gap since the last snapshot and the snapshot size, and
## prints a summary: frame percentiles, hitch count, per-section maxima,
## snapshot interval jitter.
##   godot --path godot --script res://tests/visual/probe_hitches.gd -- --qa-port 8803 [--seconds 120] [--speed 1] [--threshold 25]

var scene: WorldObserver

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var port = ""
	var seconds = 120.0
	var speed = 1
	var threshold = 25.0
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--qa-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--seconds" and i + 1 < args.size():
			seconds = float(args[i + 1])
		elif args[i] == "--speed" and i + 1 < args.size():
			speed = int(args[i + 1])
		elif args[i] == "--threshold" and i + 1 < args.size():
			threshold = float(args[i + 1])
	if port == "":
		push_error("--qa-port of an isolated QA server is required")
		quit(2)
		return
	scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.server_line_edit.text = "ws://127.0.0.1:" + port
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	var start = Time.get_ticks_msec()
	while scene.ws_client.packets_received < 5 or scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() - start > 15000:
			push_error("No snapshots from QA server")
			quit(1)
			return
		await process_frame
	scene.ws_client.send_command({"type": "setSpeed", "value": speed})
	scene.world_view.focus_on_colony(0)
	for i in range(120):
		await process_frame
	FramePerf.totals.clear()
	FramePerf.take_frame()
	var deltas: Array[float] = []
	var gaps: Array[float] = []
	var hitches = 0
	var last = Time.get_ticks_usec()
	var packets = scene.ws_client.packets_received
	var bytes = scene.ws_client.bytes_received
	var last_packet_ms = Time.get_ticks_msec()
	var t_start = Time.get_ticks_msec()
	while Time.get_ticks_msec() - t_start < int(seconds * 1000.0):
		await process_frame
		var now = Time.get_ticks_usec()
		var d = float(now - last) / 1000.0
		last = now
		deltas.append(d)
		var f = FramePerf.take_frame()
		var got = scene.ws_client.packets_received - packets
		var size = scene.ws_client.bytes_received - bytes
		packets = scene.ws_client.packets_received
		bytes = scene.ws_client.bytes_received
		if got > 0:
			gaps.append(float(Time.get_ticks_msec() - last_packet_ms))
			last_packet_ms = Time.get_ticks_msec()
		if d > threshold:
			hitches += 1
			var parts: PackedStringArray = []
			for k in f.keys():
				if f[k] > 1.0:
					parts.append("%s=%.1f" % [k, f[k]])
			print("HITCH t=%.1fs frame=%.1fms packets=%d bytes=%d tick=%d residents=%d %s" % [
				float(Time.get_ticks_msec() - t_start) / 1000.0, d, got, size,
				int(scene.world_view.last_snapshot.get("tick", 0)), scene.entity_registry.residents.size(), " ".join(parts)])
	deltas.sort()
	gaps.sort()
	var n = deltas.size()
	var avg = 0.0
	for d in deltas:
		avg += d
	avg /= maxf(1.0, n)
	print("PROBE frames=%d avg=%.2fms p50=%.2f p95=%.2f p99=%.2f max=%.2f hitches(>%.0fms)=%d" % [n, avg, deltas[n / 2], deltas[int(n * 0.95)], deltas[int(n * 0.99)], deltas[n - 1], threshold, hitches])
	if gaps.size() > 2:
		print("PROBE snapshot_gap p50=%.0fms p95=%.0fms max=%.0fms count=%d" % [gaps[gaps.size() / 2], gaps[int(gaps.size() * 0.95)], gaps[gaps.size() - 1], gaps.size()])
	print("PROBE sections:\n" + FramePerf.report())
	quit(0)
