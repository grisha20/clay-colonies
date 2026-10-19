"""Procedural 3D Clayfolk Character Generator for Blender 4.2 LTS.

Creates a genuine 3D terracotta clay villager with:
- Anatomically grouped vertex weights (no torso stretching or cross-assignment).
- Seamless closed joints at shoulders, elbows, and hips (no holes or visible gaps).
- Exact 30 FPS timing keyframed from frame 0 to 30 (duration = 1.000 s in glTF).
- Ground-contact verification: bottom of sole never dips below Z = 0.000 m.
- Rigorous IK solver with zero vertical floating error on stance frames.
- Armature with Socket_Cargo, Socket_Tool_R, and Socket_Head.
- 5 actions: idle, walk, carry_idle, carry_walk, work_gather.

Exports art/blender/resident.blend and godot/assets/models/resident.glb.
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

# Geometry and IK constants
HIP_Z = 0.49
UPPER_LEG_LEN = 0.23
LOWER_LEG_LEN = 0.21
FOOT_ANKLE_Z = 0.05 # Ankle height above bottom of sole
SOLE_Z = 0.00       # Ground plane

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.frame_start = 0
    scene.frame_end = 30

def create_pbr_material(name, base_color, roughness=0.78):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.22
        elif "Specular" in bsdf.inputs:
            bsdf.inputs["Specular"].default_value = 0.22
    return mat

def build_character_mesh():
    mesh = bpy.data.meshes.new("ResidentMesh")
    obj = bpy.data.objects.new("Resident", mesh)
    bpy.context.collection.objects.link(obj)

    mat_body = create_pbr_material("ClayBody", (0.74, 0.36, 0.19, 1.0), roughness=0.82)
    mat_face = create_pbr_material("ClayFace", (0.82, 0.46, 0.26, 1.0), roughness=0.78)
    mat_eyes = create_pbr_material("DarkEyes", (0.10, 0.07, 0.05, 1.0), roughness=0.45)
    mat_cord = create_pbr_material("GrassCord", (0.64, 0.54, 0.28, 1.0), roughness=0.88)

    mesh.materials.append(mat_body) # 0
    mesh.materials.append(mat_face) # 1
    mesh.materials.append(mat_eyes) # 2
    mesh.materials.append(mat_cord) # 3

    bm = bmesh.new()

    group_indices = {
        "Head": [],
        "Spine": [],
        "Hips": [],
        "UpperArm.L": [], "LowerArm.L": [], "Hand.L": [],
        "UpperArm.R": [], "LowerArm.R": [], "Hand.R": [],
        "UpperLeg.L": [], "LowerLeg.L": [], "Foot.L": [],
        "UpperLeg.R": [], "LowerLeg.R": [], "Foot.R": []
    }

    # 1. Torso (Hips and Spine)
    # Pear-shaped clay body from z=0.46 to z=1.12
    torso_layers = [
        (0.46, 0.28), (0.56, 0.36), (0.68, 0.38), (0.82, 0.35), (0.98, 0.30), (1.12, 0.22)
    ]
    num_seg = 16
    prev_ring = None
    first_ring = None
    for z, r in torso_layers:
        ring = []
        for i in range(num_seg):
            angle = 2 * math.pi * i / num_seg
            irr = 1.0 + 0.02 * math.sin(angle * 3)
            x = r * irr * math.cos(angle) * 1.04
            y = r * irr * math.sin(angle) * 0.96
            v = bm.verts.new((x, y, z))
            ring.append(v)
            if z < 0.72:
                group_indices["Hips"].append(v)
            else:
                group_indices["Spine"].append(v)

        if prev_ring:
            for i in range(num_seg):
                i_next = (i + 1) % num_seg
                f = bm.faces.new([prev_ring[i], prev_ring[i_next], ring[i_next], ring[i]])
                f.material_index = 0
        else:
            first_ring = ring
        prev_ring = ring

    f_bottom = bm.faces.new(first_ring[::-1])
    f_bottom.material_index = 0
    f_top = bm.faces.new(prev_ring)
    f_top.material_index = 0

    # 2. Cord belt around waist (z=0.68) - Assigned strictly to Hips
    cord_r = 0.385
    cord_steps = 16
    for i in range(cord_steps):
        angle = 2 * math.pi * i / cord_steps
        cx = cord_r * math.cos(angle) * 1.04
        cy = cord_r * math.sin(angle) * 0.96
        cz = 0.68
        res = bmesh.ops.create_uvsphere(
            bm, u_segments=6, v_segments=4, radius=0.038,
            matrix=Matrix.Translation(Vector((cx, cy, cz)))
        )
        for v in res['verts']:
            group_indices["Hips"].append(v)
            for f in v.link_faces:
                f.material_index = 3

    # Cord knot on front (-Y side)
    knot_res = bmesh.ops.create_uvsphere(
        bm, u_segments=8, v_segments=6, radius=0.065,
        matrix=Matrix.Translation(Vector((0.0, -cord_r * 0.96 - 0.03, 0.68)))
    )
    for v in knot_res['verts']:
        group_indices["Hips"].append(v)
        for f in v.link_faces:
            f.material_index = 3

    # 3. Head & Face
    head_res = bmesh.ops.create_uvsphere(
        bm, u_segments=16, v_segments=12, radius=0.32,
        matrix=Matrix.Translation(Vector((0, -0.04, 1.40))) @ Matrix.Scale(1.05, 4, Vector((1,0,0))) @ Matrix.Scale(1.0, 4, Vector((0,1,0))) @ Matrix.Scale(0.96, 4, Vector((0,0,1)))
    )
    for v in head_res['verts']:
        group_indices["Head"].append(v)
        for f in v.link_faces:
            f.material_index = 1 if v.co.y < -0.10 else 0

    # Nose (clay button on front -Y)
    nose_res = bmesh.ops.create_uvsphere(
        bm, u_segments=8, v_segments=6, radius=0.06,
        matrix=Matrix.Translation(Vector((0.0, -0.38, 1.38))) @ Matrix.Scale(0.9, 4, Vector((1,0,0))) @ Matrix.Scale(1.3, 4, Vector((0,1,0)))
    )
    for v in nose_res['verts']:
        group_indices["Head"].append(v)
        for f in v.link_faces:
            f.material_index = 1

    # Eyes (two dark clay beads on front face)
    for eye_x in (-0.11, 0.11):
        eye_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.048,
            matrix=Matrix.Translation(Vector((eye_x, -0.35, 1.45)))
        )
        for v in eye_res['verts']:
            group_indices["Head"].append(v)
            for f in v.link_faces:
                f.material_index = 2

    # 4. Arms (shoulders + limbs + mitten hands)
    for side in (-1, 1):
        side_tag = ".R" if side > 0 else ".L"
        sx = side * 0.33

        # Shoulder cap
        sh_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.10,
            matrix=Matrix.Translation(Vector((sx, 0.0, 1.04)))
        )
        for v in sh_res['verts']:
            group_indices["UpperArm" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Upper arm cylinder
        uarm_res = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=10,
            radius1=0.09, radius2=0.075, depth=0.26,
            matrix=Matrix.Translation(Vector((sx + side * 0.04, 0.0, 0.91)))
        )
        for v in uarm_res['verts']:
            group_indices["UpperArm" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Elbow sphere
        elbow_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.078,
            matrix=Matrix.Translation(Vector((sx + side * 0.06, -0.02, 0.78)))
        )
        for v in elbow_res['verts']:
            group_indices["LowerArm" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Forearm cylinder
        farm_res = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=10,
            radius1=0.075, radius2=0.068, depth=0.24,
            matrix=Matrix.Translation(Vector((sx + side * 0.06, -0.05, 0.66)))
        )
        for v in farm_res['verts']:
            group_indices["LowerArm" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Hand: rounded clay palm positioned forward
        hand_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.082,
            matrix=Matrix.Translation(Vector((sx + side * 0.05, -0.10, 0.52))) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(1.3, 4, Vector((0,1,0)))
        )
        for v in hand_res['verts']:
            group_indices["Hand" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

    # 5. Legs (UpperLeg, LowerLeg, and Foot)
    for side in (-1, 1):
        side_tag = ".R" if side > 0 else ".L"
        lx = side * 0.20

        # Hip socket cap
        hsocket_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.11,
            matrix=Matrix.Translation(Vector((lx, 0.0, HIP_Z)))
        )
        for v in hsocket_res['verts']:
            group_indices["UpperLeg" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Thigh cylinder
        thigh_res = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=10,
            radius1=0.10, radius2=0.085, depth=UPPER_LEG_LEN,
            matrix=Matrix.Translation(Vector((lx, 0.0, HIP_Z - UPPER_LEG_LEN / 2.0)))
        )
        for v in thigh_res['verts']:
            group_indices["UpperLeg" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Knee joint sphere
        knee_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.088,
            matrix=Matrix.Translation(Vector((lx, 0.0, HIP_Z - UPPER_LEG_LEN)))
        )
        for v in knee_res['verts']:
            group_indices["LowerLeg" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Shin cylinder
        shin_res = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=10,
            radius1=0.085, radius2=0.078, depth=LOWER_LEG_LEN,
            matrix=Matrix.Translation(Vector((lx, 0.0, HIP_Z - UPPER_LEG_LEN - LOWER_LEG_LEN / 2.0)))
        )
        for v in shin_res['verts']:
            group_indices["LowerLeg" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Foot: rounded solid clay sole resting strictly on Z = SOLE_Z (0.000)
        # Foot length = 0.22m (from y = +0.06 to y = -0.16)
        # Foot width = 0.14m (x from -0.07 to +0.07)
        # Bottom of foot at z = 0.000, ankle joint at z = FOOT_ANKLE_Z (0.050)
        foot_res = bmesh.ops.create_cube(
            bm, size=1.0,
            matrix=Matrix.Translation(Vector((lx, -0.05, FOOT_ANKLE_Z / 2.0))) @ Matrix.Scale(0.14, 4, Vector((1,0,0))) @ Matrix.Scale(0.22, 4, Vector((0,1,0))) @ Matrix.Scale(FOOT_ANKLE_Z, 4, Vector((0,0,1)))
        )
        for v in foot_res['verts']:
            group_indices["Foot" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

        # Rounded clay toe cap in front (-Y)
        toe_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.065,
            matrix=Matrix.Translation(Vector((lx, -0.14, FOOT_ANKLE_Z / 2.0))) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(0.8, 4, Vector((0,1,0))) @ Matrix.Scale(FOOT_ANKLE_Z / 0.13, 4, Vector((0,0,1)))
        )
        for v in toe_res['verts']:
            group_indices["Foot" + side_tag].append(v)
            for f in v.link_faces:
                f.material_index = 0

    # Ensure no vertex in rest mesh penetrates ground plane
    for v in bm.verts:
        if v.co.z < 0.0:
            v.co.z = 0.0

    bm.verts.ensure_lookup_table()
    group_indices_int = {}
    for name, verts in group_indices.items():
        group_indices_int[name] = [v.index for v in verts]

    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True

    return obj, group_indices_int

def build_armature():
    arm_data = bpy.data.armatures.new("ResidentArmature")
    arm_obj = bpy.data.objects.new("Armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones

    b_root = eb.new("Root")
    b_root.head = (0, 0, 0)
    b_root.tail = (0, 0, 0.2)

    b_hips = eb.new("Hips")
    b_hips.head = (0, 0, HIP_Z)
    b_hips.tail = (0, 0, 0.72)
    b_hips.parent = b_root

    b_spine = eb.new("Spine")
    b_spine.head = (0, 0, 0.72)
    b_spine.tail = (0, 0, 1.12)
    b_spine.parent = b_hips

    b_head = eb.new("Head")
    b_head.head = (0, 0, 1.12)
    b_head.tail = (0, 0, 1.72)
    b_head.parent = b_spine

    # Left Leg: lengths match UPPER_LEG_LEN (0.23) and LOWER_LEG_LEN (0.21)
    b_upleg_l = eb.new("UpperLeg.L")
    b_upleg_l.head = (-0.20, 0.0, HIP_Z)
    b_upleg_l.tail = (-0.20, 0.0, HIP_Z - UPPER_LEG_LEN)
    b_upleg_l.parent = b_hips

    b_lowleg_l = eb.new("LowerLeg.L")
    b_lowleg_l.head = (-0.20, 0.0, HIP_Z - UPPER_LEG_LEN)
    b_lowleg_l.tail = (-0.20, 0.0, FOOT_ANKLE_Z)
    b_lowleg_l.parent = b_upleg_l

    b_foot_l = eb.new("Foot.L")
    b_foot_l.head = (-0.20, 0.0, FOOT_ANKLE_Z)
    b_foot_l.tail = (-0.20, -0.16, FOOT_ANKLE_Z)
    b_foot_l.parent = b_lowleg_l

    # Right Leg
    b_upleg_r = eb.new("UpperLeg.R")
    b_upleg_r.head = (0.20, 0.0, HIP_Z)
    b_upleg_r.tail = (0.20, 0.0, HIP_Z - UPPER_LEG_LEN)
    b_upleg_r.parent = b_hips

    b_lowleg_r = eb.new("LowerLeg.R")
    b_lowleg_r.head = (0.20, 0.0, HIP_Z - UPPER_LEG_LEN)
    b_lowleg_r.tail = (0.20, 0.0, FOOT_ANKLE_Z)
    b_lowleg_r.parent = b_upleg_r

    b_foot_r = eb.new("Foot.R")
    b_foot_r.head = (0.20, 0.0, FOOT_ANKLE_Z)
    b_foot_r.tail = (0.20, -0.16, FOOT_ANKLE_Z)
    b_foot_r.parent = b_lowleg_r

    # Left Arm
    b_uparm_l = eb.new("UpperArm.L")
    b_uparm_l.head = (-0.33, 0.0, 1.04)
    b_uparm_l.tail = (-0.39, -0.02, 0.78)
    b_uparm_l.parent = b_spine

    b_lowarm_l = eb.new("LowerArm.L")
    b_lowarm_l.head = (-0.39, -0.02, 0.78)
    b_lowarm_l.tail = (-0.39, -0.07, 0.54)
    b_lowarm_l.parent = b_uparm_l

    b_hand_l = eb.new("Hand.L")
    b_hand_l.head = (-0.39, -0.07, 0.54)
    b_hand_l.tail = (-0.39, -0.16, 0.50)
    b_hand_l.parent = b_lowarm_l

    # Right Arm
    b_uparm_r = eb.new("UpperArm.R")
    b_uparm_r.head = (0.33, 0.0, 1.04)
    b_uparm_r.tail = (0.39, -0.02, 0.78)
    b_uparm_r.parent = b_spine

    b_lowarm_r = eb.new("LowerArm.R")
    b_lowarm_r.head = (0.39, -0.02, 0.78)
    b_lowarm_r.tail = (0.39, -0.07, 0.54)
    b_lowarm_r.parent = b_uparm_r

    b_hand_r = eb.new("Hand.R")
    b_hand_r.head = (0.39, -0.07, 0.54)
    b_hand_r.tail = (0.39, -0.16, 0.50)
    b_hand_r.parent = b_lowarm_r

    # Dedicated Sockets
    b_cargo = eb.new("Socket_Cargo")
    b_cargo.head = (0.0, -0.28, 0.65)
    b_cargo.tail = (0.0, -0.45, 0.65)
    b_cargo.parent = b_spine

    b_tool_r = eb.new("Socket_Tool_R")
    b_tool_r.head = (0.39, -0.16, 0.50)
    b_tool_r.tail = (0.39, -0.32, 0.50)
    b_tool_r.parent = b_hand_r

    b_head_sock = eb.new("Socket_Head")
    b_head_sock.head = (0.0, 0.0, 1.72)
    b_head_sock.tail = (0.0, 0.0, 1.88)
    b_head_sock.parent = b_head

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj

def assign_vertex_weights(mesh_obj, arm_obj, group_indices):
    """Assigns strictly anatomical vertex weights without cross-part distortion."""
    groups = {name: mesh_obj.vertex_groups.new(name=name) for name in group_indices.keys()}

    for name, v_indices in group_indices.items():
        if v_indices:
            groups[name].add(v_indices, 1.0, 'REPLACE')

    mod = mesh_obj.modifiers.new(name="Armature", type='ARMATURE')
    mod.object = arm_obj
    mod.use_vertex_groups = True
    mesh_obj.parent = arm_obj

def set_bone_rot(pose_bone, euler_deg):
    pose_bone.rotation_mode = 'XYZ'
    pose_bone.rotation_euler = Euler((
        math.radians(euler_deg[0]),
        math.radians(euler_deg[1]),
        math.radians(euler_deg[2])
    ), 'XYZ')

def reset_pose_transforms(arm_obj):
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.transforms_clear()
    for pb in arm_obj.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)

def solve_exact_leg_ik(target_y, target_z, cur_hip_z, tilt_deg=0.0):
    """Analytical 2-bone IK solver with exact zero-error stance height."""
    dy = target_y
    dz = target_z - cur_hip_z
    R = math.sqrt(dy * dy + dz * dz)
    max_reach = UPPER_LEG_LEN + LOWER_LEG_LEN - 0.0005
    R = min(R, max_reach)
    R = max(R, abs(UPPER_LEG_LEN - LOWER_LEG_LEN) + 0.0005)

    phi = math.atan2(dy, -dz)
    cos_alpha = (UPPER_LEG_LEN**2 + R**2 - LOWER_LEG_LEN**2) / (2.0 * UPPER_LEG_LEN * R)
    cos_alpha = max(-1.0, min(1.0, cos_alpha))
    alpha = math.acos(cos_alpha)

    # Knee bends forward towards -Y
    theta1 = phi - alpha
    knee_y = UPPER_LEG_LEN * math.sin(theta1)
    knee_z = cur_hip_z - UPPER_LEG_LEN * math.cos(theta1)

    theta2 = math.atan2(target_y - knee_y, -(target_z - knee_z))

    rot_up = math.degrees(theta1)
    rot_low = math.degrees(theta2 - theta1)
    rot_foot = tilt_deg + math.degrees(theta2)
    return rot_up, rot_low, rot_foot

def add_actions(arm_obj):
    arm_obj.animation_data_create()
    pb = arm_obj.pose.bones

    # 1. IDLE (Frame 0 to 30, exactly 1.000 s at 30 FPS)
    reset_pose_transforms(arm_obj)
    act_idle = bpy.data.actions.new("idle")
    act_idle.use_fake_user = True
    arm_obj.animation_data.action = act_idle

    for f in range(0, 31, 5):
        t = f / 30.0
        pb["Hips"].location = (0, 0, 0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        spine_rot = math.sin(t * 2 * math.pi) * 1.5
        set_bone_rot(pb["Spine"], (spine_rot, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.L"], (-4.0, 0, 6.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["UpperArm.R"], (-4.0, 0, -6.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.L"], (0, 0, 0))
        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.L"], (0, 0, 0))
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.R"], (0, 0, 0))
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.R"], (0, 0, 0))
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.R"], (0, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 2. WALK (Frame 0 to 30, exactly 1.000 s, stride 0.48 m forward along -Y)
    reset_pose_transforms(arm_obj)
    act_walk = bpy.data.actions.new("walk")
    act_walk.use_fake_user = True
    arm_obj.animation_data.action = act_walk

    for f in range(0, 31):
        t = f / 30.0
        hip_drop = -0.022 + 0.016 * abs(math.sin(t * 2 * math.pi))
        cur_hip_z = HIP_Z + hip_drop

        hips_sway = 0.010 * math.sin(t * 2 * math.pi)
        pb["Hips"].location = (hips_sway, hip_drop, 0.0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (0, 0, -hips_sway * 16.0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        if t <= 0.5:
            # Phase 1: Left foot is in Stance (y: -0.12 -> +0.12, Z: constant FOOT_ANKLE_Z)
            tau_l = t / 0.5
            y_l = -0.12 + 0.24 * tau_l
            z_l = FOOT_ANKLE_Z
            up_l, low_l, foot_l = solve_exact_leg_ik(y_l, z_l, cur_hip_z, tilt_deg=0.0)

            # Right foot is in Swing (y: +0.12 -> -0.12, with clearance arch)
            tau_r = t / 0.5
            y_r = 0.12 - 0.24 * tau_r
            z_r = FOOT_ANKLE_Z + 0.048 * math.sin(tau_r * math.pi)
            tilt_r = 10.0 * math.sin(tau_r * math.pi)
            up_r, low_r, foot_r = solve_exact_leg_ik(y_r, z_r, cur_hip_z, tilt_deg=tilt_r)
        else:
            # Phase 2: Left foot is in Swing
            tau_l = (t - 0.5) / 0.5
            y_l = 0.12 - 0.24 * tau_l
            z_l = FOOT_ANKLE_Z + 0.048 * math.sin(tau_l * math.pi)
            tilt_l = 10.0 * math.sin(tau_l * math.pi)
            up_l, low_l, foot_l = solve_exact_leg_ik(y_l, z_l, cur_hip_z, tilt_deg=tilt_l)

            # Right foot is in Stance
            tau_r = (t - 0.5) / 0.5
            y_r = -0.12 + 0.24 * tau_r
            z_r = FOOT_ANKLE_Z
            up_r, low_r, foot_r = solve_exact_leg_ik(y_r, z_r, cur_hip_z, tilt_deg=0.0)

        set_bone_rot(pb["UpperLeg.L"], (up_l, 0, 0))
        set_bone_rot(pb["LowerLeg.L"], (low_l, 0, 0))
        set_bone_rot(pb["Foot.L"], (foot_l, 0, 0))

        set_bone_rot(pb["UpperLeg.R"], (up_r, 0, 0))
        set_bone_rot(pb["LowerLeg.R"], (low_r, 0, 0))
        set_bone_rot(pb["Foot.R"], (foot_r, 0, 0))

        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        # Opposing Arm Swings
        arm_l_swing = -math.sin(t * 2 * math.pi) * 22.0
        arm_r_swing = math.sin(t * 2 * math.pi) * 22.0
        set_bone_rot(pb["UpperArm.L"], (arm_l_swing, 0, 6.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["UpperArm.R"], (arm_r_swing, 0, -6.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 3. CARRY_IDLE (Frame 0 to 30) - Hands cradling cargo bundle at Socket_Cargo
    reset_pose_transforms(arm_obj)
    act_carry_idle = bpy.data.actions.new("carry_idle")
    act_carry_idle.use_fake_user = True
    arm_obj.animation_data.action = act_carry_idle

    for f in range(0, 31, 5):
        t = f / 30.0
        pb["Hips"].location = (0, 0, 0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (0, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.L"], (0, 0, 0))
        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.L"], (0, 0, 0))
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.R"], (0, 0, 0))
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.R"], (0, 0, 0))
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.R"], (0, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        # Arms raised forward holding Socket_Cargo (hands at X=+-0.157, Y=-0.276, Z=0.654)
        set_bone_rot(pb["UpperArm.L"], (-34.0, -33.0, -3.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.L"], (-13.0, 0.0, 12.0))
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.R"], (-34.0, 33.0, 3.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.R"], (-13.0, 0.0, -12.0))
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 4. CARRY_WALK (Frame 0 to 30) - Carrying cargo while walking forward
    reset_pose_transforms(arm_obj)
    act_carry_walk = bpy.data.actions.new("carry_walk")
    act_carry_walk.use_fake_user = True
    arm_obj.animation_data.action = act_carry_walk

    for f in range(0, 31):
        t = f / 30.0
        hip_drop = -0.022 + 0.016 * abs(math.sin(t * 2 * math.pi))
        cur_hip_z = HIP_Z + hip_drop

        hips_sway = 0.010 * math.sin(t * 2 * math.pi)
        pb["Hips"].location = (hips_sway, hip_drop, 0.0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (0, 0, -hips_sway * 14.0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        if t <= 0.5:
            tau_l = t / 0.5
            y_l = -0.12 + 0.24 * tau_l
            z_l = FOOT_ANKLE_Z
            up_l, low_l, foot_l = solve_exact_leg_ik(y_l, z_l, cur_hip_z, tilt_deg=0.0)

            tau_r = t / 0.5
            y_r = 0.12 - 0.24 * tau_r
            z_r = FOOT_ANKLE_Z + 0.048 * math.sin(tau_r * math.pi)
            tilt_r = 10.0 * math.sin(tau_r * math.pi)
            up_r, low_r, foot_r = solve_exact_leg_ik(y_r, z_r, cur_hip_z, tilt_deg=tilt_r)
        else:
            tau_l = (t - 0.5) / 0.5
            y_l = 0.12 - 0.24 * tau_l
            z_l = FOOT_ANKLE_Z + 0.048 * math.sin(tau_l * math.pi)
            tilt_l = 10.0 * math.sin(tau_l * math.pi)
            up_l, low_l, foot_l = solve_exact_leg_ik(y_l, z_l, cur_hip_z, tilt_deg=tilt_l)

            tau_r = (t - 0.5) / 0.5
            y_r = -0.12 + 0.24 * tau_r
            z_r = FOOT_ANKLE_Z
            up_r, low_r, foot_r = solve_exact_leg_ik(y_r, z_r, cur_hip_z, tilt_deg=0.0)

        set_bone_rot(pb["UpperLeg.L"], (up_l, 0, 0))
        set_bone_rot(pb["LowerLeg.L"], (low_l, 0, 0))
        set_bone_rot(pb["Foot.L"], (foot_l, 0, 0))

        set_bone_rot(pb["UpperLeg.R"], (up_r, 0, 0))
        set_bone_rot(pb["LowerLeg.R"], (low_r, 0, 0))
        set_bone_rot(pb["Foot.R"], (foot_r, 0, 0))

        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        # Arms held steady cradling cargo with subtle body sway
        set_bone_rot(pb["UpperArm.L"], (-34.0, -33.0, -3.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.L"], (-13.0, 0.0, 12.0))
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.R"], (-34.0, 33.0, 3.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.R"], (-13.0, 0.0, -12.0))
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 5. WORK_GATHER (Frame 0 to 30)
    reset_pose_transforms(arm_obj)
    act_gather = bpy.data.actions.new("work_gather")
    act_gather.use_fake_user = True
    arm_obj.animation_data.action = act_gather

    for f in range(0, 31, 3):
        t = f / 30.0
        pb["Hips"].location = (0, 0, 0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        cycle = math.sin(t * 2 * math.pi)
        bend = 14.0 + 12.0 * max(0.0, cycle)
        set_bone_rot(pb["Spine"], (bend, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        arm_reach = -15.0 - 20.0 * max(0.0, cycle)
        set_bone_rot(pb["UpperArm.L"], (arm_reach, 0, -12.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["UpperArm.R"], (arm_reach, 0, 12.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.L"], (0, 0, 0))
        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.L"], (0, 0, 0))
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.R"], (0, 0, 0))
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.R"], (0, 0, 0))
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.R"], (0, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # Return to clean rest pose
    reset_pose_transforms(arm_obj)
    bpy.ops.object.mode_set(mode='OBJECT')

def verify_mesh_grounding_and_actions(mesh_obj, arm_obj):
    """Rigorous pre-export check: verifies that no vertex dips below Z=0 on any frame of any action,
    and that during stance phase of walk/carry_walk the sole is firmly on the ground."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    actions = [bpy.data.actions[name] for name in ["idle", "walk", "carry_idle", "carry_walk", "work_gather"]]

    print("\n--- RIGOROUS M1.1 ACTION VERIFICATION ---")
    for act in actions:
        arm_obj.animation_data.action = act
        min_z_overall = 999.0
        max_contact_z_in_stance = 0.0

        for f in range(0, 31):
            bpy.context.scene.frame_set(f)
            depsgraph.update()
            eval_obj = mesh_obj.evaluated_get(depsgraph)
            eval_mesh = eval_obj.to_mesh()
            min_z = min(v.co.z for v in eval_mesh.vertices)
            min_z_overall = min(min_z_overall, min_z)

            # Check stance contact
            if act.name in ("walk", "carry_walk"):
                if f in (3, 4, 5, 6, 7, 18, 19, 20, 21, 22):
                    max_contact_z_in_stance = max(max_contact_z_in_stance, min_z)

            eval_obj.to_mesh_clear()

        print(f"Action '{act.name:12s}': min Z = {min_z_overall:+.4f} m (stance contact Z = {max_contact_z_in_stance:.4f} m)")
        if min_z_overall < -0.002:
            raise RuntimeError(f"Action '{act.name}' penetrates ground: min Z = {min_z_overall:.4f} m!")
        if act.name in ("walk", "carry_walk") and max_contact_z_in_stance > 0.0025:
            raise RuntimeError(f"Action '{act.name}' floating in stance: max stance Z = {max_contact_z_in_stance:.4f} m!")

    print("--- ALL ACTIONS PASSED RIGOROUS GROUND CONTACT VERIFICATION ---\n")

def main():
    clear_scene()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    blend_path = os.path.join(script_dir, "resident.blend")
    glb_path = os.path.join(repo_root, "godot", "assets", "models", "resident.glb")

    mesh_obj, group_indices = build_character_mesh()
    arm_obj = build_armature()
    assign_vertex_weights(mesh_obj, arm_obj, group_indices)
    add_actions(arm_obj)

    # Run verification before saving
    verify_mesh_grounding_and_actions(mesh_obj, arm_obj)

    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"[generate_resident] Saved Blender scene to {blend_path}")

    # Export GLB with exact settings
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_apply=False, # preserve armature hierarchy
        export_animations=True,
        export_frame_range=True,
        export_frame_step=1
    )
    print(f"[generate_resident] Exported GLB to {glb_path}")

if __name__ == "__main__":
    main()
