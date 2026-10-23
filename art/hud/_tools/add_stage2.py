"""Stage 2 catalog entries; generated bases + explicitly recorded derivatives."""
import json
import sys
sys.dont_write_bytecode=True
from build_hud import ROOT, CATALOG, load_catalog
from build_stage0 import clean_alpha
from PIL import Image

c=load_catalog()
generated=json.loads((ROOT/'_tools'/'generated_stage2.json').read_text(encoding='utf-8'))
c.update(generated['defs'])
for name,path in generated['paths'].items():
    clean_alpha(Image.open(path)).save(ROOT/'_source'/f'{name}.png')

def add(name,size,group,title,**kw):
    c[name]=dict(size=size,group=group,title=title,stage=2,where='HUD Clayfolk · общие элементы',prompt='Offline derivative of generated '+kw.get('base','glyph_play')+' material; '+kw.get('mode','icon')+'; no external assets.',**kw)

def panel(name,size,title,fill=None):
    add(name,size,'ui',title,mode='panel',base='ui_panel',slice=[min(16,size[0]//3),min(16,size[1]//3),min(16,size[0]//3),min(16,size[1]//3)],**({'fill':fill} if fill else {}))

for state in ['hover','pressed','disabled']:
    add('btn_square_'+state,[64,64],'btn','Квадратная кнопка — '+state,mode='state',base='btn_square_normal',state=state,slice=[16,16,16,16])
for family,size,title in [('ui_button_wide',[192,48],'Широкая кнопка'),('ui_btn_plus',[32,32],'Кнопка плюс — рамка'),('ui_btn_minus',[32,32],'Кнопка минус — рамка')]:
    panel(family+'_normal',size,title)
    c[family+'_normal']['state']='normal'
    for state in ['hover','pressed','disabled']:
        add(family+'_'+state,size,'ui',title+' — '+state,mode='state',base=family+'_normal',state=state,slice=c[family+'_normal']['slice'])
for name,shape,title in [('glyph_plus','plus','Плюс'),('glyph_minus','minus','Минус')]:
    add(name,[48,48],'extra',title,mode='symbol',shape=shape,base='res_clay')
for name,count,title in [('glyph_fast',2,'Скорость 5×'),('glyph_faster',3,'Скорость 20×')]:
    width=20 if count==2 else 14
    parts=[dict(name='glyph_play',box=[2+i*(width-1),5,width,38],stretch=True,margin=4) for i in range(count)]
    add(name,[48,48],'glyph',title,mode='composite',parts=parts)
panel('ui_panel_dark',[128,128],'Тёмная панель',[76,56,38])
panel('ui_header',[192,40],'Заголовок панели',[235,209,153])
panel('ui_tooltip',[128,96],'Подсказка',[250,239,211])
for name,title,color in [('ui_bar_bg','Подложка полосы',[93,76,52]),('ui_bar_fill_green','Прогресс / здоровье',[92,140,51]),('ui_bar_fill_amber','Прогресс стройки',[240,184,90]),('ui_bar_fill_red','Здоровье врага',[192,57,43])]:
    panel(name,[128,18],title,color)
panel('ui_scroll_track',[16,128],'Дорожка прокрутки',[119,96,62])
panel('ui_scroll_grabber',[16,48],'Ползунок прокрутки',[210,165,101])
add('ui_separator_h',[128,8],'ui','Разделитель',mode='symbol',shape='bar',base='res_clay',slice=[4,2,4,2],fill=[140,97,56])
for color,rgb in [('green',[92,140,51]),('yellow',[240,184,90]),('red',[192,57,43])]:
    add('ui_dot_'+color,[32,32],'ui','Статус задачи — '+color,mode='symbol',shape='dot',base='res_clay',fill=rgb)
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Stage 2 catalog prepared; ui_check and ui_star generated separately.')
