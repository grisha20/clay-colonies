import json
import sys
sys.dont_write_bytecode=True
from build_hud import CATALOG,load_catalog
c=load_catalog()
def add(name,size,group,title,**kw):
    c[name]=dict(size=size,group=group,title=title,stage=3,where='Нижняя панель построек',prompt='Offline derivative of generated '+kw.get('base','ui_panel')+'; '+kw.get('mode','icon')+'; no external assets.',**kw)
add('card_build_normal',[128,144],'card','Карточка постройки',mode='panel',base='ui_panel',slice=[16,16,16,16],state='normal')
for s in ['hover','pressed','disabled']:
    add('card_build_'+s,[128,144],'card','Карточка постройки — '+s,mode='state',base='card_build_normal',state=s,slice=[16,16,16,16])
for name,base,title in [('group_home','build_hut','Жильё и хозяйство'),('group_defense','build_wall','Оборона'),('group_land','build_totem','Земля и зоны')]:
    add(name,[48,48],'group',title,mode='reuse',base=base)
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
