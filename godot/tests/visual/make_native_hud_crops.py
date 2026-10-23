"""Crop original screenshot pixels for review; never enlarge or sharpen them."""
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
folder=ROOT/'docs/godot/screenshots/hud_layout'
image=Image.open(folder/'target_ingame.png').convert('RGBA')
if image.size!=(1920,1080):raise ValueError('Expected original 1920x1080 capture')
for name,box in {
    'hud_works_1to1':(1510,10,1915,665),
    'hud_build_1to1':(470,830,1450,1075),
    'hud_shield_1to1':(820,835,1090,887),
}.items():
    image.crop(box).save(folder/(name+'.png'),optimize=True)
    print(name,'native pixels, no resize')
