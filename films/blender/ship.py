# The merchant ship of film 3 ("Three Corsairs") -> assets/corsair/ship.glb
#   node tools/blender.mjs ship [preview-prefix]
# A generic 250 m crude tanker in ballast, seen hull-down at kilometres through haze: the silhouette matters
# (raked stem and forecastle, long deck with pipe rack and manifold cranes, accommodation block and funnel
# aft), with a two-tone hull (boot-topping showing because she rides light) and rust runs. No name, flag,
# funnel mark or other identity. Origin amidships on the waterline, bow along +X.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, HERE)
import bpy
import numpy as np

import dowlib as d
import boatkit as k
from boatkit import clamp, smooth

ARGS = d.args()
PREVIEW = ARGS[0] if ARGS else None
SIZE = 2048
LOA, HB, DECK, KEEL = 250.0, 21.5, 12.5, -7.5       # length, half-beam, deck and keel heights (ballast draught)
XB = LOA / 2


def b_deck(x):
    df, da = XB - x, x + XB
    b = HB
    if df < 34:
        b *= (1 - (1 - df / 34) ** 2.4) ** 0.62
    if da < 26:
        b *= 0.74 + 0.26 * (1 - (1 - da / 26) ** 2)
    return b


def b_wl(x):
    df, da = XB - x, x + XB
    b = HB
    if df < 52:
        b *= (1 - (1 - df / 52) ** 1.9) ** 0.8
    if da < 40:
        b *= max(0.0, 1 - (1 - da / 40) ** 2.6) ** 0.9 * 0.96 + 0.04 * da / 40
    return b


def z_keel(x):
    da, df = x + XB, XB - x
    z = KEEL
    if da < 30:
        z += (2.0 - KEEL) * (1 - da / 30) ** 2.2          # the run rises to the counter
    if df < 5:
        z += (DECK + 3.2 - KEEL) * (1 - df / 5) ** 1.3    # stem
    return z


def z_deck(x):
    return DECK + 3.2 * smooth(XB - 34, XB - 30, x) + 2.6 * smooth(-XB + 34, -XB + 30, x)   # forecastle, poop


def section(x):
    """Port half-section, keel to deck edge: flat of bottom, bilge radius, wall side with flare at the ends."""
    zk, zd, bw, bd = z_keel(x), z_deck(x), b_wl(x), b_deck(x)
    bw = min(bw, bd)
    r = min(2.6, bw * 0.45, max(0.0, (zd - zk) * 0.3))
    pts = [(0.0, zk), (max(bw - r, 0.0) * 0.5, zk), (max(bw - r, 0.0), zk)]
    for i in range(1, 6):
        a = math.radians(-90 + 90 * i / 5)
        pts.append((bw - r + r * math.cos(a), zk + r + r * math.sin(a)))
    z0 = zk + r
    for i in range(1, 9):
        u = i / 8
        z = z0 + (zd - z0) * u
        f = smooth(0.0, 1.0, clamp((z - 0.0) / max(zd - 0.0, 1e-3))) if z > 0 else 0.0
        pts.append((bw + (bd - bw) * f, z))
    return pts


def hull():
    xs = sorted(set([XB - LOA * (i / 150) for i in range(151)] + [XB - 34, XB - 30, -XB + 34, -XB + 30] + [XB - 5 * (i / 10) ** 2 for i in range(10)]), reverse=True)
    P = np.array([[(x, y, z) for y, z in section(x)] for x in xs])
    c = np.array([-XB, 0.0, 6.0])
    P[-1] = c + (P[-1] - c) * 0.985
    cuts = [int(np.argmin(np.abs(np.array(xs) - x))) for x in (60, 0, -60)]
    port = k.grid('hull_p', P, flip=True, kind='hull', atlas='ship', cuts=cuts)
    objs = [port, k.mirrored(port)]
    # deck (flat, with sheer steps) and transom
    D = np.array([[(x, section(x)[-1][0] * c, z_deck(x)) for c in (1, 0.5, 0, -0.5, -1)] for x in xs])
    objs.append(k.grid('deck', D, flip=True, kind='deck', atlas='ship', cuts=cuts))
    ring = [tuple(p) for p in P[-1]] + [(p[0], -p[1], p[2]) for p in P[-1][::-1]]
    tr = k.new_obj('transom', ring, [list(range(len(ring)))], [(p[1], p[2]) for p in ring], 'hull', 'ship')
    if tr.data.polygons[0].normal.x > 0:
        tr.data.flip_normals()
    objs.append(tr)
    return objs


def bx(name, size, loc, kind, bevel=0.0):
    return k.box(name, size, loc, bevel=bevel, seg=1, kind=kind, atlas='ship')


def outfit():
    o = []
    zd = DECK
    # bulwark at the forecastle, breakwater, foremast and windlasses
    zf = z_deck(XB - 10)
    o.append(k.tube('foremast', [(XB - 16, 0, zf), (XB - 16, 0, zf + 15)], 0.45, n=8, taper=0.25, kind='white', atlas='ship'))
    o.append(bx('foremast_yard', (0.3, 7, 0.3), (XB - 16, 0, zf + 11), 'white'))
    for s in (1, -1):
        o.append(bx(f'windlass_{s}', (3.2, 2.6, 1.8), (XB - 21, 4.5 * s, zf + 0.9), 'grey', 0.15))
        o.append(k.tube(f'bitt_{s}', [(XB - 11, 5.5 * s, zf), (XB - 11, 5.5 * s, zf + 1.1)], 0.35, n=8, kind='grey', atlas='ship'))
    o.append(bx('breakwater', (0.3, 30, 1.6), (XB - 35.5, 0, zd + 0.8), 'grey'))
    # cargo deck: centre pipe rack on stools, catwalk, deck transverses, tank hatches and vents
    x0, x1 = -XB + 46, XB - 40
    for i, y in enumerate((-2.4, -1.2, 0.0, 1.2, 2.4)):
        o.append(k.tube(f'pipe_{i}', [(x0, y, zd + 1.5), (x1, y, zd + 1.5)], 0.32 if i != 2 else 0.42, n=6, kind='pipe', atlas='ship'))
    o.append(bx('catwalk', (x1 - x0, 1.3, 0.12), ((x0 + x1) / 2, 4.2, zd + 2.6), 'grey'))
    n = 26
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        o.append(bx(f'stool_{i}', (0.35, 6.4, 1.2), (x, 0, zd + 0.6), 'grey'))
        o.append(bx(f'cw_post_{i}', (0.15, 0.15, 2.6), (x, 4.2, zd + 1.3), 'grey'))
        if i % 2 == 0:
            o.append(bx(f'trans_{i}', (0.5, 2 * b_deck(x) - 3.0, 0.45), (x + 3.3, 0, zd + 0.22), 'deck'))
        if i % 3 == 1:
            for s in (1, -1):
                o.append(k.xform(k.lathe(f'hatch_{i}_{s}', [(1.4, 0.0), (1.4, 0.9), (1.2, 1.05), (0.0, 1.1)], n=10, kind='grey', atlas='ship'), (x, 9.5 * s, zd)))
                o.append(k.tube(f'vent_{i}_{s}', [(x + 4, 13.5 * s, zd), (x + 4, 13.5 * s, zd + 2.4)], 0.22, n=6, kind='grey', atlas='ship'))
    # manifold amidships with the two hose cranes
    for s in (1, -1):
        for dx in (-6, -3, 0, 3, 6):
            o.append(k.tube(f'mani_{s}_{dx}', [(dx, 2.6 * s, zd + 1.5), (dx, 17.5 * s, zd + 1.5), (dx, 18.3 * s, zd + 1.0)], 0.3, n=6, kind='pipe', atlas='ship'))
        o.append(bx(f'driptray_{s}', (16, 3.0, 0.5), (0, 18.2 * s, zd + 0.25), 'grey'))
        o.append(k.tube(f'crane_post_{s}', [(-10.5, 12.5 * s, zd), (-10.5, 12.5 * s, zd + 9.0)], 0.75, n=10, taper=0.6, kind='white', atlas='ship'))
        o.append(bx(f'crane_house_{s}', (2.6, 2.2, 2.0), (-10.5, 12.5 * s, zd + 9.8), 'white', 0.15))
        o.append(k.tube(f'crane_jib_{s}', [(-9.5, 12.5 * s, zd + 10.2), (7.5, 14.5 * s, zd + 14.0)], 0.38, n=6, taper=0.22, kind='white', atlas='ship'))
    # poop: accommodation block, bridge with wings, funnel, radar mast, free-fall lifeboat on its ramp
    zp = z_deck(-XB + 10)
    xa = -XB + 33.5
    o.append(bx('house_base', (16, 34, 3.0), (xa - 3, 0, zp + 1.5), 'white', 0.1))
    decks = 5
    for i in range(decks):
        w = 29.0 if i < decks - 1 else 30.0
        o.append(bx(f'house_{i}', (13.5, w, 2.95), (xa - 2.2, 0, zp + 3.0 + 1.5 + 3.0 * i), 'white', 0.08))
        o.append(bx(f'win_f_{i}', (0.08, w - 3.0, 0.9), (xa + 4.56, 0, zp + 3.0 + 1.9 + 3.0 * i), 'glass'))
        for s in (1, -1):
            o.append(bx(f'win_s_{i}_{s}', (10.0, 0.08, 0.85), (xa - 2.2, (w / 2 + 0.01) * s, zp + 3.0 + 1.9 + 3.0 * i), 'glass'))
            o.append(bx(f'walk_{i}_{s}', (15.0, 1.6, 0.14), (xa - 2.4, (w / 2 + 0.8) * s, zp + 3.0 + 3.0 * i), 'grey'))
    zb = zp + 3.0 + 3.0 * decks
    o.append(bx('bridge', (9.0, 31, 3.1), (xa - 0.2, 0, zb + 1.55), 'white', 0.1))
    o.append(bx('bridge_wings', (4.2, 2 * HB - 1.0, 1.25), (xa + 0.9, 0, zb + 0.62), 'white', 0.06))
    o.append(bx('bridge_win', (0.08, 29.5, 1.15), (xa + 4.32, 0, zb + 2.0), 'glass'))
    for s in (1, -1):
        o.append(bx(f'bridge_win_s_{s}', (7.5, 0.08, 1.1), (xa - 0.2, 15.52 * s, zb + 2.0), 'glass'))
    zt = zb + 3.1
    o.append(k.tube('radar_mast', [(xa - 1.5, 0, zt), (xa - 1.5, 0, zt + 9.5)], 0.42, n=8, taper=0.2, kind='white', atlas='ship'))
    o.append(bx('radar_yard', (0.3, 8.5, 0.3), (xa - 1.5, 0, zt + 6.0), 'white'))
    o.append(bx('radar_scanner', (0.5, 3.6, 0.4), (xa - 0.6, 0, zt + 3.4), 'white'))
    o.append(bx('radar_plat', (2.4, 2.4, 0.2), (xa - 1.2, 0, zt + 3.0), 'white'))
    xf = xa - 14.5
    fun = k.box('funnel', (8.5, 7.0, 15.0), (xf, 0, zp + 3.0 + 7.5), bevel=1.6, seg=4, kind='funnel', atlas='ship')
    o.append(fun)
    o.append(bx('funnel_top', (7.0, 5.4, 1.4), (xf - 0.3, 0, zp + 18.6), 'dark', 0.6))
    for dy in (-1.2, 1.2):
        o.append(k.tube(f'uptake_{dy}', [(xf - 0.6, dy, zp + 18.5), (xf - 1.0, dy, zp + 21.0)], 0.55, n=8, kind='dark', atlas='ship'))
    o.append(bx('engine_casing', (11.0, 16.0, 6.0), (xf - 0.5, 0, zp + 3.0), 'white', 0.1))
    xr = -XB + 6.0
    o.append(k.xform(bx('lifeboat_ramp', (11.0, 3.4, 0.5), (0, 0, 0), 'grey'), (xr + 1.5, 0, zp + 4.6), (0, math.radians(-28), 0)))
    lb = k.box('lifeboat', (8.2, 2.9, 2.7), (0, 0, 0), bevel=0.9, seg=3, kind='orange', atlas='ship')
    o.append(k.xform(lb, (xr + 1.6, 0, zp + 6.3), (0, math.radians(-28), 0)))
    for s in (1, -1):
        o.append(k.tube(f'ramp_leg_{s}', [(xr + 5.0, 1.5 * s, zp), (xr + 5.0, 1.5 * s, zp + 6.6)], 0.25, n=6, kind='grey', atlas='ship'))
        o.append(k.tube(f'stern_post_{s}', [(-XB + 3, 9 * s, zp), (-XB + 3, 9 * s, zp + 6)], 0.2, n=6, kind='white', atlas='ship'))
        # deck cranes / provision cranes by the house
        o.append(k.tube(f'prov_post_{s}', [(xa - 12, 14 * s, zp), (xa - 12, 14 * s, zp + 8)], 0.4, n=8, kind='white', atlas='ship'))
        o.append(k.tube(f'prov_jib_{s}', [(xa - 12, 14 * s, zp + 7.6), (xa - 21, 15.5 * s, zp + 9.5)], 0.25, n=6, kind='white', atlas='ship'))
    return o


KINDS = {  # linear albedo, roughness
    'hull': ((0.02, 0.022, 0.026), 0.6), 'deck': ((0.17, 0.065, 0.045), 0.85), 'white': ((0.62, 0.62, 0.59), 0.55), 'grey': ((0.20, 0.21, 0.21), 0.7),
    'pipe': ((0.16, 0.10, 0.08), 0.6), 'glass': ((0.012, 0.014, 0.018), 0.15), 'funnel': ((0.025, 0.03, 0.04), 0.55), 'dark': ((0.012, 0.012, 0.012), 0.8),
    'orange': ((0.75, 0.16, 0.02), 0.5),
}
IDCOL = {'hull': (1, 0, 0), 'white': (0, 1, 0), 'funnel': (0, 1, 0), 'deck': (0, 0, 1), 'grey': (0, 0.5, 0.5), 'orange': (0, 0.5, 0), 'pipe': (0, 0.3, 0.3)}


def src_mat(kind):
    name = 'src_' + kind
    m = bpy.data.materials.get(name)
    if m:
        return m
    m, bsdf, nodes, links = d.new_material(name)
    c, r = KINDS[kind]
    bsdf.inputs['Base Color'].default_value = (*c, 1)
    bsdf.inputs['Roughness'].default_value = r
    return m


RUST = np.array([0.15, 0.062, 0.03], np.float32)
BOOT = np.array([0.105, 0.030, 0.024], np.float32)


def weather(P, N, ao, idm, base, rough):
    """Steel at sea: boot-topping below the load line (showing, since she rides light), a weed and scum band at the
    waterline, rust runs from the deck edge, scuppers and the anchor pockets, streaked white paintwork."""
    V = lambda *a: np.array(a, np.float32)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    hullm, whitem, deckm = idm[..., 0], idm[..., 1], idm[..., 2]
    side = hullm * k.sstep(0.6, 0.2, np.abs(N[..., 2]))
    n1 = k.fbm(P, 0.12, 4, seed=1)
    n2 = k.fbm(P * V(1, 1, 0.07), 0.9, 4, seed=2)                 # vertical runs
    n3 = k.fbm(P, 1.4, 3, seed=3)
    # boot-topping up to the load line at +7 m
    boot = hullm * (1 - k.sstep(6.9, 7.1, z))
    base[:] = base * (1 - boot[..., None]) + BOOT * (0.75 + 0.5 * n1[..., None]) * boot[..., None]
    scum = hullm * np.exp(-np.clip(z + 0.2, 0, 50) / (0.9 + 0.8 * n1)) * k.sstep(-1.0, 0.0, z)
    base[:] = base * (1 - 0.7 * scum[..., None]) + V(0.045, 0.05, 0.03) * 0.7 * scum[..., None]
    # rust: runs down the sides from the deck edge and stains where paint has gone
    runs = k.sstep(0.50, 0.72, n2) * side * np.exp(-np.clip(DECK - z, 0, 40) / (3.0 + 5.0 * n1)) * 0.75
    blot = k.sstep(0.60, 0.75, n3) * side * 0.35 * k.sstep(0.45, 0.6, n1)
    hawse = np.exp(-((x - (XB - 13.5)) / 1.3) ** 2) * k.sstep(11.5, 10.5, z) * np.exp(-np.clip(11 - z, 0, 40) / 6.0) * side
    rust = np.clip(runs + blot + 0.9 * hawse, 0, 1)
    base[:] = base * (1 - rust[..., None]) + RUST * (0.7 + 0.6 * n3[..., None]) * rust[..., None]
    rough += 0.25 * rust
    # white paintwork: grey-brown runs below edges and a soot fall abaft the funnel
    wr = k.sstep(0.48, 0.75, n2) * whitem * k.sstep(0.5, 0.2, np.abs(N[..., 2])) * 0.22
    base[:] = base * (1 - wr[..., None]) + V(0.22, 0.13, 0.07) * wr[..., None]
    g = 1 - k.sstep(0.3, 0.9, ao)
    base *= (1 - 0.45 * g * np.clip(whitem + deckm + idm[..., 1], 0, 1))[..., None]
    # deck: patchy, rusty red-oxide
    dn = k.fbm(P, 0.35, 4, seed=5)
    base *= (1 + 0.5 * (dn - 0.5) * deckm)[..., None]
    return base, rough


d.reset()
d.ensure_world((1, 1, 1))
bpy.context.scene.world.light_settings.distance = 12.0
objs = hull() + outfit()
k.smart_uv_missing(objs)
for o in objs:
    d.set_material(o, src_mat(o['kind']))
ob = k.join(objs, 'ship')
k.weld(ob, 0.002)
k.finish(ob, 40.0)
mpu = k.atlas_pack(ob, margin=0.002, weights={'src_hull': 1.0, 'src_deck': 0.45})
d.log(d.stats(ob), 'triangles', sum(len(p.vertices) - 2 for p in ob.data.polygons), f'texel {mpu / SIZE * 100:.1f} cm')
bdir = d.bake_dir('corsair_ship')
maps = d.bake_pbr([ob], SIZE, 'ship', bdir, ao_samples=24, ao_size=1024, normal=False)
pos, nor, idi = k.float_image('pos', SIZE), k.float_image('gn', SIZE), d.new_image('id', SIZE, non_color=True)
k.bake_position([ob], pos)
k.bake_gnormal([ob], nor)
k.bake_id([ob], idi, {s.material.name: IDCOL.get(s.material.name[4:], (0, 0, 0)) for s in ob.material_slots})
P, N, idm = d.pixels(pos)[..., :3].copy(), d.pixels(nor)[..., :3].copy(), d.pixels(idi)[..., :3].copy()
orm = d.pixels(maps['orm'])
ao, rough = orm[..., 0].copy(), orm[..., 1].copy()
base = k.srgb_to_lin(d.pixels(maps['base'])[..., :3])
base, rough = weather(P, N, ao, idm, base, rough)
arr = np.ones((SIZE, SIZE, 4), np.float32)
arr[..., :3] = k.lin_to_srgb(base)
bimg = d.new_image('ship_basef', SIZE)
d.set_pixels(bimg, arr)
arr2 = np.ones((SIZE, SIZE, 4), np.float32)
arr2[..., 0], arr2[..., 1], arr2[..., 2] = ao, np.clip(rough, 0.04, 1), 0.0
oimg = d.new_image('ship_ormf', SIZE, non_color=True)
d.set_pixels(oimg, arr2)
d.save_png(bimg, os.path.join(bdir, 'ship_basef.png'))
mat = d.gltf_material('ship', base=bimg, orm=oimg)
for s in ob.material_slots:
    s.material = mat
d.export_glb(d.out_path('corsair', 'ship.glb'), [ob], tangents=False)
if PREVIEW:
    bpy.context.scene.view_settings.exposure = -1.6
    for nm, (cam, tgt, lens) in {'side': ((20, -520, 30), (0, 0, 12), 85), 'bowq': ((330, -260, 60), (0, 0, 12), 60), 'sternq': ((-300, 220, 45), (-40, 0, 14), 60)}.items():
        d.preview(f'{PREVIEW}_{nm}.png', target=tgt, cam=cam, lens=lens, samples=16, sun_el=30, sun_az=150)
