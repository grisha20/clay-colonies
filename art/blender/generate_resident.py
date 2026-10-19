"""Procedural 3D Clayfolk Character Generator for Blender 4.2 LTS.

Creates a genuine hand-sculpted 3D terracotta clay villager with:
- Continuous organic contoured limbs (smooth shoulders, elbows, knees, and ankles).
- Sculpted clay moccasin feet with strictly flat sole on Z = 0.000 m (length 0.22m, width 0.14m).
- Unified terracotta clay material for head and body (no material split seam).
- Expressive modeled clay facial features: brow ridge, button nose, dark glossy clay bead eyes.
- Continuous braided cord belt with front knot and hanging cord ends.
- Anatomically grouped vertex weights (first 96 vertices strictly torso, smooth joint blends).
- Rigorous IK solver with zero vertical floating error on stance frames (min Z >= 0.000m).
- 5 actions: idle, walk, carry_idle, carry_walk, work_gather (each exactly 1.000 s @ 30 FPS).
- Full glTF 2.0 PBR material and texture setup.

Exports art/blender/resident.blend and godot/assets/models/resident.glb.
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

# Kinematic and IK constants (rigorously calibrated for stance contact)
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

def create_pbr_material(name, base_color, roughness=0.82, normal_map_path=None):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.20
        elif "Specular" in bsdf.inputs:
            bsdf.inputs["Specular"].default_value = 0.20

        if normal_map_path and os.path.exists(normal_map_path):
            try:
                img = bpy.data.images.load(normal_map_path)
                img.colorspace_settings.name = "Non-Color"
                tex_node = nt.nodes.new("ShaderNodeTexImage")
                tex_node.image = img
                norm_node = nt.nodes.new("ShaderNodeNormalMap")
                norm_node.inputs["Strength"].default_value = 0.35
                nt.links.new(tex_node.outputs["Color"], norm_node.inputs["Color"])
                nt.links.new(norm_node.outputs["Normal"], bsdf.inputs["Normal"])
            except Exception as e:
                print(f"[generate_resident] Warning: could not link normal map {normal_map_path}: {e}")
    return mat

def build_character_mesh():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    tex_dir = os.path.join(repo_root, "godot", "assets", "textures")

    clay_n_path = os.path.join(tex_dir, "clay_normal.png")
    cord_n_path = os.path.join(tex_dir, "cord_normal.png")

    mesh = bpy.data.meshes.new("ResidentMesh")
    obj = bpy.data.objects.new("Resident", mesh)
    bpy.context.collection.objects.link(obj)

    # Cohesive terracotta palette
    mat_body = create_pbr_material("ClayBody", (0.75, 0.38, 0.20, 1.0), roughness=0.84, normal_map_path=clay_n_path)
    mat_face = create_pbr_material("ClayFace", (0.78, 0.42, 0.23, 1.0), roughness=0.82, normal_map_path=clay_n_path)
    mat_eyes = create_pbr_material("DarkEyes", (0.10, 0.07, 0.05, 1.0), roughness=0.35)
    mat_cord = create_pbr_material("GrassCord", (0.64, 0.54, 0.28, 1.0), roughness=0.88, normal_map_path=cord_n_path)

    mesh.materials.append(mat_body) # 0: Main terracotta clay
    mesh.materials.append(mat_face) # 1: Soft warm clay accents
    mesh.materials.append(mat_eyes) # 2: Dark clay beads
    mesh.materials.append(mat_cord) # 3: Woven grass cord

    bm = bmesh.new()

    group_weights = {
        "Head": [],
        "Spine": [],
        "Hips": [],
        "UpperArm.L": [], "LowerArm.L": [], "Hand.L": [],
        "UpperArm.R": [], "LowerArm.R": [], "Hand.R": [],
        "UpperLeg.L": [], "LowerLeg.L": [], "Foot.L": [],
        "UpperLeg.R": [], "LowerLeg.R": [], "Foot.R": []
    }

    # 1. TORSO (First 96 vertices strictly: 6 layers x 16 segments)
    # Pear-shaped terracotta body from z=0.46 to z=1.10
    torso_layers = [
        (0.46, 0.28), (0.56, 0.36), (0.68, 0.385), (0.82, 0.36), (0.98, 0.31), (1.10, 0.23)
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
                group_weights["Hips"].append((v, 1.0))
            else:
                group_weights["Spine"].append((v, 1.0))

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

    # Neck extension (z=1.10 to z=1.24) connecting smoothly into head base
    neck_layers = [(1.18, 0.18), (1.25, 0.16)]
    for z, r in neck_layers:
        ring = []
        for i in range(num_seg):
            angle = 2 * math.pi * i / num_seg
            x = r * math.cos(angle) * 1.02
            y = r * math.sin(angle) * 0.98
            v = bm.verts.new((x, y, z))
            ring.append(v)
            group_weights["Head"].append((v, 1.0))
        for i in range(num_seg):
            i_next = (i + 1) % num_seg
            f = bm.faces.new([prev_ring[i], prev_ring[i_next], ring[i_next], ring[i]])
            f.material_index = 0
        prev_ring = ring
    f_neck_top = bm.faces.new(prev_ring)
    f_neck_top.material_index = 0

    # 2. CONTINUOUS BRAIDED WAIST CORD WITH HANGING KNOT (Hips)
    # Swept torus around waist (z=0.68)
    waist_steps = 24
    cord_cross_steps = 8
    cord_radius = 0.024
    torso_waist_r = 0.388
    prev_cord_ring = None
    first_cord_ring = None

    for i in range(waist_steps):
        phi = 2 * math.pi * i / waist_steps
        cx = torso_waist_r * math.cos(phi) * 1.04
        cy = torso_waist_r * math.sin(phi) * 0.96
        cz = 0.68

        # Tangent vector around waist
        tx = -math.sin(phi)
        ty = math.cos(phi)
        # Normal pointing outward
        nx = math.cos(phi)
        ny = math.sin(phi)

        cord_ring = []
        for j in range(cord_cross_steps):
            theta = 2 * math.pi * j / cord_cross_steps
            # 3-strand helical twist modulation
            r_mod = cord_radius * (1.0 + 0.15 * math.sin(3.0 * phi + 4.0 * theta))
            vx = cx + nx * r_mod * math.cos(theta)
            vy = cy + ny * r_mod * math.cos(theta)
            vz = cz + r_mod * math.sin(theta)
            v = bm.verts.new((vx, vy, vz))
            cord_ring.append(v)
            group_weights["Hips"].append((v, 1.0))

        if prev_cord_ring:
            for j in range(cord_cross_steps):
                j_next = (j + 1) % cord_cross_steps
                f = bm.faces.new([prev_cord_ring[j], prev_cord_ring[j_next], cord_ring[j_next], cord_ring[j]])
                f.material_index = 3
        else:
            first_cord_ring = cord_ring
        prev_cord_ring = cord_ring

    # Close torus
    for j in range(cord_cross_steps):
        j_next = (j + 1) % cord_cross_steps
        f = bm.faces.new([prev_cord_ring[j], prev_cord_ring[j_next], first_cord_ring[j_next], first_cord_ring[j]])
        f.material_index = 3

    # Front cord knot on front (-Y side)
    knot_res = bmesh.ops.create_uvsphere(
        bm, u_segments=8, v_segments=6, radius=0.054,
        matrix=Matrix.Translation(Vector((0.0, -torso_waist_r * 0.96 - 0.025, 0.68)))
    )
    for v in knot_res['verts']:
        group_weights["Hips"].append((v, 1.0))
        for f in v.link_faces:
            f.material_index = 3

    # Two hanging woven cord ends curving naturally down
    for side, tail_x, target_z in ((-1, -0.035, 0.55), (1, 0.040, 0.53)):
        tail_steps = 6
        prev_tr = None
        for k in range(tail_steps + 1):
            tk = k / float(tail_steps)
            tz = 0.67 - (0.67 - target_z) * tk
            ty = -torso_waist_r * 0.96 - 0.028 + 0.015 * math.sin(tk * math.pi)
            tx = tail_x * tk + 0.01 * math.sin(tk * 2 * math.pi)
            t_ring = []
            for j in range(6):
                th = 2 * math.pi * j / 6.0
                rad = 0.018 * (1.0 - 0.3 * tk)
                vx = tx + rad * math.cos(th)
                vy = ty + rad * math.sin(th) * 0.6
                vz = tz
                v = bm.verts.new((vx, vy, vz))
                t_ring.append(v)
                group_weights["Hips"].append((v, 1.0))
            if prev_tr:
                for j in range(6):
                    jn = (j + 1) % 6
                    f = bm.faces.new([prev_tr[j], prev_tr[jn], t_ring[jn], t_ring[j]])
                    f.material_index = 3
            else:
                first_tr = t_ring
            prev_tr = t_ring
        bm.faces.new(prev_tr).material_index = 3
        bm.faces.new(first_tr[::-1]).material_index = 3

    # 3. UNIFIED HEAD & MODELED FACE (Material 0, dark eyes Material 2)
    head_res = bmesh.ops.create_uvsphere(
        bm, u_segments=16, v_segments=12, radius=0.32,
        matrix=Matrix.Translation(Vector((0, -0.04, 1.40))) @ Matrix.Scale(1.05, 4, Vector((1,0,0))) @ Matrix.Scale(1.0, 4, Vector((0,1,0))) @ Matrix.Scale(0.96, 4, Vector((0,0,1)))
    )
    for v in head_res['verts']:
        group_weights["Head"].append((v, 1.0))
        for f in v.link_faces:
            f.material_index = 0 # Single unified clay material (no seam cut!)

    # Modeled clay brow ridge (soft horizontal forehead shelf)
    brow_res = bmesh.ops.create_uvsphere(
        bm, u_segments=10, v_segments=6, radius=0.10,
        matrix=Matrix.Translation(Vector((0.0, -0.32, 1.48))) @ Matrix.Scale(2.2, 4, Vector((1,0,0))) @ Matrix.Scale(0.5, 4, Vector((0,1,0))) @ Matrix.Scale(0.35, 4, Vector((0,0,1)))
    )
    for v in brow_res['verts']:
        group_weights["Head"].append((v, 1.0))
        for f in v.link_faces:
            f.material_index = 0

    # Modeled clay button nose
    nose_res = bmesh.ops.create_uvsphere(
        bm, u_segments=8, v_segments=6, radius=0.060,
        matrix=Matrix.Translation(Vector((0.0, -0.375, 1.38))) @ Matrix.Scale(0.95, 4, Vector((1,0,0))) @ Matrix.Scale(1.25, 4, Vector((0,1,0)))
    )
    for v in nose_res['verts']:
        group_weights["Head"].append((v, 1.0))
        for f in v.link_faces:
            f.material_index = 0

    # Expressive inset dark clay bead eyes
    for eye_x in (-0.11, 0.11):
        eye_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.046,
            matrix=Matrix.Translation(Vector((eye_x, -0.345, 1.45)))
        )
        for v in eye_res['verts']:
            group_weights["Head"].append((v, 1.0))
            for f in v.link_faces:
                f.material_index = 2 # Dark glossy clay beads

    # 4. CONTINUOUS CONTOURED ARMS (Seamless quad-loft shoulder -> elbow -> wrist -> mitten)
    for side in (-1, 1):
        side_tag = ".R" if side > 0 else ".L"
        sx = side * 0.33

        # 8 cross-section rings along the arm
        arm_rings_spec = [
            # z, x_off, y_off, radius
            (1.05, 0.00,  0.00, 0.098), # 0: Shoulder crest
            (0.98, 0.02, -0.01, 0.092), # 1: Upper bicep
            (0.90, 0.04, -0.01, 0.086), # 2: Mid bicep
            (0.82, 0.05, -0.02, 0.080), # 3: Above elbow
            (0.76, 0.06, -0.03, 0.078), # 4: Elbow joint (blend 50/50)
            (0.68, 0.06, -0.05, 0.074), # 5: Forearm upper
            (0.60, 0.05, -0.07, 0.070), # 6: Forearm mid
            (0.54, 0.04, -0.09, 0.066)  # 7: Wrist collar
        ]
        n_arm_seg = 10
        prev_aring = None
        first_aring = None

        for ring_idx, (az, ax_off, ay_off, arad) in enumerate(arm_rings_spec):
            aring = []
            for i in range(n_arm_seg):
                ang = 2 * math.pi * i / n_arm_seg
                vx = sx + side * ax_off + arad * math.cos(ang)
                vy = ay_off + arad * math.sin(ang)
                vz = az
                v = bm.verts.new((vx, vy, vz))
                aring.append(v)

                # Weighting along continuous limb with seamless shoulder blending to torso/Spine
                if ring_idx == 0:
                    group_weights["Spine"].append((v, 0.65))
                    group_weights["UpperArm" + side_tag].append((v, 0.35))
                elif ring_idx == 1:
                    group_weights["Spine"].append((v, 0.25))
                    group_weights["UpperArm" + side_tag].append((v, 0.75))
                elif ring_idx in (2, 3):
                    group_weights["UpperArm" + side_tag].append((v, 1.0))
                elif ring_idx == 4:
                    group_weights["UpperArm" + side_tag].append((v, 0.5))
                    group_weights["LowerArm" + side_tag].append((v, 0.5))
                else:
                    group_weights["LowerArm" + side_tag].append((v, 1.0))

            if prev_aring:
                for i in range(n_arm_seg):
                    i_next = (i + 1) % n_arm_seg
                    f = bm.faces.new([prev_aring[i], prev_aring[i_next], aring[i_next], aring[i]])
                    f.material_index = 0
            else:
                first_aring = aring
            prev_aring = aring

        # Cap top of shoulder (blended with Spine) and bottom of wrist collar (LowerArm)
        bm.faces.new(first_aring[::-1]).material_index = 0
        for v in first_aring:
            group_weights["Spine"].append((v, 0.65))
            group_weights["UpperArm" + side_tag].append((v, 0.35))

        bm.faces.new(prev_aring).material_index = 0
        for v in prev_aring:
            group_weights["LowerArm" + side_tag].append((v, 1.0))

        # Mitten hand attached smoothly to wrist
        hand_res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.082,
            matrix=Matrix.Translation(Vector((sx + side * 0.04, -0.16, 0.50))) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(1.35, 4, Vector((0,1,0))) @ Matrix.Scale(0.85, 4, Vector((0,0,1)))
        )
        for v in hand_res['verts']:
            group_weights["Hand" + side_tag].append((v, 1.0))
            for f in v.link_faces:
                f.material_index = 0

        # Sculpted thumb curving inward towards chest
        thumb_res = bmesh.ops.create_uvsphere(
            bm, u_segments=6, v_segments=4, radius=0.038,
            matrix=Matrix.Translation(Vector((sx - side * 0.02, -0.15, 0.52))) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(1.4, 4, Vector((0,1,0)))
        )
        for v in thumb_res['verts']:
            group_weights["Hand" + side_tag].append((v, 1.0))
            for f in v.link_faces:
                f.material_index = 0

    # 5. CONTINUOUS CONTOURED LEGS (Seamless quad-loft hip -> thigh -> knee -> shin -> ankle)
    for side in (-1, 1):
        side_tag = ".R" if side > 0 else ".L"
        lx = side * 0.20

        # 8 cross-section rings along the leg
        leg_rings_spec = [
            # z, y_off, radius
            (HIP_Z,  0.00, 0.108), # 0: Hip socket crest (0.49)
            (0.43,   0.00, 0.100), # 1: Upper thigh
            (0.36,   0.00, 0.094), # 2: Mid thigh
            (0.30,   0.00, 0.088), # 3: Above knee
            (0.24,  -0.01, 0.085), # 4: Knee joint (0.24) (blend 50/50)
            (0.18,   0.00, 0.082), # 5: Upper calf
            (0.12,   0.00, 0.078), # 6: Mid shin
            (0.065, -0.02, 0.074)  # 7: Ankle collar
        ]
        n_leg_seg = 12
        prev_lring = None
        first_lring = None

        for ring_idx, (lz, ly_off, lrad) in enumerate(leg_rings_spec):
            lring = []
            for i in range(n_leg_seg):
                ang = 2 * math.pi * i / n_leg_seg
                vx = lx + lrad * math.cos(ang)
                vy = ly_off + lrad * math.sin(ang)
                vz = lz
                v = bm.verts.new((vx, vy, vz))
                lring.append(v)

                if ring_idx == 0:
                    group_weights["Hips"].append((v, 0.40))
                    group_weights["UpperLeg" + side_tag].append((v, 0.60))
                elif ring_idx <= 3:
                    group_weights["UpperLeg" + side_tag].append((v, 1.0))
                elif ring_idx == 4:
                    group_weights["UpperLeg" + side_tag].append((v, 0.5))
                    group_weights["LowerLeg" + side_tag].append((v, 0.5))
                else:
                    group_weights["LowerLeg" + side_tag].append((v, 1.0))

            if prev_lring:
                for i in range(n_leg_seg):
                    i_next = (i + 1) % n_leg_seg
                    f = bm.faces.new([prev_lring[i], prev_lring[i_next], lring[i_next], lring[i]])
                    f.material_index = 0
            else:
                first_lring = lring
            prev_lring = lring

        # Cap top of hip (blended with Hips)
        bm.faces.new(first_lring[::-1]).material_index = 0
        for v in first_lring:
            group_weights["Hips"].append((v, 0.40))
            group_weights["UpperLeg" + side_tag].append((v, 0.60))

        # 6. SCULPTED CLAY MOCCASIN FOOT (Seamless flat sole strictly on Z = 0.000m)
        # Length = 0.22m (y from +0.06 to -0.16)
        # Width = 0.14m (x from lx-0.07 to lx+0.07)
        # Ankle joint at FOOT_ANKLE_Z (0.050)
        n_sole_pts = 12
        sole_verts = []
        mid_verts = []

        for i in range(n_sole_pts):
            ang = 2 * math.pi * i / n_sole_pts
            # Moccasin sole profile: rounded toe box (-Y), narrow waist, rounded heel (+Y)
            sin_a = math.sin(ang)
            cos_a = math.cos(ang)

            if sin_a < 0:
                # Front toe section
                sy = -0.05 + 0.11 * sin_a  # reaches -0.16 at sin_a = -1
                sx = lx + 0.070 * cos_a
            else:
                # Back heel section
                sy = -0.05 + 0.11 * sin_a  # reaches +0.06 at sin_a = +1
                sx = lx + 0.055 * cos_a

            # Flat ground contact sole vertex
            vs = bm.verts.new((sx, sy, 0.000))
            sole_verts.append(vs)
            group_weights["Foot" + side_tag].append((vs, 1.0))

            # Rounded mid-wall vertex of moccasin
            vm = bm.verts.new((sx + 0.005 * cos_a, sy + 0.005 * sin_a, 0.026))
            mid_verts.append(vm)
            group_weights["Foot" + side_tag].append((vm, 1.0))

        # Bottom flat sole face (strictly Z = 0.0000 m across the entire footprint!)
        f_sole = bm.faces.new(sole_verts[::-1])
        f_sole.material_index = 0

        # Mid-wall quads (sole to mid-contour)
        for i in range(n_sole_pts):
            i_next = (i + 1) % n_sole_pts
            f = bm.faces.new([sole_verts[i], sole_verts[i_next], mid_verts[i_next], mid_verts[i]])
            f.material_index = 0

        # Upper moccasin bridge connecting mid-wall to ankle collar (prev_lring)
        # Connect 12 mid_verts to 12 ankle collar verts
        for i in range(n_sole_pts):
            i_next = (i + 1) % n_sole_pts
            f = bm.faces.new([mid_verts[i], mid_verts[i_next], prev_lring[i_next], prev_lring[i]])
            f.material_index = 0

    # Ensure no vertex in rest mesh penetrates ground plane
    for v in bm.verts:
        if v.co.z < 0.0:
            v.co.z = 0.0

    bm.verts.ensure_lookup_table()
    bm.verts.index_update()

    # Assign UV layer for PBR textures
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            v = loop.vert
            u = math.atan2(v.co.x, v.co.y) / (2.0 * math.pi) + 0.5
            wz = v.co.z / 1.8
            loop[uv_layer].uv = (u * 2.0, wz * 2.0)

    # Convert group_weights to final dictionary of (vert_idx, weight) with strict index check
    final_weights = {}
    for gname, items in group_weights.items():
        final_weights[gname] = []
        for item in items:
            v_idx = item[0].index
            if v_idx < 0:
                raise RuntimeError(f"FATAL: Vertex in group '{gname}' has unindexed/negative index {v_idx}!")
            final_weights[gname].append((v_idx, item[1]))

    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True

    return obj, final_weights

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

    # Attachment Sockets for Items and Props
    b_sock_head = eb.new("Socket_Head")
    b_sock_head.head = (0, 0, 1.72)
    b_sock_head.tail = (0, 0, 1.82)
    b_sock_head.parent = b_head

    b_sock_cargo = eb.new("Socket_Cargo")
    b_sock_cargo.head = (0.0, -0.28, 0.65)
    b_sock_cargo.tail = (0.0, -0.38, 0.65)
    b_sock_cargo.parent = b_spine

    b_sock_tool_r = eb.new("Socket_Tool_R")
    b_sock_tool_r.head = (0.39, -0.16, 0.50)
    b_sock_tool_r.tail = (0.39, -0.26, 0.50)
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

        # Arms wrap firmly forward around cargo at (0, -0.28, 0.65)
        set_bone_rot(pb["UpperArm.L"], (-34.0, -33.0, -3.0))
        set_bone_rot(pb["LowerArm.L"], (-13.0, 0.0, 12.0))
        set_bone_rot(pb["Hand.L"], (15.0, 0.0, 18.0))

        set_bone_rot(pb["UpperArm.R"], (-34.0, 33.0, 3.0))
        set_bone_rot(pb["LowerArm.R"], (-13.0, 0.0, -12.0))
        set_bone_rot(pb["Hand.R"], (15.0, 0.0, -18.0))

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
        set_bone_rot(pb["UpperArm.L"], (-34.0 + arm_bob, -33.0, -3.0))
        set_bone_rot(pb["LowerArm.L"], (-13.0, 0.0, 12.0))
        set_bone_rot(pb["Hand.L"], (15.0, 0.0, 18.0))

        set_bone_rot(pb["UpperArm.R"], (-34.0 + arm_bob, 33.0, 3.0))
        set_bone_rot(pb["LowerArm.R"], (-13.0, 0.0, -12.0))
        set_bone_rot(pb["Hand.R"], (15.0, 0.0, -18.0))

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

        # Arms reach down toward clay deposit/ground
        set_bone_rot(pb["UpperArm.L"], (-18.0 - 15.0 * bend, 0, 10.0))
        set_bone_rot(pb["LowerArm.L"], (-15.0 - 20.0 * bend, 0, 10.0))
        set_bone_rot(pb["Hand.L"], (10.0 + 20.0 * bend, 0, 0))

        set_bone_rot(pb["UpperArm.R"], (-18.0 - 15.0 * bend, 0, -10.0))
        set_bone_rot(pb["LowerArm.R"], (-15.0 - 20.0 * bend, 0, -10.0))
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
            if max_left_sole_disp < 0.07 or max_right_sole_disp < 0.07:
                raise RuntimeError(f"Action '{act.name}' sole vertices are frozen or unweighted! (L disp: {max_left_sole_disp:.4f}m, R disp: {max_right_sole_disp:.4f}m, required >= 0.07m)")

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
