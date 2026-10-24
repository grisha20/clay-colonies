"""Clayfolk stage-0 hut, modelled against art/hud/build_hut.png.

Blender 4.5 --background --python-exit-code 1 --python this_file.py
All outputs stay in the two new buildings/ folders. No old source is opened.
The one opaque palette/texture atlas is ready to share with later buildings.
"""
from pathlib import Path
import json
import math
import struct
import zlib

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/blender/buildings"
EXPORT = ROOT / "godot/assets/models/buildings"
TAU = math.tau
VERTS, FACES, UVS = [], [], []


def png(path, rgb):
    height, width, _ = rgb.shape
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + row.tobytes() for row in rgb)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def atlas():
    # sRGB bytes, not bright linear base-color factors (the old roof was pale).
    colors = [(214,100,37), (239,177,61), (224,154,44), (245,190,78),
              (117,65,32), (57,27,15), (185,78,35), (159,70,31),
              (111,111,102), (149,142,120), (85,52,28), (67,38,22),
              (72,147,160), (183,76,44), (105,137,52), (244,202,113)]
    rng = np.random.default_rng(20261024)
    image = np.zeros((1024,1024,3), dtype=np.uint8)
    y, x = np.mgrid[0:256,0:256] / 256.0
    for i, color in enumerate(colors):
        noise = rng.normal(0, .012, (256,256))
        clay = noise.copy()
        for _ in range(70):
            cx,cy=rng.uniform(0,1,2);radius=rng.uniform(.003,.018)
            clay -= rng.uniform(.015,.07)*np.exp(-((x-cx)**2+(y-cy)**2)/(radius*radius))
        if i in (1,2,3,15):
            # Broad longitudinal straw fibres, already legible at a small mip.
            texture = .052*np.sin(x*116+np.sin(y*19)*.8) + .022*np.sin(x*360+y*5) + noise
        elif i in (4,10,11):
            texture = .07*np.sin(x*62+np.sin(y*9)*2) + .025*np.sin(x*172+y*4) + noise
        else:
            texture = clay
        tile = np.clip(np.array(color)[None,None,:]*(1+texture[:,:,None]),0,255).astype(np.uint8)
        image[(i//4)*256:(i//4+1)*256,(i%4)*256:(i%4+1)*256] = tile
    path = EXPORT / 'buildings_palette.png'
    png(path, image)
    return path


def part(vertices, faces, uvs, tile):
    offset = len(VERTS)
    VERTS.extend(vertices)
    FACES.extend(tuple(offset+i for i in face) for face in faces)
    # Gutters keep mip filtering away from neighbouring palette tiles.
    UVS.extend(((tile%4+.08+.84*u)/4, (3-tile//4+.08+.84*v)/4) for u,v in uvs)


def lathe(profile, segments, tile, origin=(0,0,0), axis=None):
    vertices, faces, uvs, rings = [], [], [], []
    rotation = Vector((0,0,1)).rotation_difference(Vector(axis).normalized()) if axis else None
    height = max(z for radius,z in profile)
    for radius,z in profile:
        ring = []
        for i in range(1 if radius == 0 else segments):
            angle = TAU*i/segments
            pos = Vector((radius*math.cos(angle), radius*math.sin(angle),z))
            if rotation: pos = rotation @ pos
            pos += Vector(origin)
            ring.append(len(vertices)); vertices.append(tuple(pos)); uvs.append((i/segments,z/height))
        rings.append(ring)
    for low,high in zip(rings,rings[1:]):
        for i in range(segments):
            j = (i+1)%segments
            if len(low)==1: faces.append((low[0],high[j],high[i]))
            elif len(high)==1: faces.append((low[i],low[j],high[0]))
            else: faces.append((low[i],low[j],high[j],high[i]))
    part(vertices,faces,uvs,tile)


def walls():
    radius = 1.28
    gap = math.asin(.28/radius)
    segments = 30
    profile = [(1.26,0), (1.30,.12), (1.28,.77), (1.23,1.10)]
    vertices, uvs, faces = [], [], []
    for r,z in profile:
        for i in range(segments+1):
            angle = -math.pi/2 + gap + (TAU-2*gap)*i/segments
            vertices.append((r*math.cos(angle),r*math.sin(angle),z))
            uvs.append((i/segments,z/1.10))
    for row in range(len(profile)-1):
        for i in range(segments):
            a=row*(segments+1)+i
            faces.append((a,a+1,a+segments+2,a+segments+1))
    part(vertices,faces,uvs,0)
    # Real gap through the outer wall, with a dark recessed interior behind it.
    part([(-.28,-1.255,.93),(.28,-1.255,.93),(.28,-1.20,1.10),(-.28,-1.20,1.10)],[(0,1,2,3)],[(0,0),(1,0),(1,1),(0,1)],0)
    part([(-.285,-1.29,0),(.285,-1.29,0),(.285,-.96,0),(-.285,-.96,0),
          (-.285,-1.29,.93),(.285,-1.29,.93),(.285,-.96,.93),(-.285,-.96,.93)],
         [(0,1,2,3),(0,3,7,4),(1,5,6,2),(3,2,6,7),(4,7,6,5)],
         [(0,0),(1,0),(1,1),(0,1),(0,0),(1,0),(1,1),(0,1)],5)
    # Three rounded timber pieces, without filling the doorway itself.
    profile = [(0,0),(.072,.025),(.085,.10),(.083,.85),(.07,.92),(0,.95)]
    for x in (-.29,.29):lathe(profile,8,4,(x,-1.28,0))
    beam = [(0,0),(.07,.025),(.085,.08),(.085,.63),(.07,.69),(0,.72)]
    lathe(beam,8,4,(-.36,-1.28,.95),(1,0,0))


def thatch(count, profile, upper=False):
    # Each closed bundle is a softened seven-sided wedge. Rounded outer ends
    # produce the scalloped eave on the card, rather than a smooth cone.
    cross = [(-1,-.01),(-.94,.025),(-.56,.075),(0,.09),(.56,.075),(.94,.025),(1,-.01)]
    sides = len(cross)
    for index in range(count):
        angle = TAU*(index+.5*(1 if upper else 0))/count
        vertices, uvs, faces = [], [], []
        for k,(radius,z,width) in enumerate(profile):
            wobble = .012*math.sin(index*2.37)
            for transverse,height in cross:
                a = angle + transverse * math.pi/count * .985 * width
                vertices.append((radius*math.cos(a),radius*math.sin(a),z+height+wobble))
                uvs.append(((transverse+1)/2,k/(len(profile)-1)))
        for k in range(len(profile)-1):
            for j in range(sides):
                a=k*sides+j; b=k*sides+(j+1)%sides
                faces.append((a,b,b+sides,a+sides))
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple(range((len(profile)-1)*sides,len(profile)*sides)))
        part(vertices,faces,uvs,1+(index%3))


def main():
    SOURCE.mkdir(parents=True,exist_ok=True); EXPORT.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    texture = atlas()
    walls()
    thatch(30,[(.27,2.08,.6),(.90,1.78,1),(1.49,1.14,1),(1.54,1.09,.8)])
    thatch(20,[(.22,2.18,.6),(.77,1.88,1),(.81,1.80,.8)],upper=True)
    # A hidden inner skin keeps the seams dark straw instead of open sky.
    vertices=[(0,0,2.18)]+[(1.51*math.cos(TAU*i/32),1.51*math.sin(TAU*i/32),1.10) for i in range(32)]
    part(vertices,[(0,i+1,(i+1)%32+1) for i in range(32)],
         [(.5,.5)]+[(.5+.45*math.cos(TAU*i/32),.5+.45*math.sin(TAU*i/32)) for i in range(32)],2)
    # Two soft terracotta discs at the top, echoing the card's clay cap.
    lathe([(0,0),(.22,.015),(.29,.045),(.30,.10),(.25,.15),(0,.17)],16,6,(0,0,2.12))
    lathe([(0,0),(.18,.015),(.245,.045),(.24,.11),(.19,.16),(0,.18)],16,6,(0,0,2.27))

    mesh=bpy.data.meshes.new('HutV2Mesh'); mesh.from_pydata(VERTS,[],FACES); mesh.update()
    uv=mesh.uv_layers.new(name='PaletteUV')
    for polygon in mesh.polygons:
        for loop in polygon.loop_indices:uv.data[loop].uv=UVS[mesh.loops[loop].vertex_index]
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    for polygon in mesh.polygons:polygon.use_smooth=True
    obj=bpy.data.objects.new('HutV2',mesh);bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    mat=bpy.data.materials.new('BuildingsPalette');mat.use_nodes=True
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Roughness'].default_value=.88
    shader.inputs['Specular IOR Level'].default_value=.22
    image=bpy.data.images.load(str(texture));image.name='buildings_palette';image.pack()
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
    mesh.materials.append(mat)
    obj['Reference']='art/hud/build_hut.png'
    obj['DoorDirection']='Blender -Y -> Godot +Z; keep HUT_SCALE and +0.5 offset'
    obj['Authoring']='Procedural closed thatch bundles, actual doorway, one opaque atlas'
    bpy.context.scene.world=bpy.data.worlds.new('World')
    bpy.context.scene.view_settings.view_transform='AgX'
    triangles=sum(len(p.vertices)-2 for p in mesh.polygons)
    assert triangles<=3000,triangles
    points=np.array([v.co[:] for v in mesh.vertices])
    low=points.min(axis=0);high=points.max(axis=0)
    assert max(abs(points[:,0]))<=1.58 and max(abs(points[:,1]))<=1.58
    assert high[2]<=2.35*1.2 and low[2]>=-1e-6
    # Match server ellipse rx=4,ry=2.3 after existing HUT_SCALE (2.25,1.75,1.45).
    ellipse=(points[:,0]*2.25/4)**2+(points[:,1]*1.45/2.3)**2
    assert ellipse.max()<1,ellipse.max()
    origin=Vector((0,-2,.45));direction=Vector((0,1,0))
    bpy.context.view_layer.update()
    hit,location,normal,face=obj.ray_cast(origin,direction)
    assert hit and location.y> -1.05,(hit,location)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'hut_v2.blend'))
    bpy.ops.export_scene.gltf(filepath=str(EXPORT/'hut_v2.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=False,export_extras=True)
    print('HUT_V2_BUDGET '+json.dumps({'triangles':triangles,'materials':1,'texture':[1024,1024],
        'blender_min':low.tolist(),'blender_max':high.tolist(),'footprint_ellipse_max':float(ellipse.max()),
        'door_raycast_y':location.y,'world_size':[(high[0]-low[0])*2.25,(high[2]-low[2])*1.75,(high[1]-low[1])*1.45]},ensure_ascii=False))


if __name__=='__main__':main()
