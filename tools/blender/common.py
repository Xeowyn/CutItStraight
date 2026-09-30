"""Shared Blender-side setup for the offline sprite renders.

Runs INSIDE Blender (bpy), launched by tools/gen_chest.py and tools/gen_kitchen.py.
One lighting rig and one colour pipeline for every sprite in the game, because the
kitchen objects, the room and the chest are composited onto one screen and must
read as lit by the same light.
"""
import math
import bpy
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_render(res_x, res_y, samples=96):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = res_x
    sc.render.resolution_y = res_y
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    # Standard, not Filmic/AgX: the pack's own sprites are bright pastel renders and
    # AgX flattens exactly those colours toward grey.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    return sc


def world(strength=0.55, colour=(0.82, 0.86, 0.92)):
    w = bpy.data.worlds.new('World')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*colour, 1)
    bg.inputs[1].default_value = strength


def area(name, loc, target, energy, size, colour=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size
    d.color = colour
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


def sun(name, direction, energy, angle_deg=8, colour=(1, 0.97, 0.92)):
    d = bpy.data.lights.new(name, 'SUN')
    d.energy = energy
    d.angle = math.radians(angle_deg)
    d.color = colour
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    return o


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def ortho_camera(azimuth_deg, elevation_deg, target, ortho_scale, dist=30):
    """Azimuth measured from the -Y axis (the front) toward +X; elevation above ground."""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    d = bpy.data.cameras.new('Cam')
    d.type = 'ORTHO'
    d.ortho_scale = ortho_scale
    d.clip_start = 0.1
    d.clip_end = 200
    o = bpy.data.objects.new('Cam', d)
    bpy.context.scene.collection.objects.link(o)
    t = Vector(target)
    o.location = t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    look_at(o, t)
    bpy.context.scene.camera = o
    return o


def shadow_catcher(size=40, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    p = bpy.context.active_object
    p.name = 'ShadowCatcher'
    p.is_shadow_catcher = True
    return p


def principled(name, colour, rough=0.5, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m


def project(cam, co):
    """World point -> pixel (x right, y DOWN) in the rendered image."""
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    v = world_to_camera_view(sc, cam, Vector(co))
    return (v.x * sc.render.resolution_x, (1 - v.y) * sc.render.resolution_y)


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
