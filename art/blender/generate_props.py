"""Procedural 3D Props Generator for Clayfolk: Campfire, Hut, and Cargo.

Creates coherent clay models matching the warm terracotta palette.
Exports .blend and .glb files into art/blender/ and godot/assets/models/.
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def create_pbr_material(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    return mat

def generate_campfire(output_dir, blend_dir):
    clear_scene()
    mat_stone = create_pbr_material("ClayStone", (0.50, 0.45, 0.40, 1.0), roughness=0.85)
    mat_wood = create_pbr_material("CharredWood", (0.22, 0.16, 0.12, 1.0), roughness=0.9)
    mat_ember = create_pbr_material("Embers", (0.95, 0.35, 0.05, 1.0), roughness=0.4)

    # 1. Stone ring (8 stones)
    mesh_stones = bpy.data.meshes.new("CampfireStones")
    obj_stones = bpy.data.objects.new("Campfire", mesh_stones)
    bpy.context.collection.objects.link(obj_stones)
    bm = bmesh.new()

    num_stones = 9
    ring_radius = 0.55
    for i in range(num_stones):
        a = 2 * math.pi * i / num_stones
        sx = ring_radius * math.cos(a)
        sy = ring_radius * math.sin(a)
        # stone resting solidly on ground z=0
        bmesh.ops.create_uvsphere(
            bm, u_segments=8, v_segments=6, radius=0.14,
            matrix=Matrix.Translation(Vector((sx, sy, 0.10))) @ Matrix.Scale(1.0 + 0.2 * math.sin(i), 4, Vector((1,0,0))) @ Matrix.Scale(0.8, 4, Vector((0,0,1)))
        )

    # 2. Central ash / ember mound
    bmesh.ops.create_uvsphere(
        bm, u_segments=12, v_segments=6, radius=0.38,
        matrix=Matrix.Translation(Vector((0, 0, 0.04))) @ Matrix.Scale(1.0, 4, Vector((1,0,0))) @ Matrix.Scale(1.0, 4, Vector((0,1,0))) @ Matrix.Scale(0.25, 4, Vector((0,0,1)))
    )

    # 3. Logs (crisscrossed firewood)
    for i in range(4):
        la = math.pi * i / 4.0
        # log cylinder lying across center tilted slightly
        log_len = 0.65
        log_r = 0.065
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=8,
            radius1=log_r, radius2=log_r, depth=log_len,
            matrix=Matrix.Translation(Vector((0, 0, 0.08))) @ Matrix.Rotation(la, 4, 'Z') @ Matrix.Rotation(math.radians(10 * (1 if i%2 else -1)), 4, 'X') @ Matrix.Rotation(math.radians(90), 4, 'Y')
        )

    bm.to_mesh(mesh_stones)
    bm.free()

    for p in mesh_stones.polygons:
        p.use_smooth = True
    mesh_stones.materials.append(mat_stone)

    # Save and export
    blend_path = os.path.join(blend_dir, "campfire.blend")
    glb_path = os.path.join(output_dir, "campfire.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported campfire to {glb_path}")

def generate_hut(output_dir, blend_dir):
    clear_scene()
    mat_clay = create_pbr_material("HutClay", (0.72, 0.40, 0.25, 1.0), roughness=0.82)
    mat_thatch = create_pbr_material("HutThatch", (0.55, 0.45, 0.26, 1.0), roughness=0.9)

    mesh = bpy.data.meshes.new("HutMesh")
    obj = bpy.data.objects.new("Hut", mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    # Circular clay base wall (radius ~1.3, height ~1.2)
    wall_radius = 1.3
    wall_height = 1.1
    # Cylinder wall
    bmesh.ops.create_cone(
        bm, cap_ends=False, segments=16,
        radius1=wall_radius, radius2=wall_radius * 0.95, depth=wall_height,
        matrix=Matrix.Translation(Vector((0, 0, wall_height / 2.0)))
    )

    # Doorway opening framing (two clay jambs and lintel)
    door_w = 0.45
    door_h = 0.85
    bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((-door_w/2, -wall_radius, door_h/2))) @ Matrix.Scale(0.12, 4, Vector((1,0,0))) @ Matrix.Scale(0.25, 4, Vector((0,1,0))) @ Matrix.Scale(door_h, 4, Vector((0,0,1)))
    )
    bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((door_w/2, -wall_radius, door_h/2))) @ Matrix.Scale(0.12, 4, Vector((1,0,0))) @ Matrix.Scale(0.25, 4, Vector((0,1,0))) @ Matrix.Scale(door_h, 4, Vector((0,0,1)))
    )
    bmesh.ops.create_cube(
        bm, size=1.0,
        matrix=Matrix.Translation(Vector((0, -wall_radius, door_h))) @ Matrix.Scale(door_w + 0.15, 4, Vector((1,0,0))) @ Matrix.Scale(0.25, 4, Vector((0,1,0))) @ Matrix.Scale(0.12, 4, Vector((0,0,1)))
    )

    # Conical thatched roof (overhanging, height 1.1 to 2.3)
    roof_r = 1.55
    roof_h = 1.2
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=16,
        radius1=roof_r, radius2=0.08, depth=roof_h,
        matrix=Matrix.Translation(Vector((0, 0, wall_height + roof_h / 2.0)))
    )

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(mat_clay)

    blend_path = os.path.join(blend_dir, "hut.blend")
    glb_path = os.path.join(output_dir, "hut.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported hut to {glb_path}")

def generate_cargo(output_dir, blend_dir):
    clear_scene()
    mat_clay = create_pbr_material("CargoClay", (0.76, 0.38, 0.22, 1.0), roughness=0.75)

    mesh = bpy.data.meshes.new("CargoMesh")
    obj = bpy.data.objects.new("CargoLump", mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    # A clay lump held in front: sculpted round shape (radius ~0.16)
    bmesh.ops.create_uvsphere(
        bm, u_segments=10, v_segments=8, radius=0.18,
        matrix=Matrix.Scale(1.1, 4, Vector((1,0,0))) @ Matrix.Scale(0.9, 4, Vector((0,1,0))) @ Matrix.Scale(0.95, 4, Vector((0,0,1)))
    )

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(mat_clay)

    blend_path = os.path.join(blend_dir, "cargo.blend")
    glb_path = os.path.join(output_dir, "cargo.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
    print(f"[generate_props] Exported cargo to {glb_path}")

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    blend_dir = os.path.join(repo_root, "art", "blender")
    output_dir = os.path.join(repo_root, "godot", "assets", "models")
    os.makedirs(blend_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    generate_campfire(output_dir, blend_dir)
    generate_hut(output_dir, blend_dir)
    generate_cargo(output_dir, blend_dir)

if __name__ == "__main__":
    main()
