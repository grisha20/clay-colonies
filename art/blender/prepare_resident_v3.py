"""Prepare the supplied Hunyuan mesh, without resculpting or repainting it.

blender --background --python-exit-code 1 --python art/blender/prepare_resident_v3.py
Blender 4.2 LTS. Source attribution and service terms: docs/godot/RESIDENT_V3.md.
"""
from pathlib import Path
import sys, math, json, hashlib
import bpy, bmesh, numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_resident as rig

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'art/source/resident_hunyuan/resident_hunyuan_lowpoly_textured.glb'
TEX = ROOT / 'godot/assets/textures/resident_v3'

def smooth(a, b, x):
    t = max(0., min(1., (x-a)/(b-a)))
    return t*t*(3.-2.*t)

def prepare():
    rig.clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.name = mesh.data.name = 'Resident'
    original = np.array([tuple(v.co) for v in mesh.data.vertices])
    lo, hi = original[:,2].min(), original[:,2].max()
    scale = 1.75 / (hi-lo)
    for v in mesh.data.vertices:
        v.co = ((v.co.x)*scale, v.co.y*scale, (v.co.z-lo)*scale)
        # Snap numerical round-off only; retain the supplied foot geometry.
        if v.co.z < .000001:
            v.co.z = 0.
    mesh.data.update()
    mesh['AI_generated'] = True
    mesh['source'] = 'Tencent Hunyuan 3D; supplied by Clayfolk owner, 2026-10-22'
    mesh['source_sha256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    mesh['service_terms'] = 'https://rule.tencent.com/rule/202501080004 (2025-05-26)'
    mesh['qa_candidate'] = 'resident_v3; owner approval required before replacement'
    # Keep UVs and triangles unchanged. Recompute outward normals only.
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh.data); bm.free()
    for p in mesh.data.polygons:
        p.use_smooth = True
    return mesh, original, scale

def textures_and_materials(mesh, original):
    TEX.mkdir(parents=True, exist_ok=True)
    source_mat = mesh.data.materials[0]
    nodes = source_mat.node_tree.nodes
    color = next(n.image for n in nodes if n.type=='TEX_IMAGE' and n.image.name=='texture_pbr_20250901')
    normal = next(n.image for n in nodes if n.type=='TEX_IMAGE' and n.image.name.endswith('_normal'))
    orm = next(n.image for n in nodes if n.type=='TEX_IMAGE' and 'metallic' in n.image.name)
    pixels = np.array(color.pixels[:], dtype=np.float32).reshape(color.size[1],color.size[0],4)
    uv = mesh.data.uv_layers.active.data
    counts = [0,0,0]
    for p in mesh.data.polygons:
        c = original[list(p.vertices)].mean(axis=0)
        u = np.mean([tuple(uv[i].uv) for i in p.loop_indices], axis=0)
        rgb = pixels[int(u[1]*(color.size[1]-1)),int(u[0]*(color.size[0]-1)),:3]
        # Eyes are the existing bead geometry, not a painted new face. The
        # ellipses bound those beads; texture ratio avoids the clay eyelids.
        eye = c[1]<-.17 and ((abs(c[0])-.105)/.031)**2+((c[2]-.245)/.031)**2<1. and rgb[0]<.58
        # Yellow cloth/knot includes its hanging tab; exclude the hands/legs.
        cloth_region = (c[2]>-.22 and abs(c[0])<.185) or (c[2]<=-.22 and c[1]<-.10 and abs(c[0])<.17)
        cloth = -.335<c[2]<-.105 and cloth_region and rgb[2]<.24*max(.01,rgb[0]) and rgb[1]>.22
        p.material_index = 1 if eye else (2 if cloth else 0)
        counts[p.material_index] += len(p.vertices)-2
    print('MATERIAL_TRIANGLES',counts)
    for im, name in [(color,'albedo'),(normal,'normal'),(orm,'roughness')]:
        im.scale(2048,2048)
        im.name = 'resident_v3_'+name
        if name=='roughness':
            # Retain the source green roughness channel, remove metallic.
            a=np.array(im.pixels[:],dtype=np.float32).reshape(-1,4)
            a[:,0]=a[:,1]; a[:,2]=a[:,1]; a[:,3]=1.
            im.pixels.foreach_set(a.ravel())
        im.filepath_raw=str(TEX/(name+'.png')); im.file_format='PNG'; im.save(); im.pack()
    face_materials=[p.material_index for p in mesh.data.polygons]
    mesh.data.materials.clear()
    for name in ['ClayBody','DarkEyes','GrassCord']:
        m=bpy.data.materials.new(name); m.use_nodes=True
        nt=m.node_tree; bs=nt.nodes.get('Principled BSDF')
        bs.inputs['Metallic'].default_value=0.
        bs.inputs['Roughness'].default_value=.75 if name!='DarkEyes' else .2
        for im, socket in [(color,'Base Color'),(orm,'Roughness')]:
            tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=im
            if name!='DarkEyes' or socket=='Base Color': nt.links.new(tex.outputs['Color'],bs.inputs[socket])
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=normal
        n=nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tex.outputs['Color'],n.inputs['Color']);nt.links.new(n.outputs['Normal'],bs.inputs['Normal'])
        mesh.data.materials.append(m)
    for p,idx in zip(mesh.data.polygons,face_materials): p.material_index=idx
    return counts

def skeleton():
    rig.HIP_Z=.48; rig.UPPER_LEG_LEN=.195; rig.LOWER_LEG_LEN=.190; rig.FOOT_ANKLE_Z=.095
    arm=rig.build_armature()
    bpy.context.view_layer.objects.active=arm; bpy.ops.object.mode_set(mode='EDIT')
    eb=arm.data.edit_bones
    positions={'Hips':((0,0,.48),(0,0,.66)), 'Spine':((0,0,.66),(0,0,1.01)),
               'Head':((0,0,1.01),(0,0,1.75)), 'Socket_Head':((0,0,1.75),(0,0,1.85)),
               'Socket_Cargo':((0,-.44,.85),(0,-.54,.85))}
    for side,sign in [('.L',-1),('.R',1)]:
        for name,a,b in [('UpperArm',(.28,0,.91),(.40,0,.72)),('LowerArm',(.40,0,.72),(.44,-.025,.53)),('Hand',(.44,-.025,.53),(.45,-.09,.49))]:
            positions[name+side]=((a[0]*sign,a[1],a[2]),(b[0]*sign,b[1],b[2]))
    positions['Socket_Tool_R']=((.45,-.09,.49),(.45,-.19,.49))
    for name,(head,tail) in positions.items(): eb[name].head=head;eb[name].tail=tail
    # Sockets are attachment transforms, never deforming influences.
    for b in eb:
        b.use_deform = not b.name.startswith('Socket_') and b.name!='Root'
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm

def release_arm_contacts(mesh):
    """Release only the fused contact behind the right hand. Original face,
    ear, finger and exterior body vertices stay in their supplied positions.
    """
    bm=bmesh.new();bm.from_mesh(mesh.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    part=bm.verts.layers.int.new('limb_part')
    uv=bm.loops.layers.uv.active
    body_face=min((f for f in bm.faces if f.material_index==0),key=lambda f:(f.calc_center_median()-Vector((0,-.20,.85))).length)
    uv_center=body_face.loops[0][uv].uv.copy()
    center=Vector((.307,.04,.605));radii=(.055,.105,.065)
    contact=[f for f in bm.faces if sum(((f.calc_center_median()[i]-center[i])/radii[i])**2 for i in range(3))<1.]
    bmesh.ops.delete(bm,geom=contact,context='FACES')
    boundary=[e for e in bm.edges if e.is_boundary and all(v.co.z>.4 for v in e.verts)]
    # Capture border UVs before adding faces. Each new closure uses its local
    # source texture, including the existing ochre at the waist.
    border_uv={v:next(loop[uv].uv.copy() for f in v.link_faces for loop in f.loops if loop.vert==v) for e in boundary for v in e.verts}
    remaining=set(boundary)
    while remaining:
        edge=next(iter(remaining));ring=[edge.verts[0]];current=ring[0];ring_edges=[]
        while True:
            choices=[e for e in current.link_edges if e in remaining]
            assert choices,'Open contact contour'
            e=choices[0];remaining.remove(e);ring_edges.append(e);other=e.other_vert(current)
            if other==ring[0]:break
            assert other not in ring,'Self-intersecting contact contour'
            ring.append(other);current=other
        midpoint=sum((v.co for v in ring),Vector())/len(ring)
        center_vertex=bm.verts.new(midpoint)
        center_uv=border_uv[min(ring,key=lambda v:(v.co-midpoint).length)]
        neighbors=[f.material_index for e in ring_edges for f in e.link_faces]
        material=2 if neighbors.count(2)>len(neighbors)*.5 else 0
        for i in range(len(ring)):
            f=bm.faces.new((ring[i],ring[(i+1)%len(ring)],center_vertex));f.material_index=material;f.smooth=True
            for loop in f.loops:loop[uv].uv=center_uv if loop.vert==center_vertex else border_uv[loop.vert]
    assert all(not e.is_boundary for e in boundary)
    # Below the upper arms, connected components now distinguish the two
    # forearms from the waist, including the newly closed interfaces.
    remaining={v for v in bm.verts if v.co.z<.65}
    while remaining:
        seed=remaining.pop();component={seed};stack=[seed]
        while stack:
            for edge in stack.pop().link_edges:
                for other in edge.verts:
                    if other in remaining:remaining.remove(other);component.add(other);stack.append(other)
        cx=sum(v.co.x for v in component)/len(component)
        if abs(cx)>.30:
            for v in component:v[part]=1 if cx<0 else 2
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(mesh.data);bm.free();mesh.data.update()
    # The supplied reconstruction has tiny overlapping faces at finger
    # contacts and small holes at the outer toes. Repair those locally;
    # keep every outline vertex and the original UVs of retained faces.
    bm=bmesh.new();bm.from_mesh(mesh.data)
    uv=bm.loops.layers.uv.active
    removed=0
    while True:
        candidates={f for e in bm.edges if len(e.link_faces)>2 for f in e.link_faces}
        if not candidates:break
        f=min(candidates,key=lambda f:f.calc_area())
        bmesh.ops.delete(bm,geom=[f],context='FACES');removed+=1
    fill=bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0)
    for f in fill['faces']:
        f.material_index=0
        for loop in f.loops:loop[uv].uv=uv_center
    isolated=[f for f in bm.faces if all(e.is_boundary for e in f.edges)]
    bmesh.ops.delete(bm,geom=isolated,context='FACES')
    remaining={e for e in bm.edges if e.is_boundary}
    while remaining:
        edge=next(iter(remaining));path=[edge.verts[0]];walk=[];current=path[0]
        while True:
            choices=[e for e in current.link_edges if e in remaining and e not in walk]
            assert choices,'Open repair boundary'
            e=choices[0];walk.append(e);other=e.other_vert(current)
            if other in path:
                start=path.index(other);ring=path[start:];ring_edges=walk[start:]
                break
            path.append(other);current=other
        center=bm.verts.new(sum((v.co for v in ring),Vector())/len(ring))
        for i in range(len(ring)):
            f=bm.faces.new((ring[i],ring[(i+1)%len(ring)],center));f.material_index=0;f.smooth=True
            for loop in f.loops:loop[uv].uv=uv_center
        remaining.difference_update(ring_edges)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    assert all(e.is_manifold for e in bm.edges)
    bm.to_mesh(mesh.data);bm.free();mesh.data.update()
    print('LOCAL_FACE_REPAIRS',removed,'nonmanifold=0')
    print('CONTACT_CLEANUP',len(mesh.data.vertices),sum(len(p.vertices)-2 for p in mesh.data.polygons))

def weights(mesh,arm):
    # glTF splits vertices at UV seams. Welding coincident samples preserves
    # per-loop UVs but makes the bind continuous across those seams.
    parts=mesh.data.attributes['limb_part'].data
    # Heat weights provide the initial bind; deterministic anatomical corrections
    # prevent touching surfaces (cloth/thigh, head/shoulder) sharing influences.
    bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);arm.select_set(True)
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for g in list(mesh.vertex_groups): mesh.vertex_groups.remove(g)
    groups={b.name:mesh.vertex_groups.new(name=b.name) for b in arm.data.bones if b.use_deform}
    cloth_vertices={i for p in mesh.data.polygons if p.material_index==2 for i in p.vertices if abs(mesh.data.vertices[i].co.x)<.28 or mesh.data.vertices[i].co.z<.40}
    adjacent=[set() for v in mesh.data.vertices]
    for edge in mesh.data.edges:
        i,j=edge.vertices;adjacent[i].add(j);adjacent[j].add(i)
    # Below the wrists the two hands are separate connected components. Use
    # topology, not an X threshold that would cut through the curled fingers.
    remaining={v.index for v in mesh.data.vertices if v.co.z<.55};hands={}
    while remaining:
        seed=remaining.pop();component={seed};stack=[seed]
        while stack:
            for j in adjacent[stack.pop()]:
                if j in remaining:remaining.remove(j);component.add(j);stack.append(j)
        cx=sum(mesh.data.vertices[i].co.x for i in component)/len(component)
        if abs(cx)>.30:
            for i in component:hands[i]='Hand.L' if cx<0 else 'Hand.R'
    print('RIGID_HAND_VERTICES',len(hands))
    for p in mesh.data.polygons:
        if p.material_index==2 and all(i in hands for i in p.vertices):p.material_index=0
    cloth_vertices={i for p in mesh.data.polygons if p.material_index==2 for i in p.vertices if abs(mesh.data.vertices[i].co.x)<.28 or mesh.data.vertices[i].co.z<.40}
    all_weights=[]
    for v in mesh.data.vertices:
        x,y,z=v.co; ax=abs(x); side='.L' if x<0 else '.R'
        limb=parts[v.index].value
        if limb:
            elbow=smooth(.65,.80,z);wrist=smooth(.51,.60,z)
            w={'UpperArm'+side:elbow,'LowerArm'+side:(1-elbow)*wrist,'Hand'+side:(1-elbow)*(1-wrist)}
        elif v.index in hands:
            w={hands[v.index]:1.}
        elif z>=1.04:
            w={'Head':1.}
        elif v.index in cloth_vertices:
            w={'Hips':1.}
        elif z>.94:
            t=smooth(.94,1.04,z);w={'Head':t,'Spine':1-t}
        elif ax>(.265 if z>.80 else .29) and z>.65:
            shoulder=smooth(.265,.34,ax) if z>.80 else 1.;elbow=smooth(.65,.80,z)
            w={'Spine':1-shoulder,'UpperArm'+side:shoulder*elbow,'LowerArm'+side:shoulder*(1-elbow)}
        elif z<.52:
            foot=1-smooth(.14,.23,z); upper=smooth(.25,.39,z)
            hip=max(smooth(.38,.52,z),1-smooth(.06,.16,ax) if z>.30 else 0.)
            w={'Hips':hip,'Foot'+side:(1-hip)*foot,'LowerLeg'+side:(1-hip)*(1-foot)*(1-upper),'UpperLeg'+side:(1-hip)*(1-foot)*upper}
        else:
            spine=smooth(.52,.74,z);w={'Hips':1-spine,'Spine':spine}
        all_weights.append(w)
    names=list(groups); a=np.array([[w.get(n,0.) for n in names] for w in all_weights])
    # Smooth through the actual connected topology, never across nearby but
    # separate fingers/cloth/head surfaces. Keep rigid extremities anchored.
    for iteration in range(32):
        prev=a.copy()
        for v in mesh.data.vertices:
            x,y,z=v.co
            if v.index in hands or v.index in cloth_vertices or z>1.10 or z<.16:continue
            neighbors=list(adjacent[v.index])
            if neighbors:a[v.index]=.45*prev[v.index]+.55*prev[neighbors].mean(axis=0)
    for v in mesh.data.vertices:
        values=a[v.index];values[values<.008]=0
        # glTF/Godot skinning supports four influences.
        keep=np.argsort(values)[-4:];values[[i for i in range(len(values)) if i not in keep]]=0;values/=values.sum()
        for name,value in zip(names,values):
            if value>1e-6: groups[name].add([v.index],value,'REPLACE')
    assert all(abs(sum(g.weight for g in v.groups)-1)<1e-5 for v in mesh.data.vertices)

def actions(arm):
    # The supplied feet are longer than the current model's feet. Limit toe
    # pitch so the whole sole clears the ground during the swing.
    original_solver=rig.solve_exact_leg_ik
    def broad_foot_ik(target_y,target_z,cur_hip_z,tilt_deg=0.):
        return original_solver(target_y,target_z,cur_hip_z,tilt_deg*.4)
    rig.solve_exact_leg_ik=broad_foot_ik
    rig.add_actions(arm)
    # Head cargo is the production behavior: carry arms use the matching base
    # gait, not the old forward embrace which intersects the large new head.
    for base,carry in [('idle','carry_idle'),('walk','carry_walk')]:
        old=bpy.data.actions[carry];bpy.data.actions.remove(old)
        act=bpy.data.actions[base].copy();act.name=carry;act.use_fake_user=True
    # Smaller torso bend avoids folding the short neck into the large head.
    for fc in bpy.data.actions['work_gather'].fcurves:
        if fc.data_path=='pose.bones["Spine"].rotation_euler':
            for key in fc.keyframe_points:
                key.co.y*=.45;key.handle_left.y*=.45;key.handle_right.y*=.45
        if fc.data_path=='pose.bones["UpperArm.R"].rotation_euler' and fc.array_index==0:
            for key in fc.keyframe_points:
                bend=.5*(1-math.cos(key.co.x/30*2*math.pi))
                key.co.y=math.radians(-85+75*bend)
                key.handle_left.y=key.handle_right.y=key.co.y
        if fc.data_path=='pose.bones["LowerArm.R"].rotation_euler' and fc.array_index==0:
            for key in fc.keyframe_points:
                bend=.5*(1-math.cos(key.co.x/30*2*math.pi))
                key.co.y=math.radians(-25+20*bend)
                key.handle_left.y=key.handle_right.y=key.co.y

def verify(mesh,arm):
    stats={};deps=bpy.context.evaluated_depsgraph_get()
    soles={side:[v.index for v in mesh.data.vertices if v.co.z<.001 and (v.co.x<0)==(side=='L')] for side in ['L','R']}
    assert all(soles.values())
    for act in bpy.data.actions:
        rig.reset_pose_transforms(arm);arm.animation_data.action=act
        minimum=99.;stretch=0.;stance=0.;lift={'L':0.,'R':0.};first=None;seam=0.
        for frame in range(31):
            bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
            obj=mesh.evaluated_get(deps);m=obj.to_mesh()
            minimum=min(minimum,min(v.co.z for v in m.vertices))
            if frame==0:first=[v.co.copy() for v in m.vertices]
            if frame==30:seam=max((v.co-first[v.index]).length for v in m.vertices)
            if act.name in ['walk','carry_walk']:
                for side,indices in soles.items():
                    height=min(m.vertices[i].co.z for i in indices)
                    contact=(frame<=15) if side=='L' else (frame>=15)
                    if contact:stance=max(stance,abs(height))
                    else:lift[side]=max(lift[side],height)
            for e in m.edges:
                a,b=e.vertices;rest=(mesh.data.vertices[a].co-mesh.data.vertices[b].co).length
                if rest>.005:
                    ratio=(m.vertices[a].co-m.vertices[b].co).length/rest
                    if ratio>stretch:
                        stretch=ratio;worst=[frame,list(mesh.data.vertices[a].co),list(mesh.data.vertices[b].co)]
            obj.to_mesh_clear()
        print('ACTION',act.name,'min_z',minimum,'max_edge_ratio',stretch,'worst',worst)
        assert minimum>-.004, (act.name,minimum)
        assert seam<.0001,(act.name,'loop seam',seam)
        if act.name in ['walk','carry_walk']:
            assert stance<.003,(act.name,'stance',stance)
            assert min(lift.values())>.04,(act.name,'lift',lift)
        stats[act.name]={'minimum_z':minimum,'maximum_edge_ratio':stretch,'loop_seam':seam,'stance_error':stance,'swing_clearance':lift}
    arm.animation_data.action=None;rig.reset_pose_transforms(arm);bpy.context.scene.frame_set(0)
    return stats

def main():
    if (ROOT/'art/blender/resident_v3.blend').exists() and '--rebuild-from-hunyuan' not in sys.argv:
        raise SystemExit('resident_v3.blend is the authored sculpt/paint source. '
                         'Use export_resident_v3.py to export it. '
                         'Only --rebuild-from-hunyuan explicitly discards the art edits.')
    mesh,original,scale=prepare();counts=textures_and_materials(mesh,original)
    release_arm_contacts(mesh)
    source_tree=KDTree(len(original))
    lo=original[:,2].min()
    for i,p in enumerate(original):source_tree.insert(Vector((p[0]*scale,p[1]*scale,(p[2]-lo)*scale)),i)
    source_tree.balance()
    for v in mesh.data.vertices:
        if v.co.z>1.04 or (abs(v.co.x)>.33 and .40<v.co.z<.55):
            assert source_tree.find(v.co)[2]<.00001,'Changed supplied head/finger geometry'
    arm=skeleton();weights(mesh,arm);actions(arm);stats=verify(mesh,arm)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/resident_v3.blend'))
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'godot/assets/models/resident_v3.glb'),export_format='GLB',export_animations=True,export_frame_range=True,export_frame_step=1,export_extras=True)
    counts=[sum(len(p.vertices)-2 for p in mesh.data.polygons if p.material_index==i) for i in range(3)]
    assert sum(counts)<=8000
    report={'triangles':sum(counts),'material_triangles':counts,'vertices':len(mesh.data.vertices),'scale':scale,'nonmanifold_edges':0,'source_head_and_finger_positions_preserved':True,'actions':stats}
    (ROOT/'art/blender/resident_v3_validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()
