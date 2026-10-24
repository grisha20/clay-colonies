extends SceneTree

const Audit=preload("res://tests/visual/buildings_v2/probe_assets.gd")
var failures=0
func _initialize() -> void:call_deferred("run")
func check(label: String,ok: bool) -> void:
	print("PASS " if ok else "FAIL ",label)
	if not ok:failures+=1

func inspect(mesh: MeshInstance3D,rx: float,rz: float,offset: float) -> bool:
	if mesh.mesh.get_surface_count()!=1:return false
	var mat=mesh.get_active_material(0) as StandardMaterial3D
	if not mat or mat.emission_enabled or mat.transparency!=BaseMaterial3D.TRANSPARENCY_DISABLED:return false
	if not mat.albedo_texture or mat.albedo_texture.get_size()!=Vector2(1024,1024):return false
	for point in mesh.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]:
		if pow(point.x/rx,2)+pow((point.z-offset)/rz,2)>1.001:return false
	return true

func run() -> void:
	var view=WorldView.new();root.add_child(view);await process_frame
	var kiln=view._make_building("kiln",true,false,1) as MeshInstance3D
	check("kiln_authored_model",kiln.name=="KilnV2")
	var box=kiln.mesh.get_aabb()
	check("kiln_dimensions",box.size.x<=5.309949 and box.size.z<=4.028 and box.size.y>=3.090272*.8 and box.size.y<=3.090272*1.2)
	check("kiln_body_opaque_atlas_inside_ellipse",inspect(kiln,2.4,1.7,.3))
	check("kiln_total_budget_including_existing_fire",Audit.triangles(kiln)<=3000)
	check("kiln_fire_children_preserved",kiln.get_node_or_null("Glow")!=null and kiln.get_node_or_null("KilnLight")!=null)
	check("kiln_cold_initially",not kiln.get_node("Glow").visible and not kiln.get_node("KilnLight").visible)
	var ghost=view._make_building("kiln",false,false,1) as MeshInstance3D
	view._set_fade(ghost,.43)
	check("kiln_construction_no_fire",ghost.get_node_or_null("Glow")==null and is_equal_approx(ghost.transparency,.43))
	root.add_child(kiln);view._hit_building("kiln-review",kiln)
	check("kiln_hit_dust",kiln.get_node_or_null("HitDust")!=null)
	view._update_campfires([{"x":100,"y":100}])
	var fire=view.active_campfires[0] as Node3D
	var body=fire.get_node_or_null("CampfireV2") as MeshInstance3D
	check("campfire_authored_model",body!=null)
	if body:
		box=body.mesh.get_aabb()
		check("campfire_dimensions",box.size.x<=1.287933 and box.size.z<=1.2842 and box.size.y>=.46*.8 and box.size.y<=.46*1.2)
		check("campfire_body_opaque_atlas_inside_old_base",inspect(body,.65,.65,0))
		check("campfire_static_budget",Audit.triangles(body)<=3000)
	check("campfire_existing_attachments",fire.get_node_or_null("Seats")!=null and fire.get_node_or_null("Flame")!=null and fire.get_node_or_null("FireLight")!=null)
	view.colony_fire[0]=0;view._animate_world(.1)
	check("campfire_extinguished",not fire.get_node("Flame").visible and not fire.get_node("FireLight").visible)
	view.colony_fire[0]=1;view._animate_world(.1)
	check("campfire_relit",fire.get_node("Flame").visible and fire.get_node("FireLight").visible)
	kiln.free();ghost.free();view.free();await process_frame
	print("STAGE2_FAILURES=",failures);quit(1 if failures else 0)
