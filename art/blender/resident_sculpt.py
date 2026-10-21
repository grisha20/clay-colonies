"""Deterministic low-poly clay sculpt; Blender 4.2 Python, no external assets."""
import math
import os
import bpy
import bmesh
import numpy as np
from mathutils import Vector


def normal_texture(path):
    n = 512
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    # Soft thumb-pad ridges, with a very shallow kneaded-clay grain.
    height = .014 * np.sin(2 * math.pi * (6*x + 2*y + .16*np.sin(2*math.pi*y)))
    height += .009 * np.sin(2 * math.pi * (3*y + .25*np.sin(2*math.pi*x)))
    height += .002 * np.sin(2*math.pi*39*x) * np.sin(2*math.pi*31*y)
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 80
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 80
    normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    pixels = np.ones((n, n, 4), dtype=np.float32)
    pixels[:, :, :3] = normal * .5 + .5
    image = bpy.data.images.new('resident_clay_normal', width=n, height=n)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    # Portable .blend and GLB; no dependency on the author's absolute paths.
    image.pack()
    image.filepath = '//../../godot/assets/textures/resident_clay_normal.png'
    return image


def material(name, color, roughness, image=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = .28 if name == 'DarkEyes' else .22
    if image:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .24
        mat.node_tree.links.new(tex.outputs['Color'], normal.inputs['Color'])
        mat.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def ellipsoid(name, pos, scale, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def join(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return obj


def sculpt_body():
    pieces = []
    # Pear belly, tucked neck, broad slightly off-centre head: overlapping clay
    # volumes become one watertight skin, not articulated balls or robot joints.
    for name, pos, scale in [
        ('belly', (0, -.018, .73), (.35, .276, .37)),
        ('chest', (0, .006, .98), (.285, .218, .24)),
        ('neck', (0, -.004, 1.16), (.166, .158, .16)),
        ('head', (-.008, -.018, 1.43), (.346, .276, .32)),
        ('cheekL', (-.16, -.17, 1.32), (.144, .103, .115)),
        ('cheekR', (.16, -.16, 1.325), (.14, .105, .12)),
        ('nose', (.009, -.309, 1.401), (.077, .097, .071)),
    ]:
        pieces.append(ellipsoid(name, pos, scale))
    for sign in [-1, 1]:
        # The rest-pose bone axes are retained, but the volume is rounder.
        for name, pos, scale in [
            ('shoulder', (sign*.306, 0, 1.035), (.145, .147, .153)),
            ('arm', (sign*.435, -.012, .892), (.115, .126, .215)),
            ('forearm', (sign*.485, -.037, .708), (.11, .12, .181)),
            ('mitten', (sign*.485, -.077, .552), (.12, .128, .113)),
            ('thigh', (sign*.20, .008, .385), (.14, .143, .199)),
            ('shin', (sign*.20, -.004, .195), (.116, .119, .165)),
            ('foot', (sign*.20, -.058, .061), (.126, .173, .086)),
        ]:
            pieces.append(ellipsoid(name, pos, scale))
    body = join(pieces)
    remesh = body.modifiers.new('Fuse the clay', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = .024
    remesh.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = body.modifiers.new('Thumb smoothing', 'SMOOTH')
    smooth.factor = 1.1
    smooth.iterations = 4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    # Press a closed, shallow smile into the skin; no mouth cavity or extra
    # dark material. The face remains a continuous watertight clay surface.
    for v in body.data.vertices:
        x, y, z = v.co
        if y < -.18 and abs(x) < .12 and 1.26 < z < 1.34:
            smile_z = 1.293 + .65*x*x
            v.co.y += .014 * math.exp(-((x/.075)**4 + ((z-smile_z)/.016)**2))
    # Deliberate broad asymmetry and local thumb dents (not noisy displacement).
    for v in body.data.vertices:
        x, y, z = v.co
        influence = min(1., max(0., (z-.12)/.5))
        v.co.x += influence * (.0035*math.sin(z*12+y*9) + .002*math.sin(y*17))
        v.co.y += influence * .0035*math.sin(x*15+z*9)
        for cx, cy, cz, radius, depth in [(.16,-.267,.82,.11,.009),(-.18,.22,1.52,.14,.008),(.30,-.09,1.55,.10,.006)]:
            delta = Vector((x-cx,y-cy,z-cz))
            amount = depth * math.exp(-delta.length_squared/(radius*radius))
            v.co.y += amount if cy < 0 else -amount
    # Leave room in the 5000-triangle budget for the eyes and the cord.
    body.data.calc_loop_triangles()
    decimate = body.modifiers.new('Game mesh budget', 'DECIMATE')
    decimate.ratio = min(1., 3500 / len(body.data.loop_triangles))
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    # Flat little pancake soles, with a separate fully weighted foot region.
    for v in body.data.vertices:
        if v.co.z < .027:
            v.co.z = 0.
    return body


def tube(name, points, radii, sides=7, closed=False):
    verts, faces = [], []
    for i, point in enumerate(points):
        p = Vector(point)
        a = Vector(points[(i-1) % len(points)] if closed or i > 0 else points[0])
        b = Vector(points[(i+1) % len(points)] if closed or i+1 < len(points) else points[-1])
        tangent = (b-a).normalized()
        u = tangent.cross(Vector((0,0,1)))
        if u.length < .01:
            u = tangent.cross(Vector((1,0,0)))
        u.normalize()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            angle = math.tau*j/sides
            verts.append(p + radii[i]*(math.cos(angle)*u + math.sin(angle)*v))
    for i in range(len(points) if closed else len(points)-1):
        nxt = (i+1) % len(points)
        for j in range(sides):
            faces.append((i*sides+j,i*sides+(j+1)%sides,nxt*sides+(j+1)%sides,nxt*sides+j))
    if not closed:
        faces.extend([tuple(reversed(range(sides))), tuple((len(points)-1)*sides+j for j in range(sides))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def skin_weights(obj):
    weights = {}
    def add(index, groups):
        for name, weight in groups.items():
            if weight > .00001:
                weights.setdefault(name, []).append((index, weight))
    for vert in obj.data.vertices:
        x, y, z = vert.co
        side = '.L' if x < 0 else '.R'
        if z >= 1.225:
            groups = {'Head': 1.}
        elif z >= 1.08:
            t = min(1.,max(0.,(z-1.08)/.145))
            groups = {'Spine':1-t,'Head':t}
        elif (abs(x) > .36 and z > .40) or (abs(x) > .30 and z > .94):
            if z > .94:
                t = min(1., (z-.94)/.15)
                groups = {'UpperArm'+side:1-t,'Spine':t}
            elif z > .76:
                t = min(1.,max(0.,(.83-z)/.12))
                groups = {'UpperArm'+side:1-t,'LowerArm'+side:t}
            else:
                t = min(1.,max(0.,(.66-z)/.12))
                groups = {'LowerArm'+side:1-t,'Hand'+side:t}
        elif z < .50:
            if z < .115:
                groups = {'Foot'+side:1.}
            elif z < .30:
                t = min(1.,max(0.,(z-.20)/.12))
                foot = max(0.,(.155-z)/.04)
                groups = {'Foot'+side:foot,'LowerLeg'+side:(1-t)*(1-foot),'UpperLeg'+side:t*(1-foot)}
            else:
                t = min(1.,max(0.,(z-.36)/.14))
                groups = {'UpperLeg'+side:1-t,'Hips':t}
        else:
            t = min(1.,max(0.,(z-.68)/.18))
            groups = {'Hips':1-t,'Spine':t}
        add(vert.index, groups)
    return weights


def build_character_mesh():
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    image = normal_texture(os.path.join(repo,'godot/assets/textures/resident_clay_normal.png'))
    mats = [material('ClayBody',(.68,.48,.33,1),.86,image),
            material('DarkEyes',(.025,.018,.014,1),.18),
            material('GrassCord',(.53,.50,.30,1),.88)]
    body = sculpt_body()
    body.name = 'Resident'
    body.data.materials.append(mats[0])
    weights = skin_weights(body)
    # Closed bead eyes, slightly different in height and size.
    extras = []
    for sign in [-1,1]:
        eye = ellipsoid('Bead eye', (sign*.139,-.270,1.48+sign*.006), (.052,.043,.057 if sign<0 else .053),16,10)
        eye.data.materials.append(mats[1])
        extras.append((eye,'Head'))
    waist = [(math.cos(math.tau*i/40)*.354,math.sin(math.tau*i/40)*.284-.018,.702+.008*math.sin(math.tau*i/40*3)) for i in range(40)]
    belt = tube('Grass cord',waist,[.024]*40,7,True)
    belt.data.materials.append(mats[2]); extras.append((belt,'Hips'))
    knot = ellipsoid('Tied knot',(-.061,-.309,.698),(.046,.032,.039),12,8)
    knot.data.materials.append(mats[2]); extras.append((knot,'Hips'))
    for sign in [-1,1]:
        points = [(-.06+sign*.012,-.310,.686),(-.06+sign*.027,-.320,.61),(-.06+sign*.037,-.302,.52),(-.06+sign*.052,-.287,.49+sign*.02)]
        tail = tube('Cord end',points,[.018,.016,.014,.008])
        tail.data.materials.append(mats[2]); extras.append((tail,'Hips'))
    # Assign deform groups before joining: Blender remaps vertex indices.
    for name, rows in weights.items():
        vg = body.vertex_groups.new(name=name)
        for index, weight in rows:
            vg.add([index],weight,'REPLACE')
    for obj, bone in extras:
        vg = obj.vertex_groups.new(name=bone)
        vg.add(list(range(len(obj.data.vertices))),1.,'REPLACE')
    body = join([body]+[obj for obj,_ in extras])
    body.name = 'Resident'
    body.data.name = 'Resident'
    # Correct winding everywhere, and independently check manifold edges.
    bm = bmesh.new(); bm.from_mesh(body.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    invalid = sum(not e.is_manifold for e in bm.edges)
    bm.to_mesh(body.data); bm.free()
    if invalid:
        raise RuntimeError(f'{invalid} non-manifold edges')
    for polygon in body.data.polygons:
        polygon.use_smooth = True
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(68),island_margin=.025)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Return the contract used by the existing rig assignment code.
    result = {vg.name:[] for vg in body.vertex_groups}
    for v in body.data.vertices:
        for g in v.groups:
            result[body.vertex_groups[g.group].name].append((v.index,g.weight))
    body.vertex_groups.clear()
    body.data.calc_loop_triangles()
    triangles = len(body.data.loop_triangles)
    names = [m.name for m in body.data.materials]
    assert names == ['ClayBody','DarkEyes','GrassCord'], names
    assert triangles <= 5000, triangles
    print(f'SCULPT triangles={triangles} vertices={len(body.data.vertices)} manifold_errors={invalid} materials={names}')
    return body, result
