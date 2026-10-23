import json
import sys
sys.dont_write_bytecode=True
from build_hud import CATALOG,load_catalog
c=load_catalog()
def add(name,size,group,title,**kw):
    c[name]=dict(size=[size,size] if isinstance(size,int) else size,group=group,title=title,stage=4,where='HUD Clayfolk · работы / карточка жителя',prompt='Offline derivative of generated '+kw.get('base','HUD assets')+'; '+kw.get('mode','icon')+'; no text or external assets.',**kw)
def reuse(name,base,title,size,group):
    add(name,size,group,title,mode='reuse',base=base)
def pair(name,main,other,title,size,group,flip=False):
    parts=[dict(name=main,box=[0,0,size-3,size-3]),dict(name=other,box=[size//3,size//3,size*2//3,size*2//3],flip=flip)]
    add(name,size,group,title,mode='composite',parts=parts)

add('glyph_deselect',48,'glyph','Снять выбор',mode='symbol',shape='cross',base='res_clay',fill=[139,90,43])
reuse('glyph_next_resident','glyph_play','Следующий житель',48,'glyph')
reuse('glyph_gather','res_wood','Собирать',48,'glyph')
add('glyph_forbid',48,'glyph','Запрет',mode='symbol',shape='ban',base='res_clay',fill=[192,57,43])
for name,base,title in [('job_guard','tool_spear','Стража'),('job_fish','tool_rod','Рыбалка'),('job_food','res_berries','Сбор еды'),('job_firing','build_kiln','Обжиг'),('job_manual','glyph_hand','Вручную')]:
    reuse(name,base,title,64,'job')
for name,a,b,title in [('job_clay','tool_pickaxe','res_clay','Добыча глины'),('job_wood','tool_axe','res_wood','Рубка дерева'),('job_stone','tool_pickaxe','res_stone','Добыча камня'),('job_build','build_hut','tool_axe','Стройка'),('job_hunt','tool_spear','res_meat','Охота'),('job_heal','ui_heart','glyph_plus_light','Лечение'),('job_carry','glyph_hand','res_wood','Носка'),('job_water_shot','res_water','glyph_play_light','Выстрел водой'),('job_mother_auto','res_people','glyph_settings_light','Праматерь решает')]:
    pair(name,a,b,title,64,'job')
for name,base,title in [('act_idle','mood_ok','Бездействует'),('act_walk','glyph_follow','Идёт'),('act_guard','tool_spear','Охраняет')]:
    reuse(name,base,title,48,'act')
for name,a,b,title in [('act_carry','glyph_hand','res_wood','Несёт груз'),('act_chop','tool_axe','res_wood','Рубит'),('act_dig','tool_pickaxe','res_clay','Копает'),('act_mine','tool_pickaxe','res_stone','Добывает камень'),('act_build','build_hut','tool_axe','Строит'),('act_fish','tool_rod','res_fish','Рыбачит'),('act_hunt','tool_spear','res_meat','Охотится'),('act_eat','res_people','res_berries','Ест'),('act_flee','glyph_follow','glyph_play','Убегает'),('act_wounded','mood_sad','ui_heart','Ранен')]:
    pair(name,a,b,title,48,'act')
add('act_fight',48,'act','Сражается',mode='composite',parts=[dict(name='tool_spear',box=[0,0,48,48]),dict(name='tool_spear',box=[0,0,48,48],flip=True)])
add('card_resident_panel',[320,256],'card','Карточка жителя',mode='panel',base='ui_panel',slice=[16,16,16,16])
add('card_resident_portrait_frame',[112,112],'card','Рамка портрета жителя',mode='frame',base='ui_panel',slice=[12,12,12,12])
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
