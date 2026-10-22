class_name Minimap
extends PanelContainer

## Framed minimap in the bottom-right corner (the 2D reference layout): the
## terrain is painted once per map (grass, sand round the camps, water, rock),
## then camps, buildings, springs, residents, game and enemies are drawn as
## dots from the latest snapshot, with the camera's view as a frame. Clicking
## or dragging moves the camera there.

signal focus_requested(point: Vector2)

const MAP_SIZE := Vector2(480, 480)
const VIEW := 210
## Terrain is sampled on a coarser grid (scaled up with filtering) on a worker thread.
const TERRAIN_RES := 105
const GRASS := Color(0.47, 0.62, 0.31)
const GRASS_DARK := Color(0.40, 0.55, 0.27)
const SAND := Color(0.84, 0.72, 0.47)
const WATER := Color(0.28, 0.55, 0.78)
const ROCK := Color(0.55, 0.53, 0.50)
const TRIBE := {"colony-1": Color(0.93, 0.48, 0.24), "colony-2": Color(0.35, 0.62, 0.90)}

var canvas: Control
var terrain_tex: ImageTexture
var terrain_sig := ""
var snapshot: Dictionary = {}
## Corners of the camera's view on the ground (map units), or empty.
var view_quad: PackedVector2Array = PackedVector2Array()
var dragging := false
var _task_id := -1
var _pending: Image


func _ready() -> void:
	name = "Minimap"
	var sb = GameHud.panel_style(Color(0.86, 0.72, 0.50, 0.97))
	sb.set_border_width_all(4)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 6; sb.content_margin_right = 6; sb.content_margin_top = 6; sb.content_margin_bottom = 6
	add_theme_stylebox_override("panel", sb)
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_force_pass_scroll_events = false
	tooltip_text = ""
	canvas = Control.new()
	canvas.name = "MapCanvas"
	canvas.custom_minimum_size = Vector2(VIEW, VIEW)
	canvas.mouse_filter = Control.MOUSE_FILTER_PASS
	canvas.draw.connect(_draw_map)
	canvas.gui_input.connect(_on_input)
	add_child(canvas)


func to_map(p: Vector2) -> Vector2:
	return p / MAP_SIZE * canvas.size


func to_world(local: Vector2) -> Vector2:
	return (local / canvas.size * MAP_SIZE).clamp(Vector2.ZERO, MAP_SIZE)


func update_from_snapshot(snap: Dictionary) -> void:
	snapshot = snap
	var surface = snap.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		var sig = SurfaceTerrain.signature_of(surface.get("terrain", {})) + JSON.stringify(surface.get("entrances", []))
		if sig != terrain_sig:
			terrain_sig = sig
			_paint_terrain(surface)
	canvas.queue_redraw()


## Terrain image, painted only when the map changes — on a worker thread, so a
## new map never stalls snapshot handling (the old main-thread paint took
## hundreds of milliseconds).
func _paint_terrain(surface: Dictionary) -> void:
	var camps: Array[Vector2] = []
	for e in surface.get("entrances", []):
		if typeof(e) == TYPE_DICTIONARY:
			camps.append(Vector2(float(e.get("x", 0)), float(e.get("y", 0))))
	if _task_id >= 0:
		WorkerThreadPool.wait_for_task_completion(_task_id)
	_task_id = WorkerThreadPool.add_task(_paint_worker.bind(camps), false, "Clayfolk minimap terrain")


func _paint_worker(camps: Array[Vector2]) -> void:
	var img = Image.create(TERRAIN_RES, TERRAIN_RES, false, Image.FORMAT_RGBA8)
	for py in range(TERRAIN_RES):
		for px in range(TERRAIN_RES):
			var w = Vector2(px + 0.5, py + 0.5) / float(TERRAIN_RES) * MAP_SIZE
			var col = GRASS if (int(w.x / 24.0) + int(w.y / 24.0)) % 2 == 0 else GRASS.lerp(GRASS_DARK, 0.35)
			for c in camps:
				if w.distance_to(c) < 26.0:
					col = SAND
			if SurfaceTerrain.is_mountain_at(w.x, w.y):
				col = ROCK
			elif SurfaceTerrain.is_water_at(w.x, w.y):
				col = WATER
			img.set_pixel(px, py, col)
	_pending = img


func _process(_delta: float) -> void:
	if _task_id >= 0 and WorkerThreadPool.is_task_completed(_task_id):
		WorkerThreadPool.wait_for_task_completion(_task_id)
		_task_id = -1
		terrain_tex = ImageTexture.create_from_image(_pending)
		canvas.queue_redraw()


func _exit_tree() -> void:
	if _task_id >= 0:
		WorkerThreadPool.wait_for_task_completion(_task_id)
		_task_id = -1


func set_view_quad(points: PackedVector2Array) -> void:
	view_quad = points
	canvas.queue_redraw()


func _draw_map() -> void:
	var r = Rect2(Vector2.ZERO, canvas.size)
	if terrain_tex:
		canvas.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		canvas.draw_texture_rect(terrain_tex, r, false)
	else:
		canvas.draw_rect(r, GRASS)
	var surface = snapshot.get("surface", {})
	if typeof(surface) == TYPE_DICTIONARY:
		for n in surface.get("resourceNodes", []):
			if typeof(n) == TYPE_DICTIONARY and str(n.get("kind", "")) == "tree" and float(n.get("amount", 0)) > 0:
				canvas.draw_circle(to_map(_p(n.get("pos"))), 1.2, Color(0.20, 0.40, 0.17))
		for s in surface.get("springs", []):
			if typeof(s) == TYPE_DICTIONARY:
				canvas.draw_circle(to_map(_p(s.get("pos"))), 3.5, Color(0.62, 0.32, 0.70))
		for b in surface.get("buildings", []):
			if typeof(b) != TYPE_DICTIONARY:
				continue
			var col: Color = TRIBE.get(str(b.get("colonyId", "")), Color.WHITE)
			var t = str(b.get("type", ""))
			var s = 1.5 if t in ["wall", "gate"] else 3.0
			canvas.draw_rect(Rect2(to_map(_p(b.get("pos"))) - Vector2(s, s) * 0.5, Vector2(s, s)), col.darkened(0.25))
		for a in surface.get("animals", []):
			if typeof(a) == TYPE_DICTIONARY and str(a.get("state", "")) != "dead":
				canvas.draw_circle(to_map(_p(a.get("pos"))), 1.4, Color(0.50, 0.33, 0.18))
	for ant in snapshot.get("ants", []):
		if typeof(ant) == TYPE_DICTIONARY and str(ant.get("state", "")) != "dead":
			canvas.draw_circle(to_map(_p(ant.get("pos"))), 1.3, TRIBE.get(str(ant.get("colonyId", "")), Color.WHITE))
	for e in snapshot.get("enemies", []):
		if typeof(e) == TYPE_DICTIONARY and float(e.get("hp", 1)) > 0:
			canvas.draw_circle(to_map(_p(e.get("pos"))), 3.0, Color(0.85, 0.12, 0.10))
	if typeof(surface) == TYPE_DICTIONARY:
		var entrances = surface.get("entrances", [])
		for i in range(entrances.size()):
			var c = to_map(_p(entrances[i]))
			canvas.draw_circle(c, 5.0, Color(1.0, 0.82, 0.3))
			canvas.draw_arc(c, 5.0, 0, TAU, 16, TRIBE.get("colony-%d" % (i + 1), Color.WHITE), 1.5)
	if view_quad.size() == 4:
		var pts = PackedVector2Array()
		for p in view_quad:
			pts.append(to_map(p).clamp(Vector2.ZERO, canvas.size))
		pts.append(pts[0])
		canvas.draw_polyline(pts, Color(1, 1, 1, 0.9), 1.5)


static func _p(d: Variant) -> Vector2:
	if typeof(d) != TYPE_DICTIONARY:
		return Vector2(-100, -100)
	return Vector2(float(d.get("x", 0)), float(d.get("y", 0)))


func _on_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		dragging = event.pressed
		if event.pressed:
			focus_requested.emit(to_world(event.position))
		accept_event()
	elif event is InputEventMouseMotion and dragging:
		focus_requested.emit(to_world(event.position))
		accept_event()
