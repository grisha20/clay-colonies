extends SceneTree

const Audit=preload("res://tests/visual/buildings_v2/probe_assets.gd")
const Materials=preload("res://tests/world/test_buildings_stage1.gd")
var failures=0
func _initialize() -> void:call_deferred("run")
func check(label: String,ok: bool) -> void:
	print("PASS " if ok else "FAIL ",label)
	if not ok:failures+=1

func run() -> void:
	var view=WorldView.new();root.add_child(view);await process_frame
	for spec in [["idol",Vector2(1.8,1),3.676586,Vector2(3.5134,2.33111)],["totem",Vector2(1.1,.8),4.407253,Vector2(2.360142,2.073949)]]:
		var node=view._make_building(spec[0],true,false,1)
		root.add_child(node)
		check(spec[0]+"_authored_model",node.name==str(spec[0]).capitalize()+"V2")
		var box=Audit.bounds(node)
		check(spec[0]+"_base_no_larger",box.size.x<=spec[3].x and box.size.z<=spec[3].y)
		check(spec[0]+"_height_within_20_percent",box.size.y>=spec[2]*.8 and box.size.y<=spec[2]*1.2)
		check(spec[0]+"_triangle_budget",Audit.triangles(node)<=3000)
		view._set_fade(node,.43)
		var audit=Materials.inspect(node,Transform3D.IDENTITY,spec[1],0)
		check(spec[0]+"_opaque_atlas_inside_ellipse",audit.opaque and audit.atlas==1 and audit.ellipse<=1)
		check(spec[0]+"_construction_fade",audit.fade)
		view._hit_building(spec[0],node)
		check(spec[0]+"_hit_dust",node.get_node_or_null("HitDust")!=null)
		if spec[0]=="totem":
			view._update_totem_siege(node,{"hp":150,"maxHp":150})
			view._update_totem_siege(node,{"hp":75,"maxHp":150})
			check("totem_damage_lean_and_dust",node.rotation.z>.1 and node.get_node_or_null("SiegeDust")!=null)
		node.free()
	var a=view._make_building("totem",true,false,1,0)
	var b=view._make_building("totem",true,false,1,1)
	var ma=(a.get_node("TribeAccent") as MeshInstance3D).material_override
	var mb=(b.get_node("TribeAccent") as MeshInstance3D).material_override
	check("totem_independent_tribe_colours",ma!=mb and ma.albedo_color==WorldView.POST_COLORS[0] and mb.albedo_color==WorldView.POST_COLORS[1])
	a.free();b.free();view.free();await process_frame
	print("STAGE3_FAILURES=",failures);quit(1 if failures else 0)
