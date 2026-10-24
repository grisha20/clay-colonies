extends SceneTree

var failures:=0
func _initialize() -> void:call_deferred("run")
func check(ok: bool, message: String) -> void:
	print("PASS " if ok else "FAIL ",message)
	if not ok:failures+=1

func run() -> void:
	var actor=NetworkResident.new()
	root.add_child(actor)
	var card=ResidentCard.new()
	root.add_child(card)
	var data={"id":"portrait-test","colonyId":"colony-2","pos":{"x":100,"y":100},"heading":{"x":0,"y":1},"state":"idle","job":"guard","carrying":4,"carryKind":"wood","energy":450,"waterExposure":48}
	actor.update_from_ant_data(data,.1,1)
	card.update_resident(actor,{"ants":[data]},"Храбрый Жёлудь",false)
	check(is_equal_approx(card.energy_bar.value,50),"energy uses 900-point server scale")
	check(card.wet_box.visible and is_equal_approx(card.wet_bar.value,40),"wetness uses real waterExposure ticks")
	check(card.cargo_row.visible and card.cargo_label.text.contains("4"),"displayed actor cargo amount")
	check(card.activity_label.text.contains("дерево"),"cargo occupation is readable")
	check(card.portrait_model!=null and card.portrait_mesh!=null,"live resident_v3 portrait loaded")
	check(card.portrait_mesh.get_active_material(0)==actor.mesh_instance.get_active_material(0),"portrait uses selected tribe material")
	actor.fired=true;actor._apply_colony_color();actor.carrying_amount=0
	data.erase("waterExposure");data["waterDamage"]=.25
	card.update_resident(actor,{"ants":[data]},"Храбрый Жёлудь",true)
	check(card.clay_label.text=="Обожжён" and card.clay_label.tooltip_text.contains("дождь не страшен"),"fired clay information")
	check(card.portrait_mesh.get_active_material(0)==actor.mesh_instance.get_active_material(0),"portrait updates fired material")
	check(is_equal_approx(card.wet_bar.value,25),"waterDamage compatibility")
	check(not card.cargo_row.visible and card.activity_label.text.contains("страже"),"empty cargo hidden, guard occupation shown")
	actor.kiln_called=true
	card.update_resident(actor,{"ants":[{"id":actor.ant_id}]},"Жёлудь",false)
	check(card.clay_label.text=="Идёт на обжиг","kiln summons status")
	check(not card.wet_box.visible and card.energy_label.text.contains("нет данных"),"missing data is not invented")
	card.hide()
	check(card.portrait_viewport.render_target_update_mode==SubViewport.UPDATE_DISABLED,"hidden portrait stops rendering")
	card.free();actor.free();await process_frame
	print("RESIDENT_CARD_FAILURES=",failures)
	quit(1 if failures else 0)
