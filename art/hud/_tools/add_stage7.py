import json
import sys
sys.dont_write_bytecode=True
from build_hud import CATALOG,load_catalog
c=load_catalog()
def add(name,title,**kw):
    c[name]=dict(size=[64,64],group='cursor',title=title,stage=7,where='Указатель мыши',prompt='Offline derivative of generated '+kw.get('base','HUD assets')+'; '+kw.get('mode','icon')+'; no text or external assets.',**kw)
for name in ['cursor_hover','cursor_build','cursor_brush']:
    c[name].update(auto_hotspot='tip',hotspot=[4,4])
for name in ['cursor_grab','cursor_rotate']:
    c[name]['hotspot']=[32,32]
add('cursor_forbid','Сюда нельзя',mode='cursor_forbid',base='cursor_default',hotspot=[4,4])
add('cursor_harvest','Зона добычи',mode='reuse',base='tool_pickaxe',auto_hotspot='tip',hotspot=[4,4])
add('cursor_attack','Атака',mode='reuse',base='tool_spear',rotate=90,auto_hotspot='tip',hotspot=[4,4])
add('cursor_wait','Ожидание',mode='composite',parts=[dict(name='cursor_rotate',box=[0,0,64,64]),dict(name='res_clay',box=[17,17,30,30])],hotspot=[32,32])
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
