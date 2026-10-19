"""Procedural 3D Props Generator for Clayfolk: Campfire, Hut, and Cargo.

Creates rich clay models matching the warm terracotta palette with distinct materials:
- Campfire: Stone ring (ClayStone), Ash mound (AshMound), Logs (CharredWood), Glowing coals (Embers),
  and a stylized 3D flame mesh (CampfireFlame with emissive glow).
- Hut: Terracotta walls (HutClay), thatched roof (HutThatch), wooden doorframe (HutWood),
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

def create_pbr_material(name, color, roughness=0.8, emission_color=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        if emission_color and emission_strength > 0:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = emission_color
                bsdf.inputs["Emission Strength"].default_value = emission_strength
            elif "Emission" in bsdf.inputs:
                bsdf.inputs["Emission"].default_value = emission_color
    return mat

def generate_campfire(output_dir, blend_dir):
    clear_scene()

    mat_stone = create_pbr_material("ClayStone", (0.52, 0.46, 0.40, 1.0), roughness=0.86)
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
        log_len = 0.62
        log_r = 0.062
        log_res = bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=8,
            radius1=log_r, radius2=log_r, depth=log_len,
            matrix=Matrix.Translation(Vector((0, 0, 0.10))) @ Matrix.Rotation(la, 4, 'Z') @ Matrix.Rotation(math.radians(10 * (1 if i % 2 else -1)), 4, 'X') @ Matrix.Rotation(math.radians(90), 4, 'Y')
        )
        for v in log_res['verts']:
            for f in v.link_faces:
                f.material_index = 2

    # 5. Visible 3D stylized flame cluster rising from the center
    # Central flame cone (height 0.10 to 0.44)
    flame_main = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=8,
        radius1=0.14, radius2=0.015, depth=0.34,
        matrix=Matrix.Translation(Vector((0, 0, 0.26)))
    )
    for v in flame_main['verts']:
        for f in v.link_faces:
            f.material_index = 4

    # Smaller flame tongues around center
    for fi in range(3):
        fa = 2 * math.pi * fi / 3.0 + 0.4
        fx = 0.08 * math.cos(fa)
        fy = 0.08 * math.sin(fa)
        flame_sub = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=6,
            radius1=0.08, radius2=0.01, depth=0.22,
            matrix=Matrix.Translation(Vector((fx, fy, 0.20))) @ Matrix.Rotation(math.radians(12), 4, 'Y')
        )
        for v in flame_sub['verts']:
            for f in v.link_faces:
                f.material_index = 4

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    blend_path = os.path.join(blend_dir, "campfire.blend")
    glb_path = os.path.join(output_dir, "campfire.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported campfire with 5 materials to {glb_path}")

def generate_hut(output_dir, blend_dir):
    clear_scene()

    mat_clay = create_pbr_material("HutClay", (0.72, 0.38, 0.22, 1.0), roughness=0.84)
    mat_thatch = create_pbr_material("HutThatch", (0.58, 0.48, 0.26, 1.0), roughness=0.92)
    mat_wood = create_pbr_material("HutWood", (0.34, 0.22, 0.14, 1.0), roughness=0.85)
    mat_interior = create_pbr_material("HutInterior", (0.08, 0.06, 0.05, 1.0), roughness=0.95)

    mesh = bpy.data.meshes.new("HutMesh")
    obj = bpy.data.objects.new("Hut", mesh)
    bpy.context.collection.objects.link(obj)

    mesh.materials.append(mat_clay)     # 0
    mesh.materials.append(mat_thatch)   # 1
    mesh.materials.append(mat_wood)     # 2
    mesh.materials.append(mat_interior) # 3

    bm = bmesh.new()

    wall_radius = 1.3
    wall_height = 1.1

    # 1. Circular clay base wall
    wall_res = bmesh.ops.create_cone(
        bm, cap_ends=False, segments=18,
        radius1=wall_radius, radius2=wall_radius * 0.96, depth=wall_height,
        matrix=Matrix.Translation(Vector((0, 0, wall_height / 2.0)))
    )
    for v in wall_res['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # Clay foundation lip on ground (z=0.0 to 0.14)
    lip_res = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=18,
        radius1=wall_radius + 0.10, radius2=wall_radius, depth=0.14,
        matrix=Matrix.Translation(Vector((0, 0, 0.07)))
    )
    for v in lip_res['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # 2. Doorway: Wood jambs and lintel
    door_w = 0.52
    door_h = 0.88
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

    # 3. Recessed dark interior doorway (giving real visual depth to entrance)
    door_interior = bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((0, -wall_radius + 0.12, door_h / 2.0))) @ Matrix.Scale(door_w - 0.04, 4, Vector((1,0,0))) @ Matrix.Scale(0.10, 4, Vector((0,1,0))) @ Matrix.Scale(door_h - 0.04, 4, Vector((0,0,1)))
    )
    for v in door_interior['verts']:
        for f in v.link_faces:
            f.material_index = 3

    # 4. Conical thatched roof (overhanging, height 1.1 to 2.3)
    roof_r = 1.58
    roof_h = 1.25
    roof_res = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=18,
        radius1=roof_r, radius2=0.08, depth=roof_h,
        matrix=Matrix.Translation(Vector((0, 0, wall_height + roof_h / 2.0)))
    )
    for v in roof_res['verts']:
        for f in v.link_faces:
            f.material_index = 1

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    blend_path = os.path.join(blend_dir, "hut.blend")
    glb_path = os.path.join(output_dir, "hut.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported hut with 4 materials to {glb_path}")

def generate_cargo(output_dir, blend_dir):
    clear_scene()

    mat_clay = create_pbr_material("CargoClay", (0.76, 0.40, 0.22, 1.0), roughness=0.76)
    mat_cord = create_pbr_material("GrassCord", (0.64, 0.54, 0.28, 1.0), roughness=0.88)

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
    os.makedirs(models_dir, exist_ok=True)

    generate_campfire(models_dir, script_dir)
    generate_hut(models_dir, script_dir)
    generate_cargo(models_dir, script_dir)

if __name__ == "__main__":
    main()
