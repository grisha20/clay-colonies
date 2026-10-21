class_name BuildController
extends Node

## Build and zone tools: a toolbar, a live placement preview that turns red
## exactly where the server would refuse (BuildRules = shared TS rules), and
## the commands the 2D client sends (placeBuilding, placeGate, paintWall,
## paintZone, eraseZone, eraseBuild). Also draws the player's zones on the ground.
##
## Point buildings: click (Shift keeps the tool). Fence: drag a brush line.
## Gate: click, R rotates. Zones and eraser: drag a rectangle. Esc/RMB cancels.

signal tool_changed(tool: String)

const TOOLS = [
	["hut", "Хижина", "1"], ["storage", "Склад", "2"], ["workshop", "Мастерская", "3"], ["idol", "Идол", "4"],
	["wall", "Ограда", "5"], ["gate", "Ворота", "6"],
	["harvest", "Зона добычи", "7"], ["forbid", "Запрет", "8"], ["erase", "Ластик", "9"],
	["post", "Пост обороны", "0"],
]
const HINTS = {
	"hut": "Хижина: +4 к пределу жителей",
	"storage": "Склад: запасы ближе к работе",
	"workshop": "Мастерская: топоры, кирки, удочки",
	"idol": "Идол: ритуал победы у живого костра",
	"wall": "Ограда: тяните линию",
	"gate": "Ворота: свои проходят, чужие нет · R — поворот",
	"harvest": "Зона добычи: жители добывают только здесь · тяните прямоугольник",
	"forbid": "Запрет: жители сюда не ходят · тяните прямоугольник",
	"erase": "Ластик: снимает зоны и недостроенную ограду",
	"post": "Пост обороны: стража ждёт здесь, у ворот или у берега",
}
const OK_COLOR := Color(0.35, 0.85, 0.4, 0.45)
const BAD_COLOR := Color(0.95, 0.25, 0.2, 0.5)

var observer: Node            # WorldObserver
var world_view: WorldView
var ws_client: Node
var hud: GameHud

var tool: String = ""
var gate_axis: String = "horizontal"
var drag_start: Vector2 = Vector2.INF
var mouse_world: Vector2 = Vector2.INF
var buttons: Dictionary = {}
var toolbar: PanelContainer

var ghost_root: Node3D
var ghost_building: Node3D
var ghost_ring: MeshInstance3D
var brush_marks: MultiMeshInstance3D
var rect_mesh: MeshInstance3D
var zone_overlay: MultiMeshInstance3D
var zone_version: String = ""
var last_reason: String = ""
var _overlay_ok: StandardMaterial3D
var _overlay_bad: StandardMaterial3D


func setup(p_observer: Node, p_world_view: WorldView, p_ws: Node, p_hud: GameHud, canvas: CanvasLayer) -> void:
	observer = p_observer
	world_view = p_world_view
	ws_client = p_ws
	hud = p_hud
	_overlay_ok = _flat_material(OK_COLOR)
	_overlay_bad = _flat_material(BAD_COLOR)
	_build_toolbar(canvas)
	_build_ghosts()


static func _flat_material(c: Color) -> StandardMaterial3D:
	var m = StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = c
	m.no_depth_test = false
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func _build_toolbar(canvas: CanvasLayer) -> void:
	toolbar = PanelContainer.new()
	toolbar.name = "BuildToolbar"
	toolbar.add_theme_stylebox_override("panel", GameHud.panel_style())
	toolbar.theme = GameHud.ink_theme()
	toolbar.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	toolbar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	toolbar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	toolbar.offset_bottom = -16
	toolbar.mouse_force_pass_scroll_events = false
	canvas.add_child(toolbar)
	var row = HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	toolbar.add_child(row)
	for spec in TOOLS:
		var b = Button.new()
		var cost = BuildRules.cost_text(spec[0])
		b.text = "%s\n%s" % [spec[1], cost if cost != "" else " "]
		b.tooltip_text = "%s  [%s]" % [HINTS[spec[0]], spec[2]]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(100, 54)
		var t: String = spec[0]
		b.pressed.connect(func(): set_tool("" if tool == t else t))
		row.add_child(b)
		buttons[t] = b


func _build_ghosts() -> void:
	ghost_root = Node3D.new()
	ghost_root.name = "BuildGhost"
	world_view.add_child(ghost_root)
	ghost_ring = MeshInstance3D.new()
	var ring = TorusMesh.new()
	ring.inner_radius = 0.92
	ring.outer_radius = 1.0
	ring.rings = 48
	ring.ring_segments = 4
	ghost_ring.mesh = ring
	ghost_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ghost_root.add_child(ghost_ring)
	brush_marks = MultiMeshInstance3D.new()
	var mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var mark = BoxMesh.new()
	mark.size = Vector3(1.7, 0.5, 1.7)
	var mat = _flat_material(Color.WHITE)
	mat.vertex_color_use_as_albedo = true
	mark.material = mat
	mm.mesh = mark
	brush_marks.multimesh = mm
	brush_marks.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ghost_root.add_child(brush_marks)
	rect_mesh = MeshInstance3D.new()
	rect_mesh.mesh = PlaneMesh.new()
	rect_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ghost_root.add_child(rect_mesh)
	zone_overlay = MultiMeshInstance3D.new()
	zone_overlay.name = "ZoneOverlay"
	var zmm = MultiMesh.new()
	zmm.transform_format = MultiMesh.TRANSFORM_3D
	zmm.use_colors = true
	var quad = PlaneMesh.new()
	quad.size = Vector2(3.8, 3.8)
	var zmat = _flat_material(Color.WHITE)
	zmat.vertex_color_use_as_albedo = true
	quad.material = zmat
	zmm.mesh = quad
	zone_overlay.multimesh = zmm
	zone_overlay.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world_view.add_child(zone_overlay)
	_hide_ghosts()


func set_tool(t: String) -> void:
	tool = t
	drag_start = Vector2.INF
	for k in buttons.keys():
		buttons[k].button_pressed = k == t
	if ghost_building:
		ghost_building.queue_free()
		ghost_building = null
	if t in ["hut", "storage", "workshop", "idol", "gate", "post"]:
		ghost_building = _make_ghost(t)
		ghost_root.add_child(ghost_building)
	_hide_ghosts()
	tool_changed.emit(t)


func _make_ghost(t: String) -> Node3D:
	var node: Node3D
	match t:
		"hut":
			node = Node3D.new()
			var scene = load("res://assets/models/hut.glb") as PackedScene
			if scene:
				var hut = scene.instantiate() as Node3D
				hut.scale = WorldView.HUT_SCALE
				hut.position = Vector3(0, 0, 0.5)
				node.add_child(hut)
		"storage":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.storage()
		"workshop":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.workshop()
		"idol":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.idol()
		"post":
			node = MeshInstance3D.new()
			node.mesh = PropFactory.post_pole()
		_:
			node = MeshInstance3D.new()
			node.mesh = PropFactory.gate(float(BuildRules.GATE_SPAN) * BuildRules.WALL_CELL_SIZE, false)
	return node


func _set_ghost_tint(node: Node, ok: bool) -> void:
	if node is GeometryInstance3D:
		node.material_overlay = _overlay_ok if ok else _overlay_bad
		node.transparency = 0.35
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in node.get_children():
		_set_ghost_tint(c, ok)


func _hide_ghosts() -> void:
	if ghost_building:
		ghost_building.visible = false
	ghost_ring.visible = false
	brush_marks.multimesh.instance_count = 0
	rect_mesh.visible = false


func _surface() -> Dictionary:
	var s = world_view.last_snapshot.get("surface", {})
	return s if typeof(s) == TYPE_DICTIONARY else {}


func _owner() -> String:
	return "colony-1" if int(observer.player_colony) == 0 else "colony-2"


func _ground(p: Vector2, lift: float = 0.0) -> Vector3:
	return Vector3(p.x, SurfaceTerrain.height_at(p.x, p.y) + lift, p.y)


## Called every frame with the mouse ground point (INF when over UI).
func update_preview(p: Vector2) -> void:
	mouse_world = p
	update_zone_overlay()
	if tool == "" or p == Vector2.INF:
		_hide_ghosts()
		return
	var surface = _surface()
	var owner = _owner()
	match tool:
		"hut", "storage", "workshop", "idol":
			last_reason = BuildRules.point_building_placement(surface, owner, tool, p)
			ghost_building.visible = true
			ghost_building.position = _ground(p)
			_set_ghost_tint(ghost_building, last_reason == "")
			var f = BuildingGeometry.get_building_footprint({"type": tool, "stage": "built", "pos": {"x": p.x, "y": p.y}})
			ghost_ring.visible = true
			ghost_ring.position = _ground(Vector2(f.x, f.y), 0.08)
			ghost_ring.scale = Vector3(float(f.rx), 1.0, float(f.ry))
			ghost_ring.material_override = _overlay_ok if last_reason == "" else _overlay_bad
			_hint(last_reason, tool)
		"post":
			last_reason = BuildRules.post_placement(surface, owner, p)
			ghost_building.visible = true
			ghost_building.position = _ground(p)
			_set_ghost_tint(ghost_building, last_reason == "")
			hud.show_tooltip(HINTS.post if last_reason == "" else "Пост обороны: " + last_reason, observer.get_viewport().get_mouse_position())
		"gate":
			last_reason = BuildRules.gate_placement(surface, owner, p, gate_axis)
			var snapped = BuildRules.snap_fence_position(p)
			ghost_building.visible = true
			ghost_building.position = _ground(snapped)
			ghost_building.rotation.y = PI * 0.5 if gate_axis == "vertical" else 0.0
			_set_ghost_tint(ghost_building, last_reason == "")
			_set_marks(BuildRules.gate_cell_centers(p, gate_axis).map(func(c): return [c, BuildRules.fence_placement(surface, owner, c, true) == ""]))
			_hint(last_reason, tool)
		"wall":
			var cells = BuildRules.wall_line_cells(surface, drag_start if drag_start != Vector2.INF else p, p)
			var marks = []
			var ok_count = 0
			for idx in cells:
				var c = BuildRules.cell_center(surface, idx, BuildRules.WALL_CELL_SIZE)
				var ok = BuildRules.fence_placement(surface, owner, c) == ""
				ok_count += int(ok)
				marks.append([c, ok])
			_set_marks(marks)
			hud.show_tooltip("Ограда · %d секц. · %s" % [ok_count, _cost_times("wall", ok_count)] if drag_start != Vector2.INF else HINTS.wall, observer.get_viewport().get_mouse_position())
		"harvest", "forbid", "erase":
			var a = drag_start if drag_start != Vector2.INF else p
			_show_rect(a, p)
			var n = BuildRules.rect_cells(surface, a, p, BuildRules.ZONE_CELL_SIZE).size()
			hud.show_tooltip(HINTS[tool] if drag_start == Vector2.INF else "%s · %d клеток" % [{"harvest": "Зона добычи", "forbid": "Запрет", "erase": "Ластик"}[tool], n], observer.get_viewport().get_mouse_position())


func _cost_times(kind: String, n: int) -> String:
	var c: Dictionary = BuildRules.COSTS.get(kind, {})
	var parts: PackedStringArray = []
	for res in [["clay", "глина"], ["wood", "дерево"], ["stone", "камень"]]:
		if int(c.get(res[0], 0)) > 0:
			parts.append("%d %s" % [int(c[res[0]]) * n, res[1]])
	return ", ".join(parts)


func _hint(reason: String, kind: String) -> void:
	var name = {"hut": "Хижина", "storage": "Склад", "workshop": "Мастерская", "idol": "Идол", "gate": "Ворота"}.get(kind, "")
	var text = "%s · %s" % [name, BuildRules.cost_text(kind)] if reason == "" else "%s: %s" % [name, reason]
	hud.show_tooltip(text, observer.get_viewport().get_mouse_position())


func _set_marks(marks: Array) -> void:
	var mm = brush_marks.multimesh
	mm.instance_count = marks.size()
	for i in range(marks.size()):
		var c: Vector2 = marks[i][0]
		mm.set_instance_transform(i, Transform3D(Basis(), _ground(c, 0.25)))
		mm.set_instance_color(i, OK_COLOR if marks[i][1] else BAD_COLOR)


func _show_rect(a: Vector2, b: Vector2) -> void:
	var lo = Vector2(floor(minf(a.x, b.x) / 4.0) * 4.0, floor(minf(a.y, b.y) / 4.0) * 4.0)
	var hi = Vector2(floor(maxf(a.x, b.x) / 4.0) * 4.0 + 4.0, floor(maxf(a.y, b.y) / 4.0) * 4.0 + 4.0)
	var plane = rect_mesh.mesh as PlaneMesh
	plane.size = hi - lo
	rect_mesh.visible = true
	var centre = (lo + hi) * 0.5
	rect_mesh.position = _ground(centre, 0.15)
	var col = {"harvest": Color(0.35, 0.85, 0.4, 0.3), "forbid": Color(0.95, 0.3, 0.2, 0.35), "erase": Color(0.85, 0.85, 0.85, 0.3)}[tool]
	rect_mesh.material_override = _flat_material(col)


## Player's zones from colonies[player].colony.zones, rebuilt when they change.
func update_zone_overlay() -> void:
	var colonies = world_view.last_snapshot.get("colonies", [])
	var idx = int(observer.player_colony)
	var zones = {}
	if typeof(colonies) == TYPE_ARRAY and idx < colonies.size() and typeof(colonies[idx]) == TYPE_DICTIONARY:
		var c = colonies[idx].get("colony", {})
		if typeof(c) == TYPE_DICTIONARY and typeof(c.get("zones")) == TYPE_DICTIONARY:
			zones = c.zones
	var harvest: Array = zones.get("harvest", [])
	var forbid: Array = zones.get("forbid", [])
	var version = "%s:%d:%d:%d" % [str(zones.get("version", "")), idx, harvest.size(), forbid.size()]
	if version == zone_version:
		return
	zone_version = version
	var surface = _surface()
	var mm = zone_overlay.multimesh
	mm.instance_count = harvest.size() + forbid.size()
	var i = 0
	for list in [[harvest, Color(0.4, 0.85, 0.35, 0.22)], [forbid, Color(0.95, 0.3, 0.2, 0.28)]]:
		for cell in list[0]:
			var c = BuildRules.cell_center(surface, int(cell), BuildRules.ZONE_CELL_SIZE)
			mm.set_instance_transform(i, Transform3D(Basis(), _ground(c, 0.07)))
			mm.set_instance_color(i, list[1])
			i += 1


## Returns true when the event belongs to the active tool.
func handle_input(event: InputEvent, ground_point: Callable) -> bool:
	if event is InputEventKey and event.pressed and not event.echo:
		for spec in TOOLS:
			if event.keycode == KEY_0 + int(spec[2]):
				set_tool("" if tool == spec[0] else spec[0])
				return true
		if tool == "":
			return false
		if event.keycode == KEY_ESCAPE:
			set_tool("")
			return true
		if event.keycode == KEY_R and tool == "gate":
			gate_axis = "vertical" if gate_axis == "horizontal" else "horizontal"
			return true
		return false
	if tool == "" or not (event is InputEventMouseButton):
		return false
	if event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		set_tool("")
		return true
	if event.button_index != MOUSE_BUTTON_LEFT:
		return false
	var p: Vector2 = ground_point.call(event.position)
	if p == Vector2.INF:
		return true
	if tool in ["hut", "storage", "workshop", "idol", "gate", "post"]:
		if event.pressed:
			_place_point(p, event.shift_pressed)
		return true
	if event.pressed:
		drag_start = p
	elif drag_start != Vector2.INF:
		_commit_drag(drag_start, p)
		drag_start = Vector2.INF
	return true


func _place_point(p: Vector2, keep_tool: bool) -> void:
	var surface = _surface()
	var colony = int(observer.player_colony)
	if tool == "post":
		if BuildRules.post_placement(surface, _owner(), p) != "":
			return
		ws_client.send_command({"type": "setDefensePost", "x": p.x, "y": p.y, "colony": colony})
		set_tool("")
		return
	if tool == "gate":
		if BuildRules.gate_placement(surface, _owner(), p, gate_axis) != "":
			return
		var snapped = BuildRules.snap_fence_position(p)
		ws_client.send_command({"type": "placeGate", "x": snapped.x, "y": snapped.y, "axis": gate_axis, "colony": colony})
	else:
		if BuildRules.point_building_placement(surface, _owner(), tool, p) != "":
			return
		ws_client.send_command({"type": "placeBuilding", "building": tool, "x": p.x, "y": p.y, "colony": colony})
	if not keep_tool:
		set_tool("")


func _send_chunked(type: String, cells: Array, extra: Dictionary, chunk: int) -> void:
	for start in range(0, cells.size(), chunk):
		var cmd = {"type": type, "cells": cells.slice(start, start + chunk), "colony": int(observer.player_colony)}
		cmd.merge(extra)
		ws_client.send_command(cmd)


func _commit_drag(a: Vector2, b: Vector2) -> void:
	var surface = _surface()
	match tool:
		"wall":
			var owner = _owner()
			var dry = BuildRules.wall_line_cells(surface, a, b).filter(func(idx): return BuildRules.fence_placement(surface, owner, BuildRules.cell_center(surface, idx, BuildRules.WALL_CELL_SIZE)) == "")
			if not dry.is_empty():
				_send_chunked("paintWall", dry, {}, 500)
		"harvest", "forbid":
			_send_chunked("paintZone", BuildRules.rect_cells(surface, a, b, BuildRules.ZONE_CELL_SIZE), {"zone": tool}, 4000)
		"erase":
			_send_chunked("eraseZone", BuildRules.rect_cells(surface, a, b, BuildRules.ZONE_CELL_SIZE), {}, 4000)
			_send_chunked("eraseBuild", BuildRules.rect_cells(surface, a, b, BuildRules.WALL_CELL_SIZE), {}, 500)
