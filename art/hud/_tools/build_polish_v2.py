"""Incremental HUD polish; never rebuild unrelated assets/Claude speed glyphs."""
import argparse,json,sys
sys.dont_write_bytecode=True
import numpy as np
from PIL import Image,ImageDraw
from build_hud import ROOT,CATALOG,load_catalog,build_one,make_sheets,write_manifest
from hud_v2 import clean_source,sprite
from exact_v2 import cfg,shaped,soften_legacy
from exact_preview import overview

def source_spec(catalog,name,source,title=None,size=(96,96),margin=8):
    old=catalog.get(name,{})
    s=cfg(name,old)
    for k in ('v2_shape','v2_ref','base','parts','fill','ink_details'):s.pop(k,None)
    s.update(size=list(size),mode='v2',v2_exact=True,v2_kind='sprite',v2_margin=margin,polish_source=True,source_max=1024,
             prompt=title or old.get('prompt','Native generated Clayfolk art; HUD v2 polish'))
    if title:s['title']=title
    source=clean_source(source,preserve_cream=False)
    source.save(ROOT/'_source'/f'{name}.png',optimize=True)
    catalog[name]=s

def bell_sources(catalog,entry):
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

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--stage',type=int,choices=range(1,5),required=True)
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
    else:
        raise ValueError('Stage not implemented yet')
    CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for name in names:build_one(name,catalog[name],{})
    images={n:Image.open(ROOT/f'{n}.png').convert('RGBA') for n in catalog}
    make_sheets(images,catalog,8);overview(catalog);write_manifest(catalog)
    print('HUD polish stage',args.stage,':',len(names),'assets; unrelated game PNGs retained.')

if __name__=='__main__':main()
