"""Incremental HUD polish; never rebuild unrelated assets/Claude speed glyphs."""
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
import numpy as np
from PIL import Image,ImageDraw
from build_hud import ROOT,CATALOG,load_catalog,build_one,make_sheets,write_manifest
from hud_v2 import clean_source,sprite
from exact_v2 import cfg,shaped,soften_legacy
from exact_preview import overview

TITLES={'glyph_alarm':'Бронзовый колокол тревоги','glyph_alarm_on':'Звучащий бронзовый колокол',
 'glyph_alarm_light':'Светлый бронзовый колокол','glyph_alarm_on_light':'Звучащий светлый колокол',
 'resident_clay_raw':'Сырой житель','resident_clay_fired':'Обожжённый житель','resident_clay_firing':'Идёт на обжиг',
 'ui_bar_fill_blue':'Синяя полоса промокания'}

def source_spec(catalog,name,source,title=None,size=(96,96),margin=8):
    old=catalog.get(name,{})
    s=cfg(name,old)
    for k in ('v2_shape','v2_ref','base','parts','fill','ink_details'):s.pop(k,None)
    s.update(size=list(size),mode='v2',v2_exact=True,v2_kind='sprite',v2_margin=margin,polish_source=True,source_max=1024,
             prompt=title or old.get('prompt','Native generated Clayfolk art; HUD v2 polish'))
    if name in TITLES:s['title']=TITLES[name]
    source=clean_source(source,preserve_cream=False)
    source.save(ROOT/'_source'/f'{name}.png',optimize=True)
    catalog[name]=s

def bell_sources(catalog,entry):
    if not Path(entry['generated_path']).is_file():
        # The portable pack contains the prepared sources of all four variants.
        for name in ('glyph_alarm','glyph_alarm_on','glyph_alarm_light','glyph_alarm_on_light'):
            if not (ROOT/'_source'/f'{name}.png').is_file():raise FileNotFoundError(name)
        return
    source=clean_source(Image.open(entry['generated_path']))
    base=sprite(source,(768,768),90)
    for active in (False,True):
        image=base.rotate(-13,Image.Resampling.BICUBIC,expand=False) if active else base.copy()
        if active:
            d=ImageDraw.Draw(image)
            d.arc((55,170,300,630),115,245,fill=(153,93,39,255),width=20)
            d.arc((475,170,720,630),295,425,fill=(153,93,39,255),width=20)
        name='glyph_alarm'+('_on' if active else '')
        source_spec(catalog,name,image,entry['prompt']+(' Tilted -13 degrees with sound arcs.' if active else ''))
        data=np.array(image)
        lum=(data[:,:,:3].astype(float)*np.array((.2126,.7152,.0722))).sum(axis=2)/255
        shade=np.clip(lum*.9+.23,.24,1)
        data[:,:,:3]=np.rint(shade[:,:,None]*np.array((242,227,189))).astype('uint8')
        data[data[:,:,3]==0]=0
        source_spec(catalog,name+'_light',Image.fromarray(data),entry['prompt']+' Ivory-bronze light material; keep volume and silhouette.')

def map_sources(catalog):
    names=[]
    for name,color in [('minimap_camp_own',(247,183,49,255)),('minimap_camp_enemy',(220,64,43,255))]:
        image=Image.new('RGBA',(384,384))
        hut=clean_source(Image.open(ROOT/'_source/build_hut.png'))
        hut=sprite(hut,(308,270),12)
        image.alpha_composite(hut,(20,100))
        d=ImageDraw.Draw(image)
        d.line([(270,225),(270,42)],fill=(147,91,45,255),width=12)
        d.polygon([(277,42),(353,62),(277,96)],fill=color)
        d.line([(280,45),(346,63)],fill=(255,225,159,255),width=5)
        source_spec(catalog,name,image,'Native v2 hut with '+('gold own-camp' if name.endswith('_own') else 'red other-camp')+' flag; reduced 48px map symbol',size=(48,48),margin=4)
        names.append(name)
    for name,base in [('minimap_enemy','alert_spider'),('minimap_totem','build_totem')]:
        source=Image.open(ROOT/'_source'/f'{base}.png').convert('RGBA')
        if catalog[base].get('style_version')!=2:source=soften_legacy(source)
        source_spec(catalog,name,source,'Native generated '+base+'; v2 map overlay, no v1 ink; 48px',size=(48,48),margin=4)
        names.append(name)
    # Extend the existing water icon system with a small pool and broad waves.
    image=Image.new('RGBA',(384,384));d=ImageDraw.Draw(image)
    d.ellipse((26,82,358,304),fill=(35,113,153,255))
    d.ellipse((33,82,351,288),fill=(65,159,196,255))
    d.ellipse((48,88,334,263),fill=(99,194,219,255))
    d.arc((81,107,278,188),15,165,fill=(225,246,235,255),width=12)
    d.arc((108,172,307,243),15,165,fill=(209,240,234,255),width=12)
    name='minimap_lake'
    source_spec(catalog,name,image,'V2 water-pool overlay, turquoise volumetric basin and two broad cream wave highlights, 48px',size=(48,48),margin=4)
    names.append(name)
    return names

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--stage',type=int,choices=range(1,6),required=True)
    args=parser.parse_args()
    catalog=load_catalog();names=[]
    if args.stage==1:
        entry=json.loads((ROOT/'_tools/generated_polish.json').read_text(encoding='utf-8'))['bell']
        bell_sources(catalog,entry)
        names=['glyph_alarm','glyph_alarm_on','glyph_alarm_light','glyph_alarm_on_light']
        for state in ('normal','hover','pressed','disabled'):
            name='btn_square_'+state;s=cfg(name,catalog[name]);catalog[name]=s
            source=shaped(tuple(s['size']),name,s['v2_shape']).resize((384,384),Image.Resampling.LANCZOS)
            clean_source(source).save(ROOT/'_source'/f'{name}.png',optimize=True);names.append(name)
    elif args.stage==2:
        for name in sorted(catalog):
            if not name.startswith('act_'):continue
            old=catalog[name]
            source=Image.open(ROOT/'_source'/f'{name}.png').convert('RGBA')
            if old.get('style_version')!=2:source=soften_legacy(source)
            source_spec(catalog,name,source,'Native generated activity; HUD v2 soft material without v1 ink; '+old.get('prompt',''),size=(96,96),margin=8)
            names.append(name)
        for base in ('glyph_follow','glyph_next_resident','glyph_deselect'):
            for suffix in ('','_light'):
                name=base+suffix;catalog[name]=cfg(name,catalog[name]);catalog[name].pop('polish_source',None)
                from exact_v2 import symbol
                source=symbol((96,96),name).resize((384,384),Image.Resampling.LANCZOS)
                clean_source(source,preserve_cream=False).save(ROOT/'_source'/f'{name}.png',optimize=True);names.append(name)
        name='card_resident_portrait_frame';s=cfg(name,catalog[name])
        s.update(size=[112,112],slice=[24,24,24,24],v2_kind='frame',v2_shape='frame',v2_center='transparent')
        catalog[name]=s
        source=shaped((112,112),name,'frame').resize((448,448),Image.Resampling.LANCZOS)
        clean_source(source,preserve_cream=False).save(ROOT/'_source'/f'{name}.png',optimize=True);names.append(name)
        name='ui_bar_fill_blue';s=cfg(name,{})
        s['title']=TITLES[name];catalog[name]=s
        source=shaped(tuple(s['size']),name,'bar').resize((512,72),Image.Resampling.LANCZOS)
        clean_source(source).save(ROOT/'_source'/f'{name}.png',optimize=True);names.append(name)
        for name,base,brightness in [('resident_clay_raw','res_clay',1),('resident_clay_fired','res_clay',.67),('resident_clay_firing','icon_kiln',1)]:
            image=Image.open(ROOT/'_source'/f'{base}.png').convert('RGBA')
            if brightness!=1:
                a=np.array(image);a[:,:,:3]=np.rint(a[:,:,:3]*brightness).astype('uint8');image=Image.fromarray(a)
            source_spec(catalog,name,image,'Derived from native '+base+'; clay state icon',size=(96,96));names.append(name)
    elif args.stage==3:
        name='menu_panel';s=cfg(name,catalog[name])
        s.update(size=[128,128],slice=[24,24,24,24],v2_kind='panel',v2_shape='rounded')
        catalog[name]=s
        source=shaped((128,128),name,'rounded').resize((512,512),Image.Resampling.LANCZOS)
        clean_source(source).save(ROOT/'_source'/f'{name}.png',optimize=True);names.append(name)
    elif args.stage==4:
        names=map_sources(catalog)
    elif args.stage==5:
        # Refresh inventory/overview without touching any game image.
        for name,title in TITLES.items():
            if name in catalog:catalog[name]['title']=title
    CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for name in names:build_one(name,catalog[name],{})
    images={n:Image.open(ROOT/f'{n}.png').convert('RGBA') for n in catalog}
    make_sheets(images,catalog,8);overview(catalog);write_manifest(catalog)
    print('HUD polish stage',args.stage,':',len(names),'assets; unrelated game PNGs retained.')

if __name__=='__main__':main()
