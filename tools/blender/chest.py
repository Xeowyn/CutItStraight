"""Blender side of tools/gen_chest.py: renders the chest's 2D sprite frames.

Run by gen_chest.py, never by hand:
    blender -b --factory-startup -P chest.py -- <glb> <outdir> <samples>

Writes into <outdir>:
    lid_<n>.png     the whole chest (body + lid) with the lid open by LID_ANGLES[n]
    latch_<i>.png   one brass catch, plus the shadow it throws on the chest
    lock.png        the padlock, plus its shadow
    meta.json       pixel positions the runtime needs (pivots, seam, mouth)

Every image is the SAME frame from the SAME camera, so the runtime draws them all at
one origin and they register exactly. The Python side crops and quantises afterwards
and records the crop offsets.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 96
RES = 760

# Lid angles in degrees. The runtime picks the nearest two and cross-fades, and the
# burst overshoots past the last frame's angle only in spirit — 104 is the resting
# angle, and it is reached through 118 so the settle has somewhere to settle FROM.
LID_ANGLES = [0, 14, 32, 56, 82, 104, 118]

C.reset()
bpy.ops.import_scene.gltf(filepath=GLB)
body = bpy.data.objects['Chest_Bottom']
lid = bpy.data.objects['Chest_Top']
hinge = bpy.data.objects['Bone.001']
# The file's stored pose for the hinge is the CLOSED lid. Opening is applied on top of
# it; assigning an absolute rotation instead (the first version of this script) throws
# the stored pose away and renders the lid standing wide open at "0 degrees".
from mathutils import Matrix  # noqa: E402
HINGE_REST = hinge.matrix_basis.copy()


def set_lid(deg):
    hinge.matrix_basis = HINGE_REST @ Matrix.Rotation(-math.radians(deg), 4, 'X')
    bpy.context.view_layer.update()


def world_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


lo, hi = world_bounds([body, lid])
blo, bhi = world_bounds([body])
FRONT_Y = blo.y           # the hinge is at +y, so the front face is the -y side
SEAM_Z = bhi.z - 0.01
CX = (lo.x + hi.x) / 2

# --- Materials: re-expose the pack's albedo -----------------------------------
#
# The texture is authored dark (mean 34,23,17) for an engine that adds its own
# exposure. Rather than brighten the texture, give it more light: a brighter rig is a
# conversion between lighting models, the same reasoning gen_chest.py used to bake a
# gain into the old palette.
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Roughness'].default_value = max(0.45, n.inputs['Roughness'].default_value)

brass = C.principled('Brass', (0.83, 0.58, 0.18), rough=0.32, metal=1.0)
brass_dark = C.principled('BrassDark', (0.45, 0.30, 0.09), rough=0.4, metal=1.0)
iron = C.principled('Iron', (0.08, 0.07, 0.06), rough=0.6, metal=0.6)


def bevel_box(name, loc, dims, mat, bevel=0.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = dims
    bpy.ops.object.transform_apply(scale=True)
    mod = o.modifiers.new('bev', 'BEVEL')
    mod.width = bevel
    mod.segments = 3
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


def cylinder(name, loc, r, depth, mat, rot=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=24)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


# --- The ironmongery the ceremony knocks off --------------------------------
LATCH_X = [CX - 0.40, CX, CX + 0.40]
latches = []
for i, x in enumerate(LATCH_X):
    parts = [
        bevel_box(f'L{i}plate', (x, FRONT_Y - 0.012, SEAM_Z), (0.17, 0.03, 0.17), brass_dark),
        bevel_box(f'L{i}catch', (x, FRONT_Y - 0.035, SEAM_Z - 0.005), (0.095, 0.03, 0.135), brass),
        cylinder(f'L{i}rivet', (x, FRONT_Y - 0.052, SEAM_Z + 0.04), 0.024, 0.02, brass),
    ]
    latches.append(parts)

LOCK_Z = SEAM_Z - 0.17
lock = [
    bevel_box('LockBody', (CX, FRONT_Y - 0.07, LOCK_Z), (0.17, 0.065, 0.18), brass, bevel=0.02),
    cylinder('Keyhole', (CX, FRONT_Y - 0.104, LOCK_Z - 0.025), 0.02, 0.01, iron),
]
bpy.ops.mesh.primitive_torus_add(location=(CX, FRONT_Y - 0.07, LOCK_Z + 0.1),
                                 rotation=(0, math.pi / 2, 0), major_radius=0.055,
                                 minor_radius=0.013)
shackle = bpy.context.active_object
shackle.data.materials.append(brass_dark)
bpy.ops.object.shade_smooth()
lock.append(shackle)

# --- The hoard, seen only once the lid is up ---------------------------------
# Metal gold with only a breath of emission: the first pass glowed at 0.9 and the
# whole hoard blew out to one flat white-yellow plate.
hoard_mat = C.principled('Hoard', (0.95, 0.66, 0.2), rough=0.28, metal=1.0,
                         emit=(1.0, 0.6, 0.15), emit_strength=0.06)
coin_mat = C.principled('CoinGold', (1.0, 0.74, 0.26), rough=0.22, metal=1.0)
# The mound's rim sits BELOW the chest's rim and reaches the walls, so its edge is
# hidden inside the casing. With the edge on show it read as a gold plate laid on top.
MOUND_Z = SEAM_Z - 0.07
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(CX, (blo.y + bhi.y) / 2, MOUND_Z),
                                     segments=32, ring_count=16)
hoard = bpy.context.active_object
hoard.scale = ((bhi.x - blo.x) * 0.47, (bhi.y - blo.y) * 0.44, 0.15)
hoard.data.materials.append(hoard_mat)
bpy.ops.object.shade_smooth()
coins = []
# Loose coins lying ON the mound, heights following its surface, tilted every which
# way. Individual struck discs are what make a gold heap read as coins rather than as
# a gold-coloured lump.
HX, HY = (bhi.x - blo.x) * 0.47, (bhi.y - blo.y) * 0.44
MY = (blo.y + bhi.y) / 2
# Coins lie nearly FLAT on the slope (a real heap settles); tilted hard and thin they
# read as shards.
for k in range(52):
    a = k * 2.399
    r = min(0.9, 0.1 + 0.12 * k ** 0.5)
    ux, uy = math.cos(a) * r, math.sin(a) * r
    h = 0.15 * math.sqrt(max(0.0, 1 - ux * ux - uy * uy))
    if MOUND_Z + h < SEAM_Z - 0.03:
        continue          # below the rim: never seen
    c = cylinder(f'Coin{k}', (CX + ux * HX, MY + uy * HY, MOUND_Z + h + 0.004),
                 0.062, 0.016, coin_mat,
                 rot=(-uy * 0.5 + 0.12 * math.sin(a * 3.1), ux * 0.5 + 0.12 * math.cos(a * 1.7), a))
    coins.append(c)
hoard_objs = [hoard, *coins]

# --- Rig ----------------------------------------------------------------------
sc = C.setup_render(RES, RES, SAMPLES)
C.world(0.9, (0.95, 0.9, 0.84))
C.area('Key', (CX - 2.6, FRONT_Y - 3.2, 4.2), (CX, 0, 0.5), 520, 3.0, (1.0, 0.94, 0.84))
C.area('Fill', (CX + 3.4, FRONT_Y - 2.0, 1.6), (CX, 0, 0.5), 170, 4.0, (0.84, 0.9, 1.0))
C.area('Rim', (CX + 0.8, 3.2, 3.4), (CX, 0, 0.6), 260, 2.0, (1.0, 0.86, 0.66))
catcher = C.shadow_catcher(20, lo.z)

cam = C.ortho_camera(azimuth_deg=-17, elevation_deg=24,
                     target=(CX, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2 + 0.26),
                     ortho_scale=2.05)


def show(objs, on):
    for o in objs:
        o.hide_render = not on


latch_objs = [p for parts in latches for p in parts]

# Lid frames: the chest itself, no ironmongery (drawn on top separately so each piece
# can be knocked off on its own tap).
show(latch_objs + lock, False)
for n, ang in enumerate(LID_ANGLES):
    set_lid(ang)
    show(hoard_objs, ang > 0)
    C.render_to(os.path.join(OUT, f'lid_{n}.png'))

# Ironmongery: the chest becomes a shadow catcher, so each sprite carries the shadow
# it throws on the casing but not the casing itself.
set_lid(0)
show(hoard_objs, False)
body.is_shadow_catcher = True
lid.is_shadow_catcher = True
for i, parts in enumerate(latches):
    show(latch_objs + lock, False)
    show(parts, True)
    C.render_to(os.path.join(OUT, f'latch_{i}.png'))
show(latch_objs, False)
show(lock, True)
C.render_to(os.path.join(OUT, 'lock.png'))

meta = {
    'res': RES,
    'lidAngles': LID_ANGLES,
    'latch': [C.project(cam, (x, FRONT_Y - 0.035, SEAM_Z)) for x in LATCH_X],
    'lock': C.project(cam, (CX, FRONT_Y - 0.07, LOCK_Z)),
    'seam': [C.project(cam, (blo.x, FRONT_Y, SEAM_Z)), C.project(cam, (bhi.x, FRONT_Y, SEAM_Z))],
    'mouth': C.project(cam, (CX, (blo.y + bhi.y) / 2, SEAM_Z)),
    'base': C.project(cam, (CX, (blo.y + bhi.y) / 2, lo.z)),
}
with open(os.path.join(OUT, 'meta.json'), 'w') as f:
    json.dump(meta, f)
print('CHEST_DONE')
