"""Review revised icons at production size and at 24px; no game changes."""
import sys
sys.dont_write_bytecode=True
from PIL import Image,ImageDraw
import raster_pipeline as raster
from build_hud import ROOT,load_catalog,write_manifest,make_index
from build_stage0 import font,paste_center

names=['glyph_alarm','glyph_alarm_light','glyph_alarm_on','glyph_alarm_on_light',
       'glyph_next_resident','glyph_next_resident_light','cursor_forbid','alert_raid',
       'act_idle','act_sleep','act_flee','act_carry',
       'glyph_pause','glyph_settings','glyph_play','job_carry']
board=Image.new('RGBA',(1600,1160),'#F2E3BD')
d=ImageDraw.Draw(board)
d.text((22,16),'CLAYFOLK · поправки · готовый размер / 24 px / 24 px ×4',font=font(28,True),fill='#4D331F')
for i,name in enumerate(names):
    x,y=(i%4)*400,68+(i//4)*273
    im=Image.open(ROOT/f'{name}.png').convert('RGBA')
    d.rectangle((x,y,x+399,y+272),outline='#B69A70')
    d.text((x+16,y+14),name,font=font(18,True),fill='#4D331F')
    d.rectangle((x+92,y+48,x+171,y+127),fill='#2B2118')
    paste_center(board,im,(x+12,y+48,80,80))
    paste_center(board,im,(x+92,y+48,80,80))
    small=raster.finish(im,(24,24))
    d.text((x+16,y+147),'24 px',font=font(14),fill='#4D331F')
    paste_center(board,small,(x+20,y+177,32,32))
    d.rectangle((x+92,y+177,x+123,y+208),fill='#2B2118')
    paste_center(board,small,(x+92,y+177,32,32))
    d.rectangle((x+140,y+177,x+171,y+208),fill='#C0392B')
    paste_center(board,small,(x+140,y+177,32,32))
    d.rectangle((x+218,y+58,x+337,y+177),fill='#2B2118')
    zoom=small.resize((96,96),Image.Resampling.NEAREST)
    board.alpha_composite(zoom,(x+230,y+70))
    d.text((x+218,y+192),'×4 nearest',font=font(13),fill='#4D331F')
    if i>=12:
        d.text((x+16,y+238),'Для сравнения',font=font(14),fill='#4D331F')
board.save(ROOT/'_preview'/'revision_board.png')
c=load_catalog()
images={n:Image.open(ROOT/f'{n}.png').convert('RGBA') for n in c}
for stage in (2,4,5,7):
    make_index(images,c,stage)
write_manifest(c)
print('Revision board + manifest updated.')
