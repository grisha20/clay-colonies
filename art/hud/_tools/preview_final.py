"""Review-only compositions. Text is never baked into game assets."""
import sys
sys.dont_write_bytecode=True
import numpy as np
from scipy.ndimage import binary_erosion
from PIL import Image,ImageDraw
from build_hud import ROOT,load_catalog,write_manifest,recolor
from build_stage0 import font,nine_slice,paste_center

c=load_catalog()
def asset(name):
    return Image.open(ROOT/f'{name}.png').convert('RGBA')

# A static menu material study, explicitly marked as an offline preview.
menu=asset('menu_background')
logo=asset('logo_clayfolk')
logo.thumbnail((600,225),Image.Resampling.LANCZOS)
menu.alpha_composite(logo,(58,50))
panel=nine_slice(asset('menu_panel'),(480,620),tuple(c['menu_panel']['slice']))
menu.alpha_composite(panel,(82,330))
d=ImageDraw.Draw(menu)
for i,text in enumerate(['Продолжить','Новая игра','Загрузить','Настройки','Выход']):
    name='ui_button_wide_hover' if i==1 else 'ui_button_wide_normal'
    button=nine_slice(asset(name),(396,68),tuple(c[name]['slice']))
    menu.alpha_composite(button,(124,380+i*100))
    d.text((322,414+i*100),text,font=font(27,True),fill='#4D331F',anchor='mm')
d.rounded_rectangle((1180,28,1886,70),radius=9,fill='#F2E3BD')
d.text((1200,37),'ПРЕВЬЮ АССЕТОВ · БЕЗ ПОДКЛЮЧЕНИЯ К ИГРЕ',font=font(18,True),fill='#4D331F')
menu.save(ROOT/'_preview'/'menu_mockup.png')

proof=Image.new('RGBA',(1440,800),'#2B2118')
d=ImageDraw.Draw(proof)
d.text((28,22),'Плотный контур #4D331F · обычный курсор без «иголки»',font=font(28,True),fill='#F2E3BD')
names=['res_clay','res_wood','res_people','build_hut','glyph_pause_light','cursor_default']
for i,name in enumerate(names):
    x=28+i*236
    im=asset(name)
    paste_center(proof,im,(x,80,208,145))
    d.text((x+104,235),name,font=font(17,True),fill='#F2E3BD',anchor='mm')
    mask=np.array(im.getchannel('A'))>0
    edge=mask & ~binary_erosion(mask)
    yy,xx=np.where(edge & (np.indices(mask.shape)[1]<im.width*.4))
    if len(xx)==0:
        yy,xx=np.where(edge)
    p=int(np.argmin(np.abs(yy-im.height*.5)))
    px,py=int(xx[p]),int(yy[p])
    patch=im.crop((px-8,py-8,px+8,py+8)).resize((128,128),Image.Resampling.NEAREST)
    proof.alpha_composite(patch,(x+40,315))
    d.text((x+104,465),'граница ×8 / nearest',font=font(14),fill='#F2E3BD',anchor='mm')
d.text((28,510),'15 светлых глифов: одинаковые силуэты, пергамент #F2E3BD, тёмный контур',font=font(24,True),fill='#F2E3BD')
lights=sorted(n for n in c if n.startswith('glyph_') and n.endswith('_light'))
for i,name in enumerate(lights):
    x=60+i*88
    im=asset(name)
    proof.alpha_composite(im,(x+12,565))
    red=recolor(asset('btn_square_normal'),(192,57,43))
    red.alpha_composite(im,(8,8))
    proof.alpha_composite(red,(x+4,650))
    d.text((x+36,741),name.removeprefix('glyph_').removesuffix('_light'),font=font(11),fill='#F2E3BD',anchor='mm')
proof.save(ROOT/'_preview'/'contour_check.png')

# Exercise the actual corner pads used for stretching and show the speech tail.
sheet=Image.new('RGBA',(1440,720),'#F2E3BD')
d=ImageDraw.Draw(sheet)
d.text((24,16),'9-slice · сохранение углов и хвостика',font=font(28,True),fill='#4D331F')
for i,(name,sizes) in enumerate([
    ('btn_square_normal',[(64,64),(160,64),(64,128)]),
    ('card_build_normal',[(128,144),(256,144)]),
    ('mother_bubble',[(320,128),(640,180)]),
]):
    y=75+i*205
    d.text((24,y),name+' · '+str(c[name]['slice']),font=font(18,True),fill='#4D331F')
    x=24
    for size in sizes:
        stretched=nine_slice(asset(name),size,tuple(c[name]['slice']))
        sheet.alpha_composite(stretched,(x,y+34))
        x+=size[0]+32
sheet.save(ROOT/'_preview'/'slice_check.png')
write_manifest(c)
print('Final review PNGs + manifest updated.')
