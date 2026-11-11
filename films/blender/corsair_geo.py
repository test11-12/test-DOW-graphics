"""Geometry of the Saronic Corsair (24 ft autonomous surface vessel), built from the released photographs:
deep-V hull with reverse chines and two lifting strakes a side, blunt full bow, raised sheer forward of a
step, a faceted foredeck cowl (upper lid, step, lower foredeck), flush aft deck with the engine box at the
transom, tubular sensor mast (radome, EO/IR head, cameras, whips, light). Dimensions are estimates scaled
from the photographs to the published 24 ft length.

Model frame (Blender): +X bow, +Y port, +Z up; origin amidships at the datum the code-built model used as its
waterline (z = 0); the hull spans x = -3.65 .. 3.65, so placeBoat() floats it unchanged. Heights above the
datum (sheer, cowl top) match the code-built boat, which keeps the film's bow camera clear of the deck; the
photographs show a deeper hull than that leaves room for, so the extra depth is below the datum (keel at
-0.60 m, chine at -0.20 m aft): running on the plane, the bow shows the deep forefoot of the real boat.

build() returns {atlas: [objects]}; every object carries a 'kind' (which source material it gets).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import boatkit as k
from boatkit import clamp, lerp, smooth

L, HB, XB = 7.3, 1.24, 3.65
LB = 3.07            # length of the bow taper of the sheer line
RIM = 0.17           # gunwale rim + gutter, measured inboard from the sheer
CH = math.radians(65)  # slope of the cowl's side faces
TOP_KNOTS = (-1.0, -0.63, 2.20, 2.235, 3.48)


def bg(x):
    """Half-breadth of the sheer (deck edge)."""
    dd = XB - x
    if dd < LB:
        return HB * math.sqrt(max(0.0, 1 - (1 - dd / LB) ** 1.8))
    return HB - 0.05 * ((dd - LB) / (L - LB)) ** 2


def zg(x):
    """Height of the sheer: springs up to the bow, steps down 0.15 m abaft the cowl."""
    base = 0.50 + 0.11 * (max(x, 0.0) / XB) ** 1.6 - 0.02 * clamp(-x / XB)
    return base - 0.15 * smooth(-0.78, -1.08, x)


zk = k.pchip([-3.65, 1.6, 2.4, 2.95, 3.27, 3.45, 3.56, 3.62, 3.65], [-0.60, -0.60, -0.585, -0.52, -0.36, -0.10, 0.22, 0.45, 0.61])


def bc(x):
    """Half-breadth of the chine."""
    dd = XB - x
    if dd < 3.4:
        return 1.05 * max(0.0, 1 - (1 - dd / 3.4) ** 2.0) ** 0.8
    return 1.05 - 0.03 * (dd - 3.4) / (L - 3.4)


def zc(x):
    dd = XB - x
    z = -0.20 + 0.42 * (1 - min(dd / 4.0, 1.0)) ** 1.8
    return max(z, zk(x) + bc(x) * 0.27)


def deck_base(x):
    """Height of the gutter / aft deck inside the rim."""
    return zg(x) - 0.024


def abs_top(x):
    """Height of the cowl crest (centreline): aft deck, bulkhead ramp, upper lid, step, lower foredeck."""
    xs = TOP_KNOTS
    zs = (deck_base(-1.0), 1.05, 0.915, 0.785, 0.70)
    if x <= xs[0]:
        return deck_base(x)
    return float(np.interp(x, xs, zs))


def ridge(x):
    """The lower foredeck is peaked along the centreline."""
    return 0.03 * smooth(2.235, 2.5, x)


# ---------------------------------------------------------------- stations
def stations():
    """Shared stations. Returns a dict of arrays indexed by station: inner (cowl-base) point, outward plan
    normal, sheer point."""
    M = 4000
    dd = L * (np.arange(M + 1) / M) ** 2
    ox = XB - dd
    oy = np.array([bg(x) for x in ox])
    tx, ty = np.gradient(ox), np.gradient(oy)
    ln = np.hypot(tx, ty)
    tx, ty = tx / ln, ty / ln
    nx, ny = -ty, tx                                   # inward (towards the centreline / aft at the tip)
    nx[0], ny[0] = -1.0, 0.0
    ix, iy = ox + nx * RIM, np.maximum(oy + ny * RIM, 0.0)
    x0, x1 = XB - RIM, -XB
    N = 110
    xs = list(x0 - (x0 - x1) * (np.arange(N + 1) / N) ** 1.6)
    for kn in TOP_KNOTS[:4]:
        xs = [x for x in xs if abs(x - kn) > 0.03] + [kn - 0.012, kn + 0.012]
    xs += list(np.arange(-1.12, -0.74, 0.03)) + [x1 + 0.006]
    xs = sorted(set(round(float(x), 5) for x in xs), reverse=True)
    out = [xs[0]]
    for x in xs[1:]:
        if out[-1] - x < 0.004:
            continue
        while out[-1] - x > 0.085:
            out.append(out[-1] - min(0.07, (out[-1] - x) / 2))
        out.append(x)
    xs = np.array(out)
    r = slice(None, None, -1)
    yi = np.interp(xs, ix[r], iy[r])
    onx, ony = np.interp(xs, ix[r], -nx[r]), np.interp(xs, ix[r], -ny[r])
    ln = np.hypot(onx, ony)
    onx, ony = onx / ln, ony / ln
    yi[0], onx[0], ony[0] = 0.0, 1.0, 0.0
    onx[-1], ony[-1] = 0.0, 1.0
    sx, sy = xs + onx * RIM, yi + ony * RIM
    sx[-1] = -XB
    sz = np.array([zg(x) for x in sx])
    return dict(x=xs, y=yi, nx=onx, ny=ony, sx=sx, sy=sy, sz=sz, n=len(xs))


def hull_section(x, ys, zs):
    """Port half-section at x up to the sheer point (ys, zs): (bottom incl. chine [16], topside [8]) as (y, z)."""
    dd = XB - x
    K = np.array([0.0, zk(x)])
    b = min(bc(x), max(ys - 0.03, 0.0) * 0.9)
    zc_ = min(zc(x), zs - 0.02) if b > 1e-4 else K[1]
    C = np.array([b, max(zc_, K[1])])
    Lb = float(np.linalg.norm(C - K))
    t = (C - K) / Lb if Lb > 1e-6 else np.array([1.0, 0.0])
    e = clamp(b / 0.35)
    es = clamp((b - 0.25) / 0.35)
    pts = [K, K + t * min(0.02, Lb * 0.1), K + t * Lb * 0.19]
    for f, mid in ((0.36, 0.52), (0.68, 0.86)):
        ws = 0.032 * es
        A, A2 = K + t * (f * Lb - ws), K + t * (f * Lb + ws)
        B = np.array([A2[0], A[1]])
        pts += [A, B - np.array([0.008 * es, 0.0]), B + np.array([0.0, 0.008 * es]), A2, K + t * Lb * mid]
    pts.append(C)
    cf = 0.075 * e
    D = np.array([b + cf, C[1] - 0.07 * cf])
    pts += [D - np.array([0.1 * cf, 0.0]), D + np.array([0.0, 0.1 * cf])]
    D2 = pts[-1]
    S = np.array([ys, zs])
    bulge = (0.03 * clamp(ys / 0.5) + 0.05 * smooth(1.6, 0.3, dd) * clamp(ys / 0.3)) * clamp((zs - D2[1]) / 0.2)
    top = []
    for j in range(8):
        u = j / 7
        p = D2 + (S - D2) * u
        top.append(np.array([p[0] + bulge * math.sin(math.pi * u ** 0.8), p[1]]))
    top[-1] = S
    return pts, top


RIM_PROFILE = [(RIM, 0.0), (RIM - 0.010, 0.022), (RIM - 0.028, 0.032), (RIM - 0.085, 0.032), (RIM - 0.100, 0.024),
               (RIM - 0.110, -0.018), (RIM - 0.118, -0.024), (0.0, -0.024)]


def cowl_section(x, yi, zb):
    """Port half of the cowl at inner station x: chamfer columns [4], top half-breadth, shoulder z, crest z."""
    h = max(0.0, abs_top(x) - ridge(x) - zb) if x > TOP_KNOTS[0] else 0.0
    r = h / math.tan(CH)
    bt = yi - r
    if bt < 0.0:
        bt, h = 0.0, yi * math.tan(CH)
        r = yi
    f = 0.022 * clamp(h / 0.08)
    cham = [(yi, zb), (yi - r / 2, zb + h / 2), (bt + f * math.cos(CH), zb + h - f * math.sin(CH)), (max(bt - 0.9 * f, 0.0), zb + h)]
    crest = zb + h + (ridge(x) if bt > 1e-4 else 0.0)
    return cham, max(bt - 0.9 * f, 0.0), zb + h, crest


class Boat:
    pass


def build_shell():
    """Hull, deck / cowl and rub rail. Returns (objects, Boat info for placing fittings)."""
    st = stations()
    n = st['n']
    bot, top, rim, cham, lid = [], [], [], [], []
    info = Boat()
    info.st = st
    info.bt = np.zeros(n)
    info.zsh = np.zeros(n)
    info.crest = np.zeros(n)
    for i in range(n):
        xh, ys, zs = st['sx'][i], st['sy'][i], st['sz'][i]
        b, t = hull_section(xh, ys, zs)
        bot.append([(xh, p[0], p[1]) for p in b])
        top.append([(xh, p[0], p[1]) for p in t])
        xi, yi, nx, ny = st['x'][i], st['y'][i], st['nx'][i], st['ny'][i]
        rim.append([(xi + nx * w, yi + ny * w, zs + dz) for w, dz in RIM_PROFILE])
        ch, bt, zsh, crest = cowl_section(xi, yi, zs - 0.024)
        cham.append([(xi, y, z) for y, z in ch])
        info.bt[i], info.zsh[i], info.crest[i] = bt, zsh, crest
        lid.append([(xi, bt * c, crest - (crest - zsh) * abs(c)) for c in (1, 0.66, 0.33, 0, -0.33, -0.66, -1)])
    bot, top, rim, cham, lid = (np.array(a, np.float64) for a in (bot, top, rim, cham, lid))
    # round the transom corner: pull the last section 6 mm towards its middle
    c = np.array([-XB, 0.0, 0.12])
    for a in (bot, top, rim, cham, lid):
        v = a[-1] - c
        ln = np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-6)
        a[-1] = c + v * np.maximum(1 - 0.006 / ln, 0.0)
    row = lambda xs: [int(np.argmin(np.abs(st['x'] - x))) for x in xs]     # UV seams at these stations
    hc = row((1.3, -1.3))
    dc = row((2.218, -0.63, -1.0, -2.3))
    hull = [k.grid('hull_bot_p', bot, flip=True, kind='hull', atlas='hull', cuts=hc), k.grid('hull_top_p', top, flip=True, kind='hull', atlas='hull', cuts=hc)]
    hull += [k.mirrored(o) for o in hull]
    deck = [k.grid('deck_rim_p', rim, flip=True, kind='deck', atlas='deck', cuts=row((2.2, 0.6, -1.0, -2.3))), k.grid('deck_cham_p', cham, flip=True, kind='deck', atlas='deck', cuts=dc)]
    deck += [k.mirrored(o) for o in deck]
    deck.append(k.grid('deck_lid', lid, flip=True, kind='deck', atlas='deck', cuts=dc))
    # transom: one polygon closing hull and deck profiles (seen from astern, counter-clockwise)
    port = [bot[-1][j] for j in range(len(bot[-1]))] + [top[-1][j] for j in range(1, 8)] + [rim[-1][j] for j in range(1, 8)] \
        + [cham[-1][j] for j in range(1, 4)] + [lid[-1][j] for j in (1, 2, 3)]
    stbd = [(p[0], -p[1], p[2]) for p in port[1:-1]]
    loop = [port[0]] + stbd + [port[-1]] + list(reversed(port[1:-1]))
    tr = k.new_obj('transom', loop, [list(range(len(loop)))], [(p[1], p[2]) for p in loop], 'hull', 'hull')
    if tr.data.polygons[0].normal.x > 0:
        tr.data.flip_normals()
    hull.append(tr)
    # rub rail: a D-section with a fastener groove, swept round the sheer
    idx = list(range(n - 1, 0, -1))
    path = [(st['sx'][i], -st['sy'][i], st['sz'][i] - 0.022) for i in idx] + [(st['sx'][i], st['sy'][i], st['sz'][i] - 0.022) for i in range(n)]
    out = [(st['nx'][i], -st['ny'][i], 0.0) for i in idx] + [(st['nx'][i], st['ny'][i], 0.0) for i in range(n)]
    up = [(0.0, 0.0, 1.0)] * len(path)
    D = [(-0.022, -0.037), (0.014, -0.037), (0.030, -0.028), (0.037, -0.013), (0.037, -0.006), (0.032, -0.004), (0.032, 0.004),
         (0.037, 0.006), (0.037, 0.013), (0.030, 0.028), (0.014, 0.037), (-0.004, 0.037)]
    rail = k.sweep('rubrail', path, out, up, D, closed=True, caps=True, flip=True, kind='rubber', atlas='gear', cuts=list(range(18, len(path) - 4, 18)))
    info.rail_path, info.rail_out = np.array(path), np.array(out)
    info.x = st['x']
    return hull, deck, [rail], info


# ---------------------------------------------------------------- surface queries for placing fittings
def make_queries(info):
    st = info.st
    r = slice(None, None, -1)
    info.bt_at = lambda x: float(np.interp(x, st['x'][r], info.bt[r]))
    info.yi_at = lambda x: float(np.interp(x, st['x'][r], st['y'][r]))

    def top_z(x, y=0.0):
        """Height of the cowl top (or the aft deck) at (x, y)."""
        zsh = float(np.interp(x, st['x'][r], info.zsh[r]))
        cr = float(np.interp(x, st['x'][r], info.crest[r]))
        bt = max(info.bt_at(x), 1e-4)
        return cr - (cr - zsh) * min(abs(y) / bt, 1.0)

    def top_n(x, y):
        e = 0.01
        return Vector((-(top_z(x + e, y) - top_z(x - e, y)) / (2 * e), -(top_z(x, y + e) - top_z(x, y - e)) / (2 * e), 1.0)).normalized()

    def side(x, z):
        """Point on the port topside at station x and height z, and its outward normal."""
        ys = bg(x)
        _, t = hull_section(x, ys, zg(x))
        zz = [p[1] for p in t]
        yy = [p[0] for p in t]
        y = float(np.interp(z, zz, yy))
        y2 = float(np.interp(z + 0.02, zz, yy))
        nrm = Vector((0.0, 0.02, -(y2 - y))).normalized()
        return Vector((x, y, z)), nrm
    info.top_z, info.top_n, info.side = top_z, top_n, side
    return info


# ---------------------------------------------------------------- fittings
def deck_fittings(info):
    tz, tn = info.top_z, info.top_n
    deck, gear = [], []
    # main hatch lid with a non-skid panel, and the smaller lid abaft it
    main = k.rrect(0.20, 2.08, -0.60, 0.60, 0.05)
    deck += k.slab('hatch_main', main, tz, 0.010, inset=0.045, kinds=('deck', 'grip'), atlas='deck')
    aft = k.rrect(-0.50, 0.08, -0.46, 0.46, 0.04)
    deck += k.slab('hatch_aft', aft, tz, 0.010, inset=0.04, kinds=('deck', 'grip'), atlas='deck')
    # lower foredeck: two non-skid pads either side of the ridge
    for s in (1, -1):
        y0, y1 = (0.05, 0.38) if s > 0 else (-0.38, -0.05)
        deck += k.slab(f'pad_fore_{s}', k.rrect(2.34, 2.84, y0, y1, 0.04), tz, 0.007, chamfer=0.0025, inset=0.022, kinds=('deck', 'grip'), atlas='deck')
        yo = y1 if s > 0 else y0                                     # hinges outboard, a latch by the ridge
        for hx in (2.44, 2.74):
            gear.append(k.box(f'pad_hinge_{s}_{hx}', (0.055, 0.020, 0.007), (hx, yo + 0.004 * s, tz(hx, yo) + 0.0085), bevel=0.002, seg=1, kind='steel', atlas='gear'))
        yi = y0 if s > 0 else y1
        gear.append(k.box(f'pad_latch_{s}', (0.045, 0.026, 0.008), (2.59, yi + 0.016 * s, tz(2.59, yi + 0.016 * s) + 0.010), bevel=0.003, kind='rubber', atlas='gear'))
    # aft deck non-skid pads beside and ahead of the engine box
    deck += k.slab('pad_aft', k.rrect(-1.92, -1.12, -0.80, 0.80, 0.05), tz, 0.004, chamfer=0.002, inset=0.012, kinds=('deck', 'grip'), atlas='deck')
    # fasteners round the lids
    def ring_bolts(outline, inset, pitch, lift, tag):
        p = k.inset2d(outline, inset)
        p = np.concatenate([p, p[:1]])
        seg = np.linalg.norm(p[1:] - p[:-1], axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        nb = max(4, int(round(cum[-1] / pitch)))
        for i in range(nb):
            s = (i + 0.5) / nb * cum[-1]
            x, y = np.interp(s, cum, p[:, 0]), np.interp(s, cum, p[:, 1])
            gear.append(k.bolt(f'bolt_{tag}_{i}', (x, y, tz(x, y) + lift), tn(x, y), r=0.0065, h=0.0035, atlas='gear'))
    ring_bolts(main, 0.022, 0.26, 0.010, 'main')
    ring_bolts(aft, 0.020, 0.24, 0.010, 'aft')
    for i, y in enumerate((-0.48, -0.24, 0.0, 0.24, 0.48)):          # a row of fasteners over a stiffener
        gear.append(k.bolt(f'bolt_row_{i}', (1.74, y, tz(1.74, y) + 0.010), tn(1.74, y), r=0.0065, h=0.0035, atlas='gear'))
    for ci, (cx, cy) in enumerate(((1.86, -0.40), (1.50, 0.06), (1.93, 0.36), (0.62, -0.30))):   # drain / vent hole groups
        for dx, dy in ((0, 0), (0.022, 0), (-0.022, 0), (0, 0.022), (0, -0.022)):
            hz = tz(cx + dx, cy + dy) + 0.0106
            deck.append(k.xform(k.lathe(f'hole_{ci}_{dx}_{dy}', [(0.0042, 0.0), (0.0, 0.0)], n=10, kind='dark', atlas='deck'), (cx + dx, cy + dy, hz)))
    # round deck plates: one in the main lid, two on the lower foredeck
    for i, (x, y) in enumerate(((1.02, 0.20), (3.02, 0.17), (3.02, -0.17))):
        lift = 0.010 if i == 0 else 0.0
        prof = [(0.086, -0.003), (0.086, 0.004), (0.082, 0.007), (0.066, 0.007), (0.064, 0.004), (0.060, 0.004), (0.058, 0.0065), (0.012, 0.0065), (0.010, 0.004), (0.0, 0.004)]
        pl = k.lathe(f'deckplate_{i}', prof, n=36, kind='deck', atlas='deck')
        deck.append(k.aim(pl, (x, y, tz(x, y) + lift), Vector((x, y, tz(x, y) + lift)) + tn(x, y)))
    # two antenna pucks on the after corners of the cowl
    for s in (1, -1):
        prof = [(0.062, -0.002), (0.062, 0.010), (0.054, 0.014), (0.054, 0.058), (0.048, 0.070), (0.030, 0.078), (0.0, 0.080)]
        pk = k.lathe(f'puck_{s}', prof, n=28, kind='black', atlas='gear')
        gear.append(k.aim(pk, (-0.26, 0.62 * s, tz(-0.26, 0.62 * s)), (-0.26, 0.62 * s, tz(-0.26, 0.62 * s) + 1)))
    # bow loop
    z0 = tz(3.22, 0.0)
    gear.append(k.tube('bow_loop', [(3.22, 0.075, z0 - 0.01), (3.22, 0.075, z0 + 0.075), (3.22, -0.075, z0 + 0.075), (3.22, -0.075, z0 - 0.01)], 0.011, n=10, fillet=0.03, kind='steel', atlas='gear'))
    for s in (1, -1):
        gear.append(k.aim(k.lathe(f'bow_loop_base_{s}', [(0.022, 0.0), (0.022, 0.004), (0.016, 0.007)], n=14, kind='steel', atlas='gear'), (3.22, 0.075 * s, z0 - 0.002), (3.22, 0.075 * s, z0 + 1)))
    # quarter cleats, a bow cleat on the ridge of the lower foredeck, and a filler cap on the aft deck
    for s, (x, y) in ((1, (-3.18, 0.90)), (-1, (-3.18, -0.90)), (0, (3.02 - 0.42, 0.0))):
        z = tz(x, y)
        gear.append(k.box(f'cleat_base_{s}', (0.14, 0.04, 0.006), (x, y, z + 0.003), bevel=0.002, kind='steel', atlas='gear'))
        for dx in (-0.035, 0.035):
            gear.append(k.tube(f'cleat_post_{s}_{dx}', [(x + dx, y, z), (x + dx, y, z + 0.035)], 0.009, n=8, kind='steel', atlas='gear'))
        gear.append(k.tube(f'cleat_horn_{s}', [(x - 0.10, y, z + 0.030), (x - 0.06, y, z + 0.038), (x + 0.06, y, z + 0.038), (x + 0.10, y, z + 0.030)], 0.010, n=8, kind='steel', atlas='gear'))
    x, y = -1.75, 0.93
    gear.append(k.aim(k.lathe('filler', [(0.038, 0.0), (0.038, 0.005), (0.034, 0.008), (0.012, 0.008), (0.010, 0.005), (0.0, 0.005)], n=20, kind='steel', atlas='gear'), (x, y, tz(x, y)), (x, y, tz(x, y) + 1)))
    return deck, gear


def side_brackets(info):
    """The black fittings hanging below the rub rail, two a side (lifting / lashing points in the photographs)."""
    out = []
    for s in (1, -1):
        for x in (0.49, -2.40):
            zs = zg(x)
            pb, nb = info.side(x, zs - 0.43)
            p_top = Vector((x, bg(x) + 0.054, zs - 0.030))
            p_bot = pb + nb * 0.022
            ax = (p_top - p_bot).normalized()                     # up the bracket
            nn = Vector((0.0, ax.z, -ax.y))                       # outward
            parts = []
            ring = k.lathe('br_ring', [(0.030, -0.016), (0.062, -0.016), (0.066, -0.010), (0.066, 0.010), (0.062, 0.016), (0.030, 0.016), (0.026, 0.010), (0.026, -0.010), (0.030, -0.016)], n=24, kind='rubber', atlas='gear', cap_top=False, cap_bottom=False)
            parts.append(ring)
            parts.append(k.box('br_strap', (0.082, 0.26, 0.030), (0, -0.175, 0), bevel=0.006, kind='rubber', atlas='gear'))
            parts.append(k.box('br_foot', (0.125, 0.12, 0.042), (0, -0.345, 0), bevel=0.010, kind='rubber', atlas='gear'))
            parts.append(k.lathe('br_pin', [(0.011, -0.022), (0.011, 0.024), (0.006, 0.027)], n=10, kind='steel', atlas='gear'))
            ob = k.join(parts, f'bracket_{s}_{x}')
            from mathutils import Matrix
            M = Matrix.Identity(4)
            M.col[0].xyz, M.col[1].xyz, M.col[2].xyz = Vector((-1, 0, 0)), ax, nn
            M.col[3].xyz = p_top
            ob.data.transform(M)
            if s < 0:
                ob.data.transform(Matrix.Diagonal((1, -1, 1, 1)))
                ob.data.flip_normals()
            ob['kind'], ob['atlas'] = 'rubber', 'gear'
            ob['has_uv'] = False
            out.append(ob)
    return out


def rail_screws(info):
    out = []
    path, o = info.rail_path, info.rail_out
    cum = np.concatenate([[0], np.cumsum(np.linalg.norm(path[1:] - path[:-1], axis=1))])
    nb = int(cum[-1] / 0.30)
    for i in range(nb):
        s = (i + 0.5) / nb * cum[-1]
        p = np.array([np.interp(s, cum, path[:, c]) for c in range(3)])
        q = np.array([np.interp(s, cum, o[:, c]) for c in range(3)])
        q /= np.linalg.norm(q)
        out.append(k.bolt(f'railscrew_{i}', p + q * 0.0315, q, r=0.004, h=0.002, n=8, atlas='gear'))
    return out


def engine_box(info):
    x0, x1, hw, hgt = -3.60, -2.02, 0.74, 0.50
    zb = deck_base(-2.8) - 0.004
    zt = zb + hgt
    deck, gear = [], []
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((x1 - x0, 2 * hw, hgt)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(((x0 + x1) / 2, 0, zb + hgt / 2)), verts=bm.verts)
    vert_e = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.1]
    bmesh.ops.bevel(bm, geom=vert_e, offset=0.07, segments=5, profile=0.5, affect='EDGES')
    bm.normal_update()
    top_e = [e for e in bm.edges if e.verts[0].co.z > zt - 1e-4 and e.verts[1].co.z > zt - 1e-4 and len([f for f in e.link_faces if abs(f.normal.z) > 0.9]) == 1]
    bmesh.ops.bevel(bm, geom=top_e, offset=0.022, segments=3, profile=0.5, affect='EDGES')
    me = bpy.data.meshes.new('enginebox')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('enginebox', me)
    bpy.context.scene.collection.objects.link(ob)
    ob['kind'], ob['atlas'], ob['has_uv'] = 'box', 'deck', False
    deck.append(ob)
    deck += k.slab('box_lid', k.rrect(x0 + 0.05, x1 - 0.05, -hw + 0.05, hw - 0.05, 0.06), lambda x, y: zt, 0.014, chamfer=0.004, inset=0.05, kinds=('boxlid', 'boxlid'), atlas='deck')

    def louvre(c, u, w, h, tag):
        """Vent on a vertical face: c centre, u along-face unit vector, outward = u x z rotated."""
        c, u = Vector(c), Vector(u)
        up = Vector((0, 0, 1))
        nrm = u.cross(up)
        r = h / 2
        pts = []
        for cx, a0 in ((w / 2 - r, -90), (-(w / 2 - r), 90)):
            for i in range(9):
                a = math.radians(a0 + 180 * i / 8)
                pts.append(c + u * (cx + r * math.cos(a)) + up * (r * math.sin(a)) + nrm * 0.004)
        pts.append(pts[0])
        deck.append(k.tube(f'louvre_frame_{tag}', pts, 0.008, n=8, caps=False, kind='box', atlas='deck'))
        rot = (0, 0, math.atan2(u.y, u.x))
        deck.append(k.box(f'louvre_back_{tag}', (w - 2 * r + 0.02, 0.003, h - 0.03), c + nrm * 0.0015, kind='dark', atlas='deck', rot=rot))
        deck.append(k.box(f'louvre_backl_{tag}', (0.05, 0.003, h - 0.07), c + u * (w / 2 - r) + nrm * 0.0015, kind='dark', atlas='deck', rot=rot))
        deck.append(k.box(f'louvre_backr_{tag}', (0.05, 0.003, h - 0.07), c - u * (w / 2 - r) + nrm * 0.0015, kind='dark', atlas='deck', rot=rot))
        ns = 6
        for i in range(ns):
            z = (i + 0.5) / ns * (h - 0.036) - (h - 0.036) / 2
            sl = k.box(f'louvre_slat_{tag}_{i}', (w - 2 * r + 0.03, 0.004, 0.026), (0, 0, 0), bevel=0.0012, seg=1, kind='louvre', atlas='deck', rot=(math.radians(38), 0, 0))
            k.xform(sl, c + nrm * 0.011 + up * z, rot)
            deck.append(sl)
    for s in (1, -1):
        louvre(((x0 + x1) / 2 + 0.12, hw * s, zb + 0.27), (-s, 0, 0), 0.92, 0.21, f's{s}')
        # draw latches on the lid joint
        for x in (x0 + 0.33, x1 - 0.33):
            gear.append(k.box(f'latch_{s}_{x}', (0.030, 0.014, 0.085), (x, (hw + 0.006) * s, zt - 0.050), bevel=0.004, kind='rubber', atlas='gear'))
            gear.append(k.box(f'latchk_{s}_{x}', (0.044, 0.008, 0.022), (x, (hw + 0.003) * s, zt - 0.004), bevel=0.002, kind='steel', atlas='gear'))
        # hinges on the forward edge
        gear.append(k.tube(f'hinge_{s}', [(x1 + 0.006, 0.40 * s - 0.05, zt - 0.004), (x1 + 0.006, 0.40 * s + 0.05, zt - 0.004)], 0.009, n=10, kind='steel', atlas='gear'))
        gear.append(k.box(f'hingel_{s}', (0.006, 0.10, 0.05), (x1 + 0.002, 0.40 * s, zt - 0.034), bevel=0.0015, kind='steel', atlas='gear'))
    louvre((x0, 0.0, zb + 0.27), (0, -1, 0), 0.80, 0.21, 'aft')
    # lid handle
    zl = zt + 0.014
    gear.append(k.tube('lid_handle', [(x0 + 0.14, 0.09, zl - 0.004), (x0 + 0.14, 0.09, zl + 0.034), (x0 + 0.14, -0.09, zl + 0.034), (x0 + 0.14, -0.09, zl - 0.004)], 0.008, n=8, fillet=0.02, kind='steel', atlas='gear'))
    return deck, gear


def transom_gear(info):
    g = []
    xt = -XB
    zc_ = zk(xt) + 0.27
    # water-jet: mounting flange, nozzle, steering deflector
    def lx(name, prof, kind, n=28):
        ob = k.lathe(name, prof, n=n, kind=kind, atlas='gear')
        return k.aim(ob, (xt + 0.004, 0, zc_), (xt - 1, 0, zc_))
    g.append(lx('jet_flange', [(0.205, 0.0), (0.205, 0.018), (0.198, 0.024), (0.165, 0.024)], 'alu'))
    g.append(lx('jet_nozzle', [(0.160, 0.02), (0.155, 0.06), (0.150, 0.16), (0.128, 0.23), (0.118, 0.26), (0.112, 0.262), (0.104, 0.26), (0.104, 0.10)], 'alu'))
    g.append(lx('jet_deflector', [(0.134, 0.20), (0.138, 0.205), (0.132, 0.33), (0.126, 0.335), (0.120, 0.33), (0.122, 0.21)], 'alu'))
    g.append(lx('jet_dark', [(0.104, 0.11), (0.0, 0.11)], 'dark', n=20))
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        g.append(k.bolt(f'jet_bolt_{i}', (xt - 0.02, 0.185 * math.cos(a), zc_ + 0.185 * math.sin(a)), (-1, 0, 0), r=0.008, h=0.006, atlas='gear'))
    # trim tabs with their rams
    for s in (1, -1):
        y = 0.70 * s
        zb = zk(xt) + (zc(xt) - zk(xt)) * abs(y) / bc(xt)
        roll = math.atan2(zc(xt) - zk(xt), bc(xt)) * s
        tab = k.box(f'trimtab_{s}', (0.27, 0.34, 0.006), (0, 0, 0), bevel=0.0015, seg=1, kind='steel', atlas='gear')
        k.xform(tab, (xt - 0.14, y, zb - 0.012), (roll, math.radians(-4), 0))
        g.append(tab)
        g.append(k.tube(f'trimram_{s}', [(xt - 0.005, y, zb + 0.20), (xt - 0.17, y, zb + 0.0)], 0.014, n=10, kind='steel', atlas='gear'))
        g.append(k.box(f'anode_{s}', (0.022, 0.16, 0.055), (xt - 0.010, 0.38 * s, zk(xt) + 0.45), bevel=0.006, kind='alu', atlas='gear'))
        # lashing eyes high on the transom
        ze = zg(xt) - 0.14
        g.append(k.tube(f'eye_{s}', [(xt + 0.004, 0.93 * s - 0.03, ze), (xt - 0.05, 0.93 * s - 0.03, ze), (xt - 0.05, 0.93 * s + 0.03, ze), (xt + 0.004, 0.93 * s + 0.03, ze)], 0.007, n=8, fillet=0.02, kind='steel', atlas='gear'))
    return g


def mast(info):
    tz = info.top_z
    m, g, glass, red = [], [], [], []
    R = 0.021
    ZP = 1.50
    fa = lambda s: Vector((-1.47, 0.94 * s, tz(-1.47, 0.94 * s)))          # aft feet (aft deck)
    ff = lambda s: Vector((-0.56, 0.62 * s, tz(-0.56, 0.62 * s)))          # forward feet (cowl top)
    ca = lambda s: Vector((-1.34, 0.36 * s, ZP))
    cf = lambda s: Vector((-0.86, 0.36 * s, ZP))
    m.append(k.tube('mast_aft', [fa(1), ca(1), ca(-1), fa(-1)], R, n=14, fillet=0.09, kind='mast', atlas='gear'))
    m.append(k.tube('mast_fwd', [ff(1), cf(1), cf(-1), ff(-1)], R, n=14, fillet=0.09, kind='mast', atlas='gear'))
    for s in (1, -1):
        m.append(k.tube(f'mast_side_{s}', [ca(s), cf(s)], R, n=14, kind='mast', atlas='gear'))
        m.append(k.tube(f'mast_diag_{s}', [fa(s).lerp(ca(s), 0.22), ff(s).lerp(cf(s), 0.62)], 0.016, n=10, kind='mast', atlas='gear'))
        # camera stubs outboard of the platform, two cameras each
        m.append(k.tube(f'cam_stub_{s}', [cf(s) + Vector((0, 0.02 * s, 0)), cf(s) + Vector((0.0, 0.22 * s, 0.0))], 0.016, n=10, kind='mast', atlas='gear'))
        for j, (yy, yaw) in enumerate(((0.10, 12), (0.19, 58))):
            c = cf(s) + Vector((0.0, yy * s, 0.050))
            a = math.radians(yaw) * s
            dr = Vector((math.cos(a), math.sin(a), -0.05)).normalized()
            body = k.lathe(f'cam_{s}_{j}', [(0.0, -0.06), (0.026, -0.058), (0.030, -0.05), (0.030, 0.035), (0.034, 0.038), (0.034, 0.058), (0.030, 0.060)], n=18, kind='white', atlas='gear', cap_top=False)
            g.append(k.aim(body, c, c + dr))
            bez = k.lathe(f'cam_bez_{s}_{j}', [(0.030, 0.052), (0.031, 0.062), (0.024, 0.062), (0.024, 0.054)], n=18, kind='black', atlas='gear', cap_top=False, cap_bottom=False)
            g.append(k.aim(bez, c, c + dr))
            gl = k.lathe(f'cam_glass_{s}_{j}', [(0.0, 0.0565), (0.024, 0.0565)], n=18, cap_top=False, cap_bottom=False)
            glass.append(k.aim(gl, c, c + dr))
            g.append(k.box(f'cam_mount_{s}_{j}', (0.030, 0.030, 0.034), cf(s) + Vector((0.0, yy * s, 0.018)), bevel=0.003, kind='mast', atlas='gear'))
        # base plates with bolts
        for nm, p, slope in (('a', fa(s), 0.0), ('f', ff(s), 0.0)):
            m.append(k.box(f'mast_foot_{nm}_{s}', (0.13, 0.09, 0.008), p + Vector((0, 0, 0.003)), bevel=0.002, seg=1, kind='mast', atlas='gear'))
            for dx, dy in ((-0.05, -0.03), (0.05, -0.03), (-0.05, 0.03), (0.05, 0.03)):
                g.append(k.bolt(f'mast_bolt_{nm}_{s}_{dx}_{dy}', p + Vector((dx, dy, 0.007)), (0, 0, 1), r=0.006, h=0.004, atlas='gear'))
    for t in (0.36, 0.68):
        m.append(k.tube(f'mast_rung_{t}', [fa(1).lerp(ca(1), t), fa(-1).lerp(ca(-1), t)], 0.016, n=10, kind='mast', atlas='gear'))
    m.append(k.box('mast_plate', (0.52, 0.76, 0.006), (-1.10, 0, ZP + 0.022), bevel=0.0015, seg=1, kind='mast', atlas='gear'))
    zp = ZP + 0.025
    # radome: wide lower dish and a smaller dome on it
    rad = [(0.085, 0.0), (0.085, 0.045), (0.10, 0.052), (0.225, 0.058), (0.246, 0.068), (0.254, 0.088), (0.254, 0.135), (0.246, 0.160),
           (0.222, 0.176), (0.19, 0.183), (0.176, 0.186), (0.172, 0.196), (0.180, 0.206), (0.184, 0.27), (0.176, 0.31), (0.150, 0.345),
           (0.105, 0.368), (0.05, 0.379), (0.0, 0.381)]
    g.append(k.xform(k.lathe('radome', rad, n=48, kind='white', atlas='gear'), (-1.02, 0, zp)))
    for nm, prof in (('eq', [(0.2540, 0.108), (0.2556, 0.110), (0.2556, 0.114), (0.2540, 0.116)]), ('neck', [(0.1760, 0.185), (0.1815, 0.187), (0.1815, 0.195), (0.1790, 0.197)])):
        g.append(k.xform(k.lathe(f'radome_seal_{nm}', prof, n=48, kind='black', atlas='gear', cap_top=False, cap_bottom=False), (-1.02, 0, zp)))
    # EO/IR head on its pedestal
    ex, ey = -1.36, 0.14
    eo = [(0.062, 0.0), (0.062, 0.012), (0.044, 0.030), (0.037, 0.40), (0.050, 0.43), (0.074, 0.44), (0.078, 0.452), (0.078, 0.498), (0.072, 0.503)]
    g.append(k.xform(k.lathe('eo_pedestal', eo, n=28, kind='white', atlas='gear'), (ex, ey, zp)))
    g.append(k.xform(k.lathe('eo_band', [(0.060, 0.500), (0.073, 0.500), (0.073, 0.522), (0.060, 0.522)], n=28, kind='black', atlas='gear', cap_top=False, cap_bottom=False), (ex, ey, zp)))
    head = [(0.060, 0.520), (0.084, 0.524), (0.087, 0.535), (0.087, 0.700), (0.081, 0.735), (0.064, 0.762), (0.034, 0.778), (0.0, 0.782)]
    g.append(k.xform(k.lathe('eo_head', head, n=32, kind='white', atlas='gear'), (ex, ey, zp)))
    g.append(k.box('eo_lens_house', (0.060, 0.118, 0.140), (ex + 0.078, ey, zp + 0.615), bevel=0.012, seg=3, kind='white', atlas='gear'))
    glass.append(k.box('eo_glass', (0.004, 0.090, 0.108), (ex + 0.1085, ey, zp + 0.615), bevel=0.0015, seg=1))
    # outrigger aft with the light and two whips; two more whips on the platform
    o0, o1 = Vector((-1.34, 0.30, ZP)), Vector((-1.66, 0.44, ZP + 0.20))
    m.append(k.tube('outrigger', [o0, o0 + Vector((-0.10, 0.04, 0.0)), o1], 0.016, n=10, fillet=0.05, kind='mast', atlas='gear'))
    tb0, tb1 = o1 + Vector((0.035, -0.10, 0)), o1 + Vector((-0.035, 0.10, 0))
    m.append(k.tube('outrigger_t', [tb0, tb1], 0.014, n=10, kind='mast', atlas='gear'))

    def whip(p, ln, lean, tag):
        p = Vector(p)
        tip = p + Vector((lean[0], lean[1], ln))
        ax = (tip - p).normalized()
        g.append(k.tube(f'whip_base_{tag}', [p - ax * 0.005, p + ax * 0.075], 0.0125, n=10, kind='black', atlas='gear'))
        g.append(k.tube(f'whip_{tag}', [p + ax * 0.07, tip], 0.0075, n=8, taper=0.005, kind='black', atlas='gear'))
    whip(tb0, 0.52, (-0.03, -0.01, 0), 'o0')
    whip(tb1, 0.47, (-0.03, 0.01, 0), 'o1')
    whip((-1.30, -0.15, zp), 0.56, (-0.02, 0.0, 0), 'p0')
    whip((-1.30, -0.28, zp), 0.50, (-0.02, -0.01, 0), 'p1')
    lp = o1 + Vector((0, 0, 0.0))
    m.append(k.tube('light_pole', [lp, lp + Vector((0, 0, 0.66))], 0.011, n=10, kind='mast', atlas='gear'))
    zl = lp.z + 0.66
    g.append(k.xform(k.lathe('light_base', [(0.020, 0.0), (0.031, 0.006), (0.031, 0.020), (0.027, 0.022)], n=18, kind='black', atlas='gear'), (lp.x, lp.y, zl)))
    red.append(k.xform(k.lathe('light_lens', [(0.026, 0.020), (0.027, 0.062), (0.024, 0.066)], n=18, cap_bottom=False), (lp.x, lp.y, zl)))
    g.append(k.xform(k.lathe('light_cap', [(0.027, 0.064), (0.030, 0.068), (0.028, 0.078), (0.012, 0.084), (0.0, 0.085)], n=18, kind='black', atlas='gear'), (lp.x, lp.y, zl)))
    # cable loom down the port after leg, clipped to it, then across the deck into the bulkhead
    a, b = fa(1), ca(1)
    off = Vector((-0.034, 0.0, 0.0))
    pts = [b.lerp(ca(-1), 0.25) + Vector((-0.03, 0, -0.01)), b + Vector((-0.035, 0.0, -0.02))]
    for t in (0.8, 0.6, 0.4, 0.2, 0.06):
        pts.append(a.lerp(b, t) + off + Vector((0, 0, 0.004 * math.sin(t * 40))))
    pts += [a + Vector((0.02, -0.07, 0.012)), a + Vector((0.20, -0.16, 0.010)), Vector((-1.02, 0.62, tz(-1.02, 0.62) + 0.012)), Vector((-0.93, 0.60, tz(-0.93, 0.60) + 0.03))]
    g.append(k.tube('loom', pts, 0.0085, n=8, fillet=0.03, kind='black', atlas='gear'))
    for t in (0.75, 0.5, 0.25):
        c = a.lerp(b, t)
        ax = (b - a).normalized()
        g.append(k.tube(f'loom_clip_{t}', [c + off * 0.5 - ax * 0.012, c + off * 0.5 + ax * 0.012], 0.034, n=12, kind='black', atlas='gear'))
    g.append(k.aim(k.lathe('loom_gland', [(0.022, 0.0), (0.022, 0.02), (0.016, 0.03), (0.012, 0.03)], n=12, kind='black', atlas='gear'), (-0.955, 0.60, tz(-0.955, 0.60) - 0.005), (-0.90, 0.60, tz(-0.90, 0.60) + 0.05)))
    return m, g, glass, red


def build():
    hull, deck, rail, info = build_shell()
    make_queries(info)
    d1, g1 = deck_fittings(info)
    d2, g2 = engine_box(info)
    m, g3, glass, red = mast(info)
    gear = rail + g1 + g2 + g3 + m + side_brackets(info) + rail_screws(info) + transom_gear(info)
    for o in glass:
        o['kind'] = 'glass'
    for o in red:
        o['kind'] = 'navred'
    return {'hull': hull, 'deck': deck + d1 + d2, 'gear': gear, 'glass': glass, 'navred': red}, info
