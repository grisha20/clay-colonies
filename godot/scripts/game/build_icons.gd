class_name BuildIcons
extends RefCounted

## Pictures for the build toolbar, Stronghold style: each building is rendered
## once from the same models the world uses (PropFactory, hut.glb) in a small
## SubViewport with its own world, under a warm light and an isometric camera.
## Zone tools get a scene plus a drawn sign (green tick, red "no", red cross).

const SIZE := Vector2i(112, 88)
## kind -> [ortho size, look-at height]
const FRAMING = {
	"hut": [6.6, 1.3], "storage": [6.4, 0.8], "workshop": [6.2, 0.9], "idol": [4.2, 1.7],
	"wall": [4.2, 0.7], "gate": [6.2, 1.3], "post": [3.8, 1.5],
	"harvest": [3.0, 0.3], "forbid": [3.8, 0.5], "erase": [3.8, 0.5],
}


## Creates one SubViewport per kind under `host` and returns kind -> Texture2D.
static func create(host: Node, kinds: Array) -> Dictionary:
	var out: Dictionary = {}
	for kind in kinds:
		var vp = SubViewport.new()
		vp.name = "Icon_" + kind
		vp.size = SIZE
		vp.own_world_3d = true
		vp.transparent_bg = true
		vp.msaa_3d = Viewport.MSAA_4X
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		host.add_child(vp)
		_stage(vp, kind)
		out[kind] = vp.get_texture()
	return out


static func _stage(vp: SubViewport, kind: String) -> void:
	var env = WorldEnvironment.new()
	var e = Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(1.0, 0.92, 0.80)
	e.ambient_light_energy = 0.55
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.environment = e
	vp.add_child(env)
	var sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -38, 0)
	sun.light_energy = 1.1
	sun.light_color = Color(1.0, 0.95, 0.86)
	vp.add_child(sun)
	var frame: Array = FRAMING.get(kind, [6.0, 1.0])
	var cam = Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = float(frame[0])
	var target = Vector3(0, float(frame[1]), 0)
	var dir = Vector3(0.62, 0.62, 1.0).normalized()
	cam.position = target + dir * 30.0
	vp.add_child(cam)
	cam.look_at_from_position(cam.position, target, Vector3.UP)
	for node in _props(kind):
		vp.add_child(node)


static func _mesh(mesh: Mesh, pos := Vector3.ZERO, rot := Vector3.ZERO, scale := Vector3.ONE) -> MeshInstance3D:
	var mi = MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation = rot
	mi.scale = scale
	return mi


static func _props(kind: String) -> Array:
	match kind:
		"hut":
			var scene = load("res://assets/models/hut.glb") as PackedScene
			if scene:
				var hut = scene.instantiate() as Node3D
				hut.scale = WorldView.HUT_SCALE
				return [hut]
			return []
		"storage":
			return [_mesh(PropFactory.storage())]
		"workshop":
			return [_mesh(PropFactory.workshop())]
		"idol":
			return [_mesh(PropFactory.idol())]
		"wall":
			var list = []
			for x in [-1.8, 0.0, 1.8]:
				list.append(_mesh(PropFactory.fence_post(), Vector3(x, 0, 0)))
			list.append(_mesh(PropFactory.fence_rails(3.6), Vector3(-1.8, 0, 0)))
			return list
		"gate":
			return [_mesh(PropFactory.gate(float(BuildRules.GATE_SPAN) * BuildRules.WALL_CELL_SIZE, false))]
		"post":
			var pole = _mesh(PropFactory.post_pole())
			pole.add_child(_mesh(PropFactory.post_cloth(WorldView.POST_COLORS[0]), Vector3(0.05, 2.85, 0)))
			return [pole]
		"harvest":
			return [_mesh(PropFactory.clay_lumps(4, 1)), _mesh(PropFactory.tool("mine"), Vector3(0.9, 0.12, 0.5), Vector3(PI / 2, 0.6, 0), Vector3.ONE * 1.6)]
		"forbid":
			return [_mesh(PropFactory.rocks("stone", 3, 2), Vector3(-0.6, 0, 0)), _mesh(PropFactory.bush(0, 1), Vector3(0.9, 0, -0.3))]
		"erase":
			return [_mesh(PropFactory.fence_post(), Vector3(-1.2, 0, 0)), _mesh(PropFactory.fence_rails(2.0), Vector3(-1.2, 0, 0), Vector3(0, 0, -0.25))]
	return []


## Sign drawn over a zone picture: "ok" green tick, "no" red circle with a bar,
## "x" red cross. Empty for buildings.
static func sign_for(kind: String) -> Texture2D:
	match kind:
		"harvest":
			return _sign("ok")
		"forbid":
			return _sign("no")
		"erase":
			return _sign("x")
	return null


static func _sign(shape: String) -> ImageTexture:
	var n = 40
	var img = Image.create(n, n, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c = Vector2(n / 2.0, n / 2.0)
	for y in range(n):
		for x in range(n):
			var p = Vector2(x + 0.5, y + 0.5)
			var d = p.distance_to(c)
			var col = Color(0, 0, 0, 0)
			match shape:
				"ok":
					if d < 17.5:
						col = Color(0.22, 0.55, 0.22, 0.95) if d > 15.0 else Color(0.95, 0.98, 0.9, 0.85)
					if _near_segment(p, Vector2(10, 21), Vector2(17, 28), 3.2) or _near_segment(p, Vector2(17, 28), Vector2(30, 12), 3.2):
						col = Color(0.20, 0.55, 0.20)
				"no":
					var bar = absf((p.x - c.x) + (p.y - c.y)) / sqrt(2.0) < 3.0 and d < 16.0
					if (d < 18.0 and d > 14.0) or bar:
						col = Color(0.80, 0.14, 0.10)
				"x":
					if _near_segment(p, Vector2(9, 9), Vector2(31, 31), 3.4) or _near_segment(p, Vector2(31, 9), Vector2(9, 31), 3.4):
						col = Color(0.80, 0.14, 0.10)
			img.set_pixel(x, y, col)
	return ImageTexture.create_from_image(img)


static func _near_segment(p: Vector2, a: Vector2, b: Vector2, r: float) -> bool:
	var t = clampf((p - a).dot(b - a) / (b - a).length_squared(), 0.0, 1.0)
	return p.distance_to(a.lerp(b, t)) < r
