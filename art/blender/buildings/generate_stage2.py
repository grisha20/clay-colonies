"""Clay kiln and hearth, preserving the game's separate animated fire nodes."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import math
import bpy
import bmesh
from mathutils import Vector
from building_kit import Builder,palette,reset,export


def kiln(atlas):
    reset();b=Builder('KilnV2');sides=32
    # Closed wall thickness around an open chimney; the mouth is cut below.
    profile=[(1.55,0),(1.70,.22),(1.66,.74),(1.40,1.38),(.92,1.93),
             (.49,2.16),(.45,2.72),(.51,2.84),(.48,2.96),(.34,3.00),
             (.29,2.85),(.28,2.13),(.70,1.88),(1.15,1.29),(1.38,.20)]
    vertices=[(r*math.cos(math.tau*i/sides),r*.79*math.sin(math.tau*i/sides),z)
              for r,z in profile for i in range(sides)]
    for row in range(len(profile)):
        n=(row+1)%len(profile)
        faces=[(row*sides+i,row*sides+(i+1)%sides,n*sides+(i+1)%sides,n*sides+i) for i in range(sides)]
        b.add(vertices,faces,0 if row<9 else 5)
    # Rounded arch rim, with a real air opening rather than a painted oval.
    arch=[(-.69,-1.40,.02),(-.69,-1.40,.61)]
    arch +=[(.69*math.cos(math.pi-i*math.pi/12),-1.40,.61+.69*math.sin(math.pi-i*math.pi/12)) for i in range(13)]
    arch +=[(.69,-1.40,.02)]
    b.tube(arch,[.16]*len(arch),6,6,across=(0,1,0))
    b.beam((-.62,-1.4,.09),(.62,-1.4,.09),.13,6,6)
    obj=b.object(atlas,.3)
    # Extruded arch cutter extends from the exterior into the hollow chamber.
    outline=[(-.51,-.12),(.51,-.12),(.51,.60)]
    outline +=[(.51*math.cos(i*math.pi/16),.60+.51*math.sin(i*math.pi/16)) for i in range(1,17)]
    vs=[(x,y-.3,z) for y in (-2.0,-.35) for x,z in outline];n=len(outline)
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    fs +=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new('MouthCut');mesh.from_pydata(vs,[],fs);mesh.update()
    cutter=bpy.data.objects.new('MouthCut',mesh);bpy.context.collection.objects.link(cutter)
    for item in (obj,cutter):
        bm=bmesh.new();bm.from_mesh(item.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        loose=[v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm,geom=loose,context='VERTS')
        bm.to_mesh(item.data);bm.free()
    bpy.context.view_layer.objects.active=obj
    modifier=obj.modifiers.new('RealArchedOpening','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
    bpy.ops.object.modifier_apply(modifier=modifier.name);bpy.data.objects.remove(cutter,do_unlink=True)
    hit,point,normal,index=obj.ray_cast(Vector((0,-2.7,.55)),Vector((0,1,0)))
    assert hit and point.y>-.5,('mouth must open into chamber',tuple(point))
    hit,point,normal,index=obj.ray_cast(Vector((0,-.3,3.3)),Vector((0,0,-1)))
    assert not hit or point.z<.25,('chimney must be open',tuple(point))
    export('kiln',[obj],(2.4,1.7,.3),(3.090272*.8,3.090272*1.2))


def campfire(atlas):
    reset();b=Builder('CampfireV2')
    for i in range(7):
        a=math.tau*i/7
        b.lump((math.cos(a)*.48,math.sin(a)*.48,.13),(.145,.14,.14),8+i%2,8)
    for i in range(3):
        a=math.tau*i/3+.2;c,s=math.cos(a),math.sin(a)
        b.beam((-c*.39,-s*.39,.17),(c*.35,s*.35,.24),.115,4,8)
        # End grain on the front of each cut log.
        b.lump((-c*.39,-s*.39,.17),(.098,.098,.098),7,6)
    b.lump((0,0,.08),(.32,.31,.06),11,10)
    b.vertices=[(x,y,z*1.12) for x,y,z in b.vertices]
    # The animated flame supplies the remaining height of the old hearth.
    export('campfire',[b.object(atlas,0)],(.65,.65,0),(.46*.8,.46*1.2))


atlas=palette();kiln(atlas);campfire(atlas)
