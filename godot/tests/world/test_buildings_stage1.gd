extends SceneTree

const Audit=preload("res://tests/visual/buildings_v2/probe_assets.gd")
var failures:=0

func _initialize() -> void:call_deferred("run")

func check(label: String, ok: bool) -> void:
	print("PASS " if ok else "FAIL ",label)
	if not ok:failures+=1

func inspect(node: Node, transform: Transform3D, radius: Vector2, offset: float) -> Dictionary:
	var result={"ellipse":0.0,"opaque":true,"fade":true,"atlas":0}
	if node is Node3D:transform*=node.transform
	if node is MeshInstance3D and node.mesh:
		result.fade=is_equal_approx(node.transparency,.43)
		for i in range(node.mesh.get_surface_count()):
			var m=node.get_active_material(i) as StandardMaterial3D
			result.opaque=result.opaque and m!=null and m.transparency==BaseMaterial3D.TRANSPARENCY_DISABLED and not m.emission_enabled
			if m and m.albedo_texture:
				result.atlas+=1
				result.opaque=result.opaque and m.albedo_texture.get_size()==Vector2(1024,1024)
			for vertex in node.mesh.surface_get_arrays(i)[Mesh.ARRAY_VERTEX]:
				var p: Vector3=transform*vertex
				result.ellipse=maxf(result.ellipse,pow(p.x/radius.x,2)+pow((p.z-offset)/radius.y,2))
	for child in node.get_children():
		var c=inspect(child,transform,radius,offset)
		result.ellipse=maxf(result.ellipse,c.ellipse)
		result.opaque=result.opaque and c.opaque;result.fade=result.fade and c.fade;result.atlas+=c.atlas
	return result

func run() -> void:
	var view=WorldView.new()
	for spec in [["house","hut",2,Vector2(4,2.3),.5,4.852749,Vector3(8.3898,4.852749,5.40676)],
		["storage","storage",1,Vector2(3.4,2.1),.6,2.216812,Vector3(6.865745,2.216812,4.115544)],
		["workshop","workshop",1,Vector2(4.6,2.6),.6,3.365675,Vector3(8.708317,3.365675,4.875999)]]:
		var node=view._make_building(spec[1],true,false,1,0,spec[2])
		var box=Audit.bounds(node)
		check(spec[0]+"_authored_model",node.find_child(str(spec[0]).capitalize()+"V2",true,false)!=null or node.name==str(spec[0]).capitalize()+"V2")
		check(spec[0]+"_triangle_budget",Audit.triangles(node)<=3000)
		check(spec[0]+"_base_no_larger",box.size.x<=spec[6].x and box.size.z<=spec[6].z)
		check(spec[0]+"_height_within_20_percent",box.size.y>=float(spec[5])*.8 and box.size.y<=float(spec[5])*1.2)
		view._set_fade(node,.43)
		var audit=inspect(node,Transform3D.IDENTITY,spec[3],spec[4])
		check(spec[0]+"_inside_server_ellipse",audit.ellipse<=1)
		check(spec[0]+"_opaque_one_atlas",audit.opaque and audit.atlas==1)
		check(spec[0]+"_construction_fade",audit.fade)
		root.add_child(node);view._hit_building(spec[0],node)
		check(spec[0]+"_hit_effect",node.get_node_or_null("HitDust")!=null)
		node.free()
	var a=view._make_building("hut",true,false,1,0,2)
	var b=view._make_building("hut",true,false,1,1,2)
	var ma=(a.find_child("TribeAccent",true,false) as MeshInstance3D).material_override
	var mb=(b.find_child("TribeAccent",true,false) as MeshInstance3D).material_override
	check("house_owner_colours_independent",ma!=mb and ma.albedo_color==WorldView.POST_COLORS[0] and mb.albedo_color==WorldView.POST_COLORS[1])
	a.free();b.free();view.free();await process_frame
	print("STAGE1_FAILURES=",failures);quit(1 if failures>0 else 0)
