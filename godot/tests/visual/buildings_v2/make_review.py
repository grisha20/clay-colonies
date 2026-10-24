"""Assemble actual game captures and the untouched large card source for review."""
from pathlib import Path
import json
import struct
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent

def font(size,bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',size)

def main():
    board=Image.new('RGBA',(1920,1440),'#F3E8D2')
    draw=ImageDraw.Draw(board)
    draw.text((30,20),'CLAYFOLK · ПОСТРОЙКИ · ЭТАП 0',font=font(32,True),fill='#4D331F')
    draw.text((32,65),'Образец хижины · настоящая 3D-модель и референс карточки',font=font(23),fill='#775436')
    for box in [(18,105,950,880),(970,105,1902,880),(18,900,950,1425),(970,900,1902,1425)]:
        draw.rounded_rectangle(box,radius=16,fill='#FFF7E9',outline='#C6A178',width=2)
    draw.text((38,122),'В ИГРЕ · КРУПНО · КАМЕРА 52°',font=font(23,True),fill='#4D331F')
    # Native screenshot pixels only, no repainting/sharpening or new lighting.
    close=Image.open(HERE/'hut_close.png').convert('RGBA').crop((480,60,1440,860))
    close.thumbnail((900,700),Image.Resampling.LANCZOS)
    board.alpha_composite(close,(35+(900-close.width)//2,170))
    draw.text((995,122),'BUILD_HUT · ИСХОДНИК КАРТОЧКИ',font=font(23,True),fill='#4D331F')
    card=Image.open(ROOT/'art/hud/_source/build_hut.png').convert('RGBA')
    card.thumbnail((820,700),Image.Resampling.LANCZOS)
    board.alpha_composite(card,(1020+(820-card.width)//2,165+(700-card.height)//2))
    world=Image.open(HERE/'hut_ingame.png').convert('RGBA')
    world.thumbnail((900,506),Image.Resampling.LANCZOS)
    board.alpha_composite(world,(34,910))
    data=(ROOT/'godot/assets/models/buildings/hut_v2.glb').read_bytes()
    length=struct.unpack_from('<I',data,12)[0]
    gltf=json.loads(data[20:20+length])
    triangles=sum(gltf['accessors'][p['indices']]['count']//3 for mesh in gltf['meshes'] for p in mesh['primitives'])
    lines=[('Хижина в живом QA-поселении',28,True),
           ('Терракота · два яруса соломы · дерево',24,False),
           (f'{triangles} треугольника · 1 материал',24,False),
           ('Непрозрачный атлас 1024 × 1024',24,False),
           ('Основание сохранено, вход с прежней стороны',23,False),
           ('Стройка, свет у двери и удар сохранены',23,False)]
    y=965
    for text,size,bold in lines:
        draw.text((1000,y),text,font=font(size,bold),fill='#4D331F');y+=58
    board.convert('RGB').save(HERE/'hut_vs_card.png',optimize=True)
    print('REVIEW',HERE/'hut_vs_card.png')

if __name__=='__main__':main()
