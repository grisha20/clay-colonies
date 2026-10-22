extends SceneTree

## The mother's head over the map: silent on the first snapshot (no replay of
## old advice), speaks each new line once (typed out, `spoke` emitted), pages
## through lines, "где" sends the place, hides the bubble when she has nothing
## to say, and finds no voice file when none is recorded.
var failures := 0

func _initialize() -> void:
	call_deferred("run")

func check(name: String, ok: bool, detail: String = "") -> void:
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])
	if not ok:
		failures += 1

func snap(advice: Array) -> Dictionary:
	return {"colonies": [{"colony": {"advice": advice}}]}

func run() -> void:
	var m = MotherSpeaker.new()
	root.add_child(m)
	await process_frame
	var said: Array = []
	m.spoke.connect(func(k, t): said.append(k))
	var places: Array = []
	m.show_requested.connect(func(p): places.append(p))
	var huts = {"key": "huts", "severity": "warn", "text": "Хижин мало", "pos": {"x": 10, "y": 20}}
	var spider = {"key": "spider", "severity": "danger", "text": "Паук у костра!"}
	m.update_from_snapshot(snap([huts]), 0)
	check("first_snapshot_silent", said.is_empty() and m.bubble.visible and m.text_label.text == "Хижин мало")
	m.update_from_snapshot(snap([huts, spider]), 0)
	check("new_line_spoken_once", said == ["spider"] and m.text_label.text == "Паук у костра!", str(said))
	check("typed_out", m.text_label.visible_ratio < 0.5 and m.talk_left > 0.0)
	check("danger_border", m.bubble_style.border_color == MotherSpeaker.SEVERITY_BORDER.danger)
	check("no_where_without_place", not m.where_button.visible)
	m.update_from_snapshot(snap([huts, spider, {"key": "x"}]), 0)
	m.update_from_snapshot(snap([huts, spider]), 0)
	check("not_repeated", said.count("spider") == 1, str(said))
	check("gone_line_falls_back_to_first", m.text_label.text == "Хижин мало" and m.count_label.text == "1/2", m.count_label.text)
	m._page(1)
	check("paging", m.text_label.text == "Паук у костра!" and m.count_label.text == "2/2", m.count_label.text)
	m._page(1)
	check("paging_wraps", m.text_label.text == "Хижин мало" and m.count_label.text == "1/2", m.count_label.text)
	m._show_where()
	check("where_sends_place", places.size() == 1 and places[0] == Vector2(10, 20))
	for i in range(60):
		m._process(0.05)
	check("finishes_talking", m.talk_left <= 0.0 and is_equal_approx(m.text_label.visible_ratio, 1.0))
	m.update_from_snapshot(snap([]), 0)
	check("silent_without_advice", not m.bubble.visible)
	check("no_voice_file", MotherSpeaker.voice_stream("huts") == null)
	m.queue_free()
	await process_frame
	print("MOTHER_SPEAKER_FAILURES=%d" % failures)
	quit(1 if failures > 0 else 0)
