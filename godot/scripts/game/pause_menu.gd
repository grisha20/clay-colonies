class_name PauseMenu
extends Control

## In-game menu on Esc: continue, save, load, main menu, quit. Only emits
## intents; WorldObserver pauses the match while it is open.

signal continue_requested
signal save_requested
signal load_requested
signal main_menu_requested
signal quit_requested

var status_label: Label
var buttons: Dictionary = {}


func _ready() -> void:
	name = "PauseMenu"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	theme = GameHud.ink_theme()
	var dim = ColorRect.new()
	dim.color = Color(0.08, 0.06, 0.04, 0.5)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)
	var center = CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)
	var panel = PanelContainer.new()
	panel.custom_minimum_size = Vector2(340, 0)
	var sb = HudArt.box("menu_panel", [30, 24, 30, 24])
	panel.add_theme_stylebox_override("panel", sb if sb else GameHud.panel_style())
	center.add_child(panel)
	var box = VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	var logo = HudArt.tex("logo_clayfolk")
	if logo:
		var pic = GameHud.icon_rect(logo, 0)
		pic.custom_minimum_size = Vector2(240, 90)
		box.add_child(pic)
	var title = Label.new()
	title.text = "Пауза"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 20)
	box.add_child(title)
	for spec in [["continue", "Продолжить", continue_requested], ["save", "Сохранить", save_requested], ["load", "Загрузить", load_requested], ["menu", "Выйти в главное меню", main_menu_requested], ["quit", "Выйти из игры", quit_requested]]:
		var b = Button.new()
		b.name = "Pause_" + spec[0]
		b.text = spec[1]
		b.custom_minimum_size = Vector2(0, 44)
		b.add_theme_font_size_override("font_size", 18)
		b.focus_mode = Control.FOCUS_NONE
		var sig: Signal = spec[2]
		b.pressed.connect(func(): sig.emit())
		box.add_child(b)
		buttons[spec[0]] = b
	status_label = Label.new()
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.add_theme_font_size_override("font_size", 14)
	box.add_child(status_label)
	visible = false


func open() -> void:
	status_label.text = "Игра на паузе"
	visible = true


func close() -> void:
	visible = false
