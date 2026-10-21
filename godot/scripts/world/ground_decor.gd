class_name GroundDecor
extends Node3D

## Deterministic meadow dressing: grass tufts, flowers, pebbles and shore reeds.
## Instanced in map chunks (MultiMesh) so the camera culls them cheaply and they
## disappear at far zoom where they would only shimmer. Clearings (camps, quarries,
## building yards) and water are kept free.
##
## Placement is computed on a worker thread into raw MultiMesh buffers; the main
## thread only uploads finished chunks, nearest to the camera first, so a new
## clearing never stalls the observer.

const SurfaceTerrain = preload("res://scripts/world/surface_terrain.gd")
const PropFactory = preload("res://scripts/world/prop_factory.gd")

const CHUNK: float = 40.0
const TUFTS_PER_CHUNK: int = 320
const FLOWERS_PER_CHUNK: int = 34
const PEBBLES_PER_CHUNK: int = 22
const VISIBLE_RANGE: float = 150.0
const CHUNKS_PER_FRAME: int = 6
const KIND_TUFT := 0
const KIND_FLOWER := 1
const KIND_REED := 2
const KIND_PEBBLE := 3
const LABELS = ["Tufts", "Flowers", "Reeds", "Pebbles"]
const FLOWER_TINTS = [Color(1.0, 0.92, 0.35), Color(0.98, 0.97, 0.92), Color(0.95, 0.55, 0.7), Color(0.6, 0.65, 1.0), Color(1.0, 0.6, 0.25)]

var map_size := Vector2(480, 480)
var signature: String = ""
var grass_material: ShaderMaterial
var meshes: Array = []
var density_noise := FastNoiseLite.new()
var last_build_msec: int = 0
var instance_count: int = 0
var chunk_nodes: Dictionary = {}

var _generation: int = 0
var _task_id: int = -1
var _mutex := Mutex.new()
var _ready_chunks: Array = []
var _remaining: int = 0
var _build_started_usec: int = 0
var _old_tasks: Array[int] = []


func _ready() -> void:
	grass_material = ShaderMaterial.new()
	grass_material.shader = load("res://shaders/grass_tuft.gdshader")
	var pb = PropFactory.Builder.new()
	pb.add(PropFactory.sphere(0.12, 0.14, 7, 4), Transform3D(), Color(0.66, 0.64, 0.60), PropFactory.MAT_MATTE, 0.05)
	meshes = [
		_blade_mesh(7, 0.46, 0.06, Color(0.30, 0.46, 0.17), Color(0.66, 0.76, 0.36), false, Color.WHITE),
		_blade_mesh(3, 0.3, 0.06, Color(0.26, 0.44, 0.16), Color(0.48, 0.66, 0.28), true, Color(1, 1, 1, 0)),
		_blade_mesh(7, 1.05, 0.07, Color(0.28, 0.40, 0.18), Color(0.58, 0.64, 0.30), true, Color(0.36, 0.22, 0.12)),
		pb.commit(),
	]
	density_noise.seed = 1337
	density_noise.frequency = 0.035
	density_noise.fractal_octaves = 3


func _exit_tree() -> void:
	_generation += 1
	_wait_task()


## Blades fan out from the root. When `head` is set the tip of the middle blade
## carries a small flower/catkin. Vertex alpha 1 = keep vertex colour, alpha 0 =
## take the per-instance tint (used for flower heads).
func _blade_mesh(blades: int, height: float, width: float, root: Color, tip: Color, head: bool, head_color: Color) -> ArrayMesh:
	var st = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in range(blades):
		var a = TAU * float(k) / float(blades) + 0.37 * k
		var lean = Vector3(cos(a), 0, sin(a)) * height * (0.12 + 0.14 * float(k % 3) / 2.0)
		var h = height * (0.7 + 0.3 * float((k * 7) % 5) / 4.0)
		var side = Vector3(-sin(a), 0, cos(a)) * width
		var base = Vector3(cos(a), 0, sin(a)) * width * 0.6
		for v in [[base - side, 0.0], [base + side, 0.0], [base + lean + Vector3(0, h, 0), 1.0]]:
			st.set_color(root.lerp(tip, v[1]))
			st.set_uv(Vector2(0.5, v[1]))
			st.set_normal(Vector3.UP)
			st.add_vertex(v[0])
	if head:
		var top = Vector3(0, height * 1.02, 0)
		var r = 0.07 if head_color.a < 0.5 else 0.06
		var tall = r if head_color.a < 0.5 else r * 3.0
		var pts = [top + Vector3(r, 0, 0), top + Vector3(0, 0, r), top + Vector3(-r, 0, 0), top + Vector3(0, 0, -r)]
		for k in range(4):
			var a2 = pts[k]
			var b2 = pts[(k + 1) % 4]
			for apex in [top + Vector3(0, tall, 0), top - Vector3(0, tall * 0.6, 0)]:
				for v in [a2, b2, apex]:
					st.set_color(head_color)
					st.set_uv(Vector2(0.5, 1.0))
					st.set_normal(Vector3.UP)
					st.add_vertex(v)
	var mesh = st.commit()
	mesh.surface_set_material(0, grass_material)
	return mesh


static func _clear_zone(p: Vector2, entrances: Array, digs: Array, yards: Array) -> float:
	## Returns 0 inside a clearing, 1 in open meadow, soft in between.
	var open = 1.0
	for e in entrances:
		var d = p.distance_to(e) / 18.0
		open = minf(open, smoothstep(0.75, 1.05, d))
	for g in digs:
		var dd = Vector2((p.x - g.x) / (g.z * 1.2), (p.y - g.y) / (g.w * 1.2)).length()
		open = minf(open, smoothstep(0.9, 1.1, dd))
	for y in yards:
		var dy = Vector2((p.x - y.x) / y.z, (p.y - y.y) / y.w).length()
		open = minf(open, smoothstep(0.85, 1.2, dy))
	return open


static func _shore_distance(p: Vector2) -> float:
	## Rough distance to water (0..4) using a few probes; 99 when far away.
	var near = false
	for lake in SurfaceTerrain.get_lakes():
		if lake.box.grow(4.0).has_point(p):
			near = true
			break
	if not near:
		return 99.0
	if SurfaceTerrain.is_water_at(p.x, p.y):
		return -1.0
	for r in [1.0, 2.0, 3.5]:
		for k in range(8):
			var a = TAU * float(k) / 8.0
			if SurfaceTerrain.is_water_at(p.x + cos(a) * r, p.y + sin(a) * r):
				return r
	return 99.0


## Schedules a re-dress of the whole meadow on a worker thread. Old chunks stay
## visible until their replacement is uploaded.
func rebuild(entrances: Array, digs: Array, yards: Array, sig: String, focus: Vector2 = Vector2(240, 240)) -> void:
	if sig == signature:
		return
	signature = sig
	_mutex.lock()
	_generation += 1
	_mutex.unlock()
	# The previous task notices the new generation and stops at its next chunk;
	# it is reaped later instead of blocking this frame.
	if _task_id >= 0:
		_old_tasks.append(_task_id)
		_task_id = -1
	var order: Array[Vector2i] = []
	var cols = int(ceil(map_size.x / CHUNK))
	var rows = int(ceil(map_size.y / CHUNK))
	for cy in range(rows):
		for cx in range(cols):
			order.append(Vector2i(cx, cy))
	order.sort_custom(func(a, b): return _chunk_center(a).distance_squared_to(focus) < _chunk_center(b).distance_squared_to(focus))
	_mutex.lock()
	_ready_chunks.clear()
	_remaining = order.size()
	_mutex.unlock()
	_build_started_usec = Time.get_ticks_usec()
	var gen = _generation
	var zones = [entrances.duplicate(), digs.duplicate(), yards.duplicate()]
	_task_id = WorkerThreadPool.add_task(_compute_all.bind(order, zones, gen), false, "Clayfolk ground decor")


func _wait_task() -> void:
	for id in _old_tasks:
		WorkerThreadPool.wait_for_task_completion(id)
	_old_tasks.clear()
	if _task_id >= 0:
		WorkerThreadPool.wait_for_task_completion(_task_id)
		_task_id = -1


func _chunk_center(c: Vector2i) -> Vector2:
	return Vector2((c.x + 0.5) * CHUNK, (c.y + 0.5) * CHUNK)


func is_settled() -> bool:
	_mutex.lock()
	var done = _remaining == 0 and _ready_chunks.is_empty()
	_mutex.unlock()
	return done


## Blocks until every chunk is placed (tests and offline capture only).
func build_all_now() -> void:
	_wait_task()
	_upload_ready(1 << 30)


func _process(_delta: float) -> void:
	for i in range(_old_tasks.size() - 1, -1, -1):
		if WorkerThreadPool.is_task_completed(_old_tasks[i]):
			WorkerThreadPool.wait_for_task_completion(_old_tasks[i])
			_old_tasks.remove_at(i)
	_upload_ready(CHUNKS_PER_FRAME)


func _upload_ready(limit: int) -> void:
	_mutex.lock()
	var batch = _ready_chunks.slice(0, limit)
	_ready_chunks = _ready_chunks.slice(limit)
	var finished = _remaining == 0 and _ready_chunks.is_empty()
	_mutex.unlock()
	for item in batch:
		if item.gen != _generation:
			continue
		_apply_chunk(item)
	if finished and not batch.is_empty():
		last_build_msec = int((Time.get_ticks_usec() - _build_started_usec) / 1000)
		if _task_id >= 0:
			WorkerThreadPool.wait_for_task_completion(_task_id)
			_task_id = -1


# --- worker thread ---------------------------------------------------------

func _compute_all(order: Array[Vector2i], zones: Array, gen: int) -> void:
	for c in order:
		if gen != _generation:
			return
		var item = _compute_chunk(c, zones)
		item.gen = gen
		_mutex.lock()
		if gen == _generation:
			_ready_chunks.append(item)
			_remaining -= 1
		_mutex.unlock()


func _compute_chunk(c: Vector2i, zones: Array) -> Dictionary:
	var entrances: Array = zones[0]
	var digs: Array = zones[1]
	var yards: Array = zones[2]
	var rng = RandomNumberGenerator.new()
	rng.seed = 9173 + c.x * 131 + c.y * 7919
	var origin = Vector2(c.x * CHUNK, c.y * CHUNK)
	var center = _chunk_center(c)
	var lists = [[], [], [], []]
	for i in range(TUFTS_PER_CHUNK):
		var p = origin + Vector2(rng.randf() * CHUNK, rng.randf() * CHUNK)
		var shore = _shore_distance(p)
		if shore < 0.0:
			continue
		if shore < 3.6:
			if rng.randf() < 0.75:
				lists[KIND_REED].append([p, rng.randf(), 0.8 + rng.randf() * 0.5])
			continue
		var meadow = 0.55 + 0.45 * density_noise.get_noise_2d(p.x, p.y)
		if rng.randf() > _clear_zone(p, entrances, digs, yards) * meadow:
			continue
		lists[KIND_TUFT].append([p, rng.randf(), 0.7 + rng.randf() * 0.7])
	for i in range(FLOWERS_PER_CHUNK):
		var p = origin + Vector2(rng.randf() * CHUNK, rng.randf() * CHUNK)
		if _shore_distance(p) < 2.0:
			continue
		var bloom = density_noise.get_noise_2d(p.x * 1.7 + 100.0, p.y * 1.7)
		if bloom < 0.05 or rng.randf() > _clear_zone(p, entrances, digs, yards):
			continue
		lists[KIND_FLOWER].append([p, rng.randf(), 0.8 + rng.randf() * 0.5])
	for i in range(PEBBLES_PER_CHUNK):
		var p = origin + Vector2(rng.randf() * CHUNK, rng.randf() * CHUNK)
		if _shore_distance(p) < 0.5:
			continue
		lists[KIND_PEBBLE].append([p, rng.randf(), 0.5 + rng.randf() * 1.3])
	var buffers = []
	for kind in range(4):
		buffers.append(_pack(lists[kind], center, rng, kind))
	return {"chunk": c, "center": center, "buffers": buffers, "counts": lists.map(func(l): return l.size()), "gen": 0}


## Raw MultiMesh buffer: 12 floats of transform (+4 custom data when used).
func _pack(items: Array, center: Vector2, rng: RandomNumberGenerator, kind: int) -> PackedFloat32Array:
	var stride = 12 if kind == KIND_PEBBLE else 16
	var buf = PackedFloat32Array()
	buf.resize(items.size() * stride)
	for i in range(items.size()):
		var it = items[i]
		var p: Vector2 = it[0]
		var s: float = it[2]
		var scale = Vector3(s, s * 0.6, s * 0.8) if kind == KIND_PEBBLE else Vector3(s, s * (0.8 + 0.4 * rng.randf()), s)
		var b = Basis(Vector3.UP, it[1] * TAU).scaled(scale)
		var o = Vector3(p.x - center.x, 0.0, p.y - center.y)
		var k = i * stride
		buf[k + 0] = b.x.x; buf[k + 1] = b.y.x; buf[k + 2] = b.z.x; buf[k + 3] = o.x
		buf[k + 4] = b.x.y; buf[k + 5] = b.y.y; buf[k + 6] = b.z.y; buf[k + 7] = o.y
		buf[k + 8] = b.x.z; buf[k + 9] = b.y.z; buf[k + 10] = b.z.z; buf[k + 11] = o.z
		if stride == 16:
			var col = Color(0.36, 0.22, 0.12, 1.0)
			if kind == KIND_TUFT:
				col = Color(1.0, 1.0, 1.0, 0.85 + 0.3 * rng.randf())
			elif kind == KIND_FLOWER:
				col = FLOWER_TINTS[rng.randi() % FLOWER_TINTS.size()]
			buf[k + 12] = col.r; buf[k + 13] = col.g; buf[k + 14] = col.b; buf[k + 15] = col.a
	return buf


# --- main thread -----------------------------------------------------------

func _apply_chunk(item: Dictionary) -> void:
	var c: Vector2i = item.chunk
	for old in chunk_nodes.get(c, []):
		if is_instance_valid(old):
			instance_count -= old.multimesh.instance_count
			old.queue_free()
	chunk_nodes[c] = []
	var center: Vector2 = item.center
	for kind in range(4):
		var count: int = item.counts[kind]
		if count == 0:
			continue
		var mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = kind != KIND_PEBBLE
		mm.mesh = meshes[kind]
		mm.instance_count = count
		mm.buffer = item.buffers[kind]
		var mmi = MultiMeshInstance3D.new()
		mmi.name = "%s_%d_%d" % [LABELS[kind], int(center.x), int(center.y)]
		mmi.multimesh = mm
		mmi.position = Vector3(center.x, 0.0, center.y)
		mmi.visibility_range_end = VISIBLE_RANGE * (1.4 if kind == KIND_REED else 1.0)
		mmi.visibility_range_end_margin = 20.0
		mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if kind == KIND_REED else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)
		chunk_nodes[c].append(mmi)
		instance_count += count
