class_name FramePerf
extends RefCounted

## Cheap per-section timers for the client: where a long frame went
## (packet decode, registry, world view, HUD panels, tooltip...). Totals and
## maxima since start plus the sections of the current frame, which a probe
## (tests/visual/probe_hitches.gd) reads and clears every frame.

static var totals: Dictionary = {}   # name -> [sum_ms, max_ms, count]
static var frame: Dictionary = {}    # name -> ms in the current frame


static func add(name: String, start_usec: int) -> void:
	var ms = float(Time.get_ticks_usec() - start_usec) / 1000.0
	var t: Array = totals.get(name, [0.0, 0.0, 0])
	t[0] += ms
	t[1] = maxf(t[1], ms)
	t[2] += 1
	totals[name] = t
	frame[name] = float(frame.get(name, 0.0)) + ms


static func take_frame() -> Dictionary:
	var f = frame
	frame = {}
	return f


static func report() -> String:
	var names = totals.keys()
	names.sort_custom(func(a, b): return totals[a][1] > totals[b][1])
	var lines: PackedStringArray = []
	for n in names:
		var t = totals[n]
		lines.append("%s avg=%.2fms max=%.2fms n=%d" % [n, t[0] / maxf(1.0, t[2]), t[1], t[2]])
	return "\n".join(lines)
