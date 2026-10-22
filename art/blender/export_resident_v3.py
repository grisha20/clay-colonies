"""Export the authored v3 source without rebuilding or repainting it.

blender --background art/blender/resident_v3.blend --python-exit-code 1 \
    --python art/blender/export_resident_v3.py

The .blend, its sculpt archive and packed paint layers are the art source.
Only Resident + ResidentArmature are exported; authoring meshes stay in Blender.
"""
from pathlib import Path
import json
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[2]


def main():
    mesh = bpy.data.objects['Resident']
    arm = bpy.data.objects['ResidentArmature']
    assert mesh.get('ArtPolish'), 'Open the authored resident_v3.blend first'
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    arm.animation_data.action = None
    for bone in arm.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    triangles = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    assert triangles <= 8000
    assert [m.name for m in mesh.data.materials] == ['ClayBody', 'DarkEyes', 'GrassCord']
    assert len(arm.data.bones) == 19
    assert abs(max(v.co.z for v in mesh.data.vertices) - 1.75) < .001
    assert abs(min(v.co.z for v in mesh.data.vertices)) < .001
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    nonmanifold = sum(not edge.is_manifold for edge in bm.edges)
    bm.free()
    assert nonmanifold == 0, nonmanifold
    uv = mesh.data.uv_layers.active.data
    degenerate = 0
    for poly in mesh.data.polygons:
        points = [uv[i].uv for i in poly.loop_indices]
        area = sum(abs((points[i]-points[0]).cross(points[i+1]-points[0])) * .5
                   for i in range(1, len(points)-1))
        degenerate += area < 1e-9
    assert degenerate == 0, degenerate
    texture_dir = ROOT / 'godot/assets/textures/resident_v3'
    for name in ['albedo', 'normal', 'roughness']:
        image = bpy.data.images.get('resident_v3_' + name + '_final') or bpy.data.images['resident_v3_' + name]
        assert tuple(image.size) == (2048, 2048)
        image.filepath_raw = str(texture_dir / (name + '.png'))
        image.file_format = 'PNG'
        image.save()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [mesh, arm]:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=str(ROOT / 'godot/assets/models/resident_v3.glb'),
        export_format='GLB', use_selection=True, export_animations=True,
        export_frame_range=True, export_frame_step=1, export_extras=True)
    print('V3_AUTHORED_EXPORT', json.dumps({
        'triangles': triangles, 'vertices': len(mesh.data.vertices),
        'nonmanifold_edges': nonmanifold, 'zero_area_uv_faces': degenerate,
        'bone_count': len(arm.data.bones),
        'actions': sorted(a.name for a in bpy.data.actions),
        'polish': mesh['ArtPolish'],
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
