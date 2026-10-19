class_name CampfireLight
extends OmniLight3D

## Subtle animated flicker for campfire light in laboratory scene.

@export var base_energy: float = 2.4
@export var flicker_intensity: float = 0.4
@export var flicker_speed: float = 12.0

var time: float = 0.0

func _process(delta: float) -> void:
	if not visible:
		return
	time += delta * flicker_speed
	var noise = sin(time) * 0.5 + sin(time * 2.3) * 0.3 + sin(time * 4.7) * 0.2
	light_energy = base_energy + noise * flicker_intensity
