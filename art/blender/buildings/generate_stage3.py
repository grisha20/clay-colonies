"""Round carved idol and a three-face clay clan totem, Blender 4.5."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import math
from building_kit import Builder,palette,reset,export


def oval(b,center,scale,tile=6,sides=12,rings=6):
    cx,cy,cz=center;sx,sy,sz=scale
    vertices=[(cx,cy,cz-sz),(cx,cy,cz+sz)]
    for row in range(1,rings):
        a=-math.pi/2+math.pi*row/rings
        for i in range(sides):
            angle=math.tau*i/sides
            vertices.append((cx+sx*math.cos(a)*math.cos(angle),cy+sy*math.cos(a)*math.sin(angle),cz+sz*math.sin(a)))
    faces=[]
    for i in range(sides):
        n=(i+1)%sides
        faces.extend([(0,2+n,2+i),(1,2+(rings-2)*sides+i,2+(rings-2)*sides+n)])
    for row in range(rings-2):
        for i in range(sides):
            n=(i+1)%sides;a=2+row*sides
            faces.append((a+i,a+n,a+sides+n,a+sides+i))
    b.add(vertices,faces,tile)


def loop(b,center,rx,rz,radius,tile=6,sides=12):
    x,y,z=center
    points=[(x+rx*math.cos(math.tau*i/sides),y,z+rz*math.sin(math.tau*i/sides)) for i in range(sides+1)]
    b.tube(points,[radius]*len(points),tile,5,across=(0,1,0))


def idol(atlas):
    reset();b=Builder('IdolV2')
    oval(b,(0,0,.22),(1.03,.61,.22),13,14,4)
    oval(b,(0,0,.93),(.66,.41,.75),13,12,4)
    oval(b,(0,0,1.56),(.70,.44,.16),6,12,4)
    oval(b,(0,0,2.43),(1.18,.54,1.00),6,16,8)
    for side in (-1,1):
        oval(b,(side*.67,-.03,1.16),(.24,.28,.39),6,8,4)
        loop(b,(side*1.26,-.03,2.40),.20,.30,.105,13,10)
    # Eight large clay crest segments read as carved petals at game distance.
    for i in range(9):
        a=math.pi*i/8
        oval(b,(math.cos(a)*1.20,.08,2.43+math.sin(a)*.99),(.24,.29,.25),13,8,4)
    for x,z,scale in [(-.48,2.50,.20),(.48,2.50,.20),(0,3.02,.14)]:
        oval(b,(x,-.49,z),(scale*1.22,.105,scale*1.22),5,10,4)
        loop(b,(x,-.51,z),scale*1.18,scale*1.18,.045,13,10)
        oval(b,(x,-.57,z),(scale*.79,.115,scale*.83),12,10,5)
    oval(b,(0,-.54,2.12),(.105,.07,.14),5,8,4)
    # Incised M on the short body, and short cheek/base incisions.
    for a,c in [((-.42,-.38,.47),(-.32,-.40,1.30)),((-.32,-.40,1.30),(0,-.43,.78)),
                ((0,-.43,.78),(.32,-.40,1.30)),((.32,-.40,1.30),(.42,-.38,.47))]:b.beam(a,c,.028,5,4)
    for side in (-1,1):
        for i in range(3):b.beam((side*.82,-.38,2.05+i*.16),(side*.98,-.31,2.12+i*.16),.025,5,4)
    for x in (-.7,-.35,0,.35,.7):b.beam((x,-.49,.10),(x,-.53,.29),.025,5,4)
    export('idol',[b.object(atlas,0)],(1.8,1,0),(3.676586*.8,3.676586*1.2))


def totem(atlas):
    reset();b=Builder('TotemV2')
    oval(b,(0,0,.21),(.91,.64,.21),6,12,4)
    b.tube([(0,0,.15),(0,0,3.84)],[.34,.32],10,10)
    for i,z in enumerate((.94,2.07,3.20)):
        # Broad cylindrical mask plaques, with softened corners; do not make
        # the three faces into narrow balls on the central wooden pole.
        b.tube([(0,0,z+d) for d in (-.54,-.49,-.41,.41,.49,.54)],
               [0,(.56,.36),(.65,.43),(.65,.43),(.56,.36),0],6,12)
        for side in (-1,1):
            oval(b,(side*.60,-.10,z),(.10,.14,.16),1,8,4)
            oval(b,(side*.25,-.403,z+.11),(.16,.035,.069),5,8,4)
            slope=.06 if i==2 else -.035 if i==1 else 0
            b.tube([(side*.43,-.43,z+.27+slope),(side*.26,-.49,z+.30),(side*.09,-.46,z+.24-slope)],
                   [.09,.115,.09],1,5)
        oval(b,(0,-.45,z+.03),(.14,.16,.23),6 if i!=0 else 1,8,4)
        # Happy, stern, angry: three clearly different sculpted mouth curves.
        curve=.10 if i==1 else -.09 if i==2 else -.06
        points=[(-.39,-.43,z-.20+curve),(-.20,-.50,z-.20),(0,-.54,z-.20-curve*.5),(.20,-.50,z-.20),(.39,-.43,z-.20+curve)]
        b.tube(points,[.11]*5,1 if i!=1 else 13,5)
        b.tube([(x,y-.09,zz+.042) for x,y,zz in points],[.031]*5,5,4)
    # Clay cap; small separate jewel carries the runtime tribe colour.
    b.tube([(0,0,3.74),(0,0,3.84),(0,0,3.91)],[(.61,.40),(.60,.40),(.57,.37)],10,12)
    body=b.object(atlas,0)
    accent=Builder('TribeAccent');oval(accent,(0,-.40,3.58),(.13,.07,.14),12,10,4)
    export('totem',[body,accent.object(atlas,0)],(1.1,.8,0),(4.407253*.8,4.407253*1.2))


atlas=palette();idol(atlas);totem(atlas)
