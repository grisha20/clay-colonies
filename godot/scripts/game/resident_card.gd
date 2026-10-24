class_name ResidentCard
extends PanelContainer

## Presentation only. Energy/wetness come from the selected snapshot record;
## occupation/cargo follow the displayed actor, as the legacy inspector does.
const ENERGY_MAX := 900.0 # server/src/config.ts maxEnergy
const WATER_MAX := 120.0 # waterExposureDeathTicks; never a server command
const RESOURCE_NAMES = {"clay":"глину","wood":"дерево","stone":"камень","water":"воду","food":"еду","berries":"ягоды","fish":"рыбу","meat":"мясо"}

var inspector_label: Label
var follow_button: Button
var clear_selection_button: Button
var next_button: Button
var name_label: Label
var tribe_label: Label
var activity_icon: TextureRect
var activity_label: Label
var clay_icon: TextureRect
var clay_label: Label
var cargo_row: HBoxContainer
var cargo_icon: TextureRect
var cargo_label: Label
var energy_bar: ProgressBar
var energy_label: Label
var wet_box: VBoxContainer
var wet_bar: ProgressBar
var wet_label: Label
var portrait: TextureRect
var portrait_viewport: SubViewport
var portrait_model: Node3D
var portrait_mesh: MeshInstance3D
var appearance_key := ""
var display_signature := ""

func _ready() -> void:
	name="ResidentInspector"
	theme=GameHud.ink_theme()
	add_theme_stylebox_override("panel",GameHud.parchment([18,16,18,16]))
	custom_minimum_size=Vector2(424,0)
	mouse_filter=Control.MOUSE_FILTER_STOP
	mouse_force_pass_scroll_events=false
	var box=VBoxContainer.new()
	box.add_theme_constant_override("separation",8)
	add_child(box)
	var top=HBoxContainer.new()
	top.add_theme_constant_override("separation",14)
	box.add_child(top)
	_build_portrait(top)
	var info=VBoxContainer.new()
	info.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	info.add_theme_constant_override("separation",4)
	top.add_child(info)
	name_label=_label("",22);name_label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;name_label.custom_minimum_size.x=220
	GameHud.bold(name_label);info.add_child(name_label)
	tribe_label=_label("",15);tribe_label.add_theme_color_override("font_color",GameHud.INK.lightened(.22));info.add_child(tribe_label)
	var action=_icon_line(info,32)
	activity_icon=action[0];activity_label=action[1]
	activity_label.add_theme_font_size_override("font_size",17)
	activity_label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	activity_label.custom_minimum_size.x=220
	var clay=_icon_line(info,24)
	clay_icon=clay[0];clay_label=clay[1]
	cargo_row=HBoxContainer.new();cargo_row.add_theme_constant_override("separation",6);info.add_child(cargo_row)
	cargo_icon=GameHud.icon_rect(null,24);cargo_row.add_child(cargo_icon)
	cargo_label=_label("",15);cargo_row.add_child(cargo_label)
	energy_label=_label("Силы",14);GameHud.bold(energy_label);box.add_child(energy_label)
	energy_bar=_bar("ui_bar_fill_green");box.add_child(energy_bar)
	wet_box=VBoxContainer.new();wet_box.add_theme_constant_override("separation",4);box.add_child(wet_box)
	wet_label=_label("Промок",14);wet_box.add_child(wet_label)
	wet_bar=_bar("ui_bar_fill_blue");wet_box.add_child(wet_bar);wet_box.visible=false
	var actions=HBoxContainer.new();actions.add_theme_constant_override("separation",6);box.add_child(actions)
	follow_button=_action(actions,"glyph_follow","Следовать (F)")
	follow_button.toggle_mode=true
	next_button=_action(actions,"glyph_next_resident","Следующий житель")
	clear_selection_button=_action(actions,"glyph_deselect","Снять выбор (Esc)")
	var hint=_label("F — следовать\nEsc — снять выбор",12)
	hint.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	hint.horizontal_alignment=HORIZONTAL_ALIGNMENT_RIGHT
	actions.add_child(hint)
	inspector_label=Label.new();inspector_label.visible=false;box.add_child(inspector_label)
	visibility_changed.connect(func():
		portrait_viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS if is_visible_in_tree() else SubViewport.UPDATE_DISABLED)

func _label(text: String, font_size: int) -> Label:
	var label=Label.new();label.text=text;label.add_theme_font_size_override("font_size",font_size)
	return label

func _icon_line(parent: Control, size: int) -> Array:
	var line=HBoxContainer.new();line.add_theme_constant_override("separation",6);parent.add_child(line)
	var icon=GameHud.icon_rect(null,size);line.add_child(icon)
	var label=_label("",15);label.size_flags_horizontal=Control.SIZE_EXPAND_FILL;line.add_child(label)
	return [icon,label]

func _bar(fill: String) -> ProgressBar:
	var bar=ProgressBar.new();bar.show_percentage=false;bar.max_value=100;bar.custom_minimum_size.y=14
	GameHud.skin_bar(bar,fill)
	return bar

func _action(parent: Control, glyph: String, tip: String) -> Button:
	var button=Button.new();button.custom_minimum_size=Vector2(62,62);button.focus_mode=Control.FOCUS_NONE
	button.tooltip_text=tip;HudArt.glyph_button(button,glyph,28);parent.add_child(button)
	return button

func _build_portrait(parent: Control) -> void:
	var frame=PanelContainer.new();frame.name="ResidentPortraitFrame"
	frame.add_theme_stylebox_override("panel",HudArt.box("card_resident_portrait_frame",[8,8,8,8]))
	frame.custom_minimum_size=Vector2(128,148);parent.add_child(frame)
	portrait=GameHud.icon_rect(null,0);portrait.stretch_mode=TextureRect.STRETCH_SCALE;frame.add_child(portrait)
	portrait_viewport=SubViewport.new();portrait_viewport.name="ResidentPortraitViewport"
	portrait_viewport.size=Vector2i(336,396);portrait_viewport.own_world_3d=true;portrait_viewport.transparent_bg=true
	portrait_viewport.msaa_3d=Viewport.MSAA_4X
	portrait_viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	portrait.add_child(portrait_viewport);portrait.texture=portrait_viewport.get_texture()
	var env=WorldEnvironment.new();var environment=Environment.new()
	environment.background_mode=Environment.BG_CLEAR_COLOR
	environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color=Color(1,.9,.76);environment.ambient_light_energy=.65
	env.environment=environment;portrait_viewport.add_child(env)
	var light=DirectionalLight3D.new();light.rotation_degrees=Vector3(-30,-30,0);light.light_energy=1.2
	light.light_color=Color(1,.94,.85);portrait_viewport.add_child(light)
	portrait_model=load("res://assets/models/resident_v3.glb").instantiate()
	portrait_viewport.add_child(portrait_model)
	portrait_model.rotation.y=-.12
	portrait_mesh=portrait_model.find_child("Resident",true,false) as MeshInstance3D
	var animation=portrait_model.find_child("AnimationPlayer",true,false) as AnimationPlayer
	if animation and animation.has_animation("idle"):animation.play("idle");animation.speed_scale=.85
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=1.35
	portrait_viewport.add_child(camera)
	camera.position=Vector3(.12,1.22,3)
	camera.look_at(Vector3(0,1.12,0))

func update_resident(target: NetworkResident, snapshot: Dictionary, display_name: String, following: bool) -> void:
	var raw: Dictionary={}
	for ant in snapshot.get("ants",[]):
		if typeof(ant)==TYPE_DICTIONARY and str(ant.get("id",""))==target.ant_id:raw=ant;break
	var action=activity_for(target,raw,snapshot)
	var wet=float(raw.get("waterDamage",raw.get("waterExposure",0)))
	var energy=float(raw.get("energy",0))
	var signature=JSON.stringify([target.ant_id,target.colony_id,target.fired,target.kiln_called,target.warrior,target.job_name,target.carry_kind,target.carrying_amount,action,wet,energy,raw.has("energy"),following])
	follow_button.text="";follow_button.tooltip_text="Не следовать (F)" if following else "Следовать (F)"
	follow_button.button_pressed=following
	if signature==display_signature:return
	display_signature=signature
	name_label.text=display_name
	tribe_label.text="Племя %s%s" % ["A" if target.colony_id in ["colony-1","0"] else "B"," · воин" if target.warrior else (" · охотник" if target.job_name=="hunt" else "")]
	activity_icon.texture=HudArt.tex(action[0]);activity_label.text=action[1]
	var clay="firing" if target.kiln_called else ("fired" if target.fired else "raw")
	clay_icon.texture=HudArt.tex("resident_clay_"+clay)
	clay_label.text={"raw":"Сырой","fired":"Обожжён","firing":"Идёт на обжиг"}[clay]
	clay_label.tooltip_text={"raw":"сырая — боится дождя и воды","fired":"обожжён — дождь не страшен","firing":"идёт к печи на обжиг"}[clay]
	clay_icon.tooltip_text=clay_label.tooltip_text
	cargo_row.visible=target.carrying_amount>0
	cargo_icon.texture=HudArt.tex("res_"+{"food":"food","berries":"food","fruit":"food"}.get(target.carry_kind,target.carry_kind))
	cargo_label.text="%s · %d" % [RESOURCE_NAMES.get(target.carry_kind,"Груз"),target.carrying_amount]
	energy_bar.value=clampf(energy/ENERGY_MAX*100,0,100)
	energy_label.text="Силы · %d%%" % roundi(energy_bar.value) if raw.has("energy") else "Силы · нет данных"
	energy_bar.tooltip_text="%d из %d" % [roundi(energy),int(ENERGY_MAX)]
	wet_box.visible=wet>0
	var maximum=1.0 if raw.has("waterDamage") and wet<=1 else WATER_MAX
	wet_bar.value=clampf(wet/maximum*100,0,100);wet_label.text="Промок · %d%%" % roundi(wet_bar.value)
	var key="%s:%s:%s" % [target.ant_id,target.colony_id,target.fired]
	if key!=appearance_key and portrait_mesh and target.mesh_instance:
		appearance_key=key
		for i in range(portrait_mesh.mesh.get_surface_count()):
			portrait_mesh.set_surface_override_material(i,target.mesh_instance.get_active_material(i))
	reset_size()

static func activity_for(target: NetworkResident, raw: Dictionary, snapshot: Dictionary) -> Array:
	if target.carrying_amount>0:return ["act_carry","Несёт "+RESOURCE_NAMES.get(target.carry_kind,"ресурсы")]
	var state=str(raw.get("state",target.state_name))
	if raw.get("capturedBy")!=null:return ["act_wounded","В плену"]
	if state=="fight":return ["act_fight","Сражается"]
	if state in ["sleep","sleeping"]:return ["act_sleep","Спит"]
	if state in ["flee","fleeing"]:return ["act_flee","Убегает"]
	var kind=str(target.work.get("kind",""))
	var work={"chop":["act_chop","Рубит дерево"],"mine":["act_mine","Добывает камень"],"dig":["act_dig","Копает глину"],"build":["act_build","Строит"],"fish":["act_fish","Ловит рыбу"],"hunt":["act_fight","Охотится"]}
	if work.has(kind):return work[kind]
	if target.kiln_called:return ["act_walk","Идёт к печи"]
	if state=="feed" or target.job_name=="nurse":return ["act_eat","Заботится о малышах"]
	if target.job_name=="guard":return ["act_guard","Стоит на страже"]
	if target.job_name=="harvest":
		var resource="ресурсами"
		for node in snapshot.get("surface",{}).get("resourceNodes",[]):
			if str(node.get("id",""))==str(raw.get("harvestNodeId","")):
				resource={"tree":"деревом","stone":"камнем","clay":"глиной"}.get(str(node.get("kind","")),"ресурсами");break
		return ["act_walk","Идёт за "+resource]
	if target.job_name=="build":return ["act_walk","Идёт на стройку"]
	if target.job_name=="fish":return ["act_walk","Идёт к воде"]
	if target.job_name=="hunt":return ["act_walk","Выслеживает дичь"]
	if state in ["search","return","toEntrance"]:return ["act_walk","Ищет еду" if state=="search" else "Возвращается"]
	return ["act_idle","Отдыхает"]

func _process(_delta: float) -> void:
	if not is_visible_in_tree():return
	var bottom=-260.0 if get_viewport_rect().size.x<1800 else -16.0
	if not is_equal_approx(offset_bottom,bottom):
		offset_top=bottom-size.y;offset_bottom=bottom
