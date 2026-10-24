"""House, storage and workshop: Blender 4.5 background script for stage 1."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import math
import bpy
from building_kit import Builder,palette,reset,export


def house(atlas):
    reset();b=Builder('HouseV2')
    # Rounded clay shell, with the front door represented by separate timbers.
    sides=24;vertices=[];faces=[]
    for z,r in [(0,.96),(.18,1),(2.15,.98),(2.43,.93)]:
        for i in range(sides):
            a=math.tau*i/sides;vertices.append((3.10*r*math.cos(a),1.66*r*math.sin(a),z))
    for row in range(3):
        for i in range(sides):
            j=(i+1)%sides;a=row*sides+i;c=row*sides+j
            faces.append((a,c,c+sides,a+sides))
    b.add(vertices,faces,0)
    b.round_roof(3.56,1.98,4.65,2.50,36,102)
    b.round_roof(2.85,1.57,4.88,3.45,24,202)
    b.round_roof(1.82,1.02,5.05,4.18,16,302)
    for z,r,h in [(5.0,.43,.22),(5.19,.34,.25)]:b.lump((0,0,z+h*.5),(r,r*.63,h*.5),6,12)
    # Shut plank door and thick terracotta jambs like build_house.
    b.box((0,-1.66,.88),(1.05,.14,1.76),10)
    for x in (-.35,0,.35):b.beam((x,-1.76,.10),(x,-1.76,1.64),.14,4,5)
    for x in (-.62,.62):b.beam((x,-1.76,0),(x,-1.76,1.90),.17,6,6)
    b.beam((-.67,-1.76,1.87),(.67,-1.76,1.87),.17,6)
    obj=b.object(atlas,.5)
    # Small owner-colour medallion; only this mesh receives a runtime override.
    badge=Builder('TribeAccent');badge.lump((.81,-1.70,1.73),(.15,.08,.15),12,6)
    accent=badge.object(atlas,.5)
    export('house',[obj,accent],(4,2.3,.5),(4.852749*.8,4.852749*1.2))


def storage(atlas):
    reset();b=Builder('StorageV2')
    for x in (-2.10,2.10):
        for y in (-.91,.91):b.beam((x,y,0),(x,y,1.76),.16)
    for y in (-.93,.93):b.beam((-2.33,y,1.62),(2.33,y,1.62),.14)
    for x in (-2.10,2.10):b.beam((x,-1.02,1.59),(x,1.02,1.59),.13)
    for x in (-2.10,2.10):
        b.beam((x,0,2.43),(x,-1.30,1.57),.12)
        b.beam((x,0,2.43),(x,1.30,1.57),.12)
        b.beam((x,-.90,.94),(x,-.24,1.61),.11)
    b.pitched_roof(2.45,1.30,1.65,2.38,11,510)
    b.beam((-2.57,0,2.44),(2.57,0,2.44),.13)
    # Rope lashings as solid rounded collars, not texture lines in the straw.
    for x in (-2.10,2.10):
        for z in (.35,1.28):b.beam((x-.18,-.93,z),(x+.18,-.93,z),.065,14,5)
    for row in range(2):
        for col in range(3):
            x=-1.63+col*.43+row*.18;z=.23+row*.36
            b.beam((x,-.72,z),(x,.68,z),.21,4,7)
    for i,(x,y,z) in enumerate([(.35,-.48,.25),(.91,-.53,.25),(1.47,-.48,.24),(.64,-.09,.60),(1.22,.03,.59)]):
        b.lump((x,y,z),(.36,.31,.27),8+i%2,7)
    export('storage',[b.object(atlas)],(3.4,2.1,.6),(2.216812*.8,2.216812*1.2))


def gear(b,x,y,z,r):
    count=32;vertices=[];faces=[]
    for depth in (-.065,.065):
        for radius in ('outer','inner'):
            for i in range(count):
                a=math.tau*i/count;rr=(r if i%4 in (1,2) else r*.78) if radius=='outer' else r*.43
                vertices.append((x+rr*math.cos(a),y+depth,z+rr*math.sin(a)))
    for i in range(count):
        j=(i+1)%count
        faces.extend([(i,j,32+j,32+i),(64+i,96+i,96+j,64+j),(i,64+i,64+j,j),(32+i,32+j,96+j,96+i)])
    b.add(vertices,faces,7)
    b.lump((x,y-.09,z),(.19,.10,.19),7,8)


def workshop(atlas):
    reset();b=Builder('WorkshopV2')
    b.box((0,0,1.15),(5.93,2.50,2.25),15)
    for x in (-3.0,3.0):
        for y in (-1.30,1.30):
            b.beam((x,y,0),(x,y,2.51),.18)
            b.lump((x,y,.20),(.24,.24,.22),4,6)
            b.lump((x,y,2.40),(.24,.24,.22),4,6)
    for y in (-1.34,1.34):
        b.beam((-3.09,y,.18),(3.09,y,.18),.16)
        b.beam((-3.13,y,2.36),(3.13,y,2.36),.16)
    for x in (-3.0,3.0):
        b.beam((x,-1.3,.20),(x,1.3,2.35),.12)
        b.beam((x,1.3,.20),(x,-1.3,2.35),.12)
    b.pitched_roof(3.33,1.65,2.48,3.60,13,701)
    for x in (-3.35,3.35):
        b.beam((x,0,3.66),(x,-1.70,2.46),.17)
        b.beam((x,0,3.66),(x,1.70,2.46),.17)
    b.beam((-3.51,0,3.65),(3.51,0,3.65),.18)
    b.box((-1.12,-1.32,.92),(1.15,.14,1.78),10)
    for x in (-1.50,-1.12,-.74):b.beam((x,-1.43,.10),(x,-1.43,1.74),.16,4,5)
    for x in (-1.78,-.46):b.beam((x,-1.44,0),(x,-1.44,1.81),.12)
    b.beam((-1.81,-1.44,1.78),(-.43,-1.44,1.78),.12)
    b.lump((-.75,-1.60,.98),(.10,.065,.10),7,6)
    gear(b,1.05,-1.43,1.09,.72)
    # Rounded verge-beam ends must also stay inside the server ellipse.
    b.vertices=[(x*.98,y*.98,z) for x,y,z in b.vertices]
    export('workshop',[b.object(atlas)],(4.6,2.6,.6),(3.365675*.8,3.365675*1.2))


def main():
    reset();atlas=palette()
    house(atlas);storage(atlas);workshop(atlas)

if __name__=='__main__':main()
