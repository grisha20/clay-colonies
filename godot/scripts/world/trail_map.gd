class_name TrailMap
extends RefCounted

## Worn-path memory of the meadow. Resident footfalls press the grass a little;
## frequently used routes become visible dirt trails, unused ones slowly regrow.
## Purely visual: the server never reads it and it is not saved.

const CELL: float = 2.0
const STAMP: int = 4
const SIDE_STAMP: int = 2
const DECAY_ROWS_PER_UPDATE: int = 4

var width: int
var height: int
var data: PackedByteArray
var image: Image
var texture: ImageTexture
var decay_row: int = 0
var dirty: bool = false
var last_cells: Dictionary = {}


func _init(map_width: float = 480.0, map_height: float = 480.0) -> void:
	width = int(ceil(map_width / CELL))
	height = int(ceil(map_height / CELL))
	data = PackedByteArray()
	data.resize(width * height)
	data.fill(0)
	image = Image.create_from_data(width, height, false, Image.FORMAT_L8, data)
	texture = ImageTexture.create_from_image(image)


func _add(cx: int, cy: int, amount: int) -> void:
	if cx < 0 or cy < 0 or cx >= width or cy >= height:
		return
	var i = cy * width + cx
	data[i] = mini(255, data[i] + amount)


## Records one observed resident position. Standing still does not wear a path:
## only entering a new cell stamps the ground.
func stamp(id: String, x: float, y: float) -> void:
	var cx = int(floor(x / CELL))
	var cy = int(floor(y / CELL))
	var key = Vector2i(cx, cy)
	if last_cells.get(id, Vector2i(-1, -1)) == key:
		return
	last_cells[id] = key
	_add(cx, cy, STAMP)
	_add(cx + 1, cy, SIDE_STAMP)
	_add(cx - 1, cy, SIDE_STAMP)
	_add(cx, cy + 1, SIDE_STAMP)
	_add(cx, cy - 1, SIDE_STAMP)
	dirty = true


func forget_missing(alive: Dictionary) -> void:
	for id in last_cells.keys():
		if not alive.has(id):
			last_cells.erase(id)


## Regrows a band of rows by one step; the whole map cycles every
## height / DECAY_ROWS_PER_UPDATE updates.
func decay() -> void:
	var start = decay_row * width
	var stop = mini(height, decay_row + DECAY_ROWS_PER_UPDATE) * width
	for i in range(start, stop):
		if data[i] > 0:
			data[i] -= 1
			dirty = true
	decay_row += DECAY_ROWS_PER_UPDATE
	if decay_row >= height:
		decay_row = 0


func upload() -> void:
	if not dirty:
		return
	dirty = false
	image.set_data(width, height, false, Image.FORMAT_L8, data)
	texture.update(image)


func value_at(x: float, y: float) -> int:
	var cx = int(floor(x / CELL))
	var cy = int(floor(y / CELL))
	if cx < 0 or cy < 0 or cx >= width or cy >= height:
		return 0
	return data[cy * width + cx]
