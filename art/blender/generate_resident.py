"""Procedural 3D Clayfolk Character Generator for Blender 4.2 LTS.

Creates a genuine 3D terracotta clay villager with multi-material shading,
sculpted eyes/nose, waist cord, seamless mesh joints, and 5 animation cycles:
idle, walk, carry_idle, carry_walk, work_gather.
Exports art/blender/resident.blend and godot/assets/models/resident.glb.
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def create_pbr_material(name, base_color, roughness=0.78):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.22
        elif "Specular" in bsdf.inputs:
            bsdf.inputs["Specular"].default_value = 0.22
        if "Subsurface Weight" in bsdf.inputs:
            bsdf.inputs["Subsurface Weight"].default_value = 0.08
    return mat

def build_character_mesh():
    mesh = bpy.data.meshes.new("ResidentMesh")
    obj = bpy.data.objects.new("Resident", mesh)
    bpy.context.collection.objects.link(obj)

    # Materials:
    # 0: Body terracotta
    # 1: Face ochre
    # 2: Dark eyes
    # 3: Grass cord
    mat_body = create_pbr_material("ClayBody", (0.72, 0.35, 0.18, 1.0), roughness=0.80)
    mat_face = create_pbr_material("ClayFace", (0.84, 0.48, 0.28, 1.0), roughness=0.78)
    mat_eyes = create_pbr_material("DarkEyes", (0.12, 0.08, 0.06, 1.0), roughness=0.50)
    mat_cord = create_pbr_material("GrassCord", (0.62, 0.52, 0.28, 1.0), roughness=0.90)

    mesh.materials.append(mat_body) # idx 0
    mesh.materials.append(mat_face) # idx 1
    mesh.materials.append(mat_eyes) # idx 2
    mesh.materials.append(mat_cord) # idx 3

    bm = bmesh.new()

    # Front is -Y, Back is +Y, Up is +Z
    # 1. Torso & Hips (clay pear shape)
    torso_layers = [
        (0.48, 0.28), (0.58, 0.37), (0.70, 0.38), (0.85, 0.34), (1.00, 0.30), (1.15, 0.22)
    ]
    prev_ring = None
    first_ring = None
    num_segments = 16
    for z, r in torso_layers:
        ring = []
        for i in range(num_segments):
            angle = 2 * math.pi * i / num_segments
            irr = 1.0 + 0.025 * math.sin(angle * 3)
            x = r * irr * math.cos(angle) * 1.04
            y = r * irr * math.sin(angle) * 0.96
            v = bm.verts.new((x, y, z))
            ring.append(v)
        if prev_ring:
            for i in range(num_segments):
                i_next = (i + 1) % num_segments
                f = bm.faces.new([prev_ring[i], prev_ring[i_next], ring[i_next], ring[i]])
                f.material_index = 0
        else:
            first_ring = ring
        prev_ring = ring

    # Close bottom and top of torso
    f_bottom = bm.faces.new(first_ring[::-1])
    f_bottom.material_index = 0
    f_top = bm.faces.new(prev_ring)
    f_top.material_index = 0

    # 2. Cord belt around waist (z=0.68)
    cord_radius = 0.385
    cord_thickness = 0.038
    cord_prev = None
    cord_first = None
    cord_steps = 16
    for i in range(cord_steps):
        angle = 2 * math.pi * i / cord_steps
        cx = cord_radius * math.cos(angle) * 1.05
        cy = cord_radius * math.sin(angle) * 0.97
        cz = 0.68
        ring = []
        for j in range(6):
            sub_a = 2 * math.pi * j / 6
            rx = cord_thickness * math.cos(sub_a)
            rz = cord_thickness * math.sin(sub_a)
            vx = cx + rx * math.cos(angle)
            vy = cy + rx * math.sin(angle)
            vz = cz + rz
            ring.append(bm.verts.new((vx, vy, vz)))
        if cord_prev:
            for j in range(6):
                j_next = (j + 1) % 6
                f = bm.faces.new([cord_prev[j], cord_prev[j_next], ring[j_next], ring[j]])
                f.material_index = 3
        else:
            cord_first = ring
        cord_prev = ring
    for j in range(6):
        j_next = (j + 1) % 6
        f = bm.faces.new([cord_prev[j], cord_prev[j_next], cord_first[j_next], cord_first[j]])
        f.material_index = 3

    # 3. Head: sculpted sphere at z=1.45 (radius ~0.42)
    head_center = Vector((0, 0, 1.45))
    head_rings = 12
    head_segs = 16
    head_verts = []
    for r_idx in range(head_rings + 1):
        phi = math.pi * r_idx / head_rings
        z = head_center.z + 0.42 * math.cos(phi) * 0.98
        ring_r = 0.42 * math.sin(phi)
        ring = []
        for s_idx in range(head_segs):
            theta = 2 * math.pi * s_idx / head_segs
            irr = 1.0 + 0.02 * math.sin(theta * 3 + phi * 2)
            x = ring_r * irr * math.cos(theta) * 1.06
            y = ring_r * irr * math.sin(theta) * 0.98
            v = bm.verts.new((x, y, z))
            ring.append(v)
        head_verts.append(ring)
        if r_idx > 0:
            prev_r = head_verts[r_idx - 1]
            for s_idx in range(head_segs):
                s_next = (s_idx + 1) % head_segs
                # Check if face is on the front side (y < -0.1) for face color
                avg_y = (prev_r[s_idx].co.y + ring[s_idx].co.y) * 0.5
                mat_idx = 1 if avg_y < -0.10 else 0
                if r_idx == 1:
                    f = bm.faces.new([prev_r[0], ring[s_next], ring[s_idx]])
                elif r_idx == head_rings:
                    f = bm.faces.new([prev_r[s_idx], prev_r[s_next], ring[0]])
                else:
                    f = bm.faces.new([prev_r[s_idx], prev_r[s_next], ring[s_next], ring[s_idx]])
                f.material_index = mat_idx

    # 4. Inset dark clay eyes (front side: y is NEGATIVE!)
    for side in (-1, 1):
        eye_center = Vector((side * 0.13, -0.38, 1.46))
        res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.048,
            matrix=Matrix.Translation(eye_center)
        )
        for v in res['verts']:
            for f in v.link_faces:
                f.material_index = 2

    # 5. Small clay nose (front side: y is NEGATIVE!)
    nose_center = Vector((0.0, -0.42, 1.41))
    res_nose = bmesh.ops.create_uvsphere(
        bm, u_segments=8, v_segments=6, radius=0.042,
        matrix=Matrix.Translation(nose_center)
    )
    for v in res_nose['verts']:
        for f in v.link_faces:
            f.material_index = 1

    # 6. Legs and Feet
    # Front is -Y, so toes point towards -Y!
    for side in (-1, 1):
        sign = side
        lx = sign * 0.20
        leg_layers = [(0.50, 0.12), (0.38, 0.11), (0.28, 0.10), (0.18, 0.10), (0.09, 0.11)]
        prev_lring = None
        for lz, lr in leg_layers:
            lring = []
            for i in range(10):
                a = 2 * math.pi * i / 10
                vx = lx + lr * math.cos(a)
                vy = lr * math.sin(a)
                v = bm.verts.new((vx, vy, lz))
                lring.append(v)
            if prev_lring:
                for i in range(10):
                    i_next = (i + 1) % 10
                    f = bm.faces.new([prev_lring[i], prev_lring[i_next], lring[i_next], lring[i]])
                    f.material_index = 0
            prev_lring = lring

        # Foot: broad rounded clay sole firmly on ground z=0.0!
        # Center at y = -0.05, length 0.30 from y=+0.10 (heel) to y=-0.20 (toes)
        res_foot = bmesh.ops.create_cube(
            bm, size=1.0,
            matrix=Matrix.Translation(Vector((lx, -0.05, 0.045))) @ Matrix.Scale(0.18, 4, Vector((1,0,0))) @ Matrix.Scale(0.30, 4, Vector((0,1,0))) @ Matrix.Scale(0.09, 4, Vector((0,0,1)))
        )
        for v in res_foot['verts']:
            for f in v.link_faces:
                f.material_index = 0

    # 7. Arms and Hands
    for side in (-1, 1):
        sign = side
        ax = sign * 0.34
        # Closed hemisphere cap at shoulder so no open seams
        bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.095,
            matrix=Matrix.Translation(Vector((ax, 0.0, 1.05)))
        )
        arm_layers = [
            (Vector((ax, 0.0, 1.04)), 0.09),
            (Vector((ax + sign * 0.05, -0.01, 0.90)), 0.08),
            (Vector((ax + sign * 0.07, -0.02, 0.76)), 0.075), # elbow
            (Vector((ax + sign * 0.06, -0.05, 0.63)), 0.07),
            (Vector((ax + sign * 0.04, -0.08, 0.52)), 0.075), # wrist
        ]
        prev_aring = None
        for pos, ar in arm_layers:
            aring = []
            for i in range(10):
                a = 2 * math.pi * i / 10
                vx = pos.x + ar * math.cos(a)
                vy = pos.y + ar * math.sin(a)
                vz = pos.z + ar * math.sin(a) * 0.15
                v = bm.verts.new((vx, vy, vz))
                aring.append(v)
            if prev_aring:
                for i in range(10):
                    i_next = (i + 1) % 10
                    f = bm.faces.new([prev_aring[i], prev_aring[i_next], aring[i_next], aring[i]])
                    f.material_index = 0
            prev_aring = aring

        # Hand: rounded clay mitten/palm positioned slightly forward (-Y)
        hand_pos = Vector((ax + sign * 0.04, -0.11, 0.48))
        res_hand = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.075,
            matrix=Matrix.Translation(hand_pos) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(1.2, 4, Vector((0,1,0)))
        )
        for v in res_hand['verts']:
            for f in v.link_faces:
                f.material_index = 0

    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True

    return obj

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
    b_hips.head = (0, 0, 0.55)
    b_hips.tail = (0, 0, 0.75)
    b_hips.parent = b_root

    b_spine = eb.new("Spine")
    b_spine.head = (0, 0, 0.75)
    b_spine.tail = (0, 0, 1.15)
    b_spine.parent = b_hips

    b_head = eb.new("Head")
    b_head.head = (0, 0, 1.15)
    b_head.tail = (0, 0, 1.85)
    b_head.parent = b_spine

    # Left Leg (X < 0)
    b_upleg_l = eb.new("UpperLeg.L")
    b_upleg_l.head = (-0.20, 0.0, 0.52)
    b_upleg_l.tail = (-0.20, 0.0, 0.28)
    b_upleg_l.parent = b_hips

    b_lowleg_l = eb.new("LowerLeg.L")
    b_lowleg_l.head = (-0.20, 0.0, 0.28)
    b_lowleg_l.tail = (-0.20, 0.0, 0.09)
    b_lowleg_l.parent = b_upleg_l

    # Foot points forward towards -Y
    b_foot_l = eb.new("Foot.L")
    b_foot_l.head = (-0.20, 0.0, 0.09)
    b_foot_l.tail = (-0.20, -0.18, 0.09)
    b_foot_l.parent = b_lowleg_l

    # Right Leg (X > 0)
    b_upleg_r = eb.new("UpperLeg.R")
    b_upleg_r.head = (0.20, 0.0, 0.52)
    b_upleg_r.tail = (0.20, 0.0, 0.28)
    b_upleg_r.parent = b_hips

    b_lowleg_r = eb.new("LowerLeg.R")
    b_lowleg_r.head = (0.20, 0.0, 0.28)
    b_lowleg_r.tail = (0.20, 0.0, 0.09)
    b_lowleg_r.parent = b_upleg_r

    b_foot_r = eb.new("Foot.R")
    b_foot_r.head = (0.20, 0.0, 0.09)
    b_foot_r.tail = (0.20, -0.18, 0.09)
    b_foot_r.parent = b_lowleg_r

    # Left Arm
    b_uparm_l = eb.new("UpperArm.L")
    b_uparm_l.head = (-0.32, 0.0, 1.05)
    b_uparm_l.tail = (-0.44, 0.0, 0.80)
    b_uparm_l.parent = b_spine

    b_lowarm_l = eb.new("LowerArm.L")
    b_lowarm_l.head = (-0.44, 0.0, 0.80)
    b_lowarm_l.tail = (-0.44, -0.04, 0.56)
    b_lowarm_l.parent = b_uparm_l

    b_hand_l = eb.new("Hand.L")
    b_hand_l.head = (-0.44, -0.04, 0.56)
    b_hand_l.tail = (-0.44, -0.15, 0.48)
    b_hand_l.parent = b_lowarm_l

    # Right Arm
    b_uparm_r = eb.new("UpperArm.R")
    b_uparm_r.head = (0.32, 0.0, 1.05)
    b_uparm_r.tail = (0.44, 0.0, 0.80)
    b_uparm_r.parent = b_spine

    b_lowarm_r = eb.new("LowerArm.R")
    b_lowarm_r.head = (0.44, 0.0, 0.80)
    b_lowarm_r.tail = (0.44, -0.04, 0.56)
    b_lowarm_r.parent = b_uparm_r

    b_hand_r = eb.new("Hand.R")
    b_hand_r.head = (0.44, -0.04, 0.56)
    b_hand_r.tail = (0.44, -0.15, 0.48)
    b_hand_r.parent = b_lowarm_r

    # Attachment Sockets
    b_cargo = eb.new("Socket_Cargo")
    b_cargo.head = (0, -0.30, 0.68)
    b_cargo.tail = (0, -0.45, 0.68)
    b_cargo.parent = b_spine

    b_tool_r = eb.new("Socket_Tool_R")
    b_tool_r.head = (0.44, -0.15, 0.48)
    b_tool_r.tail = (0.44, -0.30, 0.48)
    b_tool_r.parent = b_hand_r

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj

def assign_vertex_weights(mesh_obj, arm_obj):
    bone_names = [
        "Hips", "Spine", "Head",
        "UpperLeg.L", "LowerLeg.L", "Foot.L",
        "UpperLeg.R", "LowerLeg.R", "Foot.R",
        "UpperArm.L", "LowerArm.L", "Hand.L",
        "UpperArm.R", "LowerArm.R", "Hand.R"
    ]
    groups = {name: mesh_obj.vertex_groups.new(name=name) for name in bone_names}

    mesh = mesh_obj.data
    for v in mesh.vertices:
        p = v.co
        x, y, z = p.x, p.y, p.z

        if z >= 1.15:
            groups["Head"].add([v.index], 1.0, 'REPLACE')
        elif z >= 0.72 and abs(x) < 0.28:
            spine_w = min(1.0, (z - 0.70) / 0.40)
            groups["Spine"].add([v.index], spine_w, 'REPLACE')
            groups["Hips"].add([v.index], 1.0 - spine_w, 'REPLACE')
        elif abs(x) >= 0.28 and z >= 0.46:
            side_str = ".R" if x > 0 else ".L"
            if z >= 0.82:
                groups["UpperArm" + side_str].add([v.index], 1.0, 'REPLACE')
            elif z >= 0.54:
                groups["LowerArm" + side_str].add([v.index], 1.0, 'REPLACE')
            else:
                groups["Hand" + side_str].add([v.index], 1.0, 'REPLACE')
        elif z >= 0.45:
            groups["Hips"].add([v.index], 1.0, 'REPLACE')
        else:
            side_str = ".R" if x > 0 else ".L"
            if z >= 0.26:
                groups["UpperLeg" + side_str].add([v.index], 1.0, 'REPLACE')
            elif z >= 0.08:
                groups["LowerLeg" + side_str].add([v.index], 1.0, 'REPLACE')
            else:
                groups["Foot" + side_str].add([v.index], 1.0, 'REPLACE')

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

def add_actions(arm_obj):
    arm_obj.animation_data_create()
    pb = arm_obj.pose.bones

    # 1. IDLE (30 frames, 30 FPS, loops seamlessly)
    act_idle = bpy.data.actions.new("idle")
    arm_obj.animation_data.action = act_idle
    for f in (1, 15, 30):
        t = (f - 1) / 29.0
        bob = 0.015 * math.sin(t * 2 * math.pi)
        pb["Hips"].location = (0, 0, bob)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)
        set_bone_rot(pb["Spine"], (math.sin(t * 2 * math.pi) * 2.0, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.R"], (0, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["UpperArm.L"], (-5.0, 0, 10.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["UpperArm.R"], (-5.0, 0, -10.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 2. WALK (30 frames, 30 FPS, seamless loop, alternating legs)
    # Forward direction in Blender is -Y.
    # Positive rotation about X tilts leg forward (towards -Y)!
    act_walk = bpy.data.actions.new("walk")
    arm_obj.animation_data.action = act_walk
    frames = [1, 8, 15, 23, 30]
    for f in frames:
        phase = (f - 1) / 29.0 * 2 * math.pi
        hips_bob = -0.02 * abs(math.sin(phase))
        hips_sway = 0.015 * math.sin(phase)
        pb["Hips"].location = (hips_sway, 0, hips_bob)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (0, 0, -hips_sway * 15.0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        leg_l_angle = math.sin(phase) * 26.0
        leg_r_angle = -math.sin(phase) * 26.0
        knee_l = max(0.0, -math.sin(phase) * 35.0)
        knee_r = max(0.0, math.sin(phase) * 35.0)

        set_bone_rot(pb["UpperLeg.L"], (leg_l_angle, 0, 0))
        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.L"], (-knee_l, 0, 0))
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        foot_l_rot = -leg_l_angle + knee_l if leg_l_angle > 0 else 0.0
        set_bone_rot(pb["Foot.L"], (foot_l_rot, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.R"], (leg_r_angle, 0, 0))
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.R"], (-knee_r, 0, 0))
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        foot_r_rot = -leg_r_angle + knee_r if leg_r_angle > 0 else 0.0
        set_bone_rot(pb["Foot.R"], (foot_r_rot, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        # Arms opposing swing
        arm_l_swing = -math.sin(phase) * 22.0
        arm_r_swing = math.sin(phase) * 22.0
        set_bone_rot(pb["UpperArm.L"], (arm_l_swing, 0, 8.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["UpperArm.R"], (arm_r_swing, 0, -8.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 3. CARRY_IDLE (30 frames)
    # Arms raised forward cradling cargo bundle
    act_carry_idle = bpy.data.actions.new("carry_idle")
    arm_obj.animation_data.action = act_carry_idle
    for f in (1, 15, 30):
        t = (f - 1) / 29.0
        bob = 0.012 * math.sin(t * 2 * math.pi)
        pb["Hips"].location = (0, 0, bob)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.R"], (0, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.L"], (40.0, 0, -22.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.L"], (-45.0, 0, 20.0))
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.R"], (40.0, 0, 22.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.R"], (-45.0, 0, -20.0))
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 4. CARRY_WALK (30 frames)
    act_carry_walk = bpy.data.actions.new("carry_walk")
    arm_obj.animation_data.action = act_carry_walk
    for f in frames:
        phase = (f - 1) / 29.0 * 2 * math.pi
        hips_bob = -0.02 * abs(math.sin(phase))
        hips_sway = 0.015 * math.sin(phase)
        pb["Hips"].location = (hips_sway, 0, hips_bob)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        leg_l_angle = math.sin(phase) * 26.0
        leg_r_angle = -math.sin(phase) * 26.0
        knee_l = max(0.0, -math.sin(phase) * 35.0)
        knee_r = max(0.0, math.sin(phase) * 35.0)

        set_bone_rot(pb["UpperLeg.L"], (leg_l_angle, 0, 0))
        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.L"], (-knee_l, 0, 0))
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        foot_l_rot = -leg_l_angle + knee_l if leg_l_angle > 0 else 0.0
        set_bone_rot(pb["Foot.L"], (foot_l_rot, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.R"], (leg_r_angle, 0, 0))
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.R"], (-knee_r, 0, 0))
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        foot_r_rot = -leg_r_angle + knee_r if leg_r_angle > 0 else 0.0
        set_bone_rot(pb["Foot.R"], (foot_r_rot, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.L"], (40.0 + hips_bob * 40.0, 0, -22.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.L"], (-45.0, 0, 20.0))
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.R"], (40.0 + hips_bob * 40.0, 0, 22.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.R"], (-45.0, 0, -20.0))
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 5. WORK_GATHER (30 frames)
    act_work = bpy.data.actions.new("work_gather")
    arm_obj.animation_data.action = act_work
    for f in (1, 8, 15, 22, 30):
        t = (f - 1) / 29.0
        bend = math.sin(t * math.pi)
        pb["Hips"].location = (0, -bend * 0.08, -bend * 0.08)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (bend * 32.0, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["Head"], (-bend * 18.0, 0, 0))
        pb["Head"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.L"], (-bend * 10.0, 0, 0))
        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.L"], (-bend * 18.0, 0, 0))
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.L"], (bend * 8.0, 0, 0))
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.R"], (-bend * 10.0, 0, 0))
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerLeg.R"], (-bend * 18.0, 0, 0))
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Foot.R"], (bend * 8.0, 0, 0))
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        arm_down = bend * 48.0
        set_bone_rot(pb["UpperArm.L"], (arm_down, 0, -10.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.L"], (-bend * 30.0, 0, 15.0))
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperArm.R"], (arm_down, 0, 10.0))
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["LowerArm.R"], (-bend * 30.0, 0, -15.0))
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    actions = [act_idle, act_walk, act_carry_idle, act_carry_walk, act_work]
    for act in actions:
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = act.name
        track.strips.new(act.name, 1, act)

def main():
    clear_scene()
    mesh_obj = build_character_mesh()
    arm_obj = build_armature()
    assign_vertex_weights(mesh_obj, arm_obj)
    add_actions(arm_obj)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    blend_path = os.path.join(repo_root, "art", "blender", "resident.blend")
    glb_dir = os.path.join(repo_root, "godot", "assets", "models")
    os.makedirs(glb_dir, exist_ok=True)
    glb_path = os.path.join(glb_dir, "resident.glb")

    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"[generate_resident] Saved Blender scene to: {blend_path}")

    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_animations=True,
        export_apply=True,
        export_skins=True,
        export_all_influences=False
    )
    print(f"[generate_resident] Exported GLB to: {glb_path}")

if __name__ == "__main__":
    main()
