# The Saronic Corsair for film 3 ("Three Corsairs") -> assets/corsair/corsair.glb (+ assets/corsair/tex/*.webp)
#   node tools/blender.mjs corsair [geo|full] [preview-prefix]
# geo: geometry only with flat materials (fast check; exports to the bake cache, never over the shipped GLB);
# full: scanned source materials, bakes, weathering, export; retex: weathering and export from the cached bakes.
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
    'railpaint': ((0.21, 0.23, 0.26), 0.3, 0),
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


if STAGE != 'retex':
    d.reset()
    d.ensure_world()
    groups, info = geo.build()
    d.log('bt at x:', {x: round(info.bt_at(x), 3) for x in (-0.6, 0.0, 1.15, 2.0, 2.3, 2.84, 3.02, 3.22, 3.4)})
    d.log('top z at x:', {x: round(info.top_z(x), 3) for x in (-1.5, -0.63, 0.0, 1.15, 2.19, 2.3, 3.0, 3.3)})

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
    # a scratch file: the shipped assets/corsair/corsair.glb is written only by full and retex
    d.export_glb(os.path.join(d.bake_dir('corsair'), 'corsair_geo.glb'), list(joined.values()), tangents=False)
    if PREVIEW:
        views = {'side': ((0.5, -14, 1.2), (0, 0, 0.6), 85), 'bowq': ((9, -6.5, 3.2), (0.3, 0, 0.5), 60), 'sternq': ((-9, 7, 3.0), (-0.3, 0, 0.5), 60),
                 'top': ((0.2, -0.3, 16), (0, 0, 0), 70), 'bowcam': ((1.15, 0, 1.23), (8, 0, 0.9), 20), 'mast': ((1.6, -2.6, 2.3), (-1.1, 0, 1.6), 50),
                 'vent': ((-2.05, 1.75, 0.80), (-2.72, 0.74, 0.58), 50), 'cable': ((1.9, 3.0, 1.5), (0.9, 1.0, 0.65), 32)}
        views = {k_: v for k_, v in views.items() if not ARGS[2:] or k_ in ARGS[2:]}
        for nm, (cam, tgt, lens) in views.items():
            d.preview(f'{PREVIEW}_{nm}.png', target=tgt, cam=cam, lens=lens, samples=12, sun_el=35, sun_az=140)
    sys.exit(0)

# ================================================================== full build: materials, bakes, weathering
# full: bake everything, weather, export, and keep the bakes (cache) and the scene (.blend) for retex
# retex: reopen that scene and redo only the numpy weathering and the export (a few minutes instead of fifteen)
import corsair_tex as tx

SIZE = {'hull': 2048, 'deck': 4096, 'gear': 2048}
MASK = {'hull': 1024, 'deck': 2048}          # shader-layer masks (R water film, G droplets, B salt)
MASK_GLOW = 0.001   # the masks ride in the emissive slot; a generic glTF viewer shows them at this (invisible) strength
for a in ARGS[2:]:
    if '=' in a:
        nm, v = a.split('=')
        SIZE[nm] = int(v)
bdir = d.bake_dir('corsair')
BLEND = os.path.join(bdir, 'corsair_final.blend')


def up2(a, size):
    """2K maps under a 4K atlas: smooth doubling, so mask edges do not show 2-texel steps."""
    if a.shape[0] == size:
        return a
    o = np.empty((size, size, a.shape[2]), np.float32)
    ay, ax = np.roll(a, -1, 0), np.roll(a, -1, 1)
    o[0::2, 0::2], o[1::2, 0::2], o[0::2, 1::2] = a, (a + ay) * 0.5, (a + ax) * 0.5
    o[1::2, 1::2] = (a + ay + ax + np.roll(ay, -1, 1)) * 0.25
    return o


def down(a, size):
    while a.shape[0] > size:
        a = 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])
    return a


def weather(name):
    """Final base colour, ORM and mask arrays of an atlas from its cached bakes."""
    size = SIZE[name]
    c = np.load(os.path.join(bdir, f'cache_{name}.npz'))
    P, N, idm = (up2(c[k_].astype(np.float32), size) for k_ in ('P', 'N', 'idm'))
    ao, rough, metal = (c[k_].astype(np.float32) for k_ in ('ao', 'rough', 'metal'))
    base = k.srgb_to_lin(c['base'].astype(np.float32))
    paint = (idm[..., 0:1] > 0.25) | ((idm[..., 2:3] > 0.5) & (name == 'gear'))
    b2, r2 = base.copy(), rough.copy()
    m2 = np.zeros((size, size, 3), np.float32)
    for r0 in range(0, size, 512):          # in bands of rows, to keep the peak memory small
        sl = slice(r0, r0 + 512)
        tx.WEATHER[name](P[sl], N[sl], ao[sl], idm[sl], b2[sl], r2[sl], m2[sl])
    base = np.where(paint, b2, base)
    rough = np.where(paint[..., 0], r2, rough)
    # faces that look down see the sea, not the sky: less of the probe's light reaches them
    ao = ao * (1 - (0.35 if name == 'hull' else 0.45) * k.sstep(-0.15, -0.85, N[..., 2]))
    if name == 'deck':                      # vents: the blades keep their paint; the plenum and the gaps behind them are a cavity
        vent = idm[..., 2] > 0.5
        blade = vent & (idm[..., 1] > 0.25)
        ao *= 1 - 0.6 * (vent & ~blade)
        ao[blade] = np.maximum(ao[blade], 0.55)     # the blade noses stand at the mouth of the pocket
    arr = np.ones((size, size, 4), np.float32)
    arr[..., :3] = k.lin_to_srgb(base)
    orm = np.ones((size, size, 4), np.float32)
    orm[..., 0], orm[..., 1], orm[..., 2] = ao, np.clip(rough, 0.04, 1), metal
    mk = None
    if name in MASK:
        mk = np.ones((MASK[name], MASK[name], 4), np.float32)
        mk[..., :3] = down(m2, MASK[name])
    return arr, orm, mk


def store(name, arr, orm, mk):
    for suffix, a, nc in (('basef', arr, False), ('ormf', orm, True), ('mask', mk, True)):
        if a is None:
            continue
        img = bpy.data.images.get(f'{name}_{suffix}') or d.new_image(f'{name}_{suffix}', a.shape[0], non_color=nc)
        d.set_pixels(img, a)
        d.save_png(img, os.path.join(bdir, f'{name}_{suffix}.png'))


def textures():
    tx.grip_detail(d.out_path('corsair', 'tex', 'grip.webp'))
    tx.drops_detail(d.out_path('corsair', 'tex', 'drops.webp'))


if STAGE == 'retex':
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    for m in bpy.data.materials:
        b = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
        if b and b.inputs['Emission Color'].is_linked:
            b.inputs['Emission Strength'].default_value = MASK_GLOW
    for name in SIZE:
        store(name, *weather(name))
        d.log('retex', name)
    textures()
    out_objs = [o for o in bpy.data.objects if o.get('export')]
    d.export_glb(d.out_path('corsair', 'corsair.glb'), out_objs, tangents=False)
    sys.exit(0)


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

for name, (ob, mpu) in atl.items():
    size = SIZE[name]
    maps = d.bake_pbr([ob], size, name, bdir, ao_samples=32, ao_size=1024, normal=size <= 2048)
    if 'normal' not in maps:    # paint has no fine normal detail of its own (the non-skid grain is added in the shader)
        maps['normal'] = d.bake([ob], 'NORMAL', d.new_image(name + '_normal', 2048, non_color=True, color=(0.5, 0.5, 1.0, 1.0)), samples=1)
        d.save_png(maps['normal'], os.path.join(bdir, name + '_normal.png'))
    msize = min(size, 2048)
    pos, nor, idi = k.float_image(name + '_pos', msize), k.float_image(name + '_gn', msize), d.new_image(name + '_id', msize, non_color=True)
    k.bake_position([ob], pos)
    k.bake_gnormal([ob], nor)
    k.bake_id([ob], idi, {s.material.name: tx.IDCOL.get(s.material.name[4:], (0, 0, 0)) for s in ob.material_slots})
    orm = d.pixels(maps['orm'])
    np.savez(os.path.join(bdir, f'cache_{name}.npz'), P=d.pixels(pos)[..., :3].astype(np.float16), N=d.pixels(nor)[..., :3].astype(np.float16),
             idm=d.pixels(idi)[..., :3].astype(np.float16), ao=orm[..., 0].astype(np.float16), rough=orm[..., 1].astype(np.float16),
             metal=orm[..., 2].astype(np.float16), base=d.pixels(maps['base'])[..., :3].astype(np.float16))
    for im in (pos, nor, idi):
        bpy.data.images.remove(im)
    store(name, *weather(name))
    bimg, oimg, mimg = (bpy.data.images.get(f'{name}_{s_}') for s_ in ('basef', 'ormf', 'mask'))
    # final materials: the atlas' texture set, shared by the materials the engine addresses by name
    finals, slot_final = {}, []
    for s in ob.material_slots:
        fn = tx.FINAL.get((name, s.material.name[4:]), tx.FINAL[(name, None)])
        if fn not in finals:
            finals[fn] = d.gltf_material(fn, base=bimg, orm=oimg, normal=maps['normal'], emissive=mimg, emissive_strength=MASK_GLOW)
            finals[fn]['m_per_uv'] = mpu
        slot_final.append(finals[fn])
    for s, fm in zip(ob.material_slots, slot_final):
        s.material = fm
    out_objs.append(ob)

textures()
for o in out_objs:
    o['export'] = True
d.export_glb(d.out_path('corsair', 'corsair.glb'), out_objs, tangents=False)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
