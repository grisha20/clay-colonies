"""Final polish of the authored resident v3 (after Codex's sculpt/paint pass).

blender --background art/blender/resident_v3_codex_wip.blend --python-exit-code 1 \
    --python art/blender/polish_resident_v3.py -- <out.blend>

- Gives back half of the eye beads' push-in depth (smaller size kept): fully
  sunk beads bent the socket rim into a dark shadow wedge above the eyes.
- Lightly smooths the skin ring around the eye sockets and the small creases
  at the neck/shoulder line.
- Dilates colour past UV island borders in the final albedo and normal maps so
  seams do not pick up the dark background under mipmapping.
The rest of the mesh, UVs, weights and paint stay as they are.
"""
import sys
import bpy
import bmesh
import numpy as np
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
N = 2048


def get(name):
    im = bpy.data.images[name]
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


def put(name, a):
    im = bpy.data.images[name]
    im.pixels.foreach_set(a.astype(np.float32).ravel())
    im.update()
    im.pack()


def island_mask(mesh):
    """Rasterise UV triangles of the mesh into a 2048 mask."""
    mask = np.zeros((N, N), bool)
    uv = mesh.data.uv_layers.active.data
    mesh.data.calc_loop_triangles()
    for tri in mesh.data.loop_triangles:
        p = np.array([uv[i].uv for i in tri.loops]) * N
        x0, y0 = np.floor(p.min(0)).astype(int).clip(0, N - 1)
        x1, y1 = np.ceil(p.max(0)).astype(int).clip(0, N - 1)
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        (ax, ay), (bx, by), (cx, cy) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        mask[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -.02) & (l2 >= -.02) & (1 - l1 - l2 >= -.02)
    return mask


def dilate(img, mask, steps=24):
    """Fill pixels outside the islands with the mean of filled neighbours."""
    img = img.copy()
    filled = mask.copy()
    for _ in range(steps):
        acc = np.zeros_like(img[..., :3]); cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            f = np.roll(filled, (dy, dx), (0, 1)); v = np.roll(img[..., :3], (dy, dx), (0, 1))
            acc += v * f[..., None]; cnt += f
        new = (~filled) & (cnt > 0)
        img[new, :3] = acc[new] / cnt[new, None]
        filled |= new
    return img


def smooth_skin(mesh, weight_of, iterations, factor):
    """Laplacian smoothing of ClayBody vertices; weight_of(co) in 0..1 fades it."""
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    eye_mat = [m.name for m in mesh.data.materials].index('DarkEyes')
    eye_verts = {v.index for f in bm.faces if f.material_index == eye_mat for v in f.verts}
    w = {v.index: weight_of(v.co) for v in bm.verts if v.index not in eye_verts}
    w = {i: x for i, x in w.items() if x > 0}
    # Keep the ring touching the eye beads fixed so they stay seated.
    for v in bm.verts:
        if v.index in w and any(e.other_vert(v).index in eye_verts for e in v.link_edges):
            del w[v.index]
    for _ in range(iterations):
        new = {}
        for i, x in w.items():
            v = bm.verts[i]
            nb = [e.other_vert(v).co for e in v.link_edges]
            if nb:
                avg = sum(nb, Vector()) / len(nb)
                new[i] = v.co.lerp(avg, factor * x)
        for i, co in new.items():
            bm.verts[i].co = co
    bm.to_mesh(mesh.data); bm.free(); mesh.data.update()
    return len(w)


def falloff(d, r):
    return max(0.0, 1 - d / r) ** 0.5


mesh = bpy.data.objects['Resident']

# Eye beads: keep Codex's smaller size but give back half of the push-in depth
# (y), compared with the pre-polish v3 in git. Fully sunk beads bent the socket rim.
SOURCE = bpy.path.abspath('//resident_v3.blend')
with bpy.data.libraries.load(SOURCE) as (src, dst):
    dst.objects = ['Resident']
old = dst.objects[0]
assert old and len(old.data.vertices) == len(mesh.data.vertices), 'pre-polish resident_v3.blend mesh not found'
before = np.empty(len(old.data.vertices) * 3, np.float32); old.data.vertices.foreach_get('co', before)
co = np.empty(len(mesh.data.vertices) * 3, np.float32); mesh.data.vertices.foreach_get('co', co)
before = before.reshape(-1, 3); co = co.reshape(-1, 3)
sunk = (np.linalg.norm(co - before, axis=1) > 1e-4) & (before[:, 2] > 1.15)
co[sunk, 1] += (before[sunk, 1] - co[sunk, 1]) * .5
mesh.data.vertices.foreach_set('co', co.ravel()); mesh.data.update()
old_mesh = old.data
bpy.data.objects.remove(old); bpy.data.meshes.remove(old_mesh)
mesh = bpy.data.objects['Resident']
print('POLISH_EYES', int(sunk.sum()))

eyes =[Vector((s * .183, -.343, 1.282)) for s in (-1, 1)]
n_eye = smooth_skin(mesh, lambda co: max(falloff((co - e).length, .075) for e in eyes), 6, .5)
# Neck/shoulder creases at the front, where head meets torso.
n_neck = smooth_skin(mesh, lambda co: falloff(abs(co.z - 1.0), .05) * (1 if co.y < .05 and abs(co.x) < .3 else 0), 3, .4)
print('POLISH_SMOOTHED eye_ring', n_eye, 'neck', n_neck)

mask = island_mask(mesh)
for name in ['resident_v3_albedo_final', 'resident_v3_normal_final']:
    a = dilate(get(name), mask); a[..., 3] = 1
    put(name, a)

# Codex's paint layers 00-02 ended up as plain copies of the source colour:
# drop them only when they are identical, to keep the .blend small.
source = get('resident_v3_albedo')
for name in ['ArtLayer_00_Source_Color', 'ArtLayer_01_Terracotta_Glaze', 'ArtLayer_02_Retouch_Blush_Mottling']:
    if name in bpy.data.images and np.array_equal(get(name), source):
        bpy.data.images.remove(bpy.data.images[name])
        print('POLISH_DROPPED', name)

mesh['ArtPolish'] =str(mesh.get('ArtPolish', '')) + '; eye sockets and neck smoothed, UV margin dilated (polish_resident_v3.py)'
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('POLISH_SAVED', out)
