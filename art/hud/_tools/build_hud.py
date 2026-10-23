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
import revision_shapes
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


def save_source(image,path,spec):
    image=image.copy()
    limit=spec.get('source_max')
    if limit:
        image.thumbnail((limit,limit),Image.Resampling.LANCZOS)
        image=clean_alpha(image)
    if path.is_file():
        with Image.open(path) as previous:
            if previous.mode==image.mode and previous.size==image.size and previous.tobytes()==image.tobytes():
                return
    image.save(path,optimize=bool(limit))


def ink_details(image):
    data=np.array(image)
    dark=(data[:,:,3]>0)&np.all(data[:,:,:3]<=(120,95,72),axis=2)
    data[dark,:3]=raster.INK
    return Image.fromarray(data)


def build_one(name, spec, images):
    mode=spec.get('mode','icon')
    size=tuple(spec['size'])
    source_path=ROOT/'_source'/f'{name}.png'
    if spec.get('style_version')==2:
        from hud_v2 import render
        with Image.open(source_path) as source:
            result=render(source.convert('RGBA'),size,spec)
        result.save(ROOT/f'{name}.png')
        return result
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
            pad=7*k
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
        save_source(master,source_path,spec)
        result=raster.finish(master,size)
        if shape=='bar':
            for x in range(4,size[0]-4):
                for y in range(size[1]):
                    result.putpixel((x,y),result.getpixel((size[0]//2,y)))
    elif mode=='cursor_forbid':
        master=revision_shapes.forbid_cursor(images['cursor_default'])
        save_source(master,source_path,spec)
        result=raster.finish(master,size)
    elif mode in ('alarm_on','raid_alert'):
        source=Image.open(ROOT/'_source'/f"{spec['base']}.png")
        master=revision_shapes.alarm_on(source) if mode=='alarm_on' else revision_shapes.raid_alert(source)
        save_source(master,source_path,spec)
        result=raster.icon(master,size,margin=4,outer=0,inner=0) if mode=='alarm_on' else raster.finish(master,size)
        if spec.get('ink_details'):
            result=ink_details(result)
    elif mode=='light':
        # Exactly matching silhouette: color changes only inside the existing ink.
        result=recolor(images[spec['base']],raster.PAPER)
        master=Image.open(ROOT/'_source'/f"{spec['base']}.png")
        if spec.get('ink_details'):
            master=raster.texture_mask(master)
            master=ink_details(master)
            master=recolor(master,raster.PAPER)
        else:
            master=raster.icon(master,(512,512),fill=raster.PAPER)
        save_source(master,source_path,spec)
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
        save_source(result.resize((size[0]*4,size[1]*4),Image.Resampling.NEAREST),source_path,spec)
    elif mode=='reuse':
        base=Image.open(ROOT/'_source'/f"{spec['base']}.png")
        if spec.get('rotate'):
            base=base.rotate(spec['rotate'],expand=True)
        result=raster.icon(base,size,fill=tuple(spec['fill']) if 'fill' in spec else None,
                           margin=spec.get('margin'),outer=spec.get('outer'),inner=spec.get('inner'))
        save_source(base,source_path,spec)
    elif mode=='composite':
        master=Image.new('RGBA',(size[0]*4,size[1]*4))
        for part in spec['parts']:
            base=Image.open(ROOT/'_source'/f"{part['name']}.png")
            if part.get('crop'):
                base=raster.texture_mask(base)
                x0,y0,x1,y1=part['crop']
                base=base.crop((round(base.width*x0),round(base.height*y0),round(base.width*x1),round(base.height*y1)))
            if part.get('select')=='water_drops':
                data=np.array(base.convert('RGBA'))
                rgb=data[:,:,:3].astype(float)
                water=(rgb[:,:,2]>rgb[:,:,0]*1.6)&(rgb[:,:,2]>rgb[:,:,1]*1.12)
                data[~water,3]=0
                base=Image.fromarray(data)
            if part.get('flip'):
                base=base.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if part.get('rotate'):
                base=base.rotate(part['rotate'],expand=True)
            x,y,w,h=part['box']
            if part.get('stretch'):
                base=raster.texture_mask(base).resize((w*8,h*8),Image.Resampling.LANCZOS)
            settings={'margin':0,'outer':0,'inner':0} if spec.get('tight_parts') else {'margin':part.get('margin')}
            piece=raster.icon(base,(w*4,h*4),fill=tuple(part['fill']) if 'fill' in part else None,**settings)
            master.alpha_composite(piece,(x*4,y*4))
        save_source(master,source_path,spec)
        result=raster.icon(master,size,margin=spec.get('margin',4),outer=spec.get('outer',0),inner=spec.get('inner',0))
    else:
        if not source_path.is_file() and spec.get('base'):
            save_source(Image.open(ROOT/'_source'/f"{spec['base']}.png"),source_path,spec)
        source=Image.open(source_path).convert('RGBA')
        source=clean_alpha(source)
        save_source(source,source_path,spec)
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
        elif mode=='bubble':
            result=raster.bubble(source,size,tuple(spec['slice']))
        else:
            result=raster.icon(source,size,margin=spec.get('margin'),outer=spec.get('outer'),inner=spec.get('inner'))
            if name=='mother_bubble_tail':
                data=np.array(result)
                rgb=data[:,:,:3].astype(float)
                paper=(data[:,:,3]==255)&(rgb[:,:,0]>195)&(rgb[:,:,1]>175)&(rgb[:,:,2]>125)&(rgb[:,:,1]>rgb[:,:,0]*.8)
                data[paper,:3]=raster.PAPER
                result=Image.fromarray(data)
        if 'fill' in spec:
            result=recolor(result,tuple(spec['fill']))
        if spec.get('ink_details'):
            result=ink_details(result)
    if spec.get('auto_hotspot')=='tip':
        ys,xs=np.where(np.array(result.getchannel('A'))>=128)
        scores=xs+ys
        p=int(np.argmin(scores))
        spec['hotspot']=[int(xs[p]),int(ys[p])]
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
            if catalog[name].get('style_version')!=2:
                small=raster.finish(small,small.size)
            small.save(ROOT/'_preview'/f'{name}_24.png')
            d.text((x+12,y+238),'24 px',font=font(13),fill=INK)
            if 'hotspot' in catalog[name]:
                d.text((x+198,y+238),'hotspot: '+','.join(map(str,catalog[name]['hotspot'])),font=font(13),fill=INK)
            paste_center(sheet,small,(x+64,y+233,30,30))
            d.rectangle((x+104,y+232,x+135,y+263),fill=DARK)
            paste_center(sheet,small,(x+105,y+233,30,30))
            if name.endswith('_light'):
                d.rectangle((x+154,y+232,x+185,y+263),fill='#C0392B')
                paste_center(sheet,small,(x+155,y+233,30,30))
        sheet.save(ROOT/'_preview'/f'sheet_{group}.png')
    make_index(images,catalog,stage)


def make_index(images,catalog,stage):
    # A compact index for the current stage without hiding per-group exact-size sheets.
    names=[n for n in images if catalog[n]['stage']==stage]
    if stage==8:
        names=[n for n in ['res_clay','res_wood','res_stone','res_food','res_special','res_people','tool_axe','tool_pickaxe','tool_rod','tool_spear','mood_happy','mood_scared','build_hut','build_house','build_storage','build_workshop','build_kiln','build_idol','build_wall','build_gate','build_totem','job_heal','job_carry','job_warrior','glyph_pause','glyph_pause_light','glyph_settings','glyph_settings_light','glyph_alarm_on','glyph_alarm_on_light','alert_spider','alert_big_rain','cursor_default','cursor_hover','cursor_build','cursor_forbid','cursor_attack','cursor_wait','minimap_mother_hands','mother_bubble'] if n in images]
    cols=5
    index=Image.new('RGBA',(1400,90+math.ceil(len(names)/cols)*230),PAPER)
    d=ImageDraw.Draw(index)
    d.text((24,18),f'CLAYFOLK / HUD · '+(f'{len(images)} PNG · итоговый обзор' if stage==8 else f'этап {stage}'),font=font(30,True),fill=INK)
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
    if stage==8:
        index.save(ROOT/'_preview'/'overview.png')


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
            if 'parts' in spec:
                prompt+=' | Composite recipe: '+json.dumps(spec['parts'],ensure_ascii=False,separators=(',',':'))
            if not source:
                if spec.get('style_version')==2:
                    prompt+=' | HUD v2 finishing: hud_v2.py; normalized cream/orange 9-slice geometry and inset soft shadow, or premultiplied-alpha sprite resize; no v1 ink contour.'
                    prompt+=' | V2 recipe: '+json.dumps({k:v for k,v in spec.items() if k.startswith('v2_')},ensure_ascii=False,separators=(',',':'))
                else:
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
    if any(s.get('style_version')==2 for s in load_catalog().values()):
        parser.error('HUD v2 migration started. Use build_hud_v2.py for the approved scope; v1 rebuild would also change unrevised derivatives.')
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
    CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    make_board(images)
    make_sheets(images,catalog,args.stage)
    write_manifest(catalog)
    print(f'Stage {args.stage}: {len(images)} game PNGs built; sources, sheets, manifest updated.')


if __name__=='__main__':
    main()
