"""Blender side of tools/gen_kitchen.py: renders the Build screen's sprites.

Run by gen_kitchen.py, never by hand:
    blender -b --factory-startup -P kitchen.py -- <spec.json> <outdir> <samples> [only]

The objects themselves are modelled in code by kitchen_models.py (2026-09-26; they
were an imported CC0 OBJ pack before that).

Every sprite is rendered by the SAME orthographic camera orientation at the SAME
pixels-per-unit, so a sprite can be placed anywhere in a room by projecting its world
position: the runtime needs only the camera's right/up vectors and one scale, which
this script writes into <outdir>/meta.json alongside each image's anchor (the pixel
where the object's world origin landed).

Orthographic and lit only by SUN lights and the world, on purpose: under those, an
object's image does not depend on where it stands, so one render of "a chair turned
20 degrees" serves every chair turned 20 degrees in every kitchen.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import kitchen_models as KM  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
SPEC, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 96
spec = json.load(open(SPEC))
K = spec['K']
ONLY = set(argv[3].split(',')) if len(argv) > 3 and argv[3] else None


def srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(rgb):
    return tuple(srgb_to_lin(v) for v in rgb)


def rig():
    C.world(1.0, (0.9, 0.92, 0.97))
    # Key from front-left and high, so the lit faces match the pack's own renders and
    # cast shadows stay short and fall back and to the right, into the room.
    C.sun('Key', (0.45, 0.5, -1.5), 3.2, angle_deg=14)
    C.sun('Fill', (-0.8, 0.3, -0.35), 0.7, angle_deg=30, colour=(0.85, 0.9, 1.0))


def camera():
    return C.ortho_camera(spec['azimuth'], spec['elevation'], (0, 0, 0), 4.0, dist=40)


def frame_to(cam, points, margin):
    """Point the camera at `points` and size the frame to their projection."""
    R = cam.matrix_world.col[0].xyz.normalized()
    U = cam.matrix_world.col[1].xyz.normalized()
    F = -cam.matrix_world.col[2].xyz.normalized()
    rs = [p.dot(R) for p in points]
    us = [p.dot(U) for p in points]
    r0, r1 = min(rs) - margin, max(rs) + margin
    u0, u1 = min(us) - margin, max(us) + margin
    w, h = r1 - r0, u1 - u0
    sc = bpy.context.scene
    sc.render.resolution_x = max(8, int(math.ceil(w * K)))
    sc.render.resolution_y = max(8, int(math.ceil(h * K)))
    cam.data.ortho_scale = max(sc.render.resolution_x, sc.render.resolution_y) / K
    centre = R * ((r0 + r1) / 2) + U * ((u0 + u1) / 2)
    cam.location = centre - F * 40
    # Where world (0,0,0) lands, in pixels from the top-left of this render.
    ax = (0 - (r0 + r1) / 2) * K + sc.render.resolution_x / 2
    ay = ((u0 + u1) / 2 - 0) * K + sc.render.resolution_y / 2
    return ax, ay, R, U


def mesh_points(objs):
    pts = []
    for o in objs:
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    return pts


def clear_scene():
    # Everything but the lights: the rig is built once and shared by every render.
    for o in list(bpy.data.objects):
        if o.type != 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for c in list(bpy.data.curves):
        bpy.data.curves.remove(c)


def make_object(sp):
    """Model the object and parent it to a root empty that carries the turn."""
    objs = KM.build(sp['obj'], sp)
    root = bpy.data.objects.new('Root', None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    bpy.context.view_layer.update()
    pts = mesh_points(objs)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return root, objs, hi - lo


def shadow_plane(loc, rot, size):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    p = bpy.context.active_object
    p.is_shadow_catcher = True
    return p


C.reset()                 # factory startup carries a cube, a camera and a point lamp
meta = {'K': K, 'sprites': {}, 'rooms': {}}
C.setup_render(64, 64, SAMPLES)
rig()
cam = camera()

# --- Object sprites ------------------------------------------------------------
for sp in spec['sprites']:
    if ONLY and sp['key'] not in ONLY:
        continue
    clear_scene()
    cam = camera()
    root, objs, size = make_object(sp)
    root.rotation_euler[2] = sp['ry']
    bpy.context.view_layer.update()
    if sp['obj'] == 'window':
        pass              # sits IN a hole in the wall: there is nothing behind to catch it
    elif sp['wall']:
        # Wall-mounted: the wall behind catches the shadow. Rendered slightly proud of
        # the object's back face, facing the room (-y).
        back = max(p.y for p in mesh_points(objs))
        shadow_plane((0, back + 0.002, size.z / 2), (math.pi / 2, 0, 0), 6)
    else:
        shadow_plane((0, 0, 0), (0, 0, 0), 8)
    bpy.context.view_layer.update()
    pts = mesh_points(objs)
    ax, ay, R, U = frame_to(cam, pts, 0.42)
    C.render_to(os.path.join(OUT, sp['key'] + '.png'))
    meta['sprites'][sp['key']] = {'ax': ax, 'ay': ay}
    meta['R'] = list(R)
    meta['U'] = list(U)
    meta['size'] = meta.get('size', {})
    meta['size'][sp['key']] = list(size)
    print('SPRITE', sp['key'])


# --- Room shells ----------------------------------------------------------------
def solid(name, centre, dims, top, side, mside=None, mtop=None):
    """Axis-aligned box in GAME coordinates (x right, y up, z toward the viewer).
    `mside`/`mtop` override the flat colours with a finish material."""
    x, y, z = centre
    w, h, d = dims
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    mside = mside or C.principled(name + 'S', lin(side), rough=0.8)
    mtop = mtop or C.principled(name + 'T', lin(top), rough=0.8)
    o.data.materials.append(mside)
    o.data.materials.append(mtop)
    for p in o.data.polygons:
        p.material_index = 1 if p.normal.z > 0.5 else 0
    return o


def skirting(r, w, d, sk):
    """A skirting strip along both walls: the one detail that makes a box of three
    planes read as a room."""
    return [solid('SkirtB', ((r['x0'] + r['x1']) / 2, 0.05, r['z0'] + 0.015),
                  (w, 0.10, 0.03), sk, sk),
            solid('SkirtL', (r['x0'] + 0.015, 0.05, (r['z0'] + r['z1']) / 2),
                  (0.03, 0.10, d), sk, sk)]


def tinted(col, t):
    k = t.get('amount', 0.35)
    return [round(col[i] * (1 - k) + t['rgb'][i] * k) for i in range(3)]


for kit in spec['rooms']:
    if ONLY and ('room_' + kit['id']) not in ONLY:
        continue
    clear_scene()
    cam = camera()
    r, t = kit['room'], kit['tint']
    T = 0.12
    w, d = r['x1'] - r['x0'], r['z1'] - r['z0']
    floor_top, floor_side = tinted(r['floor'], t), tinted(r['floorSide'], t)
    wall_top, wall_side = tinted(r['wallTop'], t), tinted(r['wallSide'], t)
    fin = r.get('finish', {})
    wall_kind, floor_kind = fin.get('wall', 'paint'), fin.get('floor', 'paint')
    back_m = KM.finish_mat(wall_kind, 'X', wall_side)
    left_m = KM.finish_mat(wall_kind, 'Y', wall_side)
    floor_m = KM.finish_mat(floor_kind, 'F', floor_top)
    objs = [solid('Floor', ((r['x0'] + r['x1']) / 2, -0.07, (r['z0'] + r['z1']) / 2),
                  (w + T * 2, 0.14, d + T * 2), floor_top, floor_side, mtop=floor_m)]
    bz = r['z0'] - T / 2
    op = r.get('opening')
    spans = ([[r['x0'] - T, r['x1'] + T, 0, r['h']]] if not op else [
        [r['x0'] - T, op['x0'], 0, r['h']],
        [op['x1'], r['x1'] + T, 0, r['h']],
        [op['x0'], op['x1'], 0, op['y0']],
        [op['x0'], op['x1'], op['y1'], r['h']],
    ])
    for i, (x0, x1, y0, y1) in enumerate(spans):
        if x1 - x0 > 0.01 and y1 - y0 > 0.01:
            objs.append(solid(f'Back{i}', ((x0 + x1) / 2, (y0 + y1) / 2, bz),
                              (x1 - x0, y1 - y0, T), wall_top, wall_side, mside=back_m))
    objs.append(solid('Left', (r['x0'] - T / 2, r['h'] / 2, (r['z0'] + r['z1']) / 2),
                      (T, r['h'], d), wall_top, wall_side, mside=left_m))
    # A skirting strip along both walls: the one detail that makes a box of three
    # planes read as a room.
    sk = [max(0, c - 40) for c in wall_side]
    if fin.get('panel'):
        # Wood panelling to dado height, with a moulded rail. It replaces the skirting:
        # the two would overlap with coplanar faces (black squares in Cycles).
        pm = KM.wood('Wainscot', (150, 100, 62), (104, 66, 38), axis='Z', coat=0.3)
        rm = KM.wood('WainRail', (150, 100, 62), (104, 66, 38), axis='X', coat=0.3)
        ph = fin['panel']
        objs.append(solid('PanelB', ((r['x0'] + r['x1']) / 2, ph / 2, r['z0'] + 0.015),
                          (w, ph, 0.03), sk, sk, mside=pm, mtop=pm))
        objs.append(solid('PanelL', (r['x0'] + 0.015, ph / 2, (r['z0'] + r['z1']) / 2 + 0.015),
                          (0.03, ph, d - 0.03), sk, sk, mside=pm, mtop=pm))
        objs.append(solid('RailB', ((r['x0'] + r['x1']) / 2, ph + 0.02, r['z0'] + 0.025),
                          (w, 0.04, 0.05), sk, sk, mside=rm, mtop=rm))
        objs.append(solid('RailL', (r['x0'] + 0.025, ph + 0.02, (r['z0'] + r['z1']) / 2 + 0.025),
                          (0.05, 0.04, d - 0.05), sk, sk, mside=rm, mtop=rm))
    else:
        objs += skirting(r, w, d, sk)
    bpy.context.view_layer.update()
    ax, ay, R, U = frame_to(cam, mesh_points(objs), 0.1)
    C.render_to(os.path.join(OUT, 'room_' + kit['id'] + '.png'))
    meta['rooms'][kit['id']] = {'ax': ax, 'ay': ay}
    print('ROOM', kit['id'])

with open(os.path.join(OUT, 'meta.json'), 'w') as f:
    json.dump(meta, f)
print('KITCHEN_DONE')
