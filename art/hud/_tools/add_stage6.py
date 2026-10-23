import json
import sys
sys.dont_write_bytecode=True
from build_hud import CATALOG,load_catalog
c=load_catalog()
def add(name,size,group,title,**kw):
    c[name]=dict(size=size,group=group,title=title,stage=6,where='HUD Clayfolk · миникарта / меню',prompt='Offline derivative of generated '+kw.get('base','HUD assets')+'; '+kw.get('mode','icon')+'; no text or external assets.',**kw)
add('minimap_frame',[256,256],'minimap','Рамка миникарты',mode='frame',base='ui_panel',slice=[16,16,16,16])
for name,base,title,fill in [('minimap_camp_own','build_hut','Наш лагерь',[92,140,51]),('minimap_camp_enemy','build_hut','Чужой лагерь',[192,57,43]),('minimap_enemy','alert_spider','Враг',[192,57,43]),('minimap_resident','res_people','Житель',[224,122,60]),('minimap_totem','build_totem','Тотем',None)]:
    add(name,[24,24],'minimap',title,mode='reuse',base=base,**({'fill':fill} if fill else {}))
add('minimap_lake',[24,24],'minimap','Озеро',mode='symbol',shape='dot',base='res_clay',fill=[63,143,208])
add('menu_panel',[512,640],'menu','Панель меню',mode='panel',base='ui_panel',slice=[24,24,24,24])
c['mother_bubble'].update(mode='bubble',slice=[96,32,24,48],margin=4,outer=1.5,inner=.5)
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
