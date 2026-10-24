"""Unretouched game render and the original HUD card source, side by side."""
from pathlib import Path
import argparse,json,struct
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'docs/godot/screenshots/buildings_v2'
NAMES={'house':'Дом рода','storage':'Склад','workshop':'Мастерская','kiln':'Печь','campfire':'Костёр','idol':'Идол','totem':'Тотем'}

def font(size,bold=False):return ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',size)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=['1','2','3'],required=True);args=parser.parse_args()
    names={'1':['house','storage','workshop'],'2':['kiln','campfire'],'3':['idol','totem']}[args.stage]
    overview=Image.new('RGB',(1500,80+len(names)*560),'#F3E8D2');od=ImageDraw.Draw(overview)
    od.text((22,20),'CLAYFOLK · ПОСТРОЙКИ · ЭТАП '+args.stage,font=font(28,True),fill='#4D331F')
    for index,name in enumerate(names):
        board=Image.new('RGB',(1920,1080),'#F3E8D2');d=ImageDraw.Draw(board)
        d.text((26,18),NAMES[name]+' · модель / карточка build_'+name,font=font(30,True),fill='#4D331F')
        game=Image.open(OUT/(name+'_close.png')).convert('RGB').crop((360,0,1560,1000))
        game.thumbnail((930,850),Image.Resampling.LANCZOS);board.paste(game,(20+(930-game.width)//2,100))
        reference=Image.open(ROOT/'art/hud/_source'/('build_'+name+'.png')).convert('RGBA')
        reference.thumbnail((900,850),Image.Resampling.LANCZOS)
        rgba=board.convert('RGBA');rgba.alpha_composite(reference,(980+(900-reference.width)//2,100+(850-reference.height)//2));board=rgba.convert('RGB');d=ImageDraw.Draw(board)
        raw=(ROOT/'godot/assets/models/buildings'/(name+'_v2.glb')).read_bytes();length=struct.unpack_from('<I',raw,12)[0];gltf=json.loads(raw[20:20+length])
        triangles=sum(gltf['accessors'][p['indices']]['count']//3 for mesh in gltf['meshes'] for p in mesh['primitives'])
        d.text((28,990),f'Игровая камера 52° · свет QA-мира · {triangles} треугольников',font=font(25),fill='#4D331F')
        d.text((28,1030),'Солома — округлые бугристые пучки, без древесных волокон',font=font(23),fill='#775436')
        board.save(OUT/(name+'_compare.png'),optimize=True)
        mini=board.resize((996,560),Image.Resampling.LANCZOS)
        # Full comparison sheets remain separate at 1920x1080; this index is
        # only a compact contact sheet, not the sharpness reference.
        overview.paste(mini,(252,80+index*560))
        od.text((20,105+index*560),NAMES[name],font=font(23,True),fill='#4D331F')
    overview.save(OUT/('stage'+args.stage+'_compare.png'),optimize=True)

if __name__=='__main__':main()
