extends SceneTree

## Imported model contract, independent of the Blender scene or source builder.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(label: String, value: bool) -> void:
	print("RESIDENT_ASSET ", "PASS " if value else "FAIL ", label)
	if not value:
		failures += 1

func run() -> void:
	var r = NetworkResident.new()
	root.add_child(r)
	r.set_process(false)
	check("Resident mesh, skeleton and animation player resolve", r.mesh_instance != null and r.skeleton != null and r.anim_player != null)
	var mesh = r.mesh_instance.mesh
	check("three material surfaces", mesh.get_surface_count() == 3)
	var expected = ["ClayBody", "DarkEyes", "GrassCord"]
	var triangles = 0
	for i in range(mesh.get_surface_count()):
		var mat = mesh.surface_get_material(i)
		check("surface %d is %s" % [i,expected[i]], mat is StandardMaterial3D and mat.resource_name == expected[i])
		var arrays = mesh.surface_get_arrays(i)
		triangles += arrays[Mesh.ARRAY_INDEX].size() / 3
	var budget = 8000 if r.use_resident_v3 else 5000
	check("triangle budget <= %d" % budget, triangles > 0 and triangles <= budget)
	if r.use_resident_v3:
		var current = NetworkResident.new(0)
		check("explicit current model remains available in candidate QA", not current.use_resident_v3 and current.mesh_instance.mesh.surface_get_material(0).albedo_texture == null)
		current.free()
		var shared = NetworkResident.new(1)
		check("instances share mesh and texture resources", shared.mesh_instance.mesh == mesh and shared.mesh_instance.mesh.surface_get_material(0).albedo_texture == mesh.surface_get_material(0).albedo_texture)
		shared.free()
		for i in range(3):
			var mat = mesh.surface_get_material(i) as StandardMaterial3D
			check("v3 textured PBR surface %d" % i, mat.albedo_texture != null and mat.normal_texture != null and mat.metallic == 0.)
			check("v3 texture <= 2K surface %d" % i, mat.albedo_texture.get_width() <= 2048 and mat.albedo_texture.get_height() <= 2048)
	var bounds = mesh.get_aabb()
	check("height 1.70..1.80 and soles at zero", absf(bounds.position.y) < .001 and bounds.end.y > 1.70 and bounds.end.y < 1.80)
	var parents = {"Root":"", "Hips":"Root", "Spine":"Hips", "Head":"Spine", "Socket_Head":"Head", "Socket_Cargo":"Spine", "Socket_Tool_R":"Hand.R"}
	for side in [".L", ".R"]:
		for row in [["UpperArm","Spine"],["LowerArm","UpperArm"+side],["Hand","LowerArm"+side],["UpperLeg","Hips"],["LowerLeg","UpperLeg"+side],["Foot","LowerLeg"+side]]:
			parents[row[0]+side] = row[1]
	check("exactly 19 contract bones", r.skeleton.get_bone_count() == parents.size())
	for name in parents:
		var idx = r.skeleton.find_bone(name)
		var parent = r.skeleton.get_bone_parent(idx) if idx >= 0 else -1
		var actual = r.skeleton.get_bone_name(parent) if parent >= 0 else ""
		check("bone " + name, idx >= 0 and actual == parents[name])
	var head = r.skeleton.find_bone("Socket_Head")
	check("head socket above 1.70m", r.skeleton.get_bone_global_rest(head).origin.y >= 1.70)
	var eye_bounds = mesh.surface_get_arrays(1)[Mesh.ARRAY_VERTEX]
	var front = true
	for vertex in eye_bounds:
		front = front and vertex.z > 0
	check("eyes face Godot +Z", front)
	r.anim_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	for clip in ["idle", "walk", "carry_idle", "carry_walk", "work_gather"]:
		check("clip " + clip, r.anim_player.has_animation(clip))
		if r.anim_player.has_animation(clip):
			var anim = r.anim_player.get_animation(clip)
			check("loop and 1s " + clip, anim.loop_mode == Animation.LOOP_LINEAR and absf(anim.length-1.) < .001)
	var hand = r.skeleton.find_bone("Socket_Tool_R")
	r.anim_player.play("work_gather")
	r.anim_player.seek(0.,true)
	r.anim_player.advance(0.)
	var a = r.skeleton.get_bone_global_pose(hand).origin
	r.anim_player.seek(.5,true)
	r.anim_player.advance(0.)
	var b = r.skeleton.get_bone_global_pose(hand).origin
	check("right hand strike moves > 0.4m", a.distance_to(b) > .4)
	print("RESIDENT_ASSET triangles=",triangles," height=",bounds.end.y," hand_travel=",a.distance_to(b)," failures=",failures)
	r.free()
	await process_frame
	quit(1 if failures else 0)
