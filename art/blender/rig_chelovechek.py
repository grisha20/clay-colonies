"""Owner's hand-sculpted resident (T-pose) -> game scale + contract skeleton.

blender --background --python-exit-code 1 art/blender/chelovechek_simmetriya.blend --python art/blender/rig_chelovechek.py
Blender 4.5 LTS. Never touches the source .blend: writes art/blender/chelovechek_rig.blend.

The body and the bow are scaled to 1.75 m with soles on Z=0, the Decimate
modifier is baked in, and ResidentArmature gets the same 19 bones and parents
as generate_resident.build_armature(), re-placed into this mesh's T-pose
joints. Binding (Ctrl+P -> automatic weights) is left to the owner.
"""
from pathlib import Path
import sys
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_resident as rig

OUT = Path(__file__).resolve().parent / 'chelovechek_rig.blend'
BODY, BOW = 'mesh_rep_0_ori_repair_quad', 'mesh_rep_0_ori_repair_quad.002'
HEIGHT = 1.75

# Joints measured on the scaled mesh (right side, +X); .L mirrors to -X as in the contract.
HIP_Z, KNEE_Z, ANKLE_Z, LEG_X = .45, .275, .10, .165
SHOULDER, ELBOW, WRIST, HAND_TIP = (.28, .048, .95), (.535, .068, .945), (.79, .047, .948), (.97, .03, .955)


def bake(obj):
    """Apply modifiers and transforms so the mesh data is final (data API, any saved mode)."""
    old = obj.data
    obj.data = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    obj.data.name = old.name
    obj.modifiers.clear()
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    if old.users == 0:
        bpy.data.meshes.remove(old)


def main():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    body, bow = bpy.data.objects[BODY], bpy.data.objects[BOW]
    for o in (body, bow):
        bake(o)
    zs = [v.co.z for v in body.data.vertices]
    k = HEIGHT / (max(zs) - min(zs))
    fit = Matrix.Translation((0, 0, -min(zs) * k)) @ Matrix.Scale(k, 4)
    for o in (body, bow):
        o.data.transform(fit)
        o.data.update()
    body.name, bow.name = 'Resident', 'Resident_Bow'

    arm = rig.build_armature()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    pos = {
        'Hips': ((0, 0, HIP_Z), (0, 0, .66)),
        'Spine': ((0, 0, .66), (0, 0, 1.0)),
        'Head': ((0, 0, 1.0), (0, 0, HEIGHT)),
        'Socket_Head': ((0, 0, HEIGHT), (0, 0, HEIGHT + .1)),
        'Socket_Cargo': ((0, -.44, .85), (0, -.54, .85)),
    }
    for side, s in (('.L', -1), ('.R', 1)):
        m = lambda p: (p[0] * s, p[1], p[2])
        # Knees bend slightly forward and elbows backward, so IK keeps the natural direction.
        pos['UpperLeg' + side] = (m((LEG_X, .03, HIP_Z)), m((LEG_X, .01, KNEE_Z)))
        pos['LowerLeg' + side] = (m((LEG_X, .01, KNEE_Z)), m((LEG_X, .03, ANKLE_Z)))
        pos['Foot' + side] = (m((LEG_X, .03, ANKLE_Z)), m((LEG_X, -.15, .04)))
        pos['UpperArm' + side] = (m(SHOULDER), m(ELBOW))
        pos['LowerArm' + side] = (m(ELBOW), m(WRIST))
        pos['Hand' + side] = (m(WRIST), m(HAND_TIP))
    pos['Socket_Tool_R'] = ((.88, .02, .945), (.88, -.08, .945))
    for name, (head, tail) in pos.items():
        eb[name].head, eb[name].tail = head, tail
    for b in eb:
        b.roll = 0
        b.use_deform = not b.name.startswith('Socket_') and b.name != 'Root'
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.show_in_front = True
    arm.data.show_names = True
    assert len(arm.data.bones) == 19

    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_set(o not in (body, bow))
    bpy.context.scene.render.fps = 30
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    zs = [v.co.z for v in body.data.vertices]
    print(f'RIG_OK height={max(zs) - min(zs):.4f} min_z={min(zs):.4f} tris={tris} '
          f'bow_tris={sum(len(p.vertices) - 2 for p in bow.data.polygons)} bones={len(arm.data.bones)}')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), copy=True)
    print('SAVED', OUT)


main()
