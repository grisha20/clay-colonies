"""Full v2 atlas for review before importing/adjusting the in-game HUD."""
import math
from PIL import Image,ImageDraw
from build_stage0 import ROOT,font,paste_center
from hud_v2 import V2_REQUIRED


def overview(catalog):
    names=list(V2_REQUIRED)
    names += [n for n,s in catalog.items() if s.get('style_version')==2 and n not in V2_REQUIRED]
    cols=6;cw=280;ch=170
    sheet=Image.new('RGBA',(cols*cw,190+math.ceil(len(names)/cols)*ch),'#EEE7D9')
    d=ImageDraw.Draw(sheet)
    d.text((22,15),'CLAYFOLK · HUD v2 · полный набор для сравнения с макетом',font=font(28,True),fill='#5A3A22')
    d.text((22,57),f'{len(V2_REQUIRED)} обязательных файлов + {len(names)-len(V2_REQUIRED)} светлых глифов · исходники ≤1024 px',font=font(20),fill='#75543B')
    logo=Image.open(ROOT/'logo_hud.png').convert('RGBA');logo.thumbnail((330,85),Image.Resampling.LANCZOS)
    sheet.alpha_composite(logo,(26,92))
    for j,n in enumerate(['btn_square_normal','btn_square_pressed','card_build_pressed','res_clay','res_food','res_wood','job_build','build_hut','build_house','build_idol']):
        im=Image.open(ROOT/f'{n}.png').convert('RGBA');im.thumbnail((78,78),Image.Resampling.LANCZOS)
        paste_center(sheet,im,(430+j*115,92,85,85))
    for i,name in enumerate(names):
        x,y=(i%cols)*cw,190+(i//cols)*ch
        d.rounded_rectangle((x+6,y+4,x+cw-6,y+ch-4),radius=8,fill='#FCF7ED')
        im=Image.open(ROOT/f'{name}.png').convert('RGBA')
        shown=im.copy();shown.thumbnail((108,110),Image.Resampling.LANCZOS)
        d.rounded_rectangle((x+143,y+9,x+cw-14,y+123),radius=6,fill='#2B2118')
        paste_center(sheet,shown,(x+12,y+9,118,114));paste_center(sheet,shown,(x+144,y+9,118,114))
        d.text((x+14,y+129),name,font=font(13,True),fill='#5A3A22')
        d.text((x+14,y+149),f'{im.width}×{im.height}',font=font(11),fill='#75543B')
    sheet.save(ROOT/'_preview'/'overview_v2.png')
