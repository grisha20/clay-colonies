"""Procedural 3D Props Generator for Clayfolk: Campfire, Hut, and Cargo.

Creates rich clay models matching the warm terracotta palette with distinct materials:
- Campfire: Stone ring (ClayStone), Ash mound (AshMound), Logs (CharredWood), Glowing coals (Embers),
  and a stylized 3D flame mesh (CampfireFlame with emissive glow).
- Hut: Terracotta walls with flared base (HutClay), thatched roof (HutThatch), wooden doorframe (HutWood),
  and recessed shadowed doorway (HutInterior).
- Cargo: Terracotta resource lump (CargoClay) with rope wrap (GrassCord).

Exports .blend and .glb files into art/blender/ and godot/assets/models/.
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def create_pbr_material(name, color, roughness=0.8, emission_color=None, emission_strength=0.0, normal_map_path=None):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        if emission_color and emission_strength > 0:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = emission_color
                bsdf.inputs["Emission Strength"].default_value = emission_strength
            elif "Emission" in bsdf.inputs:
                bsdf.inputs["Emission"].default_value = emission_color

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
                print(f"[generate_props] Warning: could not link normal map {normal_map_path}: {e}")
    return mat

def generate_campfire(output_dir, blend_dir, tex_dir):
    clear_scene()

    clay_n_path = os.path.join(tex_dir, "clay_normal.png")
    mat_stone = create_pbr_material("ClayStone", (0.52, 0.46, 0.40, 1.0), roughness=0.86, normal_map_path=clay_n_path)
    mat_ash = create_pbr_material("AshMound", (0.24, 0.20, 0.18, 1.0), roughness=0.92)
    mat_wood = create_pbr_material("CharredWood", (0.20, 0.14, 0.10, 1.0), roughness=0.88)
    mat_ember = create_pbr_material("Embers", (0.90, 0.32, 0.05, 1.0), roughness=0.45,
                                    emission_color=(1.0, 0.30, 0.05, 1.0), emission_strength=1.8)
    mat_flame = create_pbr_material("CampfireFlame", (1.0, 0.65, 0.10, 1.0), roughness=0.30,
                                    emission_color=(1.0, 0.60, 0.12, 1.0), emission_strength=3.2)

    mesh = bpy.data.meshes.new("CampfireMesh")
    obj = bpy.data.objects.new("Campfire", mesh)
    bpy.context.collection.objects.link(obj)

    mesh.materials.append(mat_stone) # 0
    mesh.materials.append(mat_ash)   # 1
    mesh.materials.append(mat_wood)  # 2
    mesh.materials.append(mat_ember) # 3
    mesh.materials.append(mat_flame) # 4

    bm = bmesh.new()

    # 1. Stone ring (9 rounded clay stones resting firmly on Z = 0)
    num_stones = 9
    ring_radius = 0.52
    for i in range(num_stones):
        a = 2 * math.pi * i / num_stones
        sx = ring_radius * math.cos(a)
        sy = ring_radius * math.sin(a)
        res = bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.13,
            matrix=Matrix.Translation(Vector((sx, sy, 0.09))) @ Matrix.Scale(1.0 + 0.15 * math.sin(i * 2), 4, Vector((1,0,0))) @ Matrix.Scale(0.85, 4, Vector((0,0,1)))
        )
        for v in res['verts']:
            for f in v.link_faces:
                f.material_index = 0

    # 2. Central ash mound
    ash_res = bmesh.ops.create_uvsphere(
        bm, u_segments=12, v_segments=6, radius=0.36,
        matrix=Matrix.Translation(Vector((0, 0, 0.04))) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(1.0, 4, Vector((0,1,0))) @ Matrix.Scale(0.24, 4, Vector((0,0,1)))
    )
    for v in ash_res['verts']:
        for f in v.link_faces:
            f.material_index = 1

    # 3. Glowing embers inside the mound
    for j in range(5):
        ea = 2 * math.pi * j / 5.0
        er = 0.16
        ex = er * math.cos(ea)
        ey = er * math.sin(ea)
        ember_res = bmesh.ops.create_uvsphere(
            bm, u_segments=6, v_segments=4, radius=0.065,
            matrix=Matrix.Translation(Vector((ex, ey, 0.08)))
        )
        for v in ember_res['verts']:
            for f in v.link_faces:
                f.material_index = 3

    # 4. Logs (crisscrossed charred firewood)
    for i in range(4):
        la = math.pi * i / 4.0
        rot = Matrix.Rotation(la, 4, 'Z') @ Matrix.Rotation(math.radians(18.0), 4, 'X')
        log_res = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=8,
            radius1=0.045, radius2=0.038, depth=0.46,
            matrix=Matrix.Translation(Vector((0, 0, 0.11))) @ rot
        )
        for v in log_res['verts']:
            for f in v.link_faces:
                f.material_index = 2

    # 5. Stylized 3D Campfire Flame Mesh (Volume flame rising in center)
    flame_res1 = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=8,
        radius1=0.15, radius2=0.01, depth=0.36,
        matrix=Matrix.Translation(Vector((0, 0, 0.28)))
    )
    for v in flame_res1['verts']:
        for f in v.link_faces:
            f.material_index = 4

    flame_res2 = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=6,
        radius1=0.10, radius2=0.01, depth=0.28,
        matrix=Matrix.Translation(Vector((0.05, -0.04, 0.32))) @ Matrix.Rotation(math.radians(15.0), 4, 'Y')
    )
    for v in flame_res2['verts']:
        for f in v.link_faces:
            f.material_index = 4

    # Ensure no vertex dips below ground Z = 0
    for v in bm.verts:
        if v.co.z < 0.0:
            v.co.z = 0.0

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            v = loop.vert
            u = math.atan2(v.co.x, v.co.y) / (2.0 * math.pi) + 0.5
            wz = v.co.z
            loop[uv_layer].uv = (u * 2.0, wz * 2.0)

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    blend_path = os.path.join(blend_dir, "campfire.blend")
    glb_path = os.path.join(output_dir, "campfire.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported campfire with 5 materials to {glb_path}")

def generate_hut(output_dir, blend_dir, tex_dir):
    clear_scene()

    clay_n_path = os.path.join(tex_dir, "clay_normal.png")
    thatch_n_path = os.path.join(tex_dir, "thatch_normal.png")
    cord_n_path = os.path.join(tex_dir, "cord_normal.png")

    mat_clay = create_pbr_material("HutClay", (0.72, 0.38, 0.22, 1.0), roughness=0.84, normal_map_path=clay_n_path)
    mat_thatch = create_pbr_material("HutThatch", (0.58, 0.48, 0.26, 1.0), roughness=0.92, normal_map_path=thatch_n_path)
    mat_wood = create_pbr_material("HutWood", (0.34, 0.22, 0.14, 1.0), roughness=0.85, normal_map_path=clay_n_path)
    mat_interior = create_pbr_material("HutInterior", (0.08, 0.06, 0.05, 1.0), roughness=0.95)

    mesh = bpy.data.meshes.new("HutMesh")
    obj = bpy.data.objects.new("Hut", mesh)
    bpy.context.collection.objects.link(obj)

    mesh.materials.append(mat_clay)     # 0
    mesh.materials.append(mat_thatch)   # 1
    mesh.materials.append(mat_wood)     # 2
    mesh.materials.append(mat_interior) # 3

    bm = bmesh.new()

    wall_radius = 1.30
    wall_height = 1.10
    door_w = 0.52
    door_h = 0.88

    # 1. Circular clay base wall with true geometric doorway opening
    # Door faces -Y (angle -pi/2)
    door_alpha = math.asin((door_w / 2.0) / wall_radius)
    a_start = -math.pi / 2.0 + door_alpha
    a_end = 3.0 * math.pi / 2.0 - door_alpha

    num_seg = 20
    ring_ground = [] # flared earthen base (z=0, r=1.42)
    ring_bottom = [] # base (z=0.15, r=1.34)
    ring_top = []    # top (z=wall_height, r=1.24)

    for i in range(num_seg + 1):
        t = i / float(num_seg)
        ang = a_start + t * (a_end - a_start)
        cos_a = math.cos(ang)
        sin_a = math.sin(ang)

        vg = bm.verts.new((1.42 * cos_a, 1.42 * sin_a, 0.0))
        vb = bm.verts.new((1.32 * cos_a, 1.32 * sin_a, 0.15))
        vt = bm.verts.new((1.24 * cos_a, 1.24 * sin_a, wall_height))
        ring_ground.append(vg)
        ring_bottom.append(vb)
        ring_top.append(vt)

    for i in range(num_seg):
        # Ground to base ring
        f1 = bm.faces.new([ring_ground[i], ring_ground[i+1], ring_bottom[i+1], ring_bottom[i]])
        f1.material_index = 0
        # Base ring to top ring
        f2 = bm.faces.new([ring_bottom[i], ring_bottom[i+1], ring_top[i+1], ring_top[i]])
        f2.material_index = 0

    # Lintel wall section above the door (from z=door_h to z=wall_height)
    v_door_l_bottom = bm.verts.new((ring_bottom[0].co.x, ring_bottom[0].co.y, door_h))
    v_door_r_bottom = bm.verts.new((ring_bottom[-1].co.x, ring_bottom[-1].co.y, door_h))
    f_lintel_wall = bm.faces.new([v_door_r_bottom, v_door_l_bottom, ring_top[0], ring_top[-1]])
    f_lintel_wall.material_index = 0

    # 2. Doorway: Wood jambs and lintel
    # Left post
    lpost = bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((-door_w / 2.0, -wall_radius - 0.02, door_h / 2.0))) @ Matrix.Scale(0.12, 4, Vector((1,0,0))) @ Matrix.Scale(0.18, 4, Vector((0,1,0))) @ Matrix.Scale(door_h, 4, Vector((0,0,1)))
    )
    for v in lpost['verts']:
        for f in v.link_faces:
            f.material_index = 2

    # Right post
    rpost = bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((door_w / 2.0, -wall_radius - 0.02, door_h / 2.0))) @ Matrix.Scale(0.12, 4, Vector((1,0,0))) @ Matrix.Scale(0.18, 4, Vector((0,1,0))) @ Matrix.Scale(door_h, 4, Vector((0,0,1)))
    )
    for v in rpost['verts']:
        for f in v.link_faces:
            f.material_index = 2

    # Lintel beam
    lintel = bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((0, -wall_radius - 0.02, door_h))) @ Matrix.Scale(door_w + 0.20, 4, Vector((1,0,0))) @ Matrix.Scale(0.20, 4, Vector((0,1,0))) @ Matrix.Scale(0.12, 4, Vector((0,0,1)))
    )
    for v in lintel['verts']:
        for f in v.link_faces:
            f.material_index = 2

    # Rounded clay threshold step at the door
    threshold = bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((0, -wall_radius - 0.02, 0.03))) @ Matrix.Scale(door_w + 0.10, 4, Vector((1,0,0))) @ Matrix.Scale(0.24, 4, Vector((0,1,0))) @ Matrix.Scale(0.06, 4, Vector((0,0,1)))
    )
    for v in threshold['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # 3. Recessed dark interior doorway (giving real visual and raycast depth to entrance)
    int_depth = -wall_radius + 0.35
    v_int_bl = bm.verts.new((-door_w / 2.0, int_depth, 0.0))
    v_int_br = bm.verts.new((door_w / 2.0, int_depth, 0.0))
    v_int_tr = bm.verts.new((door_w / 2.0, int_depth, door_h))
    v_int_tl = bm.verts.new((-door_w / 2.0, int_depth, door_h))
    f_interior = bm.faces.new([v_int_bl, v_int_br, v_int_tr, v_int_tl])
    f_interior.material_index = 3

    # 4. Conical thatched roof (overhanging, height 1.10 to 2.35)
    roof_r = 1.58
    roof_h = 1.25
    roof_res = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=20,
        radius1=roof_r, radius2=0.08, depth=roof_h,
        matrix=Matrix.Translation(Vector((0, 0, wall_height + roof_h / 2.0)))
    )
    for v in roof_res['verts']:
        for f in v.link_faces:
            f.material_index = 1

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            v = loop.vert
            u = math.atan2(v.co.x, v.co.y) / (2.0 * math.pi) + 0.5
            wz = v.co.z / 2.5
            loop[uv_layer].uv = (u * 3.0, wz * 3.0)

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    # Verification: Raycast through doorway must hit HutInterior (not wall)
    ray_origin = Vector((0.0, -2.0, 0.44))
    ray_dir = Vector((0.0, 1.0, 0.0))
    hit, loc, normal, face_idx = obj.ray_cast(ray_origin, ray_dir)
    if not hit:
        raise RuntimeError("Hut doorway raycast missed entirely!")
    hit_mat_idx = mesh.polygons[face_idx].material_index
    if hit_mat_idx != 3: # 3 = HutInterior
        raise RuntimeError(f"Hut doorway raycast hit material index {hit_mat_idx} ({mesh.materials[hit_mat_idx].name}) instead of HutInterior!")
    print(f"[generate_props] Verified hut doorway through-cut: raycast hit HutInterior at Y={loc.y:.3f} m.")

    blend_path = os.path.join(blend_dir, "hut.blend")
    glb_path = os.path.join(output_dir, "hut.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported hut with 4 materials to {glb_path}")

def generate_cargo(output_dir, blend_dir, tex_dir):
    clear_scene()

    clay_n_path = os.path.join(tex_dir, "clay_normal.png")
    cord_n_path = os.path.join(tex_dir, "cord_normal.png")

    mat_clay = create_pbr_material("CargoClay", (0.76, 0.40, 0.22, 1.0), roughness=0.76, normal_map_path=clay_n_path)
    mat_cord = create_pbr_material("GrassCord", (0.64, 0.54, 0.28, 1.0), roughness=0.88, normal_map_path=cord_n_path)

    mesh = bpy.data.meshes.new("CargoMesh")
    obj = bpy.data.objects.new("CargoBundle", mesh)
    bpy.context.collection.objects.link(obj)

    mesh.materials.append(mat_clay) # 0
    mesh.materials.append(mat_cord) # 1

    bm = bmesh.new()

    # Rounded clay resource bundle (radius ~0.15)
    bundle_res = bmesh.ops.create_uvsphere(
        bm, u_segments=12, v_segments=8, radius=0.15,
        matrix=Matrix.Scale(1.08, 4, Vector((1,0,0))) @ Matrix.Scale(0.92, 4, Vector((0,1,0))) @ Matrix.Scale(1.0, 4, Vector((0,0,1)))
    )
    for v in bundle_res['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # Cross cord wrapping the clay lump
    for angle_deg in (0, 90):
        rot = Matrix.Rotation(math.radians(angle_deg), 4, 'Z')
        cord_res = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=12,
            radius1=0.156, radius2=0.156, depth=0.035,
            matrix=rot
        )
        for v in cord_res['verts']:
            for f in v.link_faces:
                f.material_index = 1

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            v = loop.vert
            u = math.atan2(v.co.x, v.co.y) / (2.0 * math.pi) + 0.5
            wz = v.co.z / 0.3
            loop[uv_layer].uv = (u * 2.0, wz * 2.0)

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    blend_path = os.path.join(blend_dir, "cargo.blend")
    glb_path = os.path.join(output_dir, "cargo.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported cargo to {glb_path}")

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    models_dir = os.path.join(repo_root, "godot", "assets", "models")
    tex_dir = os.path.join(repo_root, "godot", "assets", "textures")
    os.makedirs(models_dir, exist_ok=True)

    generate_campfire(models_dir, script_dir, tex_dir)
    generate_hut(models_dir, script_dir, tex_dir)
    generate_cargo(models_dir, script_dir, tex_dir)

if __name__ == "__main__":
    main()
