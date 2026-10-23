"""Incremental HUD assembly. All writes are contained in art/hud/."""
import argparse
import csv
import json
import math
import sys
from pathlib import Path
sys.dont_write_bytecode = True
from PIL import Image, ImageDraw, ImageEnhance
import numpy as np
from scipy.ndimage import distance_transform_edt
import raster_pipeline as raster
from build_stage0 import ROOT, font, nine_slice, make_board, paste_center, clean_alpha

CATALOG = ROOT/'_tools'/'catalog.json'
PAPER,DARK,INK = '#F2E3BD','#2B2118','#4D331F'


def load_catalog():
    return json.loads(CATALOG.read_text(encoding='utf-8'))


def recolor(im, color=None, brightness=1):
    data=np.array(im)
    interior=(data[:,:,3]==255)&np.any(data[:,:,:3]!=raster.INK,axis=2)
    if color:
        data[interior,:3]=color
    elif brightness!=1:
        data[interior,:3]=np.clip(data[interior,:3].astype(float)*brightness,0,255).astype('uint8')
    return Image.fromarray(data)


def build_one(name, spec, images):
    mode=spec.get('mode','icon')
    size=tuple(spec['size'])
    source_path=ROOT/'_source'/f'{name}.png'
    if mode=='symbol':
        k=4
        large=(size[0]*k,size[1]*k)
        mask=Image.new('L',large)
        d=ImageDraw.Draw(mask)
        shape=spec['shape']
        w,h=large
        pad=5*k
        if shape=='dot':
            d.ellipse((pad,pad,w-pad-1,h-pad-1),fill=255)
        elif shape=='plus':
            d.rounded_rectangle((w*.41,pad,w*.59,h-pad),radius=k,fill=255)
            d.rounded_rectangle((pad,h*.41,w-pad,h*.59),radius=k,fill=255)
        elif shape=='minus':
            d.rounded_rectangle((pad,h*.41,w-pad,h*.59),radius=k,fill=255)
        elif shape=='cross':
            d.line((pad,pad,w-pad,h-pad),fill=255,width=5*k)
            d.line((w-pad,pad,pad,h-pad),fill=255,width=5*k)
        elif shape=='ban':
            d.ellipse((pad,pad,w-pad-1,h-pad-1),outline=255,width=5*k)
            d.line((pad+3*k,pad+3*k,w-pad-3*k,h-pad-3*k),fill=255,width=5*k)
        elif shape=='bar':
            d.rounded_rectangle((4*k,3*k,w-4*k-1,5*k-1),radius=k,fill=255)
        else:
            raise ValueError(shape)
        source=Image.open(ROOT/'_source'/f"{spec['base']}.png")
        # Use generated material as a subtle interior texture under the new mask.
        texture=source.convert('RGB').resize(large,Image.Resampling.LANCZOS)
        color=spec.get('fill',(139,90,43))
        data=np.array(texture).astype(float)
        light=np.clip(data.mean(axis=2)/110,.87,1.08)
        data=np.clip(np.array(color)[None,None,:]*light[:,:,None],0,255).astype('uint8')
        texture=Image.fromarray(data)
        master=raster.paint_contour(texture,np.array(mask)>0,0,(.6 if shape=='bar' else 1.5)*k)
        master.save(source_path)
        result=raster.finish(master,size)
    elif mode=='light':
        # Exactly matching silhouette: color changes only inside the existing ink.
        result=recolor(images[spec['base']],raster.PAPER)
        master=Image.open(ROOT/'_source'/f"{spec['base']}.png")
        raster.icon(master,(512,512),fill=raster.PAPER).save(source_path)
    elif mode=='state':
        result=images[spec['base']].copy()
        state=spec['state']
        if state=='hover':
            result=recolor(result,brightness=1.12)
        else:
            data=np.array(result)
            interior=(data[:,:,3]==255)&np.any(data[:,:,:3]!=raster.INK,axis=2)
            target=np.array((240,184,90) if state=='pressed' else (161,157,146))
            amount=.65 if state=='pressed' else .8
            data[interior,:3]=(data[interior,:3]*(1-amount)+target*amount).astype('uint8')
            if state=='pressed':
                yy=np.indices(interior.shape)[0]
                top=interior&(yy>=3)&(yy<7)
                bottom=interior&(yy>=size[1]-7)&(yy<size[1]-3)
                data[top,:3]=(data[top,:3]*.70).astype('uint8')
                data[bottom,:3]=np.clip(data[bottom,:3]*1.12,0,255).astype('uint8')
            result=Image.fromarray(data)
        result.resize((size[0]*4,size[1]*4),Image.Resampling.NEAREST).save(source_path)
    elif mode=='reuse':
        base=Image.open(ROOT/'_source'/f"{spec['base']}.png")
        result=raster.icon(base,size,fill=tuple(spec['fill']) if 'fill' in spec else None)
        base.save(source_path)
    elif mode=='composite':
        master=Image.new('RGBA',(size[0]*4,size[1]*4))
        for part in spec['parts']:
            base=Image.open(ROOT/'_source'/f"{part['name']}.png")
            x,y,w,h=part['box']
            if part.get('stretch'):
                base=raster.texture_mask(base).resize((w*8,h*8),Image.Resampling.LANCZOS)
            piece=raster.icon(base,(w*4,h*4),fill=tuple(part['fill']) if 'fill' in part else None,margin=part.get('margin'))
            master.alpha_composite(piece,(x*4,y*4))
        master.save(source_path)
        result=raster.finish(master,size)
    else:
        if not source_path.is_file() and spec.get('base'):
            Image.open(ROOT/'_source'/f"{spec['base']}.png").save(source_path)
        source=Image.open(source_path).convert('RGBA')
        source=clean_alpha(source)
        source.save(source_path)
        if spec.get('brightness'):
            a=source.getchannel('A')
            source=ImageEnhance.Brightness(source).enhance(spec['brightness'])
            source.putalpha(a)
        if spec.get('palette')=='earth_signs':
            data=np.array(source)
            rgb=data[:,:,:3].astype(float)
            green=(rgb[:,:,1]>rgb[:,:,0]*1.25)&(rgb[:,:,1]>rgb[:,:,2]*1.25)
            red=(rgb[:,:,0]>rgb[:,:,1]*1.8)&(rgb[:,:,0]>rgb[:,:,2]*1.8)
            for mask,target in [(green,(92,140,51)),(red,(192,57,43))]:
                scale=np.clip(rgb[mask].max(axis=1)/200,.7,1.1)
                data[mask,:3]=np.clip(np.array(target)[None,:]*scale[:,None],0,255).astype('uint8')
            source=Image.fromarray(data)
        if mode in ('panel','frame'):
            result=raster.panel(source,size,tuple(spec['slice']))
            if mode=='frame':
                l,t,r,b=spec['slice']
                ImageDraw.Draw(result).rectangle((l,t,size[0]-r-1,size[1]-b-1),fill=(0,0,0,0))
        elif mode=='cursor_default':
            result=raster.cursor(source)
        elif mode=='background':
            result=source.resize(size,Image.Resampling.LANCZOS)
            result.putalpha(255)
        else:
            result=raster.icon(source,size)
        if 'fill' in spec:
            result=recolor(result,tuple(spec['fill']))
    result.save(ROOT/f'{name}.png')
    return result


def make_sheets(images,catalog,stage):
    groups={}
    for name in images:
        # Light glyphs retain group=extra in the manifest but join the glyph sheet.
        group='glyph' if name.startswith('glyph_') else catalog[name]['group']
        groups.setdefault(group,[]).append(name)
    for group,names in groups.items():
        columns=3 if group not in ('brand',) else 1
        cw,ch=440,270
        rows=math.ceil(len(names)/columns)
        sheet=Image.new('RGBA',(cw*min(columns,len(names)),ch*rows),PAPER)
        d=ImageDraw.Draw(sheet)
        for i,name in enumerate(names):
            x,y=(i%columns)*cw,(i//columns)*ch
            im=images[name]
            d.rectangle((x,y,x+cw-1,y+ch-1),outline='#B69A70')
            # Show exact production pixels on each backdrop.
            d.rectangle((x+cw//2,y+6,x+cw-6,y+172),fill=DARK)
            display=im.copy()
            if im.width>cw//2-18 or im.height>152:
                display.thumbnail((cw//2-18,152),Image.Resampling.LANCZOS)
            paste_center(sheet,display,(x+6,y+6,cw//2-12,160))
            paste_center(sheet,display,(x+cw//2+6,y+6,cw//2-18,160))
            d.text((x+12,y+182),name+'.png',font=font(17,True),fill=INK)
            d.text((x+12,y+207),f"{catalog[name]['title']} · {im.width}×{im.height}",font=font(14),fill=INK)
            small=im.copy()
            small.thumbnail((24,24),Image.Resampling.BOX)
            # Restore boundary ink after resizing; no light fringe in review copies.
            small=raster.finish(small,small.size)
            small.save(ROOT/'_preview'/f'{name}_24.png')
            d.text((x+12,y+238),'24 px',font=font(13),fill=INK)
            paste_center(sheet,small,(x+64,y+233,30,30))
            d.rectangle((x+104,y+232,x+135,y+263),fill=DARK)
            paste_center(sheet,small,(x+105,y+233,30,30))
            if name.endswith('_light'):
                d.rectangle((x+154,y+232,x+185,y+263),fill='#C0392B')
                paste_center(sheet,small,(x+155,y+233,30,30))
        sheet.save(ROOT/'_preview'/f'sheet_{group}.png')
    # A compact index for the current stage without hiding per-group exact-size sheets.
    names=[n for n in images if catalog[n]['stage']==stage]
    cols=5
    index=Image.new('RGBA',(1400,90+math.ceil(len(names)/cols)*230),PAPER)
    d=ImageDraw.Draw(index)
    d.text((24,18),f'CLAYFOLK / HUD · этап {stage}',font=font(30,True),fill=INK)
    for i,name in enumerate(names):
        x,y=20+(i%cols)*276,90+(i//cols)*230
        im=images[name].copy()
        im.thumbnail((122,146),Image.Resampling.BOX)
        d.rectangle((x+130,y,x+260,y+152),fill=DARK)
        paste_center(index,im,(x,y,126,152))
        paste_center(index,im,(x+132,y,126,152))
        d.text((x,y+162),name,font=font(16,True),fill=INK)
        d.text((x,y+188),catalog[name]['title'],font=font(14),fill=INK)
    index.save(ROOT/'_preview'/f'stage_{stage}_board.png')


def write_manifest(catalog):
    rows=[]
    for path in sorted(ROOT.rglob('*.png')):
        rel=path.relative_to(ROOT).as_posix()
        name=path.stem
        source=rel.startswith('_source/')
        image=Image.open(path)
        if name in catalog and (source or '/' not in rel):
            spec=catalog[name]
            group='source' if source else spec['group']
            title=spec['title']+(' — исходник' if source else '')
            where=spec.get('where','HUD Clayfolk · '+spec['group'])
            prompt=spec['prompt']
            if not source:
                prompt+=' | Offline finishing: build_hud.py / raster_pipeline.py; binary silhouette, opaque #4D331F Euclidean contour, one-pixel BOX coverage boundary. Mode: '+spec.get('mode','icon')
            slices=','.join(map(str,spec.get('slice',[]))) if not source else ''
            hotspot=','.join(map(str,spec.get('hotspot',[]))) if not source else ''
            states=spec.get('state','') if not source else ''
        else:
            group,title,where='preview','Превью — '+name,'Служебный лист, не импортировать в игру'
            prompt='Offline composition of generated HUD assets by build_hud.py / build_stage0.py. Labels are review-only.'
            slices=hotspot=states=''
        rows.append([rel,group,title,where,f'{image.width}x{image.height}',states,slices,hotspot,prompt])
    with (ROOT/'manifest.csv').open('w',encoding='utf-8',newline='') as f:
        writer=csv.writer(f,delimiter=';')
        writer.writerow(['file','group','title_ru','where','size','states','slice','hotspot','prompt'])
        writer.writerows(rows)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--stage',type=int,required=True)
    parser.add_argument('--import-generated',type=Path)
    args=parser.parse_args()
    if args.import_generated:
        paths=json.loads(args.import_generated.read_text(encoding='utf-8'))
        for name,path in paths.items():
            if not (ROOT/'_source'/f'{name}.png').is_file():
                clean_alpha(Image.open(path)).save(ROOT/'_source'/f'{name}.png')
    catalog=load_catalog()
    for name,spec in list(catalog.items()):
        if name.startswith('glyph_') and not name.endswith('_light') and name+'_light' not in catalog:
            catalog[name+'_light']={
                'size':spec['size'],'group':'extra','title':spec['title']+' — светлый',
                'stage':spec['stage'],'mode':'light','base':name,
                'where':'Тёмные панели и красная кнопка тревоги',
                'prompt':'Derived from '+name+': exact #F2E3BD fill, solid #4D331F contour, unchanged alpha silhouette.',
            }
    CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    images={}
    for name,spec in catalog.items():
        if spec['stage']<=args.stage:
            images[name]=build_one(name,spec,images)
    make_board(images)
    make_sheets(images,catalog,args.stage)
    write_manifest(catalog)
    print(f'Stage {args.stage}: {len(images)} game PNGs built; sources, sheets, manifest updated.')


if __name__=='__main__':
    main()
