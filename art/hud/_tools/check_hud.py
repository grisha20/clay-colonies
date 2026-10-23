"""HUD specification §8. Default: entire specification; --stage 0: approved scope only."""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from PIL import Image
import numpy as np
from scipy.ndimage import distance_transform_edt
sys.dont_write_bytecode = True
from build_stage0 import ROOT, SPECS, nine_slice
from build_hud import load_catalog

STATES = ('normal', 'hover', 'pressed', 'disabled')
FAMILIES = ['btn_square', 'ui_button_wide', 'ui_btn_plus', 'ui_btn_minus', 'card_build']
SLICE_NAMES = {
    'brand_plate', 'ui_panel', 'ui_panel_dark', 'ui_header', 'ui_tooltip',
    'ui_bar_bg', 'ui_bar_fill_green', 'ui_bar_fill_amber', 'ui_bar_fill_red',
    'ui_scroll_track', 'ui_scroll_grabber', 'card_resident_panel',
    'minimap_frame', 'mother_bubble', 'menu_panel',
}
GROUPS = {
    'res': 'clay special food berries fish meat wood stone water people bones fiber',
    'tool': 'axe pickaxe rod spear',
    'mood': 'happy ok sad angry scared',
    'glyph': 'pause play fast faster settings alarm alarm_on follow deselect next_resident gather hand forbid',
    'build': 'hut house storage workshop kiln idol wall gate post totem harvest forbid erase campfire',
    'group': 'home defense land',
    'job': 'clay wood stone build guard fish hunt food heal carry warrior water_shot firing mother_auto manual',
    'act': 'idle walk carry chop dig mine build fish hunt guard fight eat sleep flee wounded',
    'task': 'clay food stone wood build_hut population idol_ritual survive_raid territory',
    'alert': 'raid spider beetle monster clouds rain big_rain alarm victory defeat',
    'time': 'day dusk night dawn',
    'weather': 'clear clouds rain',
    'minimap': 'camp_own camp_enemy enemy resident lake totem mother_hands',
    'cursor': 'default hover build brush forbid harvest attack grab rotate wait',
}
EXTRA = '''ui_separator_h ui_check ui_star ui_dot_green ui_dot_yellow ui_dot_red
card_resident_portrait_frame ui_heart mother_bubble_tail logo_clayfolk menu_background'''.split()
EXPECTED = {f'{group}_{name}' for group, names in GROUPS.items() for name in names.split()}
EXPECTED.update(SLICE_NAMES)
EXPECTED.update(EXTRA)
EXPECTED.update(f'{family}_{state}' for family in FAMILIES for state in STATES)
KNOWN_SIZES = {
    **{f'{g}_{n}': size for g, size in [('res',(128,128)),('tool',(96,96)),('mood',(64,64)),('glyph',(48,48)),('build',(128,112)),('group',(48,48)),('job',(64,64)),('act',(48,48)),('task',(48,48)),('alert',(64,64)),('time',(48,48)),('weather',(48,48)),('cursor',(64,64))] for n in GROUPS[g].split()},
    **{f'btn_square_{s}': (64,64) for s in STATES},
    **{f'card_build_{s}': (128,144) for s in STATES},
    **{f'ui_btn_{sign}_{s}': (32,32) for sign in ['plus','minus'] for s in STATES},
    **{f'minimap_{n}': (24,24) for n in 'camp_own camp_enemy enemy resident lake totem'.split()},
    **{n:(32,32) for n in 'ui_check ui_star ui_dot_green ui_dot_yellow ui_dot_red ui_heart mother_bubble_tail'.split()},
    'ui_panel': (128,128), 'ui_separator_h': (128,8),
    'card_resident_portrait_frame': (112,112), 'logo_clayfolk': (1024,384),
    'menu_background': (1920,1080),
}


def is_slice(name):
    return name in SLICE_NAMES or bool(load_catalog().get(name,{}).get('slice')) or any(name.startswith(f+'_') for f in FAMILIES)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', choices=[str(i) for i in range(9)]+['all'], default='all')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--assets-only',action='store_true',help='Check the portable art pack without this workstation\'s protected-file/worktree audit')
    args = parser.parse_args()
    report = []
    failures = []
    def out(line):
        report.append(line)
        print(line)
    def require(test, message):
        if not test:
            failures.append(message)
    with (ROOT/'manifest.csv').open(encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        require(reader.fieldnames == ['file','group','title_ru','where','size','states','slice','hotspot','prompt'], 'Manifest header')
        rows = list(reader)
    index = {r['file']:r for r in rows}
    require(len(index)==len(rows), 'Duplicate manifest rows')
    pngs = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*.png')}
    require(pngs==set(index), f'PNG/manifest mismatch: {pngs ^ set(index)}')
    top = {p.stem for p in ROOT.glob('*.png')}
    catalog=load_catalog()
    if args.stage=='all' or args.stage=='8':
        wanted=EXPECTED | {n+'_light' for n in EXPECTED if n.startswith('glyph_')}
    else:
        wanted={n for n,spec in catalog.items() if spec['stage']<=int(args.stage)}
    require(wanted <= top, 'Missing required assets: '+', '.join(sorted(wanted-top)))
    require(all(n in catalog or index.get(n+'.png',{}).get('group')=='extra' for n in top), 'Uncatalogued game assets')
    out(f'SCOPE: stage {args.stage}; {len(top)} game assets; {len(rows)} PNG manifest rows.')
    out('1. Inventory: '+('PASS' if not failures else 'FAIL'))
    before = len(failures)
    images = {}
    for file, row in index.items():
        p = ROOT/file
        require(p.resolve().is_relative_to(ROOT), f'Path outside art/hud: {file}')
        if not p.is_file():
            continue
        im = Image.open(p)
        images[file] = im
        require(re.fullmatch(r'\d+x\d+',row['size']) is not None, f'Invalid size: {file}')
        require(row['size']==f'{im.width}x{im.height}', f'Manifest size mismatch: {file}')
        if '/' not in file:
            name=p.stem
            expected_size=KNOWN_SIZES.get(name,KNOWN_SIZES.get(name.removesuffix('_light')))
            if expected_size:
                require(im.size==expected_size, f'Spec size mismatch: {file}')
            if name in catalog:
                require(im.size==tuple(catalog[name]['size']), f'Catalog size mismatch: {file}')
        require(im.format=='PNG' and im.mode=='RGBA', f'Not PNG RGBA: {file}')
        require(bool(row['title_ru'] and row['where'] and row['prompt']), f'Incomplete manifest row: {file}')
    out('2. Dimensions / PNG RGBA / metadata: '+('PASS' if before==len(failures) else 'FAIL'))
    for number, label in [(3,'Transparent corners'),(4,'No near-white semitransparent edges'),(5,'Margins >= 4 px (9-slice exempt)'),(6,'9-slice / cursor metadata')]:
        before = len(failures)
        for file, im in images.items():
            if im.mode!='RGBA' or file.startswith('_preview/'):
                continue
            row, name = index[file], Path(file).stem
            source = file.startswith('_source/')
            alpha = im.getchannel('A')
            texture = name=='menu_background' or name in {'ui_panel','ui_panel_dark','ui_header','ui_tooltip','menu_panel'}
            if number==3 and not texture:
                require(all(alpha.getpixel(p)==0 for p in [(0,0),(im.width-1,0),(0,im.height-1),(im.width-1,im.height-1)]), 'Opaque corner: '+file)
            elif number==4:
                data=np.array(im)
                rgb=data[:,:,:3]
                bad=int(np.sum((data[:,:,3]>0)&(data[:,:,3]<255)&(rgb.min(axis=2)>235)&(rgb.max(axis=2)-rgb.min(axis=2)<20)))
                require(bad==0, f'Near-white alpha edges: {file} ({bad} px)')
            elif number==5 and not source and not texture and not is_slice(name):
                bbox = alpha.getbbox()
                require(bbox is not None, 'Empty asset: '+file)
                if bbox:
                    margin = min(bbox[0],bbox[1],im.width-bbox[2],im.height-bbox[3])
                    require(margin>=4, f'Insufficient margin: {file} ({margin}px)')
            elif number==6 and not source:
                if is_slice(name):
                    try:
                        l,t,r,b = map(int,row['slice'].split(','))
                        require(min(l,t,r,b)>0 and l+r<im.width and t+b<im.height,'Invalid slice: '+file)
                    except ValueError:
                        require(False,'Missing/invalid slice: '+file)
                if name.startswith('cursor_'):
                    try:
                        x,y = map(int,row['hotspot'].split(','))
                        valid = 0<=x<im.width and 0<=y<im.height
                        require(valid,'Hotspot outside canvas: '+file)
                        if valid and name not in {'cursor_grab','cursor_rotate','cursor_wait'}:
                            require(alpha.getpixel((x,y))>0,'Hotspot on transparent pixel: '+file)
                        if name=='cursor_default':
                            require(x<=4 and y<=4,'Arrow tip too far from upper left: '+file)
                    except ValueError:
                        require(False,'Missing/invalid hotspot: '+file)
        out(f'{number}. {label}: '+('PASS' if before==len(failures) else 'FAIL'))
    before = len(failures)
    deferred = []
    for family in FAMILIES:
        present = {s for s in STATES if f'{family}_{s}' in top}
        if present and present != set(STATES):
            if args.stage not in ('all','8') and int(args.stage)<2 and family=='btn_square' and present=={'normal'}:
                deferred.append(family+': hover, pressed, disabled (stage 2)')
            else:
                require(False, f'Incomplete state family {family}: {present}')
        if present==set(STATES):
            variants = [images[f'{family}_{s}.png'] for s in STATES]
            require(len({im.size for im in variants})==1,'State sizes differ: '+family)
            require(len({im.getchannel('A').tobytes() for im in variants})==1,'State silhouettes differ: '+family)
    out('7. State families: '+('PASS' if before==len(failures) else 'FAIL')+(' (normal-only sample; full family in stage 2)' if deferred else ''))
    before=len(failures)
    for name in top:
        im=images[name+'.png']
        if name=='menu_background':
            continue
        data=np.array(im)
        a=data[:,:,3]
        partial=(a>0)&(a<255)
        require(np.all(data[partial,:3]==(77,51,31)), 'Translucent contour is not exact #4D331F: '+name)
        opaque=a==255
        if partial.any():
            distance=distance_transform_edt(~opaque)
            require(np.max(distance[partial])<=1.5,'Soft outer glow exceeds 1px coverage band: '+name)
        if name.startswith('glyph_') and not name.endswith('_light'):
            light=name+'_light'
            require(light in top, 'Missing light glyph: '+name)
            if light in top:
                li=images[light+'.png']
                require(li.size==im.size and li.getchannel('A').tobytes()==im.getchannel('A').tobytes(),'Light glyph silhouette mismatch: '+name)
                colors=np.array(li)
                require(np.any(np.all(colors[:,:,:3]==(242,227,189),axis=2)), 'Light glyph lacks parchment fill: '+name)
    out('8. Crisp #4D331F contour / 1px boundary / light glyphs: '+('PASS' if before==len(failures) else 'FAIL'))
    before=len(failures)
    for name in top:
        spec=catalog.get(name,{})
        if not spec.get('slice'):
            continue
        im=images[name+'.png']
        l,t,r,b=spec['slice']
        center=np.array(im)[t:im.height-b,l:im.width-r]
        if name!='ui_separator_h':
            require(np.all(center==center[0,0]),'9-slice center is not uniform: '+name)
        for size in [(im.width*2,im.height),(im.width,im.height*2)]:
            stretched=nine_slice(im,size,(l,t,r,b))
            for src,dest in [((0,0,l,t),(0,0,l,t)),((im.width-r,0,im.width,t),(size[0]-r,0,size[0],t)),((0,im.height-b,l,im.height),(0,size[1]-b,l,size[1])),((im.width-r,im.height-b,im.width,im.height),(size[0]-r,size[1]-b,size[0],size[1]))]:
                require(im.crop(src).tobytes()==stretched.crop(dest).tobytes(),'9-slice corner changed: '+name)
        if name in {'minimap_frame','card_resident_portrait_frame'}:
            require(not np.any(center[:,:,3]),'Frame center is not fully transparent: '+name)
        if name=='mother_bubble':
            # A uniform center alone does not catch a curved side abruptly
            # replaced by a straight strip. Compare silhouettes across joins.
            mask=np.array(im.getchannel('A'))>0
            for axis,seams in [(0,[t,im.height-b]),(1,[l,im.width-r])]:
                for seam in seams:
                    a=np.flatnonzero(np.take(mask,seam-1,axis=axis))
                    z=np.flatnonzero(np.take(mask,seam,axis=axis))
                    require(len(a)>0 and len(z)>0 and max(abs(int(a[0])-int(z[0])),abs(int(a[-1])-int(z[-1])))<=1,
                            'Speech bubble silhouette steps at slice join')
    out('9. 9-slice centers / corners / transparent frames / bubble joins: '+('PASS' if before==len(failures) else 'FAIL'))
    before=len(failures)
    for name in top:
        spec=catalog.get(name,{})
        if spec.get('source_max'):
            source=images.get('_source/'+name+'.png')
            require(source is not None and max(source.size)<=spec['source_max'],
                    'Revised source exceeds size cap: '+name)
        if name.startswith(('act_','task_')) and spec.get('source_max'):
            im=images[name+'.png']
            bbox=im.getbbox()
            extent=max(bbox[2]-bbox[0],bbox[3]-bbox[1]) if bbox else 0
            require(.82<=extent/max(im.size)<=.86,'Act/task subject does not occupy about 85%: '+name)
    out('10. Revised sources <=1024 px / act-task scale: '+('PASS' if before==len(failures) else 'FAIL'))
    for name in top:
        require((ROOT/'_source'/f'{name}.png').is_file(),'Missing large source: '+name)
        require((ROOT/'_preview'/f'{name}_24.png').is_file(),'Missing small preview: '+name)
    if 'btn_square_normal.png' in images:
        im=images['btn_square_normal.png']
        require(im.crop((16,16,48,48)).getextrema()==tuple((v,v) for v in im.getpixel((32,32))),'Button centre is not uniform')
        for size in [(128,64),(64,96),(192,64)]:
            stretched=nine_slice(im,size,(16,16,16,16))
            require(stretched.crop((0,0,16,16)).tobytes()==im.crop((0,0,16,16)).tobytes(),'9-slice altered corner')
    # Verify protected user files against the pre-work SHA-256 snapshot; never write there.
    baseline=ROOT/'_tools'/'protected_before.json'
    if baseline.is_file() and not args.assets_only:
        entries=json.loads(baseline.read_text(encoding='utf-8-sig'))
        for entry in entries:
            path=ROOT.parents[1]/entry['path']
            require(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest().upper()==entry['hash'], 'Protected file changed: '+str(path))
        out(f'Protected files: {len(entries)} SHA-256 comparisons.')
    repo=ROOT.parents[1]
    if not args.assets_only:
        changed=subprocess.run(['git','diff','--name-only','HEAD'],cwd=repo,capture_output=True,text=True,check=True).stdout.splitlines()
        require(all(p.startswith('art/hud/') for p in changed),'Tracked changes outside art/hud')
    else:
        out('Workspace audit: SKIPPED by explicit --assets-only; art checks remain enabled.')
    if args.stage not in ('all','8'):
        out(f'DEFERRED: {len(EXPECTED-top)} remaining specification assets'+('; '+', '.join(deferred) if deferred else '')+'.')
        out('Full §6 completeness is NOT claimed. Run --stage all for final delivery.')
    out(f'RESULT: {"PASS" if not failures else "FAIL"} — {len(failures)} errors.')
    for failure in failures:
        out('ERROR: '+failure)
    if args.report:
        path=args.report.resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Report must stay under art/hud')
        path.write_text('\n'.join(report)+'\n',encoding='utf-8')
    raise SystemExit(bool(failures))


if __name__=='__main__':
    main()
