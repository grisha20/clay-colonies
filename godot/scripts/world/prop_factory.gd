class_name PropFactory
extends RefCounted

## Procedural hand-sculpted clay props for the observed surface world.
## Every prop is merged into one ArrayMesh per material (vertex colours carry the
## palette) and cached by a key, so a hundred trees share a handful of meshes.
## Shapes are deliberately chunky and lumpy: a toy world of clay, sticks and pebbles.

const MAT_MATTE := 0
const MAT_GLOSS := 1
const MAT_FLAME := 2

const TRUNK := Color(0.45, 0.30, 0.18)
const TRUNK_DARK := Color(0.34, 0.22, 0.13)
const LEAF := [Color(0.30, 0.53, 0.20), Color(0.37, 0.60, 0.23), Color(0.25, 0.46, 0.21)]
const LEAF_DRY := Color(0.62, 0.57, 0.27)
const SAPLING_LEAF := Color(0.52, 0.74, 0.30)
const BUSH := Color(0.22, 0.45, 0.19)
const BERRY := Color(0.86, 0.15, 0.11)
const STONE := Color(0.63, 0.62, 0.58)
const STONE_DARK := Color(0.49, 0.48, 0.45)
const CLAY := Color(0.73, 0.38, 0.23)
const CLAY_LIGHT := Color(0.82, 0.49, 0.31)
const EARTH := Color(0.55, 0.36, 0.22)
const WOOD := Color(0.56, 0.39, 0.22)
const WOOD_LIGHT := Color(0.70, 0.52, 0.31)
const THATCH := Color(0.82, 0.67, 0.38)
const MEAT := Color(0.72, 0.27, 0.24)
const BONE := Color(0.93, 0.89, 0.79)

static var _cache: Dictionary = {}
static var _materials: Dictionary = {}


class Part:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var i := PackedInt32Array()


class Builder:
	var parts: Dictionary = {}

	## Appends a primitive. `lump` displaces vertices along their normal by a
	## deterministic noise so surfaces look pressed by hand instead of machined.
	func add(mesh: PrimitiveMesh, xf: Transform3D, color: Color, mat: int = MAT_MATTE, lump: float = 0.0, seed: float = 0.0) -> void:
		var arr = mesh.get_mesh_arrays()
		var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var norms: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
		if not parts.has(mat):
			parts[mat] = Part.new()
		var p: Part = parts[mat]
		var base = p.v.size()
		var nb = xf.basis.inverse().transposed()
		for k in range(verts.size()):
			var vtx = verts[k]
			var nrm = norms[k]
			var h = PropFactory.hash3(vtx * 2.7 + Vector3(seed, seed * 1.31, seed * 0.57))
			if lump > 0.0:
				vtx += nrm * lump * (h - 0.5)
			p.v.append(xf * vtx)
			p.n.append((nb * nrm).normalized())
			var shade = 0.93 + 0.12 * h
			p.c.append(Color(color.r * shade, color.g * shade, color.b * shade, color.a))
		for k in idx:
			p.i.append(base + k)

	func commit() -> ArrayMesh:
		var mesh = ArrayMesh.new()
		for mat in parts.keys():
			var p: Part = parts[mat]
			if p.v.is_empty():
				continue
			var arrays = []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = p.v
			arrays[Mesh.ARRAY_NORMAL] = p.n
			arrays[Mesh.ARRAY_COLOR] = p.c
			arrays[Mesh.ARRAY_INDEX] = p.i
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			mesh.surface_set_material(mesh.get_surface_count() - 1, PropFactory.material(mat))
		return mesh


static func hash3(v: Vector3) -> float:
	var s = sin(v.dot(Vector3(12.9898, 78.233, 37.719))) * 43758.5453
	return s - floor(s)


static func hash_id(id: String) -> int:
	return absi(id.hash())


static func material(kind: int) -> Material:
	if _materials.has(kind):
		return _materials[kind]
	var m: Material
	if kind == MAT_FLAME:
		var shader = Shader.new()
		shader.code = """shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled;
void fragment() {
	ALBEDO = pow(COLOR.rgb, vec3(2.2)) * 2.4;
}
"""
		var sm = ShaderMaterial.new()
		sm.shader = shader
		m = sm
	else:
		var sm3 = StandardMaterial3D.new()
		sm3.vertex_color_use_as_albedo = true
		sm3.vertex_color_is_srgb = true
		sm3.roughness = 0.86 if kind == MAT_MATTE else 0.38
		sm3.metallic_specular = 0.35 if kind == MAT_MATTE else 0.55
		var normal_tex = load("res://assets/textures/clay_normal.png") as Texture2D
		if normal_tex and kind == MAT_MATTE:
			sm3.normal_enabled = true
			sm3.normal_texture = normal_tex
			sm3.normal_scale = 0.45
			sm3.uv1_triplanar = true
			sm3.uv1_world_triplanar = true
			sm3.uv1_scale = Vector3(0.9, 0.9, 0.9)
		m = sm3
	_materials[kind] = m
	return m


static func _cached(key: String, build: Callable) -> ArrayMesh:
	if not _cache.has(key):
		_cache[key] = build.call()
	return _cache[key]


static func sphere(r: float, h: float = -1.0, segs: int = 12, rings: int = 7) -> SphereMesh:
	var s = SphereMesh.new()
	s.radius = r
	s.height = r * 2.0 if h < 0.0 else h
	s.radial_segments = segs
	s.rings = rings
	return s


static func cyl(top: float, bottom: float, h: float, segs: int = 8) -> CylinderMesh:
	var c = CylinderMesh.new()
	c.top_radius = top
	c.bottom_radius = bottom
	c.height = h
	c.radial_segments = segs
	c.rings = 1
	return c


static func box(size: Vector3) -> BoxMesh:
	var b = BoxMesh.new()
	b.size = size
	return b


static func xf(pos: Vector3, scale: Vector3 = Vector3.ONE, rot: Vector3 = Vector3.ZERO) -> Transform3D:
	var basis = Basis.from_euler(rot).scaled(scale)
	return Transform3D(basis, pos)


## A log/stick from a to b.
static func _stick(b: Builder, a: Vector3, c: Vector3, r: float, color: Color, seed: float = 0.0) -> void:
	var d = c - a
	var length = d.length()
	if length < 0.001:
		return
	var up = d / length
	var side = up.cross(Vector3.FORWARD) if absf(up.dot(Vector3.FORWARD)) < 0.95 else up.cross(Vector3.RIGHT)
	side = side.normalized()
	var fwd = side.cross(up).normalized()
	var basis = Basis(side, up, fwd)
	b.add(cyl(r * 0.85, r, length, 7), Transform3D(basis, (a + c) * 0.5), color, MAT_MATTE, r * 0.25, seed)


# ---------------------------------------------------------------------------
# Nature

static func tree(growth: String, ratio_bucket: int, variant: int) -> ArrayMesh:
	var key = "tree:%s:%d:%d" % [growth, ratio_bucket, variant]
	return _cached(key, func(): return _build_tree(growth, ratio_bucket, variant))


static func _build_tree(growth: String, ratio_bucket: int, variant: int) -> ArrayMesh:
	var b = Builder.new()
	var ratio = clampf(float(ratio_bucket) / 4.0, 0.25, 1.0)
	if growth == "sapling":
		b.add(cyl(0.04, 0.06, 0.7, 6), xf(Vector3(0, 0.35, 0)), TRUNK)
		b.add(sphere(0.26), xf(Vector3(0.05, 0.78, 0), Vector3(1, 0.8, 1)), SAPLING_LEAF, MAT_MATTE, 0.08, variant)
		b.add(sphere(0.18), xf(Vector3(-0.15, 0.6, 0.06), Vector3(1, 0.8, 1)), SAPLING_LEAF, MAT_MATTE, 0.06, variant + 3)
		return b.commit()
	var s = 0.62 if growth == "young" else 1.0
	var trunk_h = 1.9 * s
	b.add(cyl(0.16 * s, 0.27 * s, trunk_h, 8), xf(Vector3(0, trunk_h * 0.5, 0)), TRUNK, MAT_MATTE, 0.05, variant)
	b.add(cyl(0.2 * s, 0.42 * s, 0.35 * s, 8), xf(Vector3(0, 0.17 * s, 0)), TRUNK_DARK, MAT_MATTE, 0.06, variant + 1)
	# Crown layouts: round, tall, wide.
	var blobs: Array = []
	match variant % 3:
		0:
			blobs = [[Vector3(0, 2.75, 0), 1.25], [Vector3(0.85, 2.35, 0.3), 0.85], [Vector3(-0.8, 2.4, -0.25), 0.9], [Vector3(0.1, 2.3, -0.85), 0.8], [Vector3(-0.2, 2.25, 0.9), 0.8], [Vector3(0.2, 3.5, 0.1), 0.75]]
		1:
			blobs = [[Vector3(0, 2.4, 0), 1.05], [Vector3(0, 3.25, 0.05), 0.9], [Vector3(0.05, 3.95, 0), 0.6], [Vector3(0.6, 2.6, 0.4), 0.7], [Vector3(-0.6, 2.8, -0.3), 0.7]]
		_:
			blobs = [[Vector3(0, 2.6, 0), 1.1], [Vector3(1.15, 2.35, 0.2), 0.85], [Vector3(-1.15, 2.4, -0.1), 0.85], [Vector3(0.3, 2.45, 1.0), 0.8], [Vector3(-0.3, 2.5, -1.0), 0.8], [Vector3(0.5, 3.2, -0.2), 0.7]]
	var keep = maxi(2, int(ceil(blobs.size() * (0.35 + 0.65 * ratio))))
	var leaf: Color = LEAF[variant % LEAF.size()]
	if ratio < 0.45:
		leaf = leaf.lerp(LEAF_DRY, 0.55)
	for k in range(keep):
		var blob = blobs[k]
		var tint = leaf.lerp(LEAF[(k + variant) % LEAF.size()], 0.35)
		if k == 0:
			tint = tint.darkened(0.06)
		b.add(sphere(blob[1], blob[1] * 1.7), xf(blob[0] * s, Vector3.ONE * s), tint, MAT_MATTE, blob[1] * 0.22, variant * 7.0 + k)
	# A couple of branches peeking out of a thinning crown.
	if ratio < 0.7:
		_stick(b, Vector3(0, 1.6, 0) * s, Vector3(0.9, 2.6, 0.3) * s, 0.07 * s, TRUNK, variant)
		_stick(b, Vector3(0, 1.8, 0) * s, Vector3(-0.8, 2.9, -0.4) * s, 0.06 * s, TRUNK, variant + 2)
	return b.commit()


static func bush(berries: int, variant: int) -> ArrayMesh:
	var key = "bush:%d:%d" % [berries, variant]
	return _cached(key, func(): return _build_bush(berries, variant))


static func _build_bush(berries: int, variant: int) -> ArrayMesh:
	var b = Builder.new()
	var leaf = BUSH if berries > 0 else BUSH.lerp(LEAF_DRY, 0.25)
	var blobs = [[Vector3(0, 0.6, 0), 0.66], [Vector3(0.55, 0.45, 0.15), 0.5], [Vector3(-0.52, 0.47, -0.1), 0.52], [Vector3(0.05, 0.45, 0.52), 0.48], [Vector3(-0.1, 0.48, -0.5), 0.48]]
	for k in range(blobs.size()):
		var blob = blobs[k]
		var tint = leaf.lerp(LEAF[(k + variant) % LEAF.size()], 0.3)
		b.add(sphere(blob[1], blob[1] * 1.6), xf(blob[0]), tint, MAT_MATTE, 0.12, variant * 5.0 + k)
	# Berries sit on the outside of the foliage so they read from the camera.
	var dirs = [Vector3(0.1, 1.0, 0.3), Vector3(0.75, 0.55, 0.55), Vector3(-0.7, 0.6, 0.45), Vector3(0.85, 0.5, -0.25), Vector3(-0.8, 0.55, -0.35), Vector3(0.3, 0.8, -0.65), Vector3(-0.35, 0.95, -0.15), Vector3(0.45, 0.45, 0.85)]
	for k in range(mini(berries, dirs.size())):
		var d: Vector3 = dirs[(k + variant) % dirs.size()].normalized()
		var pos = Vector3(0, 0.42, 0) + d * Vector3(0.95, 0.72, 0.95)
		b.add(sphere(0.15, -1.0, 8, 5), xf(pos), BERRY, MAT_GLOSS)
		b.add(sphere(0.1, -1.0, 6, 4), xf(pos + Vector3(0.12, -0.08, 0.06)), BERRY.darkened(0.08), MAT_GLOSS)
		b.add(sphere(0.04, -1.0, 4, 3), xf(pos + Vector3(0, 0.14, 0)), LEAF[0].darkened(0.2), MAT_MATTE)
	return b.commit()


static func rocks(kind: String, chunks: int, variant: int) -> ArrayMesh:
	var key = "rocks:%s:%d:%d" % [kind, chunks, variant]
	return _cached(key, func(): return _build_rocks(kind, chunks, variant))


static func _build_rocks(kind: String, chunks: int, variant: int) -> ArrayMesh:
	var b = Builder.new()
	var loose = kind == "loose-stone"
	for k in range(chunks):
		var ang = float(k + variant) * 2.39996
		var dist = 0.0 if k == 0 else (0.35 if loose else 0.75) + 0.12 * k
		var r = (0.22 if loose else (0.62 if k == 0 else 0.42)) * (1.0 - 0.06 * k)
		var pos = Vector3(cos(ang) * dist, r * 0.55, sin(ang) * dist)
		var tint = STONE if (k + variant) % 2 == 0 else STONE_DARK
		b.add(sphere(r, r * 1.5, 9, 5), xf(pos, Vector3(1.0, 0.85, 0.9), Vector3(0, ang, 0.15)), tint, MAT_MATTE, r * 0.45, variant * 3.0 + k)
	if not loose and chunks >= 3:
		b.add(sphere(0.12, -1.0, 6, 4), xf(Vector3(0.9, 0.06, -0.5)), STONE_DARK, MAT_MATTE, 0.04)
	return b.commit()


static func clay_lumps(chunks: int, variant: int, wash: bool = false) -> ArrayMesh:
	var key = "clay:%d:%d:%s" % [chunks, variant, wash]
	return _cached(key, func(): return _build_clay(chunks, variant, wash))


static func _build_clay(chunks: int, variant: int, wash: bool) -> ArrayMesh:
	var b = Builder.new()
	if wash:
		b.add(sphere(0.7, 0.12, 10, 3), xf(Vector3(0, 0.03, 0), Vector3(1.0, 1.0, 0.7)), CLAY.darkened(0.08), MAT_GLOSS, 0.1)
		return b.commit()
	b.add(sphere(0.85, 0.5, 10, 4), xf(Vector3(0, 0.05, 0), Vector3(1.0, 1.0, 0.8)), EARTH, MAT_MATTE, 0.15, variant)
	for k in range(chunks):
		var ang = float(k + variant) * 2.39996
		var dist = 0.0 if k == 0 else 0.4 + 0.08 * k
		var r = 0.38 if k == 0 else 0.26
		var tint = CLAY if k % 2 == 0 else CLAY_LIGHT
		b.add(sphere(r, r * 1.3, 9, 5), xf(Vector3(cos(ang) * dist, 0.2 + r * 0.4, sin(ang) * dist)), tint, MAT_GLOSS, r * 0.35, variant + k)
	return b.commit()


static func sticks(count: int, variant: int) -> ArrayMesh:
	var key = "sticks:%d:%d" % [count, variant]
	return _cached(key, func():
		var b = Builder.new()
		for k in range(count):
			var ang = float(k * 2 + variant) * 1.1
			var dir = Vector3(cos(ang), 0, sin(ang))
			var off = Vector3(-dir.z, 0, dir.x) * (0.18 * (k - 1))
			var y = 0.07 + 0.09 * k
			_stick(b, off - dir * 0.6 + Vector3(0, y, 0), off + dir * 0.6 + Vector3(0, y + 0.03, 0), 0.07, WOOD if k % 2 == 0 else WOOD_LIGHT, k)
			_stick(b, off + dir * 0.25 + Vector3(0, y, 0), off + dir * 0.45 + Vector3(-dir.z * 0.3, y + 0.05, dir.x * 0.3), 0.035, WOOD_LIGHT, k + 5)
		return b.commit())


static func meat(chunks: int, variant: int) -> ArrayMesh:
	var key = "meat:%d:%d" % [chunks, variant]
	return _cached(key, func():
		var b = Builder.new()
		for k in range(chunks):
			var ang = float(k + variant) * 2.39996
			var dist = 0.0 if k == 0 else 0.35 + 0.06 * k
			var pos = Vector3(cos(ang) * dist, 0.14, sin(ang) * dist)
			b.add(sphere(0.2, 0.28, 8, 5), xf(pos, Vector3(1.2, 1, 0.9), Vector3(0, ang, 0)), MEAT, MAT_GLOSS, 0.06, k)
			if k % 2 == 0:
				_stick(b, pos + Vector3(-0.22, 0.05, 0), pos + Vector3(0.28, 0.08, 0.05), 0.04, BONE, k)
		return b.commit())


## An open quarry: rim of heaped earth around the dug floor (the floor itself is
## painted by the ground shader) plus remaining material shrinking with `fill`.
static func deposit(kind: String, fill: int, rx: float, ry: float) -> ArrayMesh:
	var key = "deposit:%s:%d:%.1f:%.1f" % [kind, fill, rx, ry]
	return _cached(key, func(): return _build_deposit(kind, fill, rx, ry))


static func _build_deposit(kind: String, fill: int, rx: float, ry: float) -> ArrayMesh:
	var b = Builder.new()
	var stone = kind == "stone"
	var rim_color = STONE_DARK.lerp(EARTH, 0.4) if stone else EARTH
	var rim_count = 34
	for k in range(rim_count):
		var a = TAU * float(k) / float(rim_count)
		var wob = 1.0 + 0.05 * sin(a * 3.0 + 1.3) + 0.04 * (hash3(Vector3(k, 1, 1)) - 0.5)
		var pos = Vector3(cos(a) * rx * wob, 0.0, sin(a) * ry * wob)
		var r = 0.55 + 0.35 * hash3(Vector3(k, 3, 7))
		var tint = rim_color.darkened(0.12 * hash3(Vector3(k, 8, 2)))
		b.add(sphere(r, r * 1.1, 10, 5), xf(pos, Vector3(1.5, 1, 1.0), Vector3(0, -a, 0)), tint, MAT_MATTE, r * 0.4, k)
		if k % 3 == 0:
			var outer = Vector3(cos(a) * (rx + 0.9), 0.0, sin(a) * (ry + 0.9))
			b.add(sphere(r * 0.6, r * 0.6, 8, 4), xf(outer), tint.lightened(0.05), MAT_MATTE, r * 0.25, k + 100)
	var amount = clampi(fill, 0, 4)
	if stone:
		# Exposed rock face along the back (north) edge.
		for k in range(3 + amount * 2):
			var t = (float(k) / float(2 + amount * 2)) - 0.5
			var h = (0.7 + 0.25 * amount) * (0.8 + 0.4 * hash3(Vector3(k, 1, 9)))
			var pos = Vector3(t * rx * 1.4, h * 0.45, -ry * 0.62 + 0.4 * hash3(Vector3(k, 5, 2)))
			b.add(box(Vector3(1.6, h, 1.3)), xf(pos, Vector3.ONE, Vector3(0, 0.4 * (k % 3) - 0.3, 0.08)), STONE if k % 2 == 0 else STONE_DARK, MAT_MATTE, 0.3, k)
		for k in range(amount * 2):
			var ang = float(k) * 2.39996
			var pos = Vector3(cos(ang) * rx * 0.45, 0.25, sin(ang) * ry * 0.3 + 0.8)
			b.add(box(Vector3(0.6, 0.45, 0.5)), xf(pos, Vector3.ONE, Vector3(0, ang, 0)), STONE, MAT_MATTE, 0.12, k + 20)
	else:
		for k in range(amount * 3):
			var ang = float(k) * 2.39996
			var dist = 0.35 + 0.1 * float(k % 4)
			var pos = Vector3(cos(ang) * rx * dist, 0.25, sin(ang) * ry * dist * 0.8 - 0.6)
			var r = 0.45 + 0.15 * hash3(Vector3(k, 2, 4))
			b.add(sphere(r, r * 1.1, 9, 5), xf(pos), CLAY if k % 2 == 0 else CLAY_LIGHT, MAT_GLOSS, r * 0.35, k)
		# Puddle-wet clay wall at the back.
		for k in range(4 + amount):
			var t = (float(k) / float(3 + amount)) - 0.5
			var pos = Vector3(t * rx * 1.3, 0.3, -ry * 0.66)
			b.add(sphere(1.0, 1.1, 9, 4), xf(pos, Vector3(1.3, 1, 0.8)), CLAY.darkened(0.12), MAT_GLOSS, 0.25, k + 40)
	return b.commit()


# ---------------------------------------------------------------------------
# Water life and creatures (all face +Z)

static func fish(species: String) -> ArrayMesh:
	var key = "fish:" + species
	return _cached(key, func():
		var col = Color(0.95, 0.62, 0.16)
		match species:
			"blue": col = Color(0.27, 0.48, 0.86)
			"silver": col = Color(0.80, 0.82, 0.84)
			"red": col = Color(0.88, 0.27, 0.21)
		var b = Builder.new()
		b.add(sphere(0.16, 0.22, 10, 5), xf(Vector3(0, 0, 0), Vector3(1, 1, 2.2)), col, MAT_GLOSS)
		b.add(cyl(0.0, 0.16, 0.3, 4), xf(Vector3(0, 0, -0.42), Vector3(1, 0.3, 1), Vector3(-PI * 0.5, 0, 0)), col.darkened(0.15), MAT_GLOSS)
		return b.commit())


static func spider(dead: bool = false) -> ArrayMesh:
	var key = "spider:%s" % dead
	return _cached(key, func():
		var b = Builder.new()
		var body = Color(0.24, 0.17, 0.13) if not dead else Color(0.42, 0.36, 0.32)
		var mark = Color(0.85, 0.48, 0.14) if not dead else Color(0.55, 0.47, 0.40)
		b.add(sphere(0.75, 1.2, 12, 7), xf(Vector3(0, 0.75, -0.75), Vector3(1, 1, 1.15)), body, MAT_GLOSS, 0.08)
		b.add(sphere(0.18, 0.12, 8, 4), xf(Vector3(0, 1.3, -0.65)), mark, MAT_GLOSS)
		b.add(sphere(0.45, 0.7, 10, 6), xf(Vector3(0, 0.6, 0.35)), body.lightened(0.05), MAT_GLOSS, 0.05)
		b.add(sphere(0.28, 0.45, 9, 5), xf(Vector3(0, 0.6, 0.85)), body, MAT_GLOSS)
		if not dead:
			for side in [-1.0, 1.0]:
				b.add(sphere(0.07, -1.0, 6, 4), xf(Vector3(0.11 * side, 0.74, 1.08)), Color(0.95, 0.2, 0.1), MAT_GLOSS)
				b.add(sphere(0.05, -1.0, 6, 4), xf(Vector3(0.22 * side, 0.7, 1.02)), Color(0.95, 0.2, 0.1), MAT_GLOSS)
		for side in [-1.0, 1.0]:
			for k in range(4):
				var z = 0.62 - 0.32 * k
				var spread = 0.9 + 0.15 * absf(1.5 - k)
				var knee = Vector3(side * spread, 1.05 if not dead else 0.55, z + (0.35 - 0.2 * k))
				var foot = Vector3(side * (spread + 0.75), 0.03, z + (0.6 - 0.4 * k))
				_stick(b, Vector3(side * 0.3, 0.62, z * 0.6 + 0.3), knee, 0.07, body.darkened(0.1), k)
				_stick(b, knee, foot, 0.05, body.darkened(0.1), k + 4)
		return b.commit())


static func beetle() -> ArrayMesh:
	return _cached("beetle", func():
		var b = Builder.new()
		var shell = Color(0.16, 0.34, 0.33)
		b.add(sphere(0.62, 0.75, 12, 6), xf(Vector3(0, 0.42, -0.1), Vector3(1, 1, 1.3)), shell, MAT_GLOSS, 0.03)
		b.add(box(Vector3(0.04, 0.05, 1.4)), xf(Vector3(0, 0.79, -0.1)), shell.darkened(0.35), MAT_GLOSS)
		b.add(sphere(0.3, 0.4, 9, 5), xf(Vector3(0, 0.35, 0.78)), Color(0.12, 0.12, 0.12), MAT_GLOSS)
		_stick(b, Vector3(0, 0.45, 0.95), Vector3(0, 0.75, 1.3), 0.05, Color(0.2, 0.18, 0.15))
		for side in [-1.0, 1.0]:
			for k in range(3):
				var z = 0.45 - 0.45 * k
				_stick(b, Vector3(side * 0.45, 0.3, z), Vector3(side * 0.95, 0.03, z + 0.1), 0.05, Color(0.1, 0.1, 0.1), k)
		return b.commit())


static func lake_monster() -> ArrayMesh:
	return _cached("lake_monster", func():
		var b = Builder.new()
		var skin = Color(0.27, 0.50, 0.42)
		b.add(sphere(1.1, 1.4, 12, 7), xf(Vector3(0, 0.5, -0.4), Vector3(1.1, 1, 1.5)), skin, MAT_GLOSS, 0.12)
		b.add(sphere(0.7, 1.0, 12, 6), xf(Vector3(0, 0.9, 1.15)), skin.lightened(0.05), MAT_GLOSS, 0.08)
		for side in [-1.0, 1.0]:
			b.add(sphere(0.2, -1.0, 8, 5), xf(Vector3(0.3 * side, 1.3, 1.45)), Color(0.98, 0.95, 0.75), MAT_GLOSS)
			b.add(sphere(0.1, -1.0, 6, 4), xf(Vector3(0.32 * side, 1.32, 1.62)), Color(0.08, 0.08, 0.08), MAT_GLOSS)
		for k in range(5):
			b.add(cyl(0.0, 0.18, 0.45, 5), xf(Vector3(0, 1.35 - 0.12 * absf(k - 1.0), 0.4 - 0.45 * k)), skin.darkened(0.25), MAT_MATTE)
		return b.commit())


# ---------------------------------------------------------------------------
# Buildings

## Open-air camp store read from above: jars under a narrow lean-to at the back,
## a log stack, a stone heap and clay balls out front.
static func storage() -> ArrayMesh:
	return _cached("storage", func():
		var b = Builder.new()
		b.add(cyl(1.0, 1.08, 0.22, 18), xf(Vector3(0, 0.1, 0.6), Vector3(3.2, 1, 1.9)), EARTH.lightened(0.1), MAT_MATTE, 0.04)
		for x in [-2.6, 0.0, 2.6]:
			_stick(b, Vector3(x, 0, -0.95), Vector3(x, 2.05, -0.95), 0.12, WOOD, x)
			_stick(b, Vector3(x, 0, 0.35), Vector3(x, 1.55, 0.35), 0.1, WOOD_LIGHT, x + 1.0)
		_stick(b, Vector3(-2.9, 2.0, -0.95), Vector3(2.9, 2.0, -0.95), 0.1, WOOD)
		_stick(b, Vector3(-2.9, 1.5, 0.35), Vector3(2.9, 1.5, 0.35), 0.09, WOOD)
		for k in range(3):
			var z = 0.35 - 0.48 * k
			var y = 1.62 + 0.18 * k
			b.add(box(Vector3(6.2, 0.16, 0.75)), xf(Vector3(0, y, z), Vector3.ONE, Vector3(0.36, 0, 0)), THATCH.darkened(0.04 * k), MAT_MATTE, 0.12, k)
		var jars = [Vector3(-2.0, 0, -0.45), Vector3(-1.05, 0, -0.35), Vector3(0.0, 0, -0.5), Vector3(1.0, 0, -0.35), Vector3(1.95, 0, -0.45)]
		for k in range(jars.size()):
			var j: Vector3 = jars[k]
			var r = 0.42 - 0.05 * (k % 2)
			b.add(sphere(r, r * 2.1, 12, 6), xf(j + Vector3(0, 0.2 + r, 0)), CLAY if k % 2 == 0 else CLAY_LIGHT, MAT_GLOSS, 0.04, k)
			b.add(cyl(r * 0.45, r * 0.5, 0.2, 10), xf(j + Vector3(0, 0.2 + r * 2.0, 0)), CLAY.darkened(0.1), MAT_GLOSS)
		# Log stack (3-2-1) on the left.
		var row_y = [0.3, 0.52, 0.74]
		for row in range(3):
			for k in range(3 - row):
				var x = -2.2 + 0.24 * row + 0.48 * k
				_stick(b, Vector3(x, row_y[row], 0.9), Vector3(x + 0.08, row_y[row], 2.1), 0.13, WOOD if (row + k) % 2 == 0 else WOOD_LIGHT, row * 3 + k)
		# Stone heap on the right.
		for k in range(7):
			var ang = float(k) * 2.39996
			var d = 0.0 if k == 0 else 0.42
			var r = 0.32 if k == 0 else 0.24
			b.add(sphere(r, r * 1.5, 9, 5), xf(Vector3(1.9 + cos(ang) * d, 0.22 + r * 0.55 + (0.18 if k == 0 else 0.0), 1.4 + sin(ang) * d * 0.8)), STONE if k % 2 == 0 else STONE_DARK, MAT_MATTE, r * 0.4, k)
		# Clay balls in a shallow basket in the middle.
		b.add(cyl(0.62, 0.5, 0.28, 12), xf(Vector3(0.0, 0.34, 1.45)), THATCH.darkened(0.12), MAT_MATTE, 0.04)
		for k in range(5):
			var ang = float(k) * 2.39996
			var d = 0.0 if k == 0 else 0.3
			b.add(sphere(0.2, 0.36, 9, 5), xf(Vector3(cos(ang) * d, 0.55 + (0.1 if k == 0 else 0.0), 1.45 + sin(ang) * d)), CLAY_LIGHT if k % 2 == 0 else CLAY, MAT_GLOSS, 0.05, k)
		return b.commit())


static func workshop() -> ArrayMesh:
	return _cached("workshop", func():
		var b = Builder.new()
		b.add(cyl(1.0, 1.06, 0.2, 16), xf(Vector3(0, 0.1, 0.4), Vector3(4.1, 1, 2.3)), EARTH.lightened(0.05), MAT_MATTE, 0.04)
		for x in [-3.6, 0.0, 3.6]:
			for z in [-1.4, 1.8]:
				_stick(b, Vector3(x, 0, z), Vector3(x, 2.3, z), 0.13, WOOD, x + z)
		_stick(b, Vector3(-3.8, 2.95, 0.2), Vector3(3.8, 2.95, 0.2), 0.12, WOOD_LIGHT)
		b.add(box(Vector3(8.2, 0.2, 2.4)), xf(Vector3(0, 2.6, -0.7), Vector3.ONE, Vector3(-0.42, 0, 0)), THATCH, MAT_MATTE, 0.1)
		b.add(box(Vector3(8.2, 0.2, 2.4)), xf(Vector3(0, 2.6, 1.1), Vector3.ONE, Vector3(0.42, 0, 0)), THATCH.darkened(0.05), MAT_MATTE, 0.1)
		# Workbench, anvil stone, chopping stump and finished tools.
		b.add(box(Vector3(2.2, 0.15, 0.9)), xf(Vector3(-1.6, 0.85, 0.2)), WOOD_LIGHT, MAT_MATTE, 0.03)
		for p in [Vector3(-2.5, 0, -0.1), Vector3(-0.7, 0, -0.1), Vector3(-2.5, 0, 0.5), Vector3(-0.7, 0, 0.5)]:
			_stick(b, p, p + Vector3(0, 0.8, 0), 0.07, WOOD)
		b.add(sphere(0.6, 0.9, 10, 5), xf(Vector3(1.3, 0.35, 0.3), Vector3(1.2, 1, 0.9)), STONE, MAT_MATTE, 0.15)
		b.add(cyl(0.38, 0.42, 0.55, 10), xf(Vector3(2.8, 0.27, 0.9)), TRUNK, MAT_MATTE, 0.05)
		_stick(b, Vector3(2.8, 0.55, 0.9), Vector3(3.1, 1.1, 0.8), 0.04, WOOD_LIGHT)
		b.add(box(Vector3(0.12, 0.25, 0.32)), xf(Vector3(3.12, 1.1, 0.8)), STONE_DARK, MAT_MATTE)
		_stick(b, Vector3(-2.2, 0.95, 0.2), Vector3(-1.4, 0.95, 0.35), 0.035, WOOD)
		b.add(box(Vector3(0.18, 0.12, 0.28)), xf(Vector3(-1.35, 0.97, 0.35)), STONE_DARK, MAT_MATTE)
		return b.commit())


static func idol() -> ArrayMesh:
	return _cached("idol", func():
		var b = Builder.new()
		for k in range(10):
			var a = TAU * float(k) / 10.0
			b.add(sphere(0.25, 0.3, 8, 4), xf(Vector3(cos(a) * 1.5, 0.08, sin(a) * 0.95)), STONE, MAT_MATTE, 0.08, k)
		b.add(cyl(0.65, 0.8, 0.5, 10), xf(Vector3(0, 0.25, 0)), STONE_DARK, MAT_MATTE, 0.1)
		b.add(cyl(0.45, 0.6, 1.5, 12), xf(Vector3(0, 1.2, 0)), CLAY, MAT_MATTE, 0.08)
		b.add(sphere(0.6, 1.1, 12, 6), xf(Vector3(0, 2.3, 0)), CLAY_LIGHT, MAT_MATTE, 0.06)
		b.add(box(Vector3(0.95, 0.85, 0.2)), xf(Vector3(0, 2.3, 0.5)), Color(0.93, 0.86, 0.70), MAT_MATTE, 0.04)
		for side in [-1.0, 1.0]:
			b.add(sphere(0.1, -1.0, 6, 4), xf(Vector3(0.22 * side, 2.45, 0.62)), Color(0.12, 0.1, 0.08), MAT_GLOSS)
			_stick(b, Vector3(0.45 * side, 1.5, 0), Vector3(0.95 * side, 2.0, 0.2), 0.12, CLAY)
		b.add(box(Vector3(0.4, 0.08, 0.05)), xf(Vector3(0, 2.05, 0.62)), MEAT, MAT_MATTE)
		for k in range(5):
			var a = -0.9 + 0.45 * k
			_stick(b, Vector3(0, 2.75, 0), Vector3(sin(a) * 0.75, 3.45 - 0.1 * absf(k - 2.0), 0), 0.05, WOOD_LIGHT, k)
			b.add(sphere(0.07, -1.0, 6, 4), xf(Vector3(sin(a) * 0.78, 3.5 - 0.1 * absf(k - 2.0), 0)), BERRY, MAT_GLOSS)
		return b.commit())


static func fence_post(gate_side: bool = false) -> ArrayMesh:
	return _cached("fence_post:%s" % gate_side, func():
		var b = Builder.new()
		var h = 2.3 if gate_side else 1.5
		var r = 0.2 if gate_side else 0.14
		b.add(sphere(0.38, 0.3, 8, 4), xf(Vector3(0, 0.05, 0)), EARTH, MAT_MATTE, 0.08)
		b.add(cyl(r, r * 1.1, h, 7), xf(Vector3(0, h * 0.5, 0)), WOOD, MAT_MATTE, 0.03)
		b.add(cyl(0.0, r, 0.3, 7), xf(Vector3(0, h + 0.15, 0)), WOOD_LIGHT, MAT_MATTE)
		b.add(cyl(r * 1.25, r * 1.25, 0.1, 7), xf(Vector3(0, h * 0.7, 0)), THATCH.darkened(0.2), MAT_MATTE)
		return b.commit())


## Two lashed rails from the origin along +X, `length` long.
static func fence_rails(length: float) -> ArrayMesh:
	return _cached("fence_rails:%.2f" % length, func():
		var b = Builder.new()
		_stick(b, Vector3(0, 0.55, 0), Vector3(length, 0.6, 0), 0.07, WOOD_LIGHT)
		_stick(b, Vector3(0, 1.1, 0), Vector3(length, 1.05, 0), 0.07, WOOD)
		return b.commit())


## Gate spanning `width` along +X centred at the origin.
static func gate(width: float, blueprint: bool) -> ArrayMesh:
	return _cached("gate:%.2f:%s" % [width, blueprint], func():
		var b = Builder.new()
		var half = width * 0.5
		_stick(b, Vector3(-half - 0.4, 2.55, 0), Vector3(half + 0.4, 2.55, 0), 0.14, WOOD_LIGHT)
		b.add(box(Vector3(width + 1.0, 0.18, 0.5)), xf(Vector3(0, 2.75, 0)), THATCH, MAT_MATTE, 0.06)
		if not blueprint:
			for side in [-1.0, 1.0]:
				for k in range(4):
					var x = side * (half - 0.3 - 0.42 * k) * 0.95
					_stick(b, Vector3(x, 0.08, 0), Vector3(x, 1.75, 0), 0.11, WOOD if k % 2 == 0 else WOOD_LIGHT, k)
				_stick(b, Vector3(side * 0.15, 0.6, 0.1), Vector3(side * (half - 0.2), 0.6, 0.1), 0.06, WOOD)
				_stick(b, Vector3(side * 0.15, 1.35, 0.1), Vector3(side * (half - 0.2), 1.35, 0.1), 0.06, WOOD)
		return b.commit())


## Log seats around a hearth (purely decorative), laid outside the hearth ellipse.
static func hearth_seats() -> ArrayMesh:
	return _cached("hearth_seats", func():
		var b = Builder.new()
		for k in range(3):
			var a = TAU * float(k) / 3.0 + 0.5
			var c = Vector3(cos(a) * 4.6, 0.17, sin(a) * 3.3)
			var t = Vector3(-sin(a), 0, cos(a) * 0.7).normalized() * 0.75
			_stick(b, c - t, c + t, 0.17, WOOD if k % 2 == 0 else TRUNK, k)
		# Ash and charred sticks in the ring.
		b.add(sphere(0.55, 0.08, 10, 3), xf(Vector3(0, 0.02, 0)), Color(0.22, 0.2, 0.19), MAT_MATTE)
		return b.commit())


## Flickering flame tongues for the campfire. Uses the unshaded flame material.
static func flame() -> ArrayMesh:
	return _cached("flame", func():
		var b = Builder.new()
		b.add(cyl(0.0, 0.32, 0.9, 7), xf(Vector3(0, 0.45, 0)), Color(1.0, 0.55, 0.12), MAT_FLAME)
		b.add(cyl(0.0, 0.2, 0.7, 6), xf(Vector3(0.15, 0.35, 0.08), Vector3.ONE, Vector3(0, 0, -0.25)), Color(1.0, 0.75, 0.2), MAT_FLAME)
		b.add(cyl(0.0, 0.18, 0.6, 6), xf(Vector3(-0.14, 0.3, -0.05), Vector3.ONE, Vector3(0.1, 0, 0.3)), Color(1.0, 0.42, 0.08), MAT_FLAME)
		b.add(cyl(0.0, 0.12, 0.45, 6), xf(Vector3(0, 0.28, 0)), Color(1.0, 0.95, 0.6), MAT_FLAME)
		return b.commit())
