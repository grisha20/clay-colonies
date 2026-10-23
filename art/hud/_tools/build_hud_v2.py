"""Build only explicitly approved HUD v2 stages; stage 0 is six samples."""
import argparse,json,sys
sys.dont_write_bytecode=True
from PIL import Image,ImageDraw
from build_hud import ROOT,CATALOG,load_catalog,build_one,make_sheets,write_manifest
from build_stage0 import font,paste_center,nine_slice
from hud_v2 import SAMPLES,clean_source


def setup_catalog(catalog,entries):
    for entry in entries:
        name=entry['name']
        if name not in SAMPLES:
            raise ValueError('Only v2 stage-0 samples may be imported')
        spec=catalog[name]
        for key in ('base','parts','fill','palette','brightness','ink_details'):
            spec.pop(key,None)
        kind='panel' if name=='ui_panel' else ('button' if name.startswith('btn_square') else ('card' if name.startswith('card_') else 'sprite'))
        spec.update(style_version=2,v2_stage=0,mode='v2',v2_kind=kind,source_max=1024,prompt=entry['prompt'])
        if kind in ('panel','card','button'):
            spec['slice']=[26,24,26,30] if kind=='button' else [32,32,32,36]
            spec['v2_fill_top']=[251,243,227] if kind=='panel' else [255,248,236]
            spec['v2_border']=[227,201,160]
            if name=='btn_square_pressed':
                spec.update(v2_fill_top=[247,168,70],v2_fill_bottom=[229,125,34],v2_border=[201,102,26])
            if kind=='card':
                spec.update(v2_fill_top=[252,221,176],v2_border=[201,102,26])
        else:
            spec['v2_margin']=10 if name=='res_wood' else 5
            if name=='job_build':
                spec['v2_flip']=True
        if name.startswith('btn_square_') or kind=='card':
            spec['state']=name.rsplit('_',1)[1]
        source=clean_source(Image.open(entry['generated_path']),preserve_cream=kind!='sprite')
        source.save(ROOT/'_source'/f'{name}.png',optimize=True)


def style_board(catalog):
    board=Image.new('RGBA',(1440,1340),'#EEE8DD')
    d=ImageDraw.Draw(board)
    d.text((22,16),'CLAYFOLK · HUD v2 · этап 0',font=font(30,True),fill='#5A3A22')
    d.text((24,55),'6 образцов · готовый размер и 24 px · фрагменты макета справа',font=font(19),fill='#5A3A22')
    for i,color in enumerate(('#FBF3E3','#E3C9A0','#F7A846','#E57D22','#FCDDB0')):
        x=785+i*128
        d.rounded_rectangle((x,15,x+32,46),radius=7,fill=color)
        d.text((x,55),color,font=font(14),fill='#5A3A22')
    with Image.open(ROOT.parents[1]/'docs/godot/reference/hud_target.png') as ref:
        reference=ref.convert('RGBA')
    sx,sy=reference.width/1672,reference.height/941
    crops={'ui_panel':(1338,82,1665,205),'btn_square_normal':(1332,16,1386,78),
           'btn_square_pressed':(1387,16,1442,78),'res_wood':(765,15,811,64),
           'job_build':(1351,330,1401,374),'card_build_pressed':(432,780,568,925)}
    for i,name in enumerate(SAMPLES):
        x,y=(i%2)*720,98+(i//2)*320
        d.rounded_rectangle((x+10,y+4,x+710,y+310),radius=14,fill='#FAF7EF')
        spec=catalog[name]
        d.text((x+26,y+17),name,font=font(21,True),fill='#5A3A22')
        im=Image.open(ROOT/f'{name}.png').convert('RGBA')
        d.text((x+26,y+47),f'{im.width}×{im.height} · '+('9-slice '+','.join(map(str,spec['slice'])) if spec.get('slice') else 'объём без обводки'),font=font(15),fill='#75543B')
        d.rounded_rectangle((x+190,y+78,x+354,y+244),radius=8,fill='#2B2118')
        paste_center(board,im,(x+22,y+78,164,166))
        paste_center(board,im,(x+190,y+78,164,166))
        d.text((x+390,y+79),'ФРАГМЕНТ МАКЕТА',font=font(15,True),fill='#75543B')
        box=tuple(round(v*(sx if j%2==0 else sy)) for j,v in enumerate(crops[name]))
        crop=reference.crop(box)
        scale=min(2,286/crop.width,154/crop.height)
        crop=crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
        paste_center(board,crop,(x+386,y+105,290,154))
        small=im.resize((round(im.width*24/max(im.size)),round(im.height*24/max(im.size))),Image.Resampling.LANCZOS)
        d.text((x+26,y+266),'24 px',font=font(15),fill='#75543B')
        paste_center(board,small,(x+88,y+258,36,36))
        d.rectangle((x+142,y+258,x+177,y+293),fill='#2B2118')
        paste_center(board,small,(x+142,y+258,36,36))
        d.text((x+206,y+266),'Светлый / тёмный фон',font=font(14),fill='#75543B')
    d.text((24,1080),'Проверка растяжения 9-slice · без рисунка и текста в центре',font=font(23,True),fill='#5A3A22')
    x=24
    for name,size in [('ui_panel',(390,170)),('btn_square_normal',(145,64)),('btn_square_pressed',(145,64)),('card_build_pressed',(260,170))]:
        im=Image.open(ROOT/f'{name}.png').convert('RGBA')
        stretched=nine_slice(im,size,tuple(catalog[name]['slice']))
        board.alpha_composite(stretched,(x,1130))
        x+=size[0]+64
    board.save(ROOT/'_preview'/'style_board_v2.png')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--stage',type=int,choices=[0],required=True)
    parser.add_argument('--import-generated',type=str)
    args=parser.parse_args()
    catalog=load_catalog()
    if args.import_generated:
        setup_catalog(catalog,json.loads(open(args.import_generated,encoding='utf-8').read()))
        CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    images={}
    for name in SAMPLES:
        if catalog[name].get('style_version')!=2:
            raise ValueError('Import all six v2 sources first')
        images[name]=build_one(name,catalog[name],images)
    images={n:Image.open(ROOT/f'{n}.png').convert('RGBA') for n in catalog}
    make_sheets(images,catalog,8)
    style_board(catalog)
    write_manifest(catalog)
    print('HUD v2 stage 0: six samples, sources <=1024px, sheets + manifest updated. STOP for owner approval.')


if __name__=='__main__':
    main()
