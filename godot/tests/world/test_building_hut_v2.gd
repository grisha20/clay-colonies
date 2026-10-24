extends SceneTree

const Audit = preload("res://tests/visual/buildings_v2/probe_assets.gd")
var failures := 0

func _initialize() -> void: call_deferred("run")

func check(label: String, condition: bool) -> void:
	print("PASS " if condition else "FAIL ", label)
	if not condition: failures+=1

func inspect(node: Node, transform: Transform3D = Transform3D.IDENTITY) -> Dictionary:
	var result = {"meshes":0,"surfaces":0,"opaque":true,"ellipse":0.0,"fade":true,"shadows":true}
	if node is Node3D: transform *= node.transform
	if node is MeshInstance3D and node.mesh:
		result.meshes+=1
		result.fade = is_equal_approx(node.transparency,.57)
		result.shadows = node.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for i in range(node.mesh.get_surface_count()):
			result.surfaces+=1
			var material = node.get_active_material(i) as StandardMaterial3D
			result.opaque = result.opaque and material!=null and material.transparency==BaseMaterial3D.TRANSPARENCY_DISABLED and not material.emission_enabled and material.albedo_texture.get_size()==Vector2(1024,1024)
			var vertices = node.mesh.surface_get_arrays(i)[Mesh.ARRAY_VERTEX]
			for vertex in vertices:
				var p: Vector3 = transform*vertex
				result.ellipse = maxf(result.ellipse,pow(p.x/4,2)+pow((p.z-.5)/2.3,2))
	for child in node.get_children():
		var c=inspect(child,transform)
		result.meshes+=c.meshes;result.surfaces+=c.surfaces
		result.opaque=result.opaque and c.opaque
		result.fade=result.fade and c.fade
		result.shadows=result.shadows and c.shadows
		result.ellipse=maxf(result.ellipse,c.ellipse)
	return result

func run() -> void:
	var view=WorldView.new()
	var hut=view._make_building("hut",true,false,1)
	var old=load("res://assets/models/hut.glb").instantiate()
	old.scale=WorldView.HUT_SCALE;old.position.z=.5
	var box=Audit.bounds(hut);var before=Audit.bounds(old)
	check("new_hut_selected",hut.find_child("HutV2",true,false)!=null)
	check("ground_bounds_no_larger",box.position.x>=before.position.x and box.end.x<=before.end.x and box.position.z>=before.position.z and box.end.z<=before.end.z)
	check("height_within_20_percent",box.size.y>=before.size.y*.8 and box.size.y<=before.size.y*1.2 and absf(box.position.y)<.001)
	check("triangle_budget",Audit.triangles(hut)<=3000)
	view._set_fade(hut,.57)
	var audit=inspect(hut)
	check("one_mesh_one_surface_opaque_atlas_no_emission",audit.meshes==1 and audit.surfaces==1 and audit.opaque)
	check("entire_mesh_inside_server_footprint",audit.ellipse<=1.0)
	check("construction_fade_recursive",audit.fade)
	check("casts_shadows",audit.shadows)
	check("door_light_preserved",hut.get_node_or_null("DoorLight")!=null and hut.get_node("DoorLight").position.z>0)
	var house=view._make_building("hut",true,false,1,0,2)
	check("clan_house_unchanged_until_stage1",house.find_child("HutV2",true,false)==null and house.get_node_or_null("HouseDecor")!=null)
	root.add_child(hut)
	view._hit_building("sample",hut)
	check("hit_shake_and_dust_preserved",float(hut.get_meta("hit_until",0))>0 and hut.get_node_or_null("HitDust")!=null)
	hut.free();house.free();old.free();view.free()
	await process_frame
	print("HUT_V2_FAILURES=",failures)
	quit(1 if failures>0 else 0)
