extends SceneTree

## Read-only asset dimensions, in actual game space including node transforms.
func _initialize() -> void:
	call_deferred("run")

static func bounds(node: Node, parent: Transform3D = Transform3D.IDENTITY) -> AABB:
	var transform = parent * node.transform if node is Node3D else parent
	var box = AABB()
	if node is MeshInstance3D and node.mesh:
		box = transform * node.mesh.get_aabb()
	for child in node.get_children():
		var other = bounds(child, transform)
		if other.size != Vector3.ZERO:
			box = other if box.size == Vector3.ZERO else box.merge(other)
	return box

static func triangles(node: Node) -> int:
	var count = 0
	if node is MeshInstance3D and node.mesh:
		for i in range(node.mesh.get_surface_count()):
			var arrays = node.mesh.surface_get_arrays(i)
			count += arrays[Mesh.ARRAY_INDEX].size() / 3 if arrays[Mesh.ARRAY_INDEX] != null and arrays[Mesh.ARRAY_INDEX].size() > 0 else arrays[Mesh.ARRAY_VERTEX].size() / 3
	for child in node.get_children(): count += triangles(child)
	return count

func run() -> void:
	var view = WorldView.new()
	for type in ["hut", "storage", "workshop", "kiln", "idol", "totem"]:
		var node = view._make_building(type, true, false, 1)
		var box = bounds(node)
		print("ASSET ", type, " min=", box.position, " size=", box.size, " triangles=", triangles(node))
		node.free()
	var house=view._make_building("hut",true,false,1,0,2)
	print("ASSET house min=",bounds(house).position," size=",bounds(house).size," triangles=",triangles(house))
	house.free()
	var old = load("res://assets/models/hut.glb").instantiate()
	old.scale = WorldView.HUT_SCALE
	old.position.z = 0.5
	print("LEGACY_HUT ", bounds(old), " triangles=", triangles(old))
	old.free()
	view.free()
	quit()
