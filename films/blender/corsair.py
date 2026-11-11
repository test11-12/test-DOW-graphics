# The Saronic Corsair for film 3 ("Three Corsairs") -> assets/corsair/corsair.glb (+ assets/corsair/tex/*.webp)
#   node tools/blender.mjs corsair [geo|full] [preview-prefix]
# geo: geometry only with flat materials (fast check); full: scanned source materials, bakes, weathering, export.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, HERE)
import bpy
import numpy as np
from mathutils import Vector

import dowlib as d
import boatkit as k
import corsair_geo as geo

ARGS = d.args()
STAGE = ARGS[0] if ARGS else 'full'
PREVIEW = ARGS[1] if len(ARGS) > 1 else None

FLAT = {  # kind: (base colour, roughness, metallic) for the geometry check
    'hull': ((0.30, 0.32, 0.34), 0.4, 0), 'deck': ((0.36, 0.38, 0.40), 0.5, 0), 'grip': ((0.30, 0.32, 0.34), 0.85, 0),
    'box': ((0.30, 0.32, 0.34), 0.45, 0), 'louvre': ((0.18, 0.19, 0.2), 0.6, 0), 'boxlid': ((0.40, 0.42, 0.44), 0.5, 0), 'dark': ((0.02, 0.02, 0.02), 0.6, 0),
    'mast': ((0.30, 0.32, 0.34), 0.4, 0), 'steel': ((0.6, 0.6, 0.6), 0.3, 1), 'alu': ((0.45, 0.46, 0.47), 0.5, 1),
    'rubber': ((0.02, 0.02, 0.022), 0.7, 0), 'black': ((0.015, 0.015, 0.016), 0.45, 0), 'white': ((0.75, 0.76, 0.76), 0.35, 0),
    'glass': ((0.01, 0.012, 0.016), 0.06, 0), 'navred': ((0.5, 0.02, 0.02), 0.3, 0),
}


def flat_mat(kind):
    name = 'flat_' + kind
    m = bpy.data.materials.get(name)
    if m:
        return m
    m, bsdf, nodes, links = d.new_material(name)
    c, r, mt = FLAT[kind]
    bsdf.inputs['Base Color'].default_value = (*c, 1)
    bsdf.inputs['Roughness'].default_value = r
    bsdf.inputs['Metallic'].default_value = mt
    return m


def check_normals(ob, axis_z=0.15):
    """Fraction of faces whose normal points away from the boat's long axis (a winding check)."""
    me = ob.data
    good = tot = 0.0
    for p in me.polygons:
        c = p.center
        v = Vector((0.0, c.y, c.z - axis_z))
        if v.length < 0.05:
            continue
        s = p.normal.dot(v.normalized())
        if abs(s) > 0.2:
            tot += p.area
            good += p.area if s > 0 else 0.0
    return good / max(tot, 1e-9)


d.reset()
d.ensure_world()
groups, info = geo.build()
d.log('bt at x:', {x: round(info.bt_at(x), 3) for x in (-0.6, 0.0, 1.15, 2.0, 2.3, 2.84, 3.02, 3.22, 3.4)})
d.log('top z at x:', {x: round(info.top_z(x), 3) for x in (-1.5, -0.63, 0.0, 1.15, 2.19, 2.3, 3.0, 3.3)})
for name, objs in groups.items():
    for o in objs:
        if name in ('hull', 'deck') and len(o.data.polygons) > 50:
            d.log('  ', name, o.name, 'outward', round(check_normals(o), 2))

if STAGE == 'geo':
    tris = 0
    joined = {}
    for name, objs in groups.items():
        for o in objs:
            d.set_material(o, flat_mat(o.get('kind', name)))
        ob = k.join(objs, name)
        if name in ('hull', 'deck'):
            k.weld(ob)
        k.finish(ob, 50.0)
        tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
        joined[name] = ob
        d.log(d.stats(ob))
    d.log('triangles', tris)
    d.export_glb(d.out_path('corsair', 'corsair.glb'), list(joined.values()), tangents=False)
    if PREVIEW:
        views = {'side': ((0.5, -14, 1.2), (0, 0, 0.6), 85), 'bowq': ((9, -6.5, 3.2), (0.3, 0, 0.5), 60), 'sternq': ((-9, 7, 3.0), (-0.3, 0, 0.5), 60),
                 'top': ((0.2, -0.3, 16), (0, 0, 0), 70), 'bowcam': ((1.15, 0, 1.23), (8, 0, 0.9), 20), 'mast': ((1.6, -2.6, 2.3), (-1.1, 0, 1.6), 50)}
        for nm, (cam, tgt, lens) in views.items():
            d.preview(f'{PREVIEW}_{nm}.png', target=tgt, cam=cam, lens=lens, samples=12, sun_el=35, sun_az=140)
    sys.exit(0)

# ================================================================== full build: materials, bakes, weathering
import corsair_tex as tx

SIZE = {'hull': 2048, 'deck': 4096, 'gear': 2048}
for a in ARGS[2:]:
    if '=' in a:
        nm, v = a.split('=')
        SIZE[nm] = int(v)


def bake_atlas(name, objs):
    size = SIZE[name]
    k.smart_uv_missing(objs)
    for o in objs:
        d.set_material(o, tx.src_mat(o['kind']))
    ob = k.join(objs, name)
    if name in ('hull', 'deck'):
        k.weld(ob)
    k.finish(ob, 50.0)
    mpu = k.atlas_pack(ob, margin=0.003)
    d.log(name, d.stats(ob), f'texel {mpu / size * 1000:.2f} mm at {size}px')
    return ob, mpu


d.ensure_world((1, 1, 1))
bpy.context.scene.world.light_settings.distance = 1.2
atl = {name: bake_atlas(name, groups[name]) for name in ('hull', 'deck', 'gear')}
out_objs = []
for name, spec in (('glass', dict(base_color=(0.012, 0.014, 0.018, 1), roughness=0.06, metallic=0.6)), ('navred', dict(base_color=(0.45, 0.02, 0.015, 1), roughness=0.25))):
    m = d.gltf_material(name, **spec)
    if name == 'navred':
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.05, 0.03, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.6
    ob = k.join(groups[name], name)
    k.finish(ob, 50.0)
    d.set_material(ob, m)
    out_objs.append(ob)

bdir = d.bake_dir('corsair')
for name, (ob, mpu) in atl.items():
    size = SIZE[name]
    maps = d.bake_pbr([ob], size, name, bdir, ao_samples=32, ao_size=1024, normal=size <= 2048)
    if 'normal' not in maps:    # paint has no fine normal detail of its own (the non-skid grain is added in the shader)
        maps['normal'] = d.bake([ob], 'NORMAL', d.new_image(name + '_normal', 2048, non_color=True, color=(0.5, 0.5, 1.0, 1.0)), samples=1)
    msize = min(size, 2048)
    pos, nor, idi = k.float_image(name + '_pos', msize), k.float_image(name + '_gn', msize), d.new_image(name + '_id', msize, non_color=True)
    k.bake_position([ob], pos)
    k.bake_gnormal([ob], nor)
    k.bake_id([ob], idi, {s.material.name: tx.IDCOL.get(s.material.name[4:], (0, 0, 0)) for s in ob.material_slots})

    def up(a):          # 2K maps under a 4K atlas: smooth doubling, so mask edges do not show 2-texel steps
        if a.shape[0] == size:
            return a
        o = np.empty((size, size, a.shape[2]), np.float32)
        ay, ax = np.roll(a, -1, 0), np.roll(a, -1, 1)
        o[0::2, 0::2], o[1::2, 0::2], o[0::2, 1::2] = a, (a + ay) * 0.5, (a + ax) * 0.5
        o[1::2, 1::2] = (a + ay + ax + np.roll(ay, -1, 1)) * 0.25
        return o
    P, N, idm = up(d.pixels(pos)[..., :3].copy()), up(d.pixels(nor)[..., :3].copy()), up(d.pixels(idi)[..., :3].copy())
    orm = d.pixels(maps['orm'])
    ao, rough, metal = orm[..., 0].copy(), orm[..., 1].copy(), orm[..., 2].copy()
    base = k.srgb_to_lin(d.pixels(maps['base'])[..., :3])
    paint = (idm[..., 0:1] > 0.25) | (idm[..., 2:3] > 0.5)
    b2, r2 = base.copy(), rough.copy()
    for r0 in range(0, size, 512):          # in bands of rows, to keep the peak memory small
        sl = slice(r0, r0 + 512)
        tx.WEATHER[name](P[sl], N[sl], ao[sl], idm[sl], b2[sl], r2[sl])
    base = np.where(paint, b2, base)
    rough = np.where(paint[..., 0], r2, rough)
    # faces that look down see the sea, not the sky: less of the probe's light reaches them
    ao *= 1 - (0.35 if name == 'hull' else 0.45) * k.sstep(-0.15, -0.85, N[..., 2])
    del P, N, idm, b2, r2
    arr = np.ones((size, size, 4), np.float32)
    arr[..., :3] = k.lin_to_srgb(base)
    bimg = d.new_image(name + '_basef', size)
    d.set_pixels(bimg, arr)
    arr2 = np.ones((size, size, 4), np.float32)
    arr2[..., 0], arr2[..., 1], arr2[..., 2] = ao, np.clip(rough, 0.04, 1), metal
    oimg = d.new_image(name + '_ormf', size, non_color=True)
    d.set_pixels(oimg, arr2)
    d.save_png(bimg, os.path.join(bdir, name + '_basef.png'))
    d.save_png(oimg, os.path.join(bdir, name + '_ormf.png'))
    # final materials: the atlas' texture set, shared by the materials the engine addresses by name
    finals, slot_final = {}, []
    for s in ob.material_slots:
        fn = tx.FINAL.get((name, s.material.name[4:]), tx.FINAL[(name, None)])
        if fn not in finals:
            finals[fn] = d.gltf_material(fn, base=bimg, orm=oimg, normal=maps['normal'])
            finals[fn]['m_per_uv'] = mpu
        slot_final.append(finals[fn])
    for s, fm in zip(ob.material_slots, slot_final):
        s.material = fm
    out_objs.append(ob)
    for im in (pos, nor, idi):
        bpy.data.images.remove(im)

tx.grip_detail(d.out_path('corsair', 'tex', 'grip.webp'))
d.export_glb(d.out_path('corsair', 'corsair.glb'), out_objs, tangents=False)
if PREVIEW:
    bpy.context.scene.view_settings.exposure = -1.6
    views = {'side': ((1.0, -30, 1.3), (0, 0, 0.7), 135), 'bowq': ((10, -7, 3.4), (0.2, 0, 0.6), 70), 'sternq': ((-10, 8, 3.2), (-0.3, 0, 0.6), 70)}
    for nm, (cam, tgt, lens) in views.items():
        d.preview(f'{PREVIEW}_{nm}.png', target=tgt, cam=cam, lens=lens, samples=16, sun_el=35, sun_az=140)
