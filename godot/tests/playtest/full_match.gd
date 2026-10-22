extends SceneTree

## Automated playtest of one full match through the production Godot client
## against an isolated QA server. A simple "player" uses the same tools a human
## has (build tools, work priorities, defence post, alarm) and plays tribe A to
## the end; everything notable goes to a log (JSON lines) and screenshots.
##   godot --path godot --script res://tests/playtest/full_match.gd -- --server-port 8799 --out <dir> [--speed 20]

var scene: WorldObserver
var out := "user://playtest"
var log_file: FileAccess
var speed := 20
var seen_events: Dictionary = {}
var shots_taken: Dictionary = {}
var start_real := 0
var frame_deltas: Array[float] = []
var last_frame_us := 0
var decisions: Array[String] = []
var stuck_samples: Dictionary = {}

func _initialize() -> void:
	call_deferred("run")

func frames(n: int) -> void:
	for i in range(n):
		await process_frame
		_track_frame()

func _track_frame() -> void:
	var now = Time.get_ticks_usec()
	if last_frame_us > 0:
		frame_deltas.append(float(now - last_frame_us) / 1000.0)
	last_frame_us = now

func write(kind: String, data: Dictionary) -> void:
	data["kind"] = kind
	data["tick"] = int(snap().get("tick", 0))
	data["real_s"] = int((Time.get_ticks_msec() - start_real) / 1000)
	log_file.store_line(JSON.stringify(data))
	log_file.flush()
	print("PLAYTEST ", JSON.stringify(data))

func snap() -> Dictionary:
	return scene.world_view.last_snapshot if scene else {}

func colony(i: int = 0) -> Dictionary:
	var cs = snap().get("colonies", [])
	return cs[i].get("colony", {}) if typeof(cs) == TYPE_ARRAY and i < cs.size() else {}

func surface() -> Dictionary:
	return snap().get("surface", {})

func own(type: String, built_only := false) -> Array:
	return surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-1" and b.type == type and (not built_only or b.stage == "built"))

func pop(colony_id := "colony-1") -> int:
	return snap().get("ants", []).filter(func(a): return a.colonyId == colony_id).size()

func shot(name: String) -> void:
	if shots_taken.has(name):
		return
	shots_taken[name] = true
	await frames(20)
	root.get_viewport().get_texture().get_image().save_png(out.path_join("%s.png" % name))
	write("shot", {"name": name})

func decide(text: String) -> void:
	decisions.append(text)
	write("decision", {"text": text})

func camp() -> Vector2:
	var e = surface().get("entrances", [{"x": 120, "y": 240}])[0]
	return Vector2(float(e.x), float(e.y))

## A free spot for a point building near camp, preferring the side away from map edges.
func spot_for(type: String, radius_min := 14.0, radius_max := 40.0) -> Vector2:
	var c = camp()
	for r in range(int(radius_min), int(radius_max), 2):
		for k in range(24):
			var p = c + Vector2(cos(k * TAU / 24.0), sin(k * TAU / 24.0)) * r
			if BuildRules.point_building_placement(surface(), "colony-1", type, p) == "":
				return p
	return Vector2.INF

func place(type: String) -> bool:
	var p = spot_for(type)
	if p == Vector2.INF:
		write("problem", {"text": "no place for %s near camp" % type})
		return false
	scene.build.set_tool(type)
	scene.build._place_point(p, false)
	decide("place %s at %d,%d" % [type, int(p.x), int(p.y)])
	return true

func pending_sites() -> int:
	return surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-1" and b.stage != "built").size()

func springs() -> Array:
	return surface().get("springs", [])

func held_springs(owner := "colony-1") -> int:
	return springs().filter(func(sp): return str(sp.get("holder", "")) == owner).size()

## A free spot for kind at distance radii from c toward ang (± turns).
func spot_toward(kind: String, c: Vector2, ang: float, radii: Array) -> Vector2:
	for r in radii:
		for turn in [0.0, 0.2, -0.2, 0.4, -0.4, 0.7, -0.7, 1.0, -1.0, 1.4, -1.4]:
			var q = c + Vector2(cos(ang + turn), sin(ang + turn)) * float(r)
			var reason = BuildRules.post_placement(surface(), "colony-1", q) if kind == "post" else BuildRules.point_building_placement(surface(), "colony-1", kind, q)
			if reason == "":
				return q
	return Vector2.INF

func place_at(type: String, p: Vector2, why: String) -> bool:
	if p == Vector2.INF:
		return false
	scene.build.set_tool(type)
	scene.build._place_point(p, false)
	scene.build.set_tool("")
	decide("place %s at %d,%d (%s)" % [type, int(p.x), int(p.y), why])
	return true

## Next spring to reach: the nearest one not ours (free first).
func target_spring() -> Dictionary:
	var best: Dictionary = {}
	var best_d = INF
	for sp in springs():
		if str(sp.get("holder", "")) == "colony-1":
			continue
		var d = Vector2(float(sp.pos.x), float(sp.pos.y)).distance_to(camp()) + (200.0 if str(sp.get("holder", "")) != "" else 0.0)
		if d < best_d:
			best_d = d
			best = sp
	return best

## Step the land toward a spring: a totem near the edge of our disc closest to it.
func totem_toward(sp: Dictionary) -> bool:
	var target = Vector2(float(sp.pos.x), float(sp.pos.y))
	var discs = BuildRules.territory_discs(surface()).filter(func(d): return str(d.owner) == "colony-1")
	if discs.is_empty():
		return false
	discs.sort_custom(func(a, b): return Vector2(a.x, a.y).distance_to(target) - float(a.r) < Vector2(b.x, b.y).distance_to(target) - float(b.r))
	var from = Vector2(float(discs[0].x), float(discs[0].y))
	return place_at("totem", spot_toward("totem", from, (target - from).angle(), [float(discs[0].r) - 5, float(discs[0].r) - 9, float(discs[0].r) - 13]), "toward spring %s" % str(sp.id))

var defending := ""
var besieging := ""

func defend(c: Dictionary) -> void:
	# A totem of ours losing strength: post by it, more guards (hands on), then back to the mother.
	var hurt = own("totem", true).filter(func(t): return float(t.hp) < float(t.maxHp) - 1.0)
	var war = colony(1).get("war")
	if not hurt.is_empty() and defending == "" and war != null:
		var t = hurt[0]
		var tp = Vector2(float(t.pos.x), float(t.pos.y))
		var post = spot_toward("post", tp, (camp() - tp).angle(), [3.0, 4.0])
		if post != Vector2.INF:
			scene.ws_client.send_command({"type": "setDefensePost", "x": post.x, "y": post.y, "colony": 0})
			var pr = c.get("priorities", {}).duplicate()
			pr["guard"] = maxi(int(pr.get("guard", 0)), int(pop() / 3))
			scene.priority_panel.priorities_requested.emit(pr)
			defending = str(t.id)
			decide("DEFEND totem %s: post next to it, guards %d" % [defending, int(pr.guard)])
	elif defending != "" and war == null:
		var home = camp() + (Vector2(240, 240) - camp()).normalized() * 14.0
		scene.ws_client.send_command({"type": "setDefensePost", "x": home.x, "y": home.y, "colony": 0})
		scene.priority_panel.auto_manage_requested.emit(true)
		decide("war over (%s): post home, work back to the mother" % defending)
		defending = ""

func besiege() -> void:
	# The neighbours hold two springs: besiege their totem by one of them.
	var dom = snap().get("session", {}).get("dominance")
	var rival_dom = typeof(dom) == TYPE_DICTIONARY and str(dom.get("holder", "")) == "colony-2"
	if rival_dom and besieging == "" and defending == "":
		var theirs = surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-2" and b.type == "totem" and b.stage == "built")
		var best: Dictionary = {}
		var best_d = INF
		for t in theirs:
			for sp in springs():
				if str(sp.get("holder", "")) != "colony-2":
					continue
				var d = Vector2(float(t.pos.x), float(t.pos.y)).distance_to(Vector2(float(sp.pos.x), float(sp.pos.y)))
				if d < best_d:
					best_d = d
					best = t
		if not best.is_empty():
			var tp = Vector2(float(best.pos.x), float(best.pos.y))
			var post = spot_toward("post", tp, (camp() - tp).angle(), [2.5, 3.5, 4.5])
			if post != Vector2.INF:
				scene.ws_client.send_command({"type": "setDefensePost", "x": post.x, "y": post.y, "colony": 0})
				var pr = colony().get("priorities", {}).duplicate()
				pr["guard"] = maxi(int(pr.get("guard", 0)), int(pop() / 3))
				scene.priority_panel.priorities_requested.emit(pr)
				besieging = str(best.id)
				decide("BESIEGE rival totem %s (they hold two springs)" % besieging)
	elif besieging != "":
		var still = surface().get("buildings", []).any(func(b): return str(b.id) == besieging)
		if not still or not rival_dom:
			var home = camp() + (Vector2(240, 240) - camp()).normalized() * 14.0
			scene.ws_client.send_command({"type": "setDefensePost", "x": home.x, "y": home.y, "colony": 0})
			scene.priority_panel.auto_manage_requested.emit(true)
			decide("siege over (%s %s): post home, work back to the mother" % [besieging, "fell" if not still else "no longer needed"])
			besieging = ""

func policy() -> void:
	var c = colony()
	var clay = float(c.get("clay", 0))
	var wood = float(c.get("wood", 0))
	var stone = float(c.get("stone", 0))
	defend(c)
	besiege()
	var huts = own("hut").size()
	if pending_sites() == 0:
		var sp = target_spring()
		if own("workshop").is_empty() and wood >= 4:
			place("workshop")
		elif huts < 3 and clay >= 8 and wood >= 5:
			place("hut")
		elif not own("workshop", true).is_empty() and own("kiln").is_empty() and clay >= 10 and stone >= 6:
			place("kiln")
		elif not sp.is_empty() and own("totem").size() < 6 and clay >= 14 and wood >= 8 and stone >= 4 and (held_springs() == 0 or (held_springs() < 2 and int(snap().get("tick", 0)) > 15000)):
			totem_toward(sp)
		elif held_springs() >= 1 and own("idol").is_empty() and clay >= 25 and stone >= 5:
			place("idol")
		elif own("storage").size() < 1 and wood >= 6 and stone >= 4:
			place("storage")
		elif huts < 8 and huts < 3 + int(pop() / 6) and clay >= 8 and wood >= 5:
			place("hut")
		elif held_springs() >= 1 and own("storage").size() < 2 and wood >= 6 and stone >= 4 and not own("totem", true).is_empty():
			# A storage by the frontier totem feeds guards at a far post.
			var t = own("totem", true)[-1]
			place_at("storage", spot_toward("storage", Vector2(float(t.pos.x), float(t.pos.y)), (camp() - Vector2(float(t.pos.x), float(t.pos.y))).angle(), [10, 14, 18]), "frontier storage")
	# Houses of the clan once the huts are maxed (keep special clay for the ritual too).
	if own("hut", true).size() >= 8 and float(c.get("specialClay", 0)) >= 20 and clay >= 12 and wood >= 6:
		var small = own("hut", true).filter(func(h): return int(h.get("level", 1)) < 2)
		if not small.is_empty():
			var hp = Vector2(float(small[0].pos.x), float(small[0].pos.y))
			scene.build.set_tool("house")
			scene.build._place_point(hp, false)
			scene.build.set_tool("")
			decide("upgrade hut %s to a house of the clan" % str(small[0].id))
	# Defence post on the camp side facing the map centre (once).
	if not shots_taken.has("post_set"):
		var toward = (Vector2(240, 240) - camp()).normalized()
		var p = camp() + toward * 14.0
		if BuildRules.post_placement(surface(), "colony-1", p) == "":
			scene.ws_client.send_command({"type": "setDefensePost", "x": p.x, "y": p.y, "colony": 0})
			shots_taken["post_set"] = true
			decide("defence post toward centre")

func record_state() -> void:
	var c = colony()
	var c2 = colony(1)
	var s = snap().get("session", {})
	var objectives = snap().get("objectives", []).map(func(o): return "%s%s %d/%d" % ["✓" if o.done else "", o.text, int(o.progress), int(o.target)])
	var motion: Dictionary = {}
	for a in snap().get("ants", []):
		if a.colonyId != "colony-1":
			continue
		var tm = a.get("taskMotion")
		if typeof(tm) == TYPE_DICTIONARY:
			motion[tm.state] = int(motion.get(tm.state, 0)) + 1
	write("state", {
		"pop_a": pop(), "pop_b": pop("colony-2"),
		"clay": int(c.get("clay", 0)), "wood": int(c.get("wood", 0)), "stone": int(c.get("stone", 0)), "food": int(c.get("food", 0)),
		"fire": snappedf(float(c.get("fire", 0)), 0.01), "axes": int(c.get("axes", 0)), "picks": int(c.get("picks", 0)),
		"huts": own("hut", true).size(), "sites": pending_sites(), "workshop": own("workshop", true).size(), "idol": own("idol", true).size(),
		"b_buildings": surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-2" and b.stage == "built").size(),
		"weather": str(snap().get("weather", {}).get("state", "")), "raid": str(s.get("raid", {}).get("phase", "")),
		"idol_progress": int(s.get("idolProgress", 0)), "enemies": snap().get("enemies", []).size(),
		"special": int(c.get("specialClay", 0)), "special_b": int(c2.get("specialClay", 0)),
		"springs": springs().map(func(sp): return str(sp.get("holder", "-"))),
		"totems_a": own("totem", true).size(), "totems_b": surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-2" and b.type == "totem" and b.stage == "built").size(),
		"kiln": own("kiln", true).size(), "fired_a": int(c.get("firedTotal", 0)), "fired_b": int(c2.get("firedTotal", 0)),
		"houses_a": own("hut", true).filter(func(h): return int(h.get("level", 1)) >= 2).size(),
		"houses_b": surface().get("buildings", []).filter(func(b): return b.colonyId == "colony-2" and b.type == "hut" and int(b.get("level", 1)) >= 2).size(),
		"cap_a": int(c.get("nestCapacity", 0)),
		"deaths_a": c.get("deaths", {}), "deaths_b": c2.get("deaths", {}),
		"dominance": s.get("dominance"), "finale": s.get("finaleScores"), "war_b": c2.get("war"), "auto": bool(c.get("autoManage", false)),
		"advice": c.get("advice", []).map(func(a): return str(a.key)),
		"motion": motion, "objectives": objectives, "status": str(s.get("status", "")),
	})

func record_events() -> void:
	for e in snap().get("session", {}).get("events", []):
		var key = "%d|%s" % [int(e.get("tick", 0)), str(e.get("text", ""))]
		if not seen_events.has(key):
			seen_events[key] = true
			write("event", {"text": str(e.get("text", "")), "at": int(e.get("tick", 0))})

func frame_report(label: String) -> void:
	if frame_deltas.is_empty():
		return
	var d = frame_deltas.duplicate()
	d.sort()
	var avg = d.reduce(func(a, b): return a + b, 0.0) / d.size()
	write("frames", {"label": label, "avg_ms": snappedf(avg, 0.01), "p99_ms": snappedf(d[int(d.size() * 0.99)], 0.01), "max_ms": snappedf(d[-1], 0.01), "over50": d.filter(func(x): return x > 50.0).size(), "count": d.size()})
	frame_deltas.clear()

func run() -> void:
	var port = ""
	var args = OS.get_cmdline_user_args()
	for i in range(args.size()):
		if args[i] == "--server-port" and i + 1 < args.size():
			port = args[i + 1]
		elif args[i] == "--out" and i + 1 < args.size():
			out = args[i + 1]
		elif args[i] == "--speed" and i + 1 < args.size():
			speed = int(args[i + 1])
	DirAccess.make_dir_recursive_absolute(out)
	log_file = FileAccess.open(out.path_join("playtest.jsonl"), FileAccess.WRITE)
	start_real = Time.get_ticks_msec()
	scene = load("res://scenes/game/world_observer.tscn").instantiate() as WorldObserver
	root.add_child(scene)
	await process_frame
	scene.ws_client.connect_to_server("ws://127.0.0.1:" + port)
	while scene.entity_registry.residents.is_empty():
		await frames(1)
	var terrain = surface().get("terrain", {})
	write("start", {"seed": int(terrain.get("seed", 0)), "lakes": terrain.get("lakes", []).size(), "mountains": terrain.get("mountains", []).size(), "camp_a": [camp().x, camp().y]})
	scene.world_view.focus_on_colony(0)
	scene.world_view.target_camera_distance = 40.0
	await shot("t000_start")
	scene.ws_client.send_command({"type": "setSpeed", "value": speed})
	var last_state_tick = -99999
	var last_policy_tick = -99999
	var last_frames_tick = 0
	var camera_mode = 0
	while true:
		await frames(1)
		var tick = int(snap().get("tick", 0))
		var status = str(snap().get("session", {}).get("status", "playing"))
		record_events()
		if tick - last_policy_tick >= 300:
			last_policy_tick = tick
			policy()
		if tick - last_state_tick >= 3000:
			last_state_tick = tick
			record_state()
			# Wander the camera between camp, the work sites and the overview.
			camera_mode = (camera_mode + 1) % 3
			if camera_mode == 0:
				scene.world_view.focus_on_colony(0)
				scene.world_view.target_camera_distance = 30.0
			elif camera_mode == 1:
				scene.world_view.focus_on_colony(1)
				scene.world_view.target_camera_distance = 30.0
			else:
				scene.world_view.camera_pivot.position = Vector3(240, 0, 240)
				scene.world_view.target_camera_distance = 80.0
		if tick - last_frames_tick >= 12000:
			last_frames_tick = tick
			frame_report("to_tick_%d" % tick)
		# Milestone screenshots.
		var c = colony()
		if own("hut", true).size() >= 3:
			scene.world_view.focus_on_colony(0)
			await shot("m1_first_new_hut")
		var burning = own("kiln", true).filter(func(k): return typeof(k.get("firing")) == TYPE_DICTIONARY and bool(k.firing.get("paid", false)))
		if not burning.is_empty():
			scene.world_view.camera_pivot.position = Vector3(float(burning[0].pos.x), 0, float(burning[0].pos.y))
			scene.world_view.target_camera_distance = 14.0
			await shot("m6_kiln")
		if held_springs() >= 1:
			var sp = springs().filter(func(x): return str(x.get("holder", "")) == "colony-1")[0]
			scene.world_view.camera_pivot.position = Vector3(float(sp.pos.x), 0, float(sp.pos.y))
			scene.world_view.target_camera_distance = 40.0
			await shot("m7_spring_held")
		if defending != "":
			var dt = own("totem", true).filter(func(t): return str(t.id) == defending)
			if not dt.is_empty():
				scene.world_view.camera_pivot.position = Vector3(float(dt[0].pos.x), 0, float(dt[0].pos.y))
				scene.world_view.target_camera_distance = 20.0
				await shot("m8_siege_defence")
		if bool(snap().get("weather", {}).get("bigRainActive", false)) and int(snap().get("tick", 0)) > 50000:
			scene.world_view.focus_on_colony(0)
			scene.world_view.target_camera_distance = 40.0
			await shot("m9_great_rain")
		if scene.world_view.atmosphere.darkness > 0.95:
			await shot("m2_first_night")
		if str(snap().get("weather", {}).get("state", "")) == "rain":
			await shot("m3_first_rain")
		if str(snap().get("session", {}).get("raid", {}).get("phase", "")) == "attack":
			scene.world_view.focus_on_colony(0)
			scene.world_view.target_camera_distance = 30.0
			await shot("m4_raid")
		if not own("idol", true).is_empty():
			await shot("m5_idol")
		if status != "playing":
			record_state()
			scene.world_view.focus_on_colony(0)
			scene.world_view.target_camera_distance = 34.0
			await shot("z_end")
			write("end", {"status": status, "reason": str(snap().get("session", {}).get("reason", "")), "stats": snap().get("session", {}).get("stats", {})})
			break
		if Time.get_ticks_msec() - start_real > 60 * 60 * 1000:
			write("end", {"status": "timeout", "reason": "60 real minutes"})
			break
	frame_report("final")
	scene.ws_client.send_command({"type": "setSpeed", "value": 1})
	await frames(5)
	scene.ws_client.disconnect_from_server()
	await frames(2)
	log_file.close()
	quit(0)
