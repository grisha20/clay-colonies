extends SceneTree

func _initialize() -> void:
	call_deferred("audit")

func snapshot(tick: int, x: float) -> Dictionary:
	return {"tick":tick,"session":{"speed":1,"status":"playing"},"surface":{"width":480,"height":480,"buildings":[],"entrances":[]},"ants":[{"id":"audit","colonyId":"colony-1","pos":{"x":x,"y":100},"heading":{"x":1,"y":0}}]}

func audit() -> void:
	var registry=EntityRegistry.new()
	root.add_child(registry)
	registry.set_process(false)
	registry.update_from_snapshot(snapshot(0,100))
	var r=registry.get_resident("audit")
	r.set_process(false)
	r.anim_player.callback_mode_process=AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	var final_steps: Array = []
	var low=INF
	var high=0.0
	# Feed the PRODUCTION registry with the same measured 100ms interval every time.
	# Frame time is controlled; no connection or server state is used.
	for packet in range(1,21):
		registry.last_snapshot_timestamp=Time.get_ticks_msec()/1000.0-0.100
		registry.update_from_snapshot(snapshot(packet,100+packet*0.1))
		var steps: Array = []
		for frame in range(10):
			var before=r.position.x
			r._process(0.010)
			var speed=(r.position.x-before)/0.010
			steps.append(snapped(speed,0.001))
			if packet>=18:
				low=minf(low,speed)
				high=maxf(high,speed)
		if packet>=18:final_steps.append(steps)
	print("F2939_STEADY_INPUT speed_m_s=1.0 packet_ms=100 frame_ms=10 output_speeds=",JSON.stringify(final_steps))
	print("F2939_STEADY_OUTPUT min_m_s=",low," max_m_s=",high," ratio=",high/low)
	# Keep moving in snapshots while delivery changes by 100/160/40ms.
	var jitter: Array = []
	var elapsed=2.1
	var previous_gap=100
	for ms in [100,160,40,100,160,40]:
		registry.last_snapshot_timestamp=Time.get_ticks_msec()/1000.0-float(previous_gap)/1000.0
		registry.update_from_snapshot(snapshot(int(elapsed*1000),100+elapsed))
		var samples: Array = []
		for frame in range(int(ms/10)):
			var before=r.position.x
			r._process(0.010)
			samples.append(snapped((r.position.x-before)/0.010,0.001))
		jitter.append({"previous_arrival_gap_ms":previous_gap,"next_arrival_gap_ms":ms,"speeds":samples})
		elapsed+=float(ms)/1000.0
		previous_gap=ms
	print("F2939_JITTER_REGISTRY ",JSON.stringify(jitter))
	registry.free()
	await process_frame
	quit(0)
