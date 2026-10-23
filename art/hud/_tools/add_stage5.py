import json
import sys
sys.dont_write_bytecode=True
from build_hud import CATALOG,load_catalog
c=load_catalog()
def add(name,size,group,title,**kw):
    c[name]=dict(size=[size,size],group=group,title=title,stage=5,where='HUD Clayfolk · задачи / тревоги / время',prompt='Offline derivative of generated '+kw.get('base','HUD assets')+'; '+kw.get('mode','icon')+'; no text or external assets.',**kw)
def reuse(name,base,title,size,group):
    add(name,size,group,title,mode='reuse',base=base)
def pair(name,a,b,title,size,group,fill=None):
    parts=[dict(name=a,box=[0,0,size,size]),dict(name=b,box=[size//3,size//3,size*2//3,size*2//3],**({'fill':fill} if fill else {}))]
    add(name,size,group,title,mode='composite',parts=parts)
for name,base,title in [('task_clay','res_clay','Запасти глину'),('task_food','res_food','Запасти еду'),('task_stone','res_stone','Запасти камень'),('task_wood','res_wood','Запасти дерево'),('task_build_hut','build_hut','Построить хижину'),('task_population','res_people','Рост населения'),('task_territory','build_totem','Территория')]:
    reuse(name,base,title,48,'task')
pair('task_idol_ritual','build_idol','res_special','Ритуал идола',48,'task')
pair('task_survive_raid','build_wall','alert_spider','Пережить набег',48,'task')
pair('alert_raid','alert_spider','glyph_play','Набег',64,'alert',[192,57,43])
for name,base,title in [('alert_clouds','weather_clouds','Тучи'),('alert_rain','weather_rain','Дождь'),('alert_alarm','glyph_alarm_on','Тревога включена'),('alert_victory','ui_star','Победа')]:
    reuse(name,base,title,64,'alert')
pair('alert_defeat','build_idol','glyph_deselect','Поражение',64,'alert',[192,57,43])
add('alert_big_rain',64,'alert','Большой дождь',mode='composite',parts=[dict(name='weather_clouds',box=[0,0,64,44]),dict(name='weather_rain',crop=[0,.52,1,1],select='water_drops',box=[0,29,40,32]),dict(name='weather_rain',crop=[0,.52,1,1],select='water_drops',box=[24,29,40,32])])
reuse('weather_clear','time_day','Ясно',48,'weather')
for name,title,angle,color in [('time_dawn','Рассвет',90,[240,184,90]),('time_dusk','Сумерки',270,[224,122,60])]:
    add(name,48,'time',title,mode='composite',parts=[dict(name='time_day',crop=[0,0,1,.63],box=[0,0,48,34],fill=color),dict(name='ui_separator_h',box=[0,26,48,12]),dict(name='glyph_play_light',box=[28,27,20,20],rotate=angle)])
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
