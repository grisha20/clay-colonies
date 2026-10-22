"""Work clips for the authored resident v3: one per job, tool held across the fist.

blender --background art/blender/resident_v3.blend --python-exit-code 1 \
    --python art/blender/animate_resident_v3.py -- [out.blend]

Clips (1 s, 30 FPS, looping): work_chop (axe), work_mine (pick), work_build
(mallet, two blows), work_dig (both hands scoop clay), work_gather (bend and
pick up), work_fish (rod). The old single work_gather swing is replaced.

Authoring is in armature space: per frame the script places IK targets for the
wrists, the handle direction and blade facing of Socket_Tool_R, spine bend and
twist, and a hip drop with feet pinned by leg IK; then it bakes visual keys and
removes the helpers. The tool mesh in Godot runs along the socket's +Y (handle,
grip at the origin) with its head towards +Z, so Y = handle direction and
Z = blade facing here.

Arms are short and the head is wider than the shoulders: wind-ups go beside
the head at ear height, never above it.
"""
import math
import sys
import bpy
from mathutils import Vector, Matrix

FRAMES = 30
arm = bpy.data.objects['ResidentArmature']
mesh = bpy.data.objects['Resident']
scene = bpy.context.scene


def ease(a, b, u):
    u = .5 - .5 * math.cos(math.pi * max(0., min(1., u)))
    if isinstance(a, (int, float)):
        return a + (b - a) * u
    return Vector(a).lerp(Vector(b), u)


def track(keys, t):
    """keys: [(time 0..1, value)], first and last equal for a loop."""
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            return ease(v0, v1, (t - t0) / max(1e-6, t1 - t0))
    return keys[-1][1] if isinstance(keys[-1][1], (int, float)) else Vector(keys[-1][1])


def basis(d, b):
    y = Vector(d).normalized()
    z = Vector(b) - y * Vector(b).dot(y)
    z.normalize()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def empty(name, parent_bone=None):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    return o


def rest(name):
    return arm.data.bones[name]


# ---- Helpers: empties and constraints -------------------------------------
helpers = {n: empty(n) for n in ['IK_R', 'IK_L', 'Pole_R', 'Pole_L', 'Ori_R', 'Leg_L', 'Leg_R', 'Knee_L', 'Knee_R', 'Toe_L', 'Toe_R']}
pb = arm.pose.bones


def add_constraints(pole_angle):
    for side in 'RL':
        c = pb['LowerArm.' + side].constraints.new('IK')
        c.name = 'AnimIK'; c.target = helpers['IK_' + side]; c.pole_target = helpers['Pole_' + side]
        c.pole_angle = pole_angle[side]; c.chain_count = 2
        c = pb['LowerLeg.' + side].constraints.new('IK')
        c.name = 'AnimIK'; c.target = helpers['Leg_' + side]; c.pole_target = helpers['Knee_' + side]
        c.pole_angle = pole_angle['leg' + side]; c.chain_count = 2
        c = pb['Foot.' + side].constraints.new('DAMPED_TRACK')
        c.name = 'AnimIK'; c.target = helpers['Toe_' + side]; c.track_axis = 'TRACK_Y'
    c = pb['Socket_Tool_R'].constraints.new('COPY_ROTATION')
    c.name = 'AnimIK'; c.target = helpers['Ori_R']


def remove_constraints():
    for b in pb:
        for c in list(b.constraints):
            if c.name.startswith('AnimIK'):
                b.constraints.remove(c)


def reset_pose():
    arm.animation_data_create()
    arm.animation_data.action = None
    for b in pb:
        b.location = (0, 0, 0); b.rotation_quaternion = (1, 0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)


def place_legs(drop):
    for side, sx in (('L', -1), ('R', 1)):
        helpers['Leg_' + side].location = (.2 * sx, 0, .095)
        helpers['Toe_' + side].location = (.2 * sx, -.16, .095)
        helpers['Knee_' + side].location = (.2 * sx, -.8, .3)


def neutral_hands():
    for side, sx in (('L', -1), ('R', 1)):
        helpers['IK_' + side].location = (.44 * sx, -.025, .53)
        helpers['Pole_' + side].location = (.75 * sx, .45, .65)
    helpers['Ori_R'].matrix_world = basis((0, -1, 0), (0, 0, 1)).to_4x4()


# Calibrate pole angles: with targets at rest, the rest elbow/knee should stay.
def calibrate():
    best = {}
    for key, bone, check in [('R', 'LowerArm.R', 'LowerArm.R'), ('L', 'LowerArm.L', 'LowerArm.L'),
                             ('legR', 'LowerLeg.R', 'LowerLeg.R'), ('legL', 'LowerLeg.L', 'LowerLeg.L')]:
        errs = []
        for deg in range(-180, 180, 15):
            reset_pose(); place_legs(0); neutral_hands()
            angles = {'R': 0., 'L': 0., 'legR': 0., 'legL': 0.}; angles[key] = math.radians(deg)
            add_constraints(angles)
            bpy.context.view_layer.update()
            err = (arm.matrix_world @ pb[check].head - arm.matrix_world @ rest(check).head_local).length
            remove_constraints()
            errs.append((err, deg))
        best[key] = math.radians(min(errs)[1])
        print('POLE', key, min(errs))
    return best


POLE = calibrate()
SHOULDER = {'R': Vector((.28, 0, .91)), 'L': Vector((-.28, 0, .91))}


def spine_world(bend, twist):
    """Rotation of the spine as (pitch forward deg, twist deg: + turns the right shoulder back)."""
    return (math.radians(bend), math.radians(twist))


def bake(name, base_action, frame_fn):
    reset_pose()
    if base_action:
        arm.animation_data.action = bpy.data.actions[base_action]
    add_constraints(POLE)
    for f in range(FRAMES + 1):
        t = f / FRAMES
        p = frame_fn(t)
        scene.frame_set(f)
        bend, twist = p.get('spine', (0., 0.))
        drop = p.get('drop', 0.)
        pb['Hips'].location = (0, -drop, 0); pb['Hips'].keyframe_insert('location', frame=f)
        pb['Spine'].rotation_mode = 'XYZ'
        pb['Spine'].rotation_euler = (math.radians(bend), math.radians(twist), 0)
        pb['Spine'].keyframe_insert('rotation_euler', frame=f)
        place_legs(drop)
        # Shoulders move with the spine: express hand targets relative to the
        # bent torso so poses stay reachable.
        pivot = Vector((0, -drop, 0)) + Vector((0, 0, .66 - drop))
        rot = Matrix.Rotation(math.radians(twist), 4, 'Z') @ Matrix.Rotation(math.radians(bend), 4, 'X')
        def body(v):
            v = Vector(v)
            return Vector((0, 0, .66 - drop)) + (rot @ (v - Vector((0, 0, .66))).to_4d()).to_3d()
        for side, sx in (('L', -1), ('R', 1)):
            hand = p.get('hand_' + side, ((.44 * sx, -.025, .53), True))
            pos, in_body = hand
            helpers['IK_' + side].location = body(pos) if in_body else Vector(pos)
            helpers['Pole_' + side].location = body((.75 * sx, .45, .62))
        d, b = p.get('tool', ((0, -1, 0), (0, 0, 1)))
        m = rot.to_3x3() @ basis(d, b)
        helpers['Ori_R'].matrix_world = m.to_4x4()
        for o in helpers.values():
            o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_euler', frame=f)
    arm.animation_data.action = None
    # Bake visual pose into a new action.
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    for b in arm.data.bones:
        b.select = True
    if base_action:
        arm.animation_data.action = bpy.data.actions[base_action]
    else:
        # Hips/Spine keys from the authoring pass live in a temp action.
        pass
    bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                     clear_constraints=False, use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    act = arm.animation_data.action
    if name in bpy.data.actions and bpy.data.actions[name] != act:
        bpy.data.actions.remove(bpy.data.actions[name])
    act.name = name; act.use_fake_user = True
    remove_constraints()
    for o in helpers.values():
        o.animation_data_clear()
    reset_pose()
    print('BAKED', name)


# Authoring pass writes Hips/Spine keys into a scratch action that bake reads.
def run(name, fn):
    reset_pose()
    scratch = bpy.data.actions.new('_scratch_' + name)
    arm.animation_data.action = scratch
    # Pre-key hips/spine into the scratch action so the bake sees them.
    for f in range(FRAMES + 1):
        p = fn(f / FRAMES)
        bend, twist = p.get('spine', (0., 0.))
        pb['Hips'].location = (0, -p.get('drop', 0.), 0); pb['Hips'].keyframe_insert('location', frame=f)
        pb['Spine'].rotation_mode = 'XYZ'
        pb['Spine'].rotation_euler = (math.radians(bend), math.radians(twist), 0)
        pb['Spine'].keyframe_insert('rotation_euler', frame=f)
    arm.animation_data.action = None
    bake(name, scratch.name, fn)
    bpy.data.actions.remove(scratch)


# ---- Clips -----------------------------------------------------------------
def chop(t):
    # Diagonal swing from beside the head to the trunk in front, fast strike.
    k = [(0, 0.), (.3, 1.), (.4, 1.), (1, 0.)]
    s = track(k, t)
    hand = ease((.50, .14, 1.04), (.16, -.40, .80), s)
    d = ease((.30, .55, .78), (-.40, -.90, .12), s)
    b = ease((-.2, -.9, .3), (-.9, -.2, -.25), s)
    return {'spine': (ease(-4., 10., s), ease(28., -22., s)), 'drop': .03 * s,
            'hand_R': (hand, True), 'tool': (d, b),
            'hand_L': (ease((-.30, -.26, .74), (-.40, .08, .62), s), True)}


def mine(t):
    k = [(0, 0.), (.32, 1.), (.42, 1.), (1, 0.)]
    s = track(k, t)
    hand = ease((.46, .06, 1.06), (.16, -.42, .56), s)
    d = ease((.10, .45, .88), (-.05, -.82, -.55), s)
    b = ease((0, -.9, .4), (0, -.5, -.85), s)
    return {'spine': (ease(-6., 26., s), ease(18., -8., s)), 'drop': .07 * s,
            'hand_R': (hand, True), 'tool': (d, b),
            'hand_L': (ease((-.32, -.22, .74), (-.36, -.10, .58), s), True)}


def build(t):
    # Two mallet blows per second.
    u = (t * 2) % 1.
    s = track([(0, 0.), (.35, 1.), (.45, 1.), (1, 0.)], u)
    hand = ease((.40, -.16, 1.0), (.18, -.40, .62), s)
    d = ease((.08, .15, 1.), (0, -.75, -.6), s)
    b = ease((0, -1, .1), (0, .45, -.85), s)
    return {'spine': (ease(4., 20., s), ease(8., -4., s)), 'drop': .06,
            'hand_R': (hand, True), 'tool': (d, b),
            'hand_L': ((-.24, -.36, .62), True)}


def dig(t):
    # Both hands scoop clay from the ground in front, alternating.
    def scoop(u, sx):
        s = track([(0, 0.), (.45, 1.), (.55, 1.), (1, 0.)], u)
        return ease((.14 * sx, -.30, .70), (.14 * sx, -.46, .40), s)
    return {'spine': (34., 3. * math.sin(t * 2 * math.pi)), 'drop': .1,
            'hand_R': (scoop(t, 1), True), 'hand_L': (scoop((t + .5) % 1., -1), True)}


def gather(t):
    s = track([(0, 0.), (.35, 1.), (.5, 1.), (.85, 0.), (1, 0.)], t)
    lift = track([(0, 0.), (.5, 0.), (.7, 1.), (.85, 0.), (1, 0.)], t)
    hand = ease((.30, -.22, .66), (.16, -.46, .40), s) + Vector((0, 0, .12 * lift)) - Vector((.12 * lift, 0, 0))
    return {'spine': (ease(6., 34., s), ease(0., 6., s)), 'drop': .1 * s,
            'hand_R': (hand, True), 'hand_L': ((-.34, -.18, .58), True)}


def fish(t):
    bob = math.sin(t * 2 * math.pi)
    return {'spine': (6., 4.), 'drop': .02,
            'hand_R': ((.28, -.32, .80 + .02 * bob), True),
            'tool': ((0, -.55 - .05 * bob, .83), (0, -.83, -.55)),
            'hand_L': ((.10, -.34, .74), True)}


for name, fn in [('work_chop', chop), ('work_mine', mine), ('work_build', build),
                 ('work_dig', dig), ('work_gather', gather), ('work_fish', fish)]:
    run(name, fn)

for o in helpers.values():
    bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    if a.users == 0 and not a.use_fake_user:
        bpy.data.actions.remove(a)
arm.animation_data.action = bpy.data.actions['idle']
mesh['WorkClips'] = 'animate_resident_v3.py: chop, mine, build, dig, gather, fish'

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = args[0] if args else bpy.data.filepath
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('ANIM_SAVED', out, sorted(a.name for a in bpy.data.actions))
