"""The Build screen's room objects, modelled in code. Runs INSIDE Blender.

The four rooms (2026-09-26 (b)): a Woodshop, a Kitchen, a Living Room and a Music
Room. They were all kitchens until the owner asked for each to be "unique and
interesting"; file and module names still say kitchen for history's sake.

Imported by tools/blender/kitchen.py. Replaced the CC0 "Kitchen" OBJ pack on
2026-09-26: the owner's verdict on the pack's pastel low-poly pieces was that they
did not look good, and they did not need to be used. Modelling our own also means
every object is sized for the room it stands in — the pack's layouts had the starter
cooker standing 0.2 units inside the worktop.

Conventions, shared with src/kitchens.js and build.js:
  * GAME coordinates: x right, y up, z toward the viewer. `G()` converts to Blender
    (x, -z, y). Everything here is written in game coordinates.
  * Every object is built at ry = 0 with its FRONT facing +z (toward the camera), its
    footprint centred on x/z and its base on y = 0. The layout only turns chairs.
  * Heights line up: every base unit's worktop is at WORKTOP (0.70), which is where
    the layouts stand the flowers.

Materials are procedural (wave/noise textures) so the objects carry real surface —
grain on the oak, brushed steel, glazed ceramic — rather than one flat colour a face.
"""
import math
import random

import bpy
from mathutils import Vector

WORKTOP = 0.70      # top of every base unit
BASE_D = 0.56       # depth of every base unit, worktop included
PLINTH = 0.07


def G(x, y, z):
    return Vector((x, -z, y))


# --- Materials -------------------------------------------------------------------

_mats = {}


def srgb(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(rgb):
    return tuple(srgb(v) for v in rgb)


def _bsdf(m):
    return m.node_tree.nodes['Principled BSDF']


def paint(name, rgb, rough=0.42, coat=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = _bsdf(m)
    b.inputs['Base Color'].default_value = (*lin(rgb), 1)
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.08
    _mats[name] = m
    return m


def metal(name, rgb, rough=0.28, brushed=False):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    b.inputs['Base Color'].default_value = (*lin(rgb), 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = rough
    if brushed:
        # Streaks along x: a stretched noise driving roughness.
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (4, 260, 260)
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 3.0
        rr = nt.nodes.new('ShaderNodeMapRange')
        rr.inputs['To Min'].default_value = rough - 0.08
        rr.inputs['To Max'].default_value = rough + 0.10
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
        nt.links.new(nz.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs['Result'], b.inputs['Roughness'])
    _mats[name] = m
    return m


def wood(name, light, dark, axis='X', rings=7.0, rough=0.5, coat=0.0):
    """Long grain along `axis` (Blender axis of the object's own coordinates).

    A wave texture in RINGS mode, heavily distorted by noise, stretched along the
    grain: flat-sawn figure, not stripes."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    stretch = {'X': (0.12, 1, 1), 'Y': (1, 0.12, 1), 'Z': (1, 1, 0.12)}[axis]
    mp.inputs['Scale'].default_value = stretch
    wv = nt.nodes.new('ShaderNodeTexWave')
    wv.wave_type = 'RINGS'
    wv.rings_direction = {'X': 'X', 'Y': 'Y', 'Z': 'Z'}[axis]
    wv.inputs['Scale'].default_value = rings
    wv.inputs['Distortion'].default_value = 6.0
    wv.inputs['Detail'].default_value = 3.0
    wv.inputs['Detail Roughness'].default_value = 0.6
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (*lin(light), 1)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = (*lin(dark), 1)
    # Fine pores / fibre so a plank is not smooth plastic between its figure lines.
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 90.0
    nz.inputs['Detail'].default_value = 4.0
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.18
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], wv.inputs['Vector'])
    nt.links.new(wv.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
    nt.links.new(nz.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.15
    _mats[name] = m
    return m


def ceramic(name, rgb, rough=0.18):
    return paint(name, rgb, rough=rough, coat=0.6)


def sky(name):
    """The view through a window: a soft blue gradient with a little cloud. Emissive,
    because the window sits in a hole in the wall with nothing behind it."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*lin((214, 236, 250)), 1)
    ramp.color_ramp.elements[1].color = (*lin((104, 170, 228)), 1)
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.5
    nz.inputs['Detail'].default_value = 6.0
    cl = nt.nodes.new('ShaderNodeValToRGB')
    cl.color_ramp.elements[0].position = 0.55
    cl.color_ramp.elements[0].color = (0, 0, 0, 1)
    cl.color_ramp.elements[1].position = 0.75
    cl.color_ramp.elements[1].color = (1, 1, 1, 1)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['B'].default_value = (0.92, 0.95, 1, 1)
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(tc.outputs['Generated'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], cl.inputs['Fac'])
    nt.links.new(cl.outputs['Color'], mix.inputs['Factor'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
    # Emission only (black base): under the key light a lit base colour plus emission
    # blew the whole pane out to white.
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    nt.links.new(mix.outputs['Result'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.8
    b.inputs['Roughness'].default_value = 0.08
    _mats[name] = m
    return m


# The palette. One kitchen style across every room, so the four kitchens read as one
# house getting nicer rather than four unrelated sets. Bright but grown-up: sage
# shaker fronts, butcher-block oak, brass, a red enamel range and a cream fridge.
def M():
    return {
        'front': paint('Front', (150, 178, 150), rough=0.38, coat=0.15),
        'carcass': paint('Carcass', (132, 160, 134), rough=0.5),
        'plinth': paint('Plinth', (58, 64, 60), rough=0.7),
        'oak': wood('Oak', (214, 170, 116), (150, 100, 58), axis='X', coat=0.25, rough=0.42),
        'oakZ': wood('OakZ', (214, 170, 116), (150, 100, 58), axis='Y', coat=0.25, rough=0.42),
        'brass': metal('Brass', (226, 180, 96), rough=0.22),
        'steel': metal('Steel', (206, 210, 214), rough=0.22, brushed=True),
        'chrome': metal('Chrome', (236, 238, 242), rough=0.06),
        'iron': metal('Iron', (40, 40, 42), rough=0.45),
        'enamel': ceramic('Enamel', (196, 58, 46)),
        'enamelDark': paint('EnamelDark', (120, 30, 24), rough=0.3),
        'cream': paint('Cream', (220, 210, 186), rough=0.3, coat=0.35),
        'blackGlass': paint('BlackGlass', (14, 16, 18), rough=0.06, coat=1.0),
        'rubber': paint('Rubber', (28, 28, 30), rough=0.8),
        'white': paint('WhitePaint', (226, 222, 212), rough=0.4),
        'walnut': wood('Walnut', (150, 102, 66), (84, 52, 30), axis='Y', coat=0.2, rough=0.45),
        'walnutX': wood('WalnutX', (150, 102, 66), (84, 52, 30), axis='X', coat=0.2, rough=0.45),
        'cushion': paint('Cushion', (226, 170, 60), rough=0.85),
        'pot': ceramic('Pot', (64, 118, 170)),
        'soil': paint('Soil', (60, 42, 30), rough=0.95),
        'stem': paint('Stem', (74, 128, 60), rough=0.6),
        'leaf': paint('Leaf', (92, 156, 70), rough=0.5),
        'petal': paint('Petal', (250, 200, 64), rough=0.45),
        'petal2': paint('Petal2', (240, 110, 90), rough=0.45),
        'eye': paint('Eye', (110, 66, 30), rough=0.7),
        'sky': sky('Sky'),
    }


# --- Primitives ------------------------------------------------------------------

def _finish(o, mat, bevel, segs=3):
    if bevel:
        md = o.modifiers.new('Bevel', 'BEVEL')
        md.width = bevel
        md.segments = segs
        md.limit_method = 'ANGLE'
        md.harden_normals = False
    if mat is not None:
        o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    try:
        o.data.set_sharp_from_angle(angle=math.radians(40))
    except Exception:  # noqa: BLE001 — older API: flat shading is acceptable
        pass
    return o


def box(c, d, mat, bevel=0.006, segs=3):
    """A box centred at game point c with game dimensions d = (w, h, depth)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*c))
    o = bpy.context.active_object
    o.scale = (d[0], d[2], d[1])
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, mat, min(bevel, min(d) * 0.45) if bevel else 0, segs)


def cyl(c, r, h, mat, axis='y', verts=40, bevel=0.003, r2=None):
    """Cylinder (or cone frustum with r2) centred at c, long axis `axis` in GAME terms."""
    rot = {'y': (0, 0, 0), 'x': (0, math.pi / 2, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h,
                                            location=G(*c), rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h,
                                        location=G(*c), rotation=rot)
    o = bpy.context.active_object
    return _finish(o, mat, min(bevel, r * 0.4) if bevel else 0, 2)


def ball(c, r, mat, scale=(1, 1, 1), segs=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=r,
                                         location=G(*c))
    o = bpy.context.active_object
    o.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, mat, 0)


def tube(points, r, mat):
    """A round bar along a polyline of game points (a tap, a stem)."""
    cu = bpy.data.curves.new('Tube', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        v = G(*p)
        sp.points[i].co = (v.x, v.y, v.z, 1)
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(points))
    o = bpy.data.objects.new('Tube', cu)
    bpy.context.scene.collection.objects.link(o)
    cu.materials.append(mat)
    return o


def carve(target, cutter):
    """Boolean-subtract `cutter` from `target`, then delete the cutter."""
    md = target.modifiers.new('Cut', 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.object = cutter
    md.solver = 'EXACT'
    # Evaluated after the bevel, so the outside keeps its rounded edges and the hole
    # is a crisp cut through them.
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = target.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    target.modifiers.clear()
    target.data = me
    bpy.data.objects.remove(cutter, do_unlink=True)
    return target


# --- Shared parts ----------------------------------------------------------------

def shaker(cx, cy, z, w, h, m, knob=None, pull=None):
    """A shaker door or drawer front: a flat frame with a recessed centre panel.

    `z` is the carcass front; the front stands 0.018 proud of it."""
    t = 0.018
    parts = [box((cx, cy, z + t / 2), (w, h, t), m['front'], bevel=0.004)]
    rail = min(0.05, w * 0.18, h * 0.22)
    # The frame is four bars proud of the slab, so the centre reads recessed. Stiles
    # run full height and the rails fit BETWEEN them: overlapping bars share coplanar
    # faces at the corners, which Cycles renders as black squares.
    for (x, y, bw, bh) in ((cx, cy + h / 2 - rail / 2, w - rail * 2, rail),
                           (cx, cy - h / 2 + rail / 2, w - rail * 2, rail),
                           (cx - w / 2 + rail / 2, cy, rail, h),
                           (cx + w / 2 - rail / 2, cy, rail, h)):
        parts.append(box((x, y, z + t + 0.005), (bw, bh, 0.01), m['front'], bevel=0.003))
    if knob:
        kx, ky = knob
        parts.append(cyl((kx, ky, z + t + 0.018), 0.006, 0.026, m['brass'], axis='z'))
        parts.append(ball((kx, ky, z + t + 0.034), 0.016, m['brass'], scale=(1, 1, 0.7)))
    if pull:
        px, py, pw = pull
        zf = z + t + 0.03
        parts.append(cyl((px, py, zf), 0.008, pw, m['brass'], axis='x'))
        for sx in (-1, 1):
            parts.append(cyl((px + sx * (pw / 2 - 0.012), py, z + t + 0.015), 0.006, 0.03,
                             m['brass'], axis='z'))
    return parts


def base_unit(w, m, doors=True):
    """Plinth, carcass and oak worktop: the body of every base unit.

    Returns (parts, front_z): front_z is the carcass front the fronts stand on."""
    d = BASE_D
    body_d = d - 0.05              # the worktop overhangs the front by 0.03
    zc = -0.025 - 0.01
    parts = [
        box((0, PLINTH / 2, zc + 0.03), (w - 0.02, PLINTH, body_d - 0.06), m['plinth'], bevel=0.003),
        box((0, PLINTH + (WORKTOP - 0.04 - PLINTH) / 2, zc),
            (w, WORKTOP - 0.04 - PLINTH, body_d), m['carcass'], bevel=0.004),
        box((0, WORKTOP - 0.02, 0), (w + 0.02, 0.04, d), m['oak'], bevel=0.006),
    ]
    return parts, zc + body_d / 2


def front_grid(w, m, zf, cols, drawers=True, top=WORKTOP - 0.04, knob_side=None):
    """Drawer row over a row of doors, `cols` columns across width `w`."""
    parts = []
    gap = 0.012
    cw = (w - gap * (cols + 1)) / cols
    y0, y1 = PLINTH + gap, top - gap
    dh = 0.13 if drawers else 0
    for i in range(cols):
        x = -w / 2 + gap + cw / 2 + i * (cw + gap)
        if drawers:
            dy = y1 - dh / 2
            parts += shaker(x, dy, zf, cw, dh, m, pull=(x, dy, min(0.16, cw * 0.5)))
        door_h = (y1 - y0) - (dh + gap if drawers else 0)
        doy = y0 + door_h / 2
        side = knob_side if knob_side is not None else (1 if i % 2 == 0 else -1)
        if cols == 1:
            side = 1
        kx = x + side * (cw / 2 - 0.045)
        parts += shaker(x, doy, zf, cw, door_h, m, knob=(kx, doy + door_h / 2 - 0.07))
    return parts


# --- Objects ---------------------------------------------------------------------

def counter(p, m):
    w = p.get('w', 1.20)
    parts, zf = base_unit(w, m)
    parts += front_grid(w, m, zf, cols=max(1, round(w / 0.4)))
    return parts


def sink(p, m):
    w = p.get('w', 0.60)
    parts, zf = base_unit(w, m)
    top = parts[2]
    # The basin: a steel bowl sunk into the worktop, its rim a little proud.
    bw, bd, bh = 0.44, 0.34, 0.16
    bz = 0.02
    carve(top, box((0, WORKTOP - 0.02, bz), (bw - 0.01, 0.2, bd - 0.01), None, bevel=0))
    # The carcass fills the unit up to the worktop, so it has to make room too or the
    # bowl is full of cabinet.
    carve(parts[1], box((0, WORKTOP - bh / 2, bz), (bw - 0.01, bh + 0.02, bd - 0.01), None, bevel=0))
    bowl = box((0, WORKTOP - bh / 2, bz), (bw - 0.012, bh, bd - 0.012), m['steel'], bevel=0.01)
    carve(bowl, box((0, WORKTOP - bh / 2 + 0.012, bz), (bw - 0.04, bh, bd - 0.04), None, bevel=0))
    parts.append(bowl)
    rim = box((0, WORKTOP + 0.003, bz), (bw + 0.02, 0.008, bd + 0.02), m['steel'], bevel=0.003)
    carve(rim, box((0, WORKTOP + 0.003, bz), (bw - 0.035, 0.05, bd - 0.035), None, bevel=0))
    parts.append(rim)
    parts.append(cyl((0, WORKTOP - bh + 0.014, bz), 0.02, 0.004, m['iron']))        # plughole
    # A gooseneck tap at the back.
    tz = -BASE_D / 2 + 0.07
    parts.append(cyl((0, WORKTOP + 0.02, tz), 0.022, 0.04, m['chrome']))
    parts.append(tube([(0, WORKTOP + 0.03, tz), (0, WORKTOP + 0.17, tz),
                       (0, WORKTOP + 0.22, tz + 0.04), (0, WORKTOP + 0.19, tz + 0.12),
                       (0, WORKTOP + 0.13, tz + 0.14)], 0.011, m['chrome']))
    for sx in (-1, 1):
        parts.append(cyl((sx * 0.06, WORKTOP + 0.03, tz), 0.012, 0.05, m['chrome']))
        parts.append(cyl((sx * 0.06, WORKTOP + 0.06, tz), 0.03, 0.012, m['chrome'], axis='x'))
    # Under a sink there are no drawers: a false front, then two doors.
    parts += front_grid(w, m, zf, cols=2, drawers=True)
    return parts


def oven(p, m):
    """A freestanding enamel range: hob, control strip, glass oven door."""
    w, h, d = 0.60, WORKTOP, BASE_D
    parts = [
        box((0, 0.03, -0.01), (w - 0.04, 0.06, d - 0.08), m['rubber'], bevel=0.003),
        box((0, 0.06 + (h - 0.06) / 2, 0), (w, h - 0.06, d), m['enamel'], bevel=0.02),
    ]
    zf = d / 2
    # Backguard.
    parts.append(box((0, h + 0.06, -d / 2 + 0.03), (w, 0.12, 0.05), m['enamel'], bevel=0.015))
    parts.append(box((0, h + 0.07, -d / 2 + 0.056), (w * 0.34, 0.05, 0.004), m['blackGlass'], bevel=0.002))
    # Hob: four burners with cast-iron grates.
    for (bx, bz, r) in ((-0.14, 0.11, 0.06), (0.14, 0.11, 0.05), (-0.14, -0.13, 0.05), (0.14, -0.13, 0.065)):
        parts.append(cyl((bx, h + 0.006, bz), r, 0.012, m['steel']))
        parts.append(cyl((bx, h + 0.016, bz), r * 0.55, 0.012, m['iron']))
    # Cast-iron grates: over each burner a square of bars with a cross, standing on
    # the hob so the burners show through. Bars never overlap (see shaker).
    g, gb = 0.21, 0.012
    for (gx, gz) in ((-0.14, 0.11), (0.14, 0.11), (-0.14, -0.13), (0.14, -0.13)):
        gy = h + 0.034
        for sx in (-1, 1):
            parts.append(box((gx + sx * (g / 2 - gb / 2), gy, gz), (gb, gb, g), m['iron'], bevel=0.003))
            parts.append(box((gx, gy, gz + sx * (g / 2 - gb / 2)), (g - gb * 2, gb, gb), m['iron'], bevel=0.003))
        parts.append(box((gx, gy + gb, gz), (g - gb * 2, gb * 0.8, gb * 0.8), m['iron'], bevel=0.002))
        parts.append(box((gx, gy + gb * 1.8, gz), (gb * 0.8, gb * 0.8, g - gb * 2), m['iron'], bevel=0.002))
    # Control strip with five knobs.
    ky = h - 0.07
    parts.append(box((0, ky, zf + 0.003), (w - 0.06, 0.08, 0.006), m['enamelDark'], bevel=0.003))
    for i in range(5):
        kx = -0.22 + i * 0.11
        parts.append(cyl((kx, ky, zf + 0.02), 0.022, 0.03, m['chrome'], axis='z'))
        parts.append(box((kx, ky + 0.012, zf + 0.036), (0.004, 0.018, 0.004), m['rubber'], bevel=0))
    # Oven door: enamel frame, dark glass window, chrome bar handle.
    dy0, dy1 = 0.14, h - 0.13
    dh = dy1 - dy0
    parts.append(box((0, dy0 + dh / 2, zf + 0.012), (w - 0.05, dh, 0.024), m['enamel'], bevel=0.012))
    parts.append(box((0, dy0 + dh / 2 - 0.02, zf + 0.026), (w - 0.18, dh - 0.16, 0.006), m['blackGlass'], bevel=0.01))
    parts.append(cyl((0, dy1 - 0.035, zf + 0.07), 0.012, w - 0.12, m['chrome'], axis='x'))
    for sx in (-1, 1):
        parts.append(cyl((sx * (w / 2 - 0.08), dy1 - 0.035, zf + 0.045), 0.009, 0.05, m['chrome'], axis='z'))
    # Warming drawer.
    parts.append(box((0, 0.1, zf + 0.008), (w - 0.05, 0.07, 0.016), m['enamel'], bevel=0.008))
    parts.append(cyl((0, 0.1, zf + 0.03), 0.008, 0.14, m['chrome'], axis='x'))
    return parts


def fridge(p, m):
    """A cream retro fridge-freezer with rounded shoulders and chrome pulls."""
    w, h, d = 0.66, 1.40, 0.60
    parts = [
        box((0, 0.04, -0.02), (w - 0.06, 0.08, d - 0.1), m['rubber'], bevel=0.004),
        box((0, 0.06 + (h - 0.06) / 2, -0.02), (w, h - 0.06, d - 0.04), m['cream'], bevel=0.08, segs=6),
    ]
    zf = -0.02 + (d - 0.04) / 2
    split = 1.02
    for (y0, y1) in ((0.10, split - 0.008), (split + 0.008, h - 0.04)):
        dh = y1 - y0
        parts.append(box((0, y0 + dh / 2, zf + 0.012), (w - 0.03, dh, 0.03), m['cream'], bevel=0.03, segs=5))
        # A long vertical pull on the left (the doors hinge right).
        px = -w / 2 + 0.07
        ln = min(0.34, dh * 0.6)
        py = y0 + dh - ln / 2 - 0.06 if y0 < 0.5 else y0 + ln / 2 + 0.05
        parts.append(cyl((px, py, zf + 0.06), 0.013, ln, m['chrome']))
        for sy in (-1, 1):
            parts.append(cyl((px, py + sy * (ln / 2 - 0.02), zf + 0.04), 0.009, 0.04, m['chrome'], axis='z'))
    # The badge.
    parts.append(box((0.12, split - 0.07, zf + 0.029), (0.12, 0.022, 0.004), m['chrome'], bevel=0.004))
    return parts


def cabinet(p, m):
    """Wall cabinet: two shaker doors under a small cornice."""
    w, h, d = 0.80, 0.50, 0.30
    parts = [box((0, h / 2, 0), (w, h, d), m['carcass'], bevel=0.004)]
    parts.append(box((0, h + 0.015, 0.01), (w + 0.04, 0.03, d + 0.03), m['front'], bevel=0.006))
    parts.append(box((0, -0.01, 0.005), (w + 0.01, 0.02, d + 0.01), m['front'], bevel=0.004))
    zf = d / 2
    gap = 0.012
    cw = (w - gap * 3) / 2
    for i, side in ((0, 1), (1, -1)):
        x = -w / 2 + gap + cw / 2 + i * (cw + gap)
        parts += shaker(x, h / 2, zf, cw, h - gap * 2, m,
                        knob=(x + side * (cw / 2 - 0.045), 0.08))
    return parts


def window(p, m):
    """A painted timber casement window with a sill, set IN the wall's opening.

    Front at +z faces the room. Depth 0.14 spans the 0.12 wall."""
    w, h, d = p.get('w', 1.16), 0.80, 0.14
    fr = 0.06
    parts = []
    # No two bars overlap (see shaker): stiles full height, everything else between.
    inner = w - fr * 2
    mull = 0.04
    pane = (inner - mull) / 2
    for (x, y, bw, bh, bd) in ((-w / 2 + fr / 2, h / 2, fr, h, d), (w / 2 - fr / 2, h / 2, fr, h, d),
                               (0, h - fr / 2, inner, fr, d), (0, fr / 2, inner, fr, d),
                               (0, h / 2, mull, h - fr * 2, d * 0.7)):
        parts.append(box((x, y, 0), (bw, bh, bd), m['white'], bevel=0.006))
    # A glazing bar across each casement, fitted between the frame and the mullion.
    for sx in (-1, 1):
        parts.append(box((sx * (mull / 2 + pane / 2), h * 0.64, 0), (pane, 0.03, d * 0.5), m['white'], bevel=0.004))
    parts.append(box((0, h / 2, -0.03), (w - 0.02, h - 0.02, 0.01), m['sky'], bevel=0))
    # Sill, projecting into the room.
    parts.append(box((0, -0.015, 0.07), (w + 0.12, 0.03, 0.18), m['white'], bevel=0.008))
    return parts


def chair(p, m):
    """A spindle-back kitchen chair in walnut with a mustard seat pad.

    Front (the open side of the seat) faces +z at ry = 0."""
    sw, sd, sy = 0.36, 0.34, 0.36
    leg = 0.03
    parts = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (sw / 2 - leg), sz * (sd / 2 - leg)
            top = 0.74 if sz < 0 else sy - 0.02
            parts.append(box((x, top / 2, z), (leg, top, leg), m['walnut'], bevel=0.005))
    parts.append(box((0, sy - 0.015, 0), (sw, 0.03, sd), m['walnutX'], bevel=0.008))
    parts.append(box((0, sy + 0.012, 0.005), (sw - 0.04, 0.026, sd - 0.05), m['cushion'], bevel=0.012, segs=4))
    # Stretchers.
    for sz in (-1, 1):
        parts.append(box((0, 0.12, sz * (sd / 2 - leg)), (sw - leg * 2, 0.02, 0.018), m['walnutX'], bevel=0.004))
    for sx in (-1, 1):
        parts.append(box((sx * (sw / 2 - leg), 0.16, 0), (0.018, 0.02, sd - leg * 2), m['walnut'], bevel=0.004))
    # Back: a curved top rail and spindles.
    bz = -(sd / 2 - leg)
    parts.append(box((0, 0.70, bz), (sw - 0.01, 0.07, 0.03), m['walnutX'], bevel=0.01))
    parts.append(box((0, 0.46, bz), (sw - leg * 2, 0.03, 0.022), m['walnutX'], bevel=0.005))
    for i in range(4):
        x = -0.09 + i * 0.06
        parts.append(cyl((x, 0.565, bz), 0.009, 0.21, m['walnut'], verts=16))
    return parts


def flower(p, m):
    """A glazed jug of sunflowers and poppies."""
    rnd = random.Random(7)
    parts = [
        cyl((0, 0.065, 0), 0.055, 0.13, m['pot'], r2=0.07, bevel=0.01),
        cyl((0, 0.126, 0), 0.066, 0.012, m['pot'], bevel=0.005),
        cyl((0, 0.126, 0), 0.058, 0.004, m['soil'], bevel=0),
    ]
    blooms = [(-0.06, 0.30, 0.01, 'petal'), (0.05, 0.33, -0.02, 'petal'), (0.0, 0.36, 0.03, 'petal2'),
              (0.08, 0.27, 0.04, 'petal2'), (-0.03, 0.26, -0.05, 'petal')]
    for (bx, by, bz, pm) in blooms:
        parts.append(tube([(bx * 0.2, 0.12, bz * 0.2), (bx * 0.6, by * 0.7, bz * 0.6), (bx, by, bz)], 0.004, m['stem']))
        for k in range(10):
            a = k / 10 * math.tau + rnd.random() * 0.2
            r = 0.028
            parts.append(ball((bx + math.cos(a) * r, by, bz + math.sin(a) * r), 0.016, m[pm],
                              scale=(1.3, 0.35, 0.7), segs=12))
        parts.append(ball((bx, by + 0.006, bz), 0.016, m['eye'], scale=(1, 0.6, 1), segs=12))
    for (lx, ly, lz) in ((-0.05, 0.19, 0.03), (0.06, 0.2, -0.01), (0.02, 0.17, 0.05)):
        parts.append(ball((lx, ly, lz), 0.03, m['leaf'], scale=(1.4, 0.3, 0.6), segs=12))
    return parts


WALNUT_TONES = (((128, 86, 56), (98, 62, 38)), ((116, 76, 48), (88, 54, 32)),
                ((138, 94, 62), (106, 68, 42)), ((106, 68, 44), (80, 50, 30)))


def floor(p, m):
    """A band of oak floorboards, laid along x with staggered joints.

    Width and depth come from the layout, so each kitchen's three (or four) bands
    exactly pave its room."""
    w, d = p['w'], p['d']
    rnd = random.Random(int(w * 1000 + d * 10))
    board_w, t, gap = 0.115, 0.02, 0.004
    tag = 'W' if p.get('tone') == 'walnut' else ''
    oak = (((204, 158, 106), (170, 122, 76)), ((190, 142, 92), (156, 108, 66)),
           ((212, 170, 120), (178, 134, 88)), ((182, 134, 86), (148, 102, 62)))
    pal = WALNUT_TONES if p.get('tone') == 'walnut' else oak
    tones = [wood(f'Floor{tag}{i}', light, dark, axis='X', rings=5.5, rough=0.5, coat=0.3)
             for i, (light, dark) in enumerate(pal)]
    parts = []
    rows = max(1, round(d / board_w))
    bw = d / rows
    for r in range(rows):
        z = -d / 2 + bw / 2 + r * bw
        x = -w / 2 - rnd.uniform(0, 0.8)
        while x < w / 2 - 0.02:
            ln = rnd.uniform(0.7, 1.3)
            x0, x1 = max(x, -w / 2), min(x + ln, w / 2)
            if x1 - x0 > 0.05:
                parts.append(box(((x0 + x1) / 2, t / 2, z), (x1 - x0 - gap, t, bw - gap),
                                 rnd.choice(tones), bevel=0.003, segs=2))
            x += ln
    return parts



# =================================================================================
# Woodshop, Living Room and Music Room objects (2026-09-26 (b))
# =================================================================================

def mat(name, fn, *a, **k):
    """Materials made on first use, so a builder can name the colour it needs."""
    return _mats.get(name) or fn(name, *a, **k)


def dots(name, base, hole, pitch=40.0, r=0.2):
    """A pegboard: a plain board with a grid of dark holes (object coordinates)."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'
    sc.inputs['Scale'].default_value = pitch
    fr = nt.nodes.new('ShaderNodeVectorMath'); fr.operation = 'FRACTION'
    sub = nt.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    ln = nt.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'
    lt.inputs[1].default_value = r
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*lin(base), 1)
    mix.inputs['B'].default_value = (*lin(hole), 1)
    nt.links.new(tc.outputs['Object'], sc.inputs[0])
    nt.links.new(sc.outputs['Vector'], fr.inputs[0])
    nt.links.new(fr.outputs['Vector'], sub.inputs[0])
    nt.links.new(sub.outputs['Vector'], sep.inputs['Vector'])
    # The board faces -Y in Blender, so its surface spans X and Z.
    nt.links.new(sep.outputs['X'], comb.inputs['X'])
    nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    nt.links.new(comb.outputs['Vector'], ln.inputs[0])
    nt.links.new(ln.outputs['Value'], lt.inputs[0])
    nt.links.new(lt.outputs['Value'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.8
    _mats[name] = m
    return m


def rug_mat(name, field, border, accent):
    """A woven rug: a border band, a field, and a lozenge medallion (Generated coords)."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sub = nt.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    ab = nt.nodes.new('ShaderNodeVectorMath'); ab.operation = 'ABSOLUTE'
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'
    edge = nt.nodes.new('ShaderNodeMath'); edge.operation = 'GREATER_THAN'
    edge.inputs[1].default_value = 0.40
    med = nt.nodes.new('ShaderNodeMath'); med.operation = 'LESS_THAN'
    med.inputs[1].default_value = 0.22
    ring = nt.nodes.new('ShaderNodeMath'); ring.operation = 'COMPARE'
    ring.inputs[1].default_value = 0.30
    ring.inputs[2].default_value = 0.015
    m1 = nt.nodes.new('ShaderNodeMix'); m1.data_type = 'RGBA'
    m1.inputs['A'].default_value = (*lin(field), 1)
    m1.inputs['B'].default_value = (*lin(accent), 1)
    m2 = nt.nodes.new('ShaderNodeMix'); m2.data_type = 'RGBA'
    m2.inputs['B'].default_value = (*lin(border), 1)
    m3 = nt.nodes.new('ShaderNodeMix'); m3.data_type = 'RGBA'
    m3.inputs['B'].default_value = (*lin(accent), 1)
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 180
    mulc = nt.nodes.new('ShaderNodeMix'); mulc.data_type = 'RGBA'; mulc.blend_type = 'MULTIPLY'
    mulc.inputs['Factor'].default_value = 0.15
    nt.links.new(tc.outputs['Generated'], sub.inputs[0])
    nt.links.new(sub.outputs['Vector'], ab.inputs[0])
    nt.links.new(ab.outputs['Vector'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['X'], mx.inputs[0])
    nt.links.new(sep.outputs['Y'], mx.inputs[1])
    nt.links.new(sep.outputs['X'], ad.inputs[0])
    nt.links.new(sep.outputs['Y'], ad.inputs[1])
    nt.links.new(mx.outputs['Value'], edge.inputs[0])
    nt.links.new(ad.outputs['Value'], med.inputs[0])
    nt.links.new(mx.outputs['Value'], ring.inputs[0])
    nt.links.new(med.outputs['Value'], m1.inputs['Factor'])
    nt.links.new(m1.outputs['Result'], m2.inputs['A'])
    nt.links.new(edge.outputs['Value'], m2.inputs['Factor'])
    nt.links.new(m2.outputs['Result'], m3.inputs['A'])
    nt.links.new(ring.outputs['Value'], m3.inputs['Factor'])
    nt.links.new(m3.outputs['Result'], mulc.inputs['A'])
    nt.links.new(nz.outputs['Color'], mulc.inputs['B'])
    nt.links.new(mulc.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    _mats[name] = m
    return m


def emit(name, rgb, strength):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = _bsdf(m)
    b.inputs['Base Color'].default_value = (*lin(rgb), 1)
    b.inputs['Emission Color'].default_value = (*lin(rgb), 1)
    b.inputs['Emission Strength'].default_value = strength
    _mats[name] = m
    return m


def painting_mat(name):
    """A small landscape in oils: sky, far hills, near field — Generated coords."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    wv = nt.nodes.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 1.4
    wv.inputs['Distortion'].default_value = 3
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 0.12
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = (*lin((70, 120, 60)), 1)
    cr.elements[1].position = 1.0; cr.elements[1].color = (*lin((150, 196, 236)), 1)
    for pos, col in ((0.34, (120, 150, 70)), (0.40, (86, 110, 140)), (0.52, (120, 140, 170)),
                     (0.60, (236, 206, 150)), (0.75, (170, 200, 232))):
        e = cr.elements.new(pos)
        e.color = (*lin(col), 1)
    cr.interpolation = 'LINEAR'
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(tc.outputs['Generated'], wv.inputs['Vector'])
    nt.links.new(wv.outputs['Fac'], mul.inputs[0])
    nt.links.new(sep.outputs['Z'], add.inputs[0])
    nt.links.new(mul.outputs['Value'], add.inputs[1])
    nt.links.new(add.outputs['Value'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.55
    b.inputs['Coat Weight'].default_value = 0.4
    _mats[name] = m
    return m


# --- Woodshop ---------------------------------------------------------------------

def workbench(p, m):
    """A heavy maple workbench: thick top, splayed legs, a shelf of offcuts, a front
    vise, and a plane and mallet left on top."""
    w, h, d = 1.30, 0.72, 0.60
    maple = mat('Maple', wood, (226, 196, 150), (180, 142, 96), axis='X', coat=0.2)
    frame = mat('BenchFrame', wood, (170, 120, 76), (120, 80, 46), axis='Z')
    parts = [box((0, h - 0.035, 0), (w, 0.07, d), maple, bevel=0.01)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(box((sx * (w / 2 - 0.08), (h - 0.07) / 2, sz * (d / 2 - 0.07)),
                             (0.07, h - 0.07, 0.07), frame, bevel=0.006))
        parts.append(box((sx * (w / 2 - 0.08), 0.12, 0), (0.07, 0.06, d - 0.14), frame, bevel=0.005))
    parts.append(box((0, 0.16, 0), (w - 0.2, 0.025, d - 0.12), frame, bevel=0.004))
    rnd = random.Random(3)
    for i in range(5):
        tone = [(214, 170, 116), (150, 96, 60), (196, 120, 90), (236, 214, 176), (110, 72, 48)][i]
        wm = mat(f'Offcut{i}', wood, tone, tuple(int(c * 0.72) for c in tone), axis='X')
        parts.append(box((-0.3 + rnd.uniform(-0.1, 0.5), 0.19 + i * 0.022, rnd.uniform(-0.12, 0.12)),
                         (rnd.uniform(0.4, 0.7), 0.02, rnd.uniform(0.07, 0.12)), wm, bevel=0.003))
    # Front vise: a wooden chop on a steel screw, with a tommy bar.
    vx = -w / 2 + 0.22
    parts.append(box((vx, h - 0.11, d / 2 + 0.03), (0.28, 0.16, 0.05), maple, bevel=0.008))
    parts.append(cyl((vx, h - 0.11, d / 2 + 0.08), 0.018, 0.06, m['steel'], axis='z'))
    parts.append(cyl((vx, h - 0.11, d / 2 + 0.11), 0.008, 0.2, m['steel'], axis='x'))
    for sx in (-1, 1):
        parts.append(ball((vx + sx * 0.1, h - 0.11, d / 2 + 0.11), 0.014, m['steel']))
    # A hand plane and a mallet on the top.
    iron = mat('PlaneBody', metal, (40, 60, 110), rough=0.35)
    parts.append(box((0.25, h + 0.03, -0.05), (0.26, 0.05, 0.07), iron, bevel=0.012))
    parts.append(box((0.21, h + 0.075, -0.05), (0.05, 0.05, 0.03), m['walnut'], bevel=0.01))
    parts.append(ball((0.33, h + 0.075, -0.05), 0.022, m['walnut']))
    parts.append(box((-0.1, h + 0.04, 0.12), (0.12, 0.07, 0.07), m['walnutX'], bevel=0.012))
    parts.append(cyl((0.02, h + 0.02, 0.12), 0.013, 0.2, m['oak'], axis='x'))
    # Shavings.
    shav = mat('Shaving', paint, (238, 214, 170), rough=0.6)
    for i in range(6):
        parts.append(ball((0.42 + rnd.uniform(-0.06, 0.12), h + 0.008, rnd.uniform(-0.2, 0.2)),
                          0.022, shav, scale=(1.4, 0.35, 0.9), segs=12))
    return parts


def pegboard(p, m):
    """A pegboard hung on the wall with the tools drawn round in marker, as every
    tidy shop has. Hung from its base (origin at the bottom edge)."""
    w, h = 1.20, 0.70
    board = dots('Pegboard', (170, 128, 88), (60, 40, 26), pitch=38)
    parts = [box((0, h / 2, 0), (w, h, 0.02), board, bevel=0.004)]
    trim = mat('PegTrim', wood, (200, 160, 110), (150, 110, 70), axis='X')
    for y in (0.012, h - 0.012):
        parts.append(box((0, y, 0.012), (w + 0.03, 0.025, 0.012), trim, bevel=0.003))
    z = 0.03
    red = mat('ToolRed', paint, (206, 50, 40), rough=0.35, coat=0.3)
    yel = mat('ToolYellow', paint, (240, 190, 40), rough=0.35, coat=0.3)
    blu = mat('ToolBlue', paint, (40, 110, 200), rough=0.35, coat=0.3)
    # Hammer.
    parts.append(box((-0.45, 0.38, z), (0.035, 0.32, 0.03), m['oak'], bevel=0.008))
    parts.append(box((-0.45, 0.55, z + 0.01), (0.14, 0.04, 0.045), m['iron'], bevel=0.008))
    # Hand saw.
    saw = box((-0.18, 0.40, z - 0.01), (0.34, 0.14, 0.004), m['steel'], bevel=0.001)
    parts.append(saw)
    parts.append(box((-0.02, 0.44, z), (0.08, 0.1, 0.025), m['walnutX'], bevel=0.01))
    # Screwdrivers.
    for i, c in enumerate((red, yel, blu)):
        x = 0.1 + i * 0.07
        parts.append(cyl((x, 0.52, z + 0.01), 0.016, 0.11, c))
        parts.append(cyl((x, 0.40, z + 0.01), 0.005, 0.14, m['chrome']))
    # Spanners.
    for i, L in enumerate((0.2, 0.16, 0.13)):
        x = 0.34 + i * 0.06
        parts.append(box((x, 0.45, z), (0.022, L, 0.008), m['chrome'], bevel=0.003))
        parts.append(cyl((x, 0.45 + L / 2, z), 0.022, 0.009, m['chrome'], axis='z'))
    # Tape measure and a coil of cord.
    parts.append(box((0.48, 0.16, z + 0.01), (0.09, 0.09, 0.04), yel, bevel=0.015))
    parts.append(cyl((-0.38, 0.16, z + 0.01), 0.07, 0.03, red, axis='z'))
    # Clamps along the bottom.
    for i in range(3):
        x = -0.1 + i * 0.1
        parts.append(box((x, 0.16, z), (0.02, 0.2, 0.012), blu, bevel=0.003))
        parts.append(box((x + 0.03, 0.25, z), (0.06, 0.02, 0.012), blu, bevel=0.003))
    return parts


def toolchest(p, m):
    """A red rolling tool chest: drawers with chrome pulls, on casters."""
    w, h, d = 0.56, 0.88, 0.42
    red = mat('ChestRed', paint, (200, 40, 34), rough=0.28, coat=0.5)
    parts = [box((0, 0.07 + (h - 0.07) / 2, 0), (w, h - 0.07, d), red, bevel=0.014)]
    zf = d / 2
    ys = [0.16, 0.30, 0.42, 0.52, 0.62, 0.72, 0.82]
    for i in range(len(ys) - 1):
        y0, y1 = ys[i] - 0.03, ys[i + 1] - 0.035
        parts.append(box((0, (y0 + y1) / 2, zf + 0.006), (w - 0.05, y1 - y0, 0.012), red, bevel=0.006))
        parts.append(box((0, y1 - 0.02, zf + 0.018), (w - 0.14, 0.012, 0.012), m['chrome'], bevel=0.004))
    # ON the chest, not flush with its top: coplanar faces render black in Cycles.
    parts.append(box((0, h + 0.008, 0), (w + 0.01, 0.016, d + 0.01), mat('ChestMat', paint, (96, 98, 104), rough=0.85), bevel=0.004))
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(cyl((sx * (w / 2 - 0.06), 0.035, sz * (d / 2 - 0.06)), 0.035, 0.03,
                             m['rubber'], axis='x'))
            parts.append(box((sx * (w / 2 - 0.06), 0.065, sz * (d / 2 - 0.06)), (0.05, 0.02, 0.05), m['steel'], bevel=0.004))
    parts.append(box((w / 2 + 0.02, h - 0.1, 0), (0.02, 0.02, d - 0.1), m['chrome'], bevel=0.006))
    return parts


def lumberrack(p, m):
    """A wall rack of timber: dark steel uprights with cantilever arms, boards of every
    colour the game has taught the player to cut."""
    w, h, d = 0.74, 1.45, 0.36
    rack = mat('RackSteel', metal, (52, 56, 62), rough=0.5)
    parts = []
    for sx in (-1, 1):
        parts.append(box((sx * (w / 2 - 0.03), h / 2, -d / 2 + 0.03), (0.05, h, 0.05), rack, bevel=0.005))
    tones = [(214, 170, 116), (180, 90, 60), (236, 214, 176), (110, 72, 48), (226, 196, 150),
             (170, 60, 50), (150, 102, 66), (240, 200, 90)]
    rnd = random.Random(11)
    k = 0
    for level in range(4):
        y = 0.28 + level * 0.34
        for sx in (-1, 1):
            parts.append(box((sx * (w / 2 - 0.03), y, 0), (0.035, 0.035, d), rack, bevel=0.004))
        for j in range(2):
            tone = tones[k % len(tones)]; k += 1
            wm = mat(f'Rack{k}', wood, tone, tuple(int(c * 0.72) for c in tone), axis='X')
            parts.append(box((rnd.uniform(-0.04, 0.04), y + 0.035 + j * 0.035 + 0.0175,
                              rnd.uniform(-0.06, 0.08)),
                             (w + rnd.uniform(0.04, 0.14), 0.03, rnd.uniform(0.12, 0.2)), wm, bevel=0.003))
    return parts


def sawhorses(p, m):
    """Two sawhorses with a board across them, a pencil line drawn on it."""
    frame = mat('HorseWood', wood, (220, 180, 120), (170, 126, 78), axis='X')
    parts = []
    for sx in (-1, 1):
        x = sx * 0.34
        parts.append(box((x, 0.50, 0), (0.07, 0.06, 0.5), frame, bevel=0.005))
        for sz in (-1, 1):
            parts.append(box((x, 0.24, sz * 0.2), (0.05, 0.5, 0.05), frame, bevel=0.005))
        parts.append(box((x, 0.12, 0), (0.035, 0.035, 0.4), frame, bevel=0.004))
    plank = mat('Plank', wood, (236, 206, 150), (196, 150, 96), axis='X', coat=0.1)
    parts.append(box((0, 0.545, 0.02), (1.1, 0.03, 0.22), plank, bevel=0.004))
    pencil = mat('Pencil', paint, (50, 50, 60), rough=0.7)
    parts.append(box((-0.1, 0.5615, 0.02), (0.7, 0.002, 0.004), pencil, bevel=0))
    parts.append(cyl((0.35, 0.57, 0.08), 0.006, 0.12, mat('PencilYel', paint, (240, 196, 40)), axis='x'))
    return parts


def stool(p, m):
    """A round-topped shop stool on four splayed legs."""
    seat = mat('StoolSeat', wood, (180, 120, 70), (130, 80, 44), axis='X', coat=0.3)
    parts = [cyl((0, 0.57, 0), 0.16, 0.04, seat, bevel=0.012)]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        top = (math.cos(a) * 0.09, 0.55, math.sin(a) * 0.09)
        bot = (math.cos(a) * 0.17, 0.0, math.sin(a) * 0.17)
        parts.append(tube([bot, top], 0.017, m['walnut']))
    parts.append(tube([(math.cos(a) * 0.14, 0.2, math.sin(a) * 0.14) for a in
                       [k * math.pi / 8 for k in range(17)]], 0.009, m['steel']))
    return parts


def shopvac(p, m):
    """A yellow shop vacuum: a drum on casters with a black lid and a coiled hose."""
    yel = mat('VacYellow', paint, (246, 196, 36), rough=0.3, coat=0.4)
    parts = [cyl((0, 0.26, 0), 0.19, 0.42, yel, bevel=0.03),
             cyl((0, 0.50, 0), 0.2, 0.08, m['rubber'], bevel=0.02),
             cyl((0, 0.56, 0), 0.08, 0.04, m['rubber'], bevel=0.01)]
    parts.append(box((0, 0.61, 0), (0.18, 0.03, 0.04), m['rubber'], bevel=0.012))
    for k in range(4):
        a = k * math.pi / 2
        parts.append(ball((math.cos(a) * 0.15, 0.025, math.sin(a) * 0.15), 0.025, m['rubber']))
    pts = [(0.2 * math.cos(t) * 0.9 + 0.02, 0.1 + t * 0.02, 0.2 * math.sin(t) * 0.9 + 0.12)
           for t in [i * 0.35 for i in range(22)]]
    hose = [(0.17, 0.4, 0.05)] + [(x + 0.1, y, z + 0.1) for (x, y, z) in pts[:1]] + \
           [(0.3, 0.12, 0.25), (0.1, 0.03, 0.35), (-0.18, 0.03, 0.3), (-0.3, 0.05, 0.1)]
    parts.append(tube(hose, 0.025, mat('VacHose', paint, (40, 42, 46), rough=0.5)))
    return parts


def offcuts(p, m):
    """A slatted crate full of offcuts standing on end — every one a different wood."""
    crate = mat('Crate', wood, (206, 172, 120), (160, 120, 76), axis='X')
    w, h, d = 0.42, 0.34, 0.34
    parts = []
    for y in (0.05, 0.16, 0.27):
        for sz in (-1, 1):
            parts.append(box((0, y, sz * (d / 2 - 0.01)), (w, 0.08, 0.02), crate, bevel=0.004))
        for sx in (-1, 1):
            parts.append(box((sx * (w / 2 - 0.01), y, 0), (0.02, 0.08, d - 0.04), crate, bevel=0.004))
    parts.append(box((0, 0.01, 0), (w - 0.02, 0.02, d - 0.02), crate, bevel=0.003))
    rnd = random.Random(5)
    tones = [(214, 170, 116), (180, 90, 60), (236, 214, 176), (110, 72, 48), (240, 200, 90),
             (170, 60, 50), (120, 170, 150), (226, 196, 150), (90, 70, 50)]
    for i, tone in enumerate(tones):
        wm = mat(f'Cut{i}', wood, tone, tuple(int(c * 0.72) for c in tone), axis='Z')
        hgt = rnd.uniform(0.34, 0.56)
        o = box((rnd.uniform(-0.13, 0.13), hgt / 2 + 0.02, rnd.uniform(-0.1, 0.1)),
                (rnd.uniform(0.05, 0.09), hgt, rnd.uniform(0.03, 0.06)), wm, bevel=0.004)
        o.rotation_euler = (rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), rnd.uniform(-0.6, 0.6))
        parts.append(o)
    return parts


def radio(p, m):
    """A 1950s tabletop radio: rounded orange body, speaker grille, dial and knobs."""
    orange = mat('RadioOrange', paint, (236, 116, 50), rough=0.3, coat=0.6)
    parts = [box((0, 0.09, 0), (0.3, 0.18, 0.14), orange, bevel=0.04, segs=6)]
    grille = mat('Grille', paint, (236, 222, 190), rough=0.6)
    parts.append(box((-0.06, 0.09, 0.066), (0.13, 0.12, 0.012), grille, bevel=0.02, segs=4))
    for i in range(5):
        parts.append(box((-0.06, 0.045 + i * 0.022, 0.074), (0.11, 0.005, 0.004), m['brass'], bevel=0))
    parts.append(cyl((0.08, 0.11, 0.07), 0.035, 0.01, m['cream'], axis='z'))
    parts.append(box((0.08, 0.11, 0.077), (0.004, 0.05, 0.002), m['rubber'], bevel=0))
    for x in (0.05, 0.11):
        parts.append(cyl((x, 0.045, 0.074), 0.013, 0.02, m['brass'], axis='z'))
    parts.append(tube([(0.12, 0.17, -0.04), (0.16, 0.3, -0.05), (0.2, 0.4, -0.06)], 0.003, m['chrome']))
    return parts


# --- Living room --------------------------------------------------------------------

def rug(p, m):
    w, d = p.get('w', 1.8), p.get('d', 1.2)
    rm = rug_mat('Rug', (160, 46, 44), (44, 54, 90), (230, 190, 110))
    parts = [box((0, 0.006, 0), (w, 0.012, d), rm, bevel=0.004)]
    fringe = mat('Fringe', paint, (236, 226, 200), rough=0.9)
    for sx in (-1, 1):
        for i in range(int(d / 0.03)):
            parts.append(box((sx * (w / 2 + 0.02), 0.004, -d / 2 + 0.015 + i * 0.03), (0.04, 0.006, 0.008), fringe, bevel=0))
    return parts


def fireplace(p, m):
    """A stone fireplace with an oak mantel and a lit fire."""
    w, h, d = 1.10, 1.12, 0.32
    stone = mat('Stone', paint, (196, 188, 176), rough=0.8)
    parts = []
    # Surround as three blocks (no overlaps), firebox recess behind.
    parts.append(box((-w / 2 + 0.16, 0.45, 0), (0.32, 0.9, d), stone, bevel=0.01))
    parts.append(box((w / 2 - 0.16, 0.45, 0), (0.32, 0.9, d), stone, bevel=0.01))
    parts.append(box((0, 0.78, 0), (w - 0.64, 0.24, d), stone, bevel=0.01))
    soot = mat('Soot', paint, (22, 20, 20), rough=0.9)
    parts.append(box((0, 0.33, -0.06), (w - 0.64, 0.66, d - 0.1), soot, bevel=0))
    parts.append(box((0, 0.02, 0.1), (w + 0.1, 0.04, d + 0.18), stone, bevel=0.01))
    parts.append(box((0, 0.93, 0.02), (w + 0.14, 0.06, d + 0.08), m['oak'], bevel=0.01))
    parts.append(box((0, h - 0.08, -0.04), (w - 0.08, 0.16, d - 0.08), stone, bevel=0.004))
    # Logs and flame.
    logm = mat('Log', wood, (120, 84, 56), (70, 48, 30), axis='X')
    for i, (x, y, rz) in enumerate(((-0.07, 0.08, 0.2), (0.07, 0.08, -0.2), (0, 0.15, 0))):
        o = cyl((x, y, 0.0), 0.045, 0.34, logm, axis='x')
        o.rotation_euler[2] = rz
        parts.append(o)
    # The fire has to read at thumbnail size: big, bright flames filling the mouth,
    # plus an ember glow on the hearth and the inside of the firebox.
    flame = emit('Flame', (255, 130, 40), 10.0)
    core = emit('FlameCore', (255, 226, 130), 14.0)
    for (x, y, s) in ((-0.1, 0.25, 1.0), (0.1, 0.23, 0.9), (0.0, 0.3, 1.35), (-0.04, 0.2, 0.8), (0.06, 0.28, 0.9)):
        parts.append(ball((x, y, 0.05), 0.07 * s, flame, scale=(0.75, 1.7, 0.6), segs=16))
        parts.append(ball((x, y - 0.03, 0.07), 0.04 * s, core, scale=(0.75, 1.5, 0.6), segs=12))
    parts.append(box((0, 0.045, 0.02), (w - 0.72, 0.012, d - 0.16), emit('Embers', (255, 90, 30), 4.0), bevel=0))
    # A clock and a candlestick on the mantel.
    parts.append(box((0.3, 1.0, 0.02), (0.14, 0.1, 0.06), m['walnutX'], bevel=0.02))
    parts.append(cyl((0.3, 1.0, 0.052), 0.035, 0.004, m['cream'], axis='z'))
    parts.append(cyl((-0.32, 1.02, 0.02), 0.012, 0.12, m['brass']))
    parts.append(cyl((-0.32, 1.1, 0.02), 0.01, 0.06, m['cream']))
    return parts


def sofa(p, m):
    """A deep teal velvet sofa: plinth, two seat cushions, back cushions, rolled arms."""
    w, d = 1.50, 0.78
    velvet = mat('Velvet', paint, (34, 110, 116), rough=0.75)
    velvet2 = mat('Velvet2', paint, (40, 124, 130), rough=0.7)
    parts = [box((0, 0.2, -0.02), (w, 0.24, d - 0.04), velvet, bevel=0.03),
             box((0, 0.5, -d / 2 + 0.1), (w, 0.5, 0.18), velvet, bevel=0.05, segs=4)]
    for sx in (-1, 1):
        parts.append(box((sx * (w / 2 - 0.08), 0.36, 0), (0.16, 0.36, d), velvet, bevel=0.06, segs=5))
        parts.append(box((sx * 0.3, 0.37, 0.05), (0.58, 0.12, d - 0.2), velvet2, bevel=0.05, segs=5))
        parts.append(box((sx * 0.3, 0.58, -d / 2 + 0.24), (0.56, 0.3, 0.14), velvet2, bevel=0.06, segs=5))
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(cyl((sx * (w / 2 - 0.08), 0.04, sz * (d / 2 - 0.08)), 0.02, 0.08, m['brass'], r2=0.012))
    # Two scatter cushions.
    parts.append(box((-0.5, 0.52, -0.12), (0.26, 0.24, 0.1), mat('Mustard', paint, (226, 170, 60), rough=0.8), bevel=0.06, segs=5))
    parts.append(box((0.52, 0.52, -0.12), (0.26, 0.24, 0.1), mat('Coral', paint, (230, 110, 90), rough=0.8), bevel=0.06, segs=5))
    return parts


def armchair(p, m):
    """A tan leather club armchair."""
    leather = mat('Leather', paint, (156, 88, 50), rough=0.45, coat=0.3)
    w, d = 0.72, 0.72
    parts = [box((0, 0.2, 0), (w, 0.26, d), leather, bevel=0.04),
             box((0, 0.36, 0.05), (w - 0.26, 0.1, d - 0.2), leather, bevel=0.05, segs=5),
             box((0, 0.56, -d / 2 + 0.1), (w - 0.1, 0.5, 0.18), leather, bevel=0.07, segs=5)]
    for sx in (-1, 1):
        parts.append(box((sx * (w / 2 - 0.08), 0.4, 0), (0.16, 0.34, d - 0.02), leather, bevel=0.07, segs=5))
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(cyl((sx * (w / 2 - 0.08), 0.035, sz * (d / 2 - 0.08)), 0.022, 0.07, m['walnut'], r2=0.016))
    return parts


def coffeetable(p, m):
    """A low walnut coffee table with a stack of books and a mug."""
    parts = [box((0, 0.36, 0), (0.9, 0.04, 0.5), m['walnutX'], bevel=0.012),
             box((0, 0.12, 0), (0.82, 0.025, 0.42), m['walnutX'], bevel=0.006)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(box((sx * 0.38, 0.17, sz * 0.18), (0.04, 0.34, 0.04), m['walnut'], bevel=0.006))
    for i, c in enumerate(((60, 90, 150), (200, 70, 60), (230, 200, 120))):
        parts.append(box((-0.2, 0.395 + i * 0.03, 0.02), (0.24 - i * 0.02, 0.028, 0.17), mat(f'Book{i}', paint, c, rough=0.6), bevel=0.004))
    parts.append(cyl((0.22, 0.42, 0.05), 0.04, 0.08, mat('Mug', ceramic, (240, 236, 226))))
    parts.append(tube([(0.26, 0.44, 0.05), (0.29, 0.42, 0.05), (0.26, 0.40, 0.05)], 0.008, m['cream']))
    return parts


def bookshelf(p, m):
    """A tall painted bookcase filled with books of every colour, a plant on top."""
    w, h, d = 0.62, 1.62, 0.3
    case = mat('Bookcase', paint, (58, 72, 96), rough=0.45)
    parts = [box((0, h / 2, -d / 2 + 0.01), (w, h, 0.02), case, bevel=0.003)]
    for sx in (-1, 1):
        parts.append(box((sx * (w / 2 - 0.015), h / 2, 0), (0.03, h, d), case, bevel=0.004))
    rnd = random.Random(9)
    cols = [(200, 60, 50), (60, 110, 180), (236, 196, 80), (70, 150, 110), (230, 230, 220),
            (150, 80, 150), (240, 140, 70), (40, 50, 60)]
    shelves = [0.04, 0.42, 0.8, 1.18, 1.58]
    for y in shelves:
        parts.append(box((0, y, 0), (w - 0.06, 0.03, d), case, bevel=0.003))
    for si in range(4):
        x = -w / 2 + 0.04
        y0 = shelves[si] + 0.015
        while x < w / 2 - 0.08:
            bw = rnd.uniform(0.025, 0.045)
            bh = rnd.uniform(0.2, 0.32)
            c = mat(f'BookC{rnd.randrange(len(cols))}', paint, cols[rnd.randrange(len(cols))], rough=0.55)
            parts.append(box((x + bw / 2, y0 + bh / 2, 0.02), (bw, bh, d - 0.08), c, bevel=0.003))
            x += bw + 0.004
            if rnd.random() < 0.1:
                x += 0.05
    parts.append(cyl((0.12, h + 0.05, 0), 0.05, 0.1, m['pot'], bevel=0.01))
    for k in range(6):
        a = k * 1.05
        parts.append(ball((0.12 + math.cos(a) * 0.05, h + 0.13, math.sin(a) * 0.04), 0.04, m['leaf'], scale=(1.2, 0.5, 0.6), segs=12))
    return parts


def floorlamp(p, m):
    """A brass standard lamp with a lit linen shade."""
    shade = emit('Shade', (250, 226, 180), 1.4)
    return [cyl((0, 0.015, 0), 0.14, 0.03, m['brass'], bevel=0.01),
            cyl((0, 0.7, 0), 0.012, 1.36, m['brass']),
            cyl((0, 1.36, 0), 0.19, 0.26, shade, r2=0.13, bevel=0.005)]


def painting(p, m):
    """A landscape in a gilt frame. Hung from its base."""
    w, h = 0.84, 0.56
    parts = [box((0, h / 2, 0.01), (w - 0.1, h - 0.1, 0.01), painting_mat('Painting'), bevel=0)]
    gilt = mat('Gilt', metal, (214, 170, 80), rough=0.3)
    f = 0.05
    for (x, y, bw, bh) in ((-w / 2 + f / 2, h / 2, f, h), (w / 2 - f / 2, h / 2, f, h),
                           (0, f / 2, w - f * 2, f), (0, h - f / 2, w - f * 2, f)):
        parts.append(box((x, y, 0.02), (bw, bh, 0.04), gilt, bevel=0.01))
    return parts


def plant(p, m):
    """A fiddle-leaf fig in a terracotta pot."""
    terra = mat('Terracotta', paint, (196, 104, 70), rough=0.8)
    parts = [cyl((0, 0.13, 0), 0.13, 0.26, terra, r2=0.16, bevel=0.01),
             cyl((0, 0.25, 0), 0.14, 0.01, m['soil'], bevel=0)]
    parts.append(tube([(0, 0.25, 0), (0.02, 0.6, 0.01), (-0.02, 0.95, 0)], 0.014, m['walnut']))
    rnd = random.Random(21)
    leaf = mat('Fig', paint, (64, 128, 60), rough=0.4, coat=0.3)
    for k in range(16):
        a = k * 2.4
        y = 0.45 + k * 0.035
        r = 0.1 + 0.1 * math.sin(k * 0.4 + 1)
        o = ball((math.cos(a) * r, y, math.sin(a) * r), 0.07, leaf, scale=(1.0, 0.25, 1.4), segs=14)
        o.rotation_euler = (rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), a)
        parts.append(o)
    return parts


def sidetable(p, m):
    """A round side table with a little lit lamp."""
    shade = emit('Shade2', (250, 216, 160), 1.2)
    return [cyl((0, 0.5, 0), 0.2, 0.03, m['oak'], bevel=0.008),
            cyl((0, 0.25, 0), 0.025, 0.5, m['walnut']),
            cyl((0, 0.015, 0), 0.14, 0.03, m['walnut'], bevel=0.008),
            cyl((0, 0.6, 0), 0.05, 0.16, mat('LampBase', ceramic, (60, 120, 170)), r2=0.035),
            cyl((0, 0.73, 0), 0.1, 0.12, shade, r2=0.07)]


def pouf(p, m):
    """A knitted pouf."""
    k = mat('Knit', paint, (220, 120, 90), rough=0.95)
    parts = [cyl((0, 0.18, 0), 0.24, 0.34, k, bevel=0.08)]
    for i in range(12):
        a = i * math.pi / 6
        parts.append(tube([(math.cos(a) * 0.24, 0.04, math.sin(a) * 0.24), (math.cos(a) * 0.25, 0.18, math.sin(a) * 0.25),
                           (math.cos(a) * 0.24, 0.32, math.sin(a) * 0.24)], 0.012, mat('Knit2', paint, (200, 100, 74), rough=0.95)))
    return parts


# --- Music room -----------------------------------------------------------------------

def piano(p, m):
    """An upright piano in black lacquer: keyboard, fallboard, candle brackets."""
    w, h, d = 1.36, 1.14, 0.55
    black = mat('PianoBlack', paint, (10, 10, 12), rough=0.25, coat=0.35)
    parts = [box((0, h / 2 + 0.03, -0.1), (w, h - 0.06, d - 0.2), black, bevel=0.015),
             box((0, 0.66, 0.06), (w, 0.06, d - 0.08), black, bevel=0.01)]
    for sx in (-1, 1):
        parts.append(box((sx * (w / 2 - 0.04), 0.5, 0.12), (0.08, 0.32, 0.16), black, bevel=0.012))
        parts.append(box((sx * (w / 2 - 0.04), 0.035, 0.2), (0.08, 0.07, 0.08), black, bevel=0.01))
        parts.append(cyl((sx * (w / 2 - 0.04), 0.35, 0.2), 0.03, 0.3, black))
    ivory = mat('Ivory', paint, (246, 240, 226), rough=0.25)
    nk = 26
    kw = (w - 0.2) / nk
    for i in range(nk):
        x = -w / 2 + 0.1 + kw / 2 + i * kw
        parts.append(box((x, 0.71, 0.14), (kw - 0.004, 0.025, 0.16), ivory, bevel=0.002))
        if i % 7 not in (2, 6):
            parts.append(box((x + kw / 2, 0.73, 0.1), (kw * 0.55, 0.03, 0.09), black, bevel=0.002))
    # Music desk with a sheet of music.
    parts.append(box((0, 0.9, 0.02), (0.6, 0.02, 0.1), black, bevel=0.004))
    sheet = mat('Sheet', paint, (246, 244, 236), rough=0.7)
    o = box((0, 1.0, 0.0), (0.42, 0.2, 0.004), sheet, bevel=0)
    o.rotation_euler[0] = -0.2
    parts.append(o)
    for sx in (-1, 1):
        parts.append(cyl((sx * 0.5, 0.92, 0.06), 0.025, 0.02, m['brass']))
        parts.append(cyl((sx * 0.5, 0.97, 0.06), 0.012, 0.09, m['cream']))
    return parts


def pianobench(p, m):
    black = mat('PianoBlack', paint, (10, 10, 12), rough=0.25, coat=0.35)
    parts = [box((0, 0.45, 0), (0.7, 0.05, 0.34), black, bevel=0.01),
             box((0, 0.49, 0), (0.64, 0.04, 0.3), mat('BenchPad', paint, (130, 30, 44), rough=0.8), bevel=0.015)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(box((sx * 0.3, 0.215, sz * 0.13), (0.04, 0.43, 0.04), black, bevel=0.006))
    return parts


def drums(p, m):
    """A drum kit: kick drum, snare, two toms, floor tom, hi-hat and a ride cymbal."""
    shell = mat('DrumShell', paint, (170, 30, 40), rough=0.15, coat=1.0)
    head = mat('DrumHead', paint, (240, 238, 230), rough=0.5)
    parts = []

    def drum(c, r, depth, axis='y'):
        parts.append(cyl(c, r, depth, shell, axis=axis, bevel=0.004))
        off = depth / 2 + 0.002
        if axis == 'y':
            parts.append(cyl((c[0], c[1] + off, c[2]), r * 0.98, 0.004, head, bevel=0))
            parts.append(cyl((c[0], c[1] + off - 0.004, c[2]), r + 0.006, 0.012, m['chrome'], bevel=0.002))
        else:
            parts.append(cyl((c[0], c[1], c[2] + off), r * 0.98, 0.004, head, axis='z', bevel=0))
            parts.append(cyl((c[0], c[1], c[2] + off - 0.004), r + 0.006, 0.014, m['chrome'], axis='z', bevel=0.002))
    drum((0, 0.23, 0.05), 0.23, 0.36, axis='z')             # kick, head to the front
    drum((-0.36, 0.52, 0.15), 0.14, 0.14)                   # snare
    drum((-0.12, 0.66, -0.02), 0.11, 0.12)                  # rack toms
    drum((0.14, 0.66, -0.02), 0.12, 0.13)
    drum((0.42, 0.32, 0.18), 0.17, 0.3)                     # floor tom
    brass = mat('Cymbal', metal, (214, 170, 90), rough=0.25)

    def cymbal(x, z, y, r):
        parts.append(tube([(x, 0.0, z), (x, y, z)], 0.008, m['chrome']))
        parts.append(cyl((x, y + 0.01, z), r, 0.008, brass, r2=r * 0.2))
        for k in range(3):
            a = k * 2.1
            parts.append(tube([(x, 0.25, z), (x + math.cos(a) * 0.14, 0.0, z + math.sin(a) * 0.14)], 0.006, m['chrome']))
    cymbal(-0.62, 0.1, 0.78, 0.17)                          # hi-hat
    cymbal(-0.62, 0.1, 0.74, 0.17)
    cymbal(0.5, -0.2, 0.95, 0.22)                           # ride
    parts.append(tube([(-0.36, 0.0, 0.15), (-0.36, 0.45, 0.15)], 0.008, m['chrome']))
    # Throne.
    parts.append(cyl((-0.05, 0.46, 0.55), 0.15, 0.08, m['rubber'], bevel=0.03))
    parts.append(tube([(-0.05, 0.0, 0.55), (-0.05, 0.42, 0.55)], 0.015, m['chrome']))
    return parts


def _guitar_body(parts, x, y, z, s, top, back, m):
    """A guitar standing upright, face to the viewer: two lobes and a waist."""
    parts.append(cyl((x, y + 0.16 * s, z), 0.18 * s, 0.1 * s, top, axis='z', bevel=0.01))
    parts.append(cyl((x, y + 0.38 * s, z), 0.14 * s, 0.1 * s, top, axis='z', bevel=0.01))
    parts.append(box((x, y + 0.27 * s, z), (0.2 * s, 0.14 * s, 0.1 * s), top, bevel=0.01))


def guitar(p, m):
    """An acoustic guitar on a stand: spruce top, rosewood back, sound hole, neck."""
    s = 1.0
    top = mat('Spruce', wood, (236, 204, 140), (206, 166, 104), axis='Z', coat=0.6, rough=0.3)
    parts = []
    _guitar_body(parts, 0, 0.08, 0, s, top, None, m)
    parts.append(cyl((0, 0.08 + 0.34, 0.052), 0.05, 0.004, m['rubber'], axis='z', bevel=0))
    parts.append(cyl((0, 0.08 + 0.34, 0.05), 0.058, 0.004, m['walnut'], axis='z', bevel=0))
    parts.append(box((0, 0.08 + 0.12, 0.052), (0.14, 0.02, 0.01), m['walnut'], bevel=0.003))
    parts.append(box((0, 0.08 + 0.72, 0.02), (0.05, 0.5, 0.03), m['walnut'], bevel=0.006))
    parts.append(box((0, 0.08 + 1.0, 0.02), (0.08, 0.12, 0.025), m['walnut'], bevel=0.01))
    for i in range(3):
        for sx in (-1, 1):
            parts.append(cyl((sx * 0.05, 0.08 + 0.96 + i * 0.03, 0.02), 0.008, 0.03, m['chrome'], axis='x'))
    for i in range(6):
        parts.append(box((-0.015 + i * 0.006, 0.08 + 0.62, 0.037), (0.0015, 0.8, 0.0015), m['chrome'], bevel=0))
    stand = mat('StandBlack', paint, (30, 30, 34), rough=0.4)
    parts.append(tube([(-0.15, 0.0, 0.12), (0, 0.1, 0.05), (0.15, 0.0, 0.12)], 0.01, stand))
    parts.append(tube([(0, 0.0, -0.15), (0, 0.9, -0.06)], 0.01, stand))
    return parts


def eguitar(p, m):
    """A sunburst-red electric guitar on a stand."""
    red = mat('Candy', paint, (200, 30, 50), rough=0.12, coat=1.0)
    parts = []
    parts.append(cyl((0, 0.24, 0), 0.16, 0.05, red, axis='z', bevel=0.012))
    parts.append(cyl((-0.02, 0.42, 0), 0.12, 0.05, red, axis='z', bevel=0.012))
    parts.append(box((0.08, 0.5, 0), (0.05, 0.14, 0.05), red, bevel=0.015))
    guard = mat('Guard', paint, (240, 236, 226), rough=0.3)
    parts.append(cyl((0.02, 0.3, 0.027), 0.1, 0.004, guard, axis='z', bevel=0))
    for y in (0.3, 0.38):
        parts.append(box((0, y, 0.031), (0.07, 0.02, 0.006), m['rubber'], bevel=0.003))
    parts.append(box((0, 0.2, 0.03), (0.08, 0.02, 0.008), m['chrome'], bevel=0.003))
    for i in range(3):
        parts.append(cyl((0.09, 0.14 + i * 0.04, 0.03), 0.012, 0.012, m['chrome'], axis='z'))
    parts.append(box((0, 0.84, 0.0), (0.045, 0.64, 0.025), m['oak'], bevel=0.006))
    parts.append(box((0.015, 1.2, 0.0), (0.06, 0.14, 0.02), m['oak'], bevel=0.012))
    for i in range(6):
        parts.append(box((-0.013 + i * 0.005, 0.7, 0.03), (0.0012, 0.95, 0.0012), m['chrome'], bevel=0))
    stand = mat('StandBlack', paint, (30, 30, 34), rough=0.4)
    parts.append(tube([(-0.14, 0.0, 0.1), (0, 0.1, 0.04), (0.14, 0.0, 0.1)], 0.01, stand))
    parts.append(tube([(0, 0.0, -0.14), (0, 0.95, -0.05)], 0.01, stand))
    return parts


def amp(p, m):
    """A valve combo amp: cream tolex, oxblood grille, chrome control panel."""
    tolex = mat('Tolex', paint, (226, 214, 184), rough=0.7)
    parts = [box((0, 0.25, 0), (0.56, 0.46, 0.28), tolex, bevel=0.02)]
    cloth = mat('Cloth', paint, (110, 34, 34), rough=0.95)
    parts.append(box((0, 0.2, 0.141), (0.48, 0.3, 0.006), cloth, bevel=0.01))
    parts.append(box((0, 0.42, 0.141), (0.5, 0.06, 0.006), m['chrome'], bevel=0.003))
    for i in range(6):
        parts.append(cyl((-0.2 + i * 0.07, 0.42, 0.152), 0.012, 0.014, m['rubber'], axis='z'))
    parts.append(ball((0.23, 0.42, 0.15), 0.01, emit('Jewel', (255, 60, 40), 4.0)))
    parts.append(box((0, 0.5, 0), (0.18, 0.02, 0.04), m['rubber'], bevel=0.01))
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(ball((sx * 0.24, 0.015, sz * 0.1), 0.015, m['rubber']))
    return parts


def records(p, m):
    """A teak record cabinet: sliding doors, a turntable on top with a spinning LP."""
    teak = mat('Teak', wood, (200, 140, 80), (150, 96, 50), axis='X', coat=0.4)
    w, h, d = 1.0, 0.56, 0.42
    parts = [box((0, 0.1 + (h - 0.1) / 2, 0), (w, h - 0.1, d), teak, bevel=0.01)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(cyl((sx * (w / 2 - 0.08), 0.05, sz * (d / 2 - 0.08)), 0.018, 0.1, m['walnut'], r2=0.012))
    zf = d / 2
    parts.append(box((-0.24, 0.33, zf + 0.006), (0.46, 0.36, 0.012), teak, bevel=0.005))
    # The open side shows the records, spines out.
    rnd = random.Random(4)
    cols = [(40, 40, 44), (220, 80, 60), (70, 120, 190), (236, 196, 80), (240, 236, 226), (60, 150, 110)]
    x = 0.04
    while x < w / 2 - 0.04:
        c = mat(f'Sleeve{rnd.randrange(6)}', paint, cols[rnd.randrange(6)], rough=0.6)
        parts.append(box((x, 0.33, zf - 0.02), (0.012, 0.32, 0.3), c, bevel=0.002))
        x += 0.016
    # Turntable.
    parts.append(box((0.05, h + 0.03, 0), (0.44, 0.06, 0.34), m['walnutX'], bevel=0.012))
    parts.append(cyl((0.0, h + 0.065, 0), 0.14, 0.01, m['steel'], bevel=0.002))
    parts.append(cyl((0.0, h + 0.072, 0), 0.13, 0.004, mat('Vinyl', paint, (16, 16, 18), rough=0.2, coat=0.8), bevel=0))
    parts.append(cyl((0.0, h + 0.075, 0), 0.04, 0.002, mat('Label', paint, (230, 90, 60)), bevel=0))
    parts.append(tube([(0.2, h + 0.08, -0.12), (0.18, h + 0.09, 0.02), (0.1, h + 0.08, 0.06)], 0.006, m['chrome']))
    return parts


def speakers(p, m):
    """A pair of floor-standing speakers either side of the record cabinet."""
    gap = p.get('gap', 1.44)
    wal = mat('SpeakerWood', wood, (120, 80, 50), (80, 50, 30), axis='Z', coat=0.3)
    parts = []
    for sx in (-1, 1):
        x = sx * gap / 2
        parts.append(box((x, 0.45, 0), (0.28, 0.9, 0.3), wal, bevel=0.01))
        parts.append(box((x, 0.45, 0.151), (0.24, 0.86, 0.004), mat('SpkCloth', paint, (46, 48, 52), rough=0.95), bevel=0.004))
        for (y, r) in ((0.3, 0.09), (0.6, 0.06), (0.78, 0.03)):
            parts.append(cyl((x, y, 0.156), r, 0.008, m['rubber'], axis='z', bevel=0.003))
            parts.append(cyl((x, y, 0.16), r * 0.35, 0.006, m['chrome'], axis='z', bevel=0.002))
    return parts


def panels(p, m):
    """Acoustic panels on the wall: five fabric slabs in a colour run. Hung from base."""
    parts = []
    cols = [(230, 120, 70), (236, 180, 70), (90, 160, 130), (70, 120, 180), (130, 90, 160)]
    for i, c in enumerate(cols):
        x = -0.56 + i * 0.28
        y = 0.25 + (0.08 if i % 2 else 0)
        parts.append(box((x, y, 0.03), (0.24, 0.5, 0.06), mat(f'Felt{i}', paint, c, rough=0.95), bevel=0.02, segs=4))
    return parts


# --- Room finishes -------------------------------------------------------------------
#
# What makes four rooms read as four different ROOMS before anything is bought: brick
# and concrete in the woodshop, striped paper over boards in the living room, navy
# walls over wood panelling in the music room. `axis` names the Blender axis a wall's
# inner face runs along ('X' for the back wall, 'Y' for the left wall), so a 2D
# pattern lands on the face that is seen; 'F' is a floor (X along, Y across).

def _uv(nt, axis):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    u, v = {'X': ('X', 'Z'), 'Y': ('Y', 'Z'), 'F': ('X', 'Y')}[axis]
    nt.links.new(sep.outputs[u], comb.inputs['X'])
    nt.links.new(sep.outputs[v], comb.inputs['Y'])
    return comb.outputs['Vector']


def _bricklike(name, axis, c1, c2, mortar, width, height, mortar_size, rough, grain=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    uv = _uv(nt, axis)
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.offset = 0.5 if not grain else 0.37
    br.inputs['Color1'].default_value = (*lin(c1), 1)
    br.inputs['Color2'].default_value = (*lin(c2), 1)
    br.inputs['Mortar'].default_value = (*lin(mortar), 1)
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = mortar_size
    br.inputs['Brick Width'].default_value = width
    br.inputs['Row Height'].default_value = height
    br.inputs['Bias'].default_value = 0.0
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 60.0 if not grain else 14.0
    nz.inputs['Detail'].default_value = 6.0
    if grain:
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (0.1, 3.0, 1.0)
        nt.links.new(uv, mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    else:
        nt.links.new(uv, nz.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.25
    nt.links.new(uv, br.inputs['Vector'])
    nt.links.new(br.outputs['Color'], mix.inputs['A'])
    nt.links.new(nz.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    return m


def finish_mat(kind, axis, colour):
    """The material for a wall's inner face or a floor's top, by finish name."""
    name = f'Finish_{kind}_{axis}_{"_".join(str(c) for c in colour)}'
    if name in _mats:
        return _mats[name]
    if kind == 'brick':
        m = _bricklike(name, axis, (176, 84, 62), (150, 70, 54), (206, 196, 182), 0.24, 0.075, 0.012, 0.85)
    elif kind == 'boards':
        m = _bricklike(name, axis, (200, 152, 100), (176, 128, 80), (70, 46, 28), 1.1, 0.115, 0.004, 0.5, grain=True)
    elif kind == 'darkboards':
        m = _bricklike(name, axis, (132, 88, 56), (110, 70, 44), (40, 26, 18), 1.1, 0.115, 0.004, 0.45, grain=True)
    elif kind == 'concrete':
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = _bsdf(m)
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 3.0
        nz.inputs['Detail'].default_value = 8.0
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (*lin((128, 128, 124)), 1)
        ramp.color_ramp.elements[1].color = (*lin((170, 168, 162)), 1)
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.7
    elif kind == 'stripes':
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = _bsdf(m)
        uv = _uv(nt, axis)
        wv = nt.nodes.new('ShaderNodeTexWave')
        wv.wave_type = 'BANDS'
        wv.bands_direction = 'X'
        wv.inputs['Scale'].default_value = 1.6
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['A'].default_value = (*lin(colour), 1)
        mix.inputs['B'].default_value = (*lin(tuple(int(c * 0.86) for c in colour)), 1)
        gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'
        gt.inputs[1].default_value = 0.5
        nt.links.new(uv, wv.inputs['Vector'])
        nt.links.new(wv.outputs['Fac'], gt.inputs[0])
        nt.links.new(gt.outputs['Value'], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.8
    else:
        m = paint(name, colour, rough=0.8)
    _mats[name] = m
    return m


BUILDERS_MORE = {
    'workbench': workbench, 'pegboard': pegboard, 'toolchest': toolchest,
    'lumberrack': lumberrack, 'sawhorses': sawhorses, 'stool': stool, 'shopvac': shopvac,
    'offcuts': offcuts, 'radio': radio,
    'rug': rug, 'fireplace': fireplace, 'sofa': sofa, 'armchair': armchair,
    'coffeetable': coffeetable, 'bookshelf': bookshelf, 'floorlamp': floorlamp,
    'painting': painting, 'plant': plant, 'sidetable': sidetable, 'pouf': pouf,
    'piano': piano, 'pianobench': pianobench, 'drums': drums, 'guitar': guitar,
    'eguitar': eguitar, 'amp': amp, 'records': records, 'speakers': speakers, 'panels': panels,
}


BUILDERS = {
    'floor': floor, 'counter': counter, 'sink': sink, 'oven': oven, 'fridge': fridge,
    'cabinet': cabinet, 'window': window, 'chair': chair, 'flower': flower,
}


BUILDERS.update(BUILDERS_MORE)


def build(obj, params):
    """Build one object; returns its mesh/curve objects."""
    before = set(bpy.data.objects)
    BUILDERS[obj](params, M())
    return [o for o in bpy.data.objects if o not in before and o.type in ('MESH', 'CURVE')]
