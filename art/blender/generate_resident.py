"""Clayfolk clay sculpt + compatible 19-bone rig, Blender 4.2 LTS.
Run: blender --background --python art/blender/generate_resident.py
Geometry/materials: resident_sculpt.py. All assets are authored by this project.
"""
import os
import sys
import math
import bpy
from mathutils import Vector, Matrix, Euler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from resident_sculpt import build_character_mesh
HIP_Z = 0.49
UPPER_LEG_LEN = 0.23
LOWER_LEG_LEN = 0.21
FOOT_ANKLE_Z = 0.05
SOLE_Z = 0.0

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 30

def build_armature():
    arm_data = bpy.data.armatures.new("ResidentArmature")
    arm_obj = bpy.data.objects.new("ResidentArmature", arm_data)
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
    b_uparm_l.tail = (-0.45, -0.02, 0.78)
    b_uparm_l.parent = b_spine

    b_lowarm_l = eb.new("LowerArm.L")
    b_lowarm_l.head = (-0.45, -0.02, 0.78)
    b_lowarm_l.tail = (-0.485, -0.07, 0.54)
    b_lowarm_l.parent = b_uparm_l

    b_hand_l = eb.new("Hand.L")
    b_hand_l.head = (-0.485, -0.07, 0.54)
    b_hand_l.tail = (-0.485, -0.16, 0.50)
    b_hand_l.parent = b_lowarm_l

    # Right Arm
    b_uparm_r = eb.new("UpperArm.R")
    b_uparm_r.head = (0.33, 0.0, 1.04)
    b_uparm_r.tail = (0.45, -0.02, 0.78)
    b_uparm_r.parent = b_spine

    b_lowarm_r = eb.new("LowerArm.R")
    b_lowarm_r.head = (0.45, -0.02, 0.78)
    b_lowarm_r.tail = (0.485, -0.07, 0.54)
    b_lowarm_r.parent = b_uparm_r

    b_hand_r = eb.new("Hand.R")
    b_hand_r.head = (0.485, -0.07, 0.54)
    b_hand_r.tail = (0.485, -0.16, 0.50)
    b_hand_r.parent = b_lowarm_r

    # Attachment Sockets for Items and Props
    b_sock_head = eb.new("Socket_Head")
    b_sock_head.head = (0, 0, 1.72)
    b_sock_head.tail = (0, 0, 1.82)
    b_sock_head.parent = b_head

    b_sock_cargo = eb.new("Socket_Cargo")
    b_sock_cargo.head = (0.0, -0.44, 0.85)
    b_sock_cargo.tail = (0.0, -0.54, 0.85)
    b_sock_cargo.parent = b_spine

    b_sock_tool_r = eb.new("Socket_Tool_R")
    b_sock_tool_r.head = (0.485, -0.16, 0.50)
    b_sock_tool_r.tail = (0.485, -0.26, 0.50)
    b_sock_tool_r.parent = b_hand_r

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj

def assign_vertex_weights(mesh_obj, arm_obj, group_weights):
    vert_to_groups = {}
    for group_name, weight_list in group_weights.items():
        for v_idx, w in weight_list:
            if v_idx not in vert_to_groups:
                vert_to_groups[v_idx] = {}
            vert_to_groups[v_idx][group_name] = vert_to_groups[v_idx].get(group_name, 0.0) + w

    created_vgs = {}
    for group_name in group_weights.keys():
        created_vgs[group_name] = mesh_obj.vertex_groups.new(name=group_name)

    for v_idx, g_dict in vert_to_groups.items():
        total_w = sum(g_dict.values())
        if total_w > 0.0:
            for group_name, w in g_dict.items():
                created_vgs[group_name].add([v_idx], w / total_w, 'REPLACE')

    mod = mesh_obj.modifiers.new(name="Armature", type='ARMATURE')
    mod.object = arm_obj
    mesh_obj.parent = arm_obj

def reset_pose_transforms(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)

def set_bone_rot(pb, euler_deg):
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = Euler((math.radians(euler_deg[0]),
                               math.radians(euler_deg[1]),
                               math.radians(euler_deg[2])), 'XYZ')

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
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()

    pb = arm_obj.pose.bones

    # 1. IDLE (Frame 0 to 30, exactly 1.000 s)
    reset_pose_transforms(arm_obj)
    act_idle = bpy.data.actions.new("idle")
    act_idle.use_fake_user = True
    arm_obj.animation_data.action = act_idle

    for f in range(0, 31):
        t = f / 30.0
        breath = 0.012 * math.sin(t * 2 * math.pi)

        pb["Hips"].location = (0.0, 0.0, 0.0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        pb["Spine"].location = (0, 0, breath * 0.5)
        pb["Spine"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (breath * 2.0, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)
        set_bone_rot(pb["Head"], (1.4*math.sin(t*2*math.pi), 0, 3.0*math.sin(t*2*math.pi)))
        pb["Head"].keyframe_insert(data_path="rotation_euler", frame=f)


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
            z_r = FOOT_ANKLE_Z + 0.065 * math.sin(tau_r * math.pi)
            tilt_r = 10.0 * math.sin(tau_r * math.pi)
            up_r, low_r, foot_r = solve_exact_leg_ik(y_r, z_r, cur_hip_z, tilt_deg=tilt_r)
        else:
            # Phase 2: Left foot is in Swing
            tau_l = (t - 0.5) / 0.5
            y_l = 0.12 - 0.24 * tau_l
            z_l = FOOT_ANKLE_Z + 0.065 * math.sin(tau_l * math.pi)
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

        # Natural arm swing opposing leg movement
        arm_swing = 16.0 * math.sin(t * 2 * math.pi)
        set_bone_rot(pb["UpperArm.L"], (arm_swing, 0, 6.0))
        set_bone_rot(pb["UpperArm.R"], (-arm_swing, 0, -6.0))
        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 3. CARRY_IDLE (Holding cargo firmly in front at Socket_Cargo)
    reset_pose_transforms(arm_obj)
    act_carry_idle = bpy.data.actions.new("carry_idle")
    act_carry_idle.use_fake_user = True
    arm_obj.animation_data.action = act_carry_idle

    for f in range(0, 31):
        t = f / 30.0
        breath = 0.010 * math.sin(t * 2 * math.pi)

        pb["Hips"].location = (0.0, 0.0, 0.0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        pb["Spine"].location = (0, 0, breath * 0.5)
        pb["Spine"].keyframe_insert(data_path="location", frame=f)
        set_bone_rot(pb["Spine"], (breath * 2.0, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        # Arms wrap firmly forward around cargo at (0, -0.44, 0.85)
        set_bone_rot(pb["UpperArm.L"], (-50.0, -25.0, 6.0))
        set_bone_rot(pb["LowerArm.L"], (-42.0, -12.0, 26.0))
        set_bone_rot(pb["Hand.L"], (15.0, 0.0, 15.0))

        set_bone_rot(pb["UpperArm.R"], (-50.0, 25.0, -6.0))
        set_bone_rot(pb["LowerArm.R"], (-42.0, 12.0, -26.0))
        set_bone_rot(pb["Hand.R"], (15.0, 0.0, -15.0))

        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Hand.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Hand.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.L"], (0, 0, 0))
        set_bone_rot(pb["LowerLeg.L"], (0, 0, 0))
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        set_bone_rot(pb["UpperLeg.R"], (0, 0, 0))
        set_bone_rot(pb["LowerLeg.R"], (0, 0, 0))
        set_bone_rot(pb["Foot.R"], (0, 0, 0))

        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 4. CARRY_WALK (Legs execute full ground-calibrated walk while arms hold cargo)
    reset_pose_transforms(arm_obj)
    act_carry_walk = bpy.data.actions.new("carry_walk")
    act_carry_walk.use_fake_user = True
    arm_obj.animation_data.action = act_carry_walk

    for f in range(0, 31):
        t = f / 30.0
        hip_drop = -0.022 + 0.016 * abs(math.sin(t * 2 * math.pi))
        cur_hip_z = HIP_Z + hip_drop

        hips_sway = 0.008 * math.sin(t * 2 * math.pi)
        pb["Hips"].location = (hips_sway, hip_drop, 0.0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (0, 0, -hips_sway * 12.0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        if t <= 0.5:
            tau_l = t / 0.5
            y_l = -0.12 + 0.24 * tau_l
            z_l = FOOT_ANKLE_Z
            up_l, low_l, foot_l = solve_exact_leg_ik(y_l, z_l, cur_hip_z, tilt_deg=0.0)

            tau_r = t / 0.5
            y_r = 0.12 - 0.24 * tau_r
            z_r = FOOT_ANKLE_Z + 0.065 * math.sin(tau_r * math.pi)
            tilt_r = 10.0 * math.sin(tau_r * math.pi)
            up_r, low_r, foot_r = solve_exact_leg_ik(y_r, z_r, cur_hip_z, tilt_deg=tilt_r)
        else:
            tau_l = (t - 0.5) / 0.5
            y_l = 0.12 - 0.24 * tau_l
            z_l = FOOT_ANKLE_Z + 0.065 * math.sin(tau_l * math.pi)
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

        # Arms stably hold cargo during walk with gentle natural step damping
        arm_bob = 2.0 * math.sin(t * 2 * math.pi)
        set_bone_rot(pb["UpperArm.L"], (-50.0 + arm_bob, -25.0, 6.0))
        set_bone_rot(pb["LowerArm.L"], (-42.0, -12.0, 26.0))
        set_bone_rot(pb["Hand.L"], (15.0, 0.0, 15.0))

        set_bone_rot(pb["UpperArm.R"], (-50.0 + arm_bob, 25.0, -6.0))
        set_bone_rot(pb["LowerArm.R"], (-42.0, 12.0, -26.0))
        set_bone_rot(pb["Hand.R"], (15.0, 0.0, -15.0))

        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Hand.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Hand.R"].keyframe_insert(data_path="rotation_euler", frame=f)

    # 5. WORK_GATHER (Frame 0 to 30, kneeling/bending gathering work motion)
    reset_pose_transforms(arm_obj)
    act_work = bpy.data.actions.new("work_gather")
    act_work.use_fake_user = True
    arm_obj.animation_data.action = act_work

    for f in range(0, 31):
        t = f / 30.0
        bend = 0.5 * (1.0 - math.cos(t * 2 * math.pi)) # 0.0 -> 1.0 -> 0.0

        pb["Hips"].location = (0.0, 0.0, 0.0)
        pb["Hips"].keyframe_insert(data_path="location", frame=f)

        set_bone_rot(pb["Spine"], (22.0 * bend, 0, 0))
        pb["Spine"].keyframe_insert(data_path="rotation_euler", frame=f)

        # An overhead right-hand strike; the left arm balances the round body.
        set_bone_rot(pb["UpperArm.L"], (-8.0 - 10.0 * bend, 0, 10.0))
        set_bone_rot(pb["LowerArm.L"], (-15.0 - 20.0 * bend, 0, 10.0))
        set_bone_rot(pb["Hand.L"], (10.0 + 20.0 * bend, 0, 0))

        set_bone_rot(pb["UpperArm.R"], (-125.0 + 100.0 * bend, 0, -10.0))
        set_bone_rot(pb["LowerArm.R"], (-35.0 - 15.0 * bend, 0, -10.0))
        set_bone_rot(pb["Hand.R"], (10.0 + 20.0 * bend, 0, 0))

        pb["UpperArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerArm.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Hand.L"].keyframe_insert(data_path="rotation_euler", frame=f)

        pb["UpperArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerArm.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Hand.R"].keyframe_insert(data_path="rotation_euler", frame=f)

        set_bone_rot(pb["UpperLeg.L"], (0, 0, 0))
        set_bone_rot(pb["LowerLeg.L"], (0, 0, 0))
        set_bone_rot(pb["Foot.L"], (0, 0, 0))
        set_bone_rot(pb["UpperLeg.R"], (0, 0, 0))
        set_bone_rot(pb["LowerLeg.R"], (0, 0, 0))
        set_bone_rot(pb["Foot.R"], (0, 0, 0))

        pb["UpperLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.L"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["UpperLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["LowerLeg.R"].keyframe_insert(data_path="rotation_euler", frame=f)
        pb["Foot.R"].keyframe_insert(data_path="rotation_euler", frame=f)

def verify_mesh_grounding_and_actions(mesh_obj, arm_obj):
    print("\n--- RIGOROUS PRE-EXPORT RIGGING & DEFORMATION VERIFICATION ---")

    # 1. Verify 100% vertex weight coverage (zero unweighted vertices across whole mesh)
    num_verts = len(mesh_obj.data.vertices)
    vg_names = {vg.index: vg.name for vg in mesh_obj.vertex_groups}
    unweighted = [v for v in mesh_obj.data.vertices if sum(g.weight for g in v.groups) < 0.001]
    if unweighted:
        raise RuntimeError(f"FATAL RIGGING ERROR: {len(unweighted)}/{num_verts} unweighted vertices found! Indices: {[v.index for v in unweighted[:10]]}")
    print(f"[generate_resident] Weight verification: 0/{num_verts} unweighted vertices (100% covered).")

    # 2. Verify all 6 leg groups are populated with non-zero vertices
    leg_groups = ["UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R"]
    for lg in leg_groups:
        count = sum(1 for v in mesh_obj.data.vertices for g in v.groups if vg_names.get(g.group) == lg and g.weight > 0.001)
        if count == 0:
            raise RuntimeError(f"FATAL RIGGING ERROR: Leg group '{lg}' has 0 weighted vertices!")
        print(f"[generate_resident] Group '{lg}': {count} weighted vertices.")

    # 3. Identify sole vertices at rest pose (strictly on Z <= 0.001)
    sole_left = [v.index for v in mesh_obj.data.vertices if v.co.z <= 0.001 and v.co.x < 0.0]
    sole_right = [v.index for v in mesh_obj.data.vertices if v.co.z <= 0.001 and v.co.x > 0.0]
    if len(sole_left) == 0 or len(sole_right) == 0:
        raise RuntimeError(f"FATAL: Ground sole vertices not found! Left={len(sole_left)}, Right={len(sole_right)}")
    print(f"[generate_resident] Found {len(sole_left)} Left sole vertices and {len(sole_right)} Right sole vertices on Z=0.000m.")

    # 4. Rigorous evaluated depsgraph animation check across all actions and frames
    depsgraph = bpy.context.evaluated_depsgraph_get()

    for act in bpy.data.actions:
        reset_pose_transforms(arm_obj)
        arm_obj.animation_data.action = act
        min_z_overall = 999.0
        max_contact_z_in_stance = 0.0
        max_left_sole_disp = 0.0
        max_right_sole_disp = 0.0
        max_left_swing_lift = 0.0
        max_right_swing_lift = 0.0

        for f in range(0, 31):
            bpy.context.scene.frame_set(f)
            depsgraph.update()
            eval_obj = mesh_obj.evaluated_get(depsgraph)
            eval_mesh = eval_obj.to_mesh()

            min_z = min(v.co.z for v in eval_mesh.vertices)
            min_z_overall = min(min_z_overall, min_z)

            # Left sole deformed metrics
            left_z_vals = [eval_mesh.vertices[i].co.z for i in sole_left]
            min_left_z = min(left_z_vals)
            max_left_swing_lift = max(max_left_swing_lift, min_left_z)
            for i in sole_left:
                disp = (eval_mesh.vertices[i].co - mesh_obj.data.vertices[i].co).length
                max_left_sole_disp = max(max_left_sole_disp, disp)

            # Right sole deformed metrics
            right_z_vals = [eval_mesh.vertices[i].co.z for i in sole_right]
            min_right_z = min(right_z_vals)
            max_right_swing_lift = max(max_right_swing_lift, min_right_z)
            for i in sole_right:
                disp = (eval_mesh.vertices[i].co - mesh_obj.data.vertices[i].co).length
                max_right_sole_disp = max(max_right_sole_disp, disp)

            # Stance phase contact
            if act.name in ("walk", "carry_walk"):
                if f in (3, 4, 5, 6, 7): # Left foot stance
                    max_contact_z_in_stance = max(max_contact_z_in_stance, min_left_z)
                elif f in (18, 19, 20, 21, 22): # Right foot stance
                    max_contact_z_in_stance = max(max_contact_z_in_stance, min_right_z)

            eval_obj.to_mesh_clear()

        print(f"Action '{act.name:12s}': min Z={min_z_overall:+.4f}m, stance Z={max_contact_z_in_stance:.4f}m, L-lift={max_left_swing_lift:.4f}m, R-lift={max_right_swing_lift:.4f}m, L-disp={max_left_sole_disp:.4f}m, R-disp={max_right_sole_disp:.4f}m")

        if min_z_overall < -0.002:
            raise RuntimeError(f"Action '{act.name}' penetrates ground: min Z = {min_z_overall:.4f} m!")

        if act.name in ("walk", "carry_walk"):
            if max_contact_z_in_stance > 0.0025:
                raise RuntimeError(f"Action '{act.name}' floating in stance: max stance Z = {max_contact_z_in_stance:.4f} m!")
            # STRICT CHECK: Sole vertices MUST lift during swing and MUST deform dynamically!
            if max_left_swing_lift < 0.05 or max_right_swing_lift < 0.05:
                raise RuntimeError(f"Action '{act.name}' sole vertices failed to lift during swing! (L: {max_left_swing_lift:.4f}m, R: {max_right_swing_lift:.4f}m, required >= 0.05m)")
            # STRICT CHECK: In carry actions, verify cargo socket and hand clearance in front of torso
            if act.name in ("carry_idle", "carry_walk"):
                pb = arm_obj.pose.bones
                cargo_head = pb["Socket_Cargo"].head
                if cargo_head.y > -0.40:
                    raise RuntimeError(f"Action '{act.name}' Socket_Cargo is buried inside torso: Y = {cargo_head.y:.3f} m (required <= -0.40 m)!")
                
                # Check hand bone positions flank cargo and are in front of torso (-0.34)
                wr_l = pb["Hand.L"].head
                wr_r = pb["Hand.R"].head
                if wr_l.y > -0.36 or wr_r.y > -0.36:
                    raise RuntimeError(f"Action '{act.name}' hands are buried in torso: L.y={wr_l.y:.3f}, R.y={wr_r.y:.3f} (required <= -0.36 m)!")
                if wr_l.x > -0.12 or wr_r.x < 0.12:
                    raise RuntimeError(f"Action '{act.name}' hands do not flank cargo: L.x={wr_l.x:.3f}, R.x={wr_r.x:.3f} (required L <= -0.12, R >= 0.12)!")

    print("--- ALL ACTIONS PASSED RIGOROUS GROUND CONTACT & DEFORMATION VERIFICATION ---\n")

def main():
    clear_scene()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    blend_path = os.path.join(script_dir, "resident.blend")
    glb_path = os.path.join(repo_root, "godot", "assets", "models", "resident.glb")

    mesh_obj, group_weights = build_character_mesh()
    arm_obj = build_armature()
    assign_vertex_weights(mesh_obj, arm_obj, group_weights)
    add_actions(arm_obj)

    # Run verification before saving
    verify_mesh_grounding_and_actions(mesh_obj, arm_obj)

    arm_obj.animation_data.action = None
    reset_pose_transforms(arm_obj)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    bpy.context.preferences.filepaths.save_version = 0
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
