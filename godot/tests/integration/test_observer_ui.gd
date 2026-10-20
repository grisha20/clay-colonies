extends SceneTree

# Real production observer + WSClient against an explicitly supplied own QA port.
# The observer only connects when --qa-port/--connect is provided.
func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	var start = Time.get_ticks_msec()
	while scene.ws_client.packets_received < 5 or scene.entity_registry.residents.is_empty():
		if Time.get_ticks_msec() - start > 12000:
			push_error("Production observer timed out waiting for its explicit QA server")
			scene.free()
			quit(1)
			return
		await process_frame
	for colony in ["colony-1", "colony-2"]:
		var target: NetworkResident = null
		for actor in scene.entity_registry.residents.values():
			if actor.colony_id == colony and actor.carrying_amount > 0:
				target = actor
				break
		if not is_instance_valid(target):
			push_error("QA fixture must supply a carrier in " + colony)
			scene.free()
			quit(1)
			return
		scene.world_view.focus_on_resident(target)
		await physics_frame
		await process_frame
		var point = scene.world_view.camera.unproject_position(target.global_position + Vector3(0, 0.55, 0))
		var hit = scene.resident_at_screen(point)
		if hit != target:
			push_error("Live ray missed carrier " + target.ant_id)
			scene.free()
			quit(1)
			return
		scene.select_resident(hit)
		await process_frame
		if scene.selected_resident_id != target.ant_id or not target.selection_ring.visible or not scene.inspector_label.text.contains(target.ant_id):
			push_error("Live selection/inspector mismatch for " + target.ant_id)
			scene.free()
			quit(1)
			return
		print("OBSERVER_UI_LIVE PASS colony=", colony, " selected=", target.ant_id, " cargo=", target.carrying_amount)
	scene.free()
	await process_frame
	print("OBSERVER_UI_LIVE ALL PASSED")
	quit(0)
