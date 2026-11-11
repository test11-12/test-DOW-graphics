# AIM-120 AMRAAM -> assets/fury/amraam.glb
#   node tools/blender.mjs amraam            build, bake, paint, export
#   node tools/blender.mjs amraam paint      repaint and export from the cached geometry
# 3.65 m long, 178 mm body, 447 mm across the clipped cruciform wings and fins, hung in an X on the rail, hooks up.
# Body frame: +x forward, +y up (towards the launcher), +z starboard; origin at mid-length; s = metres aft of the tip.
# Stations were measured on the released take-off photograph of aircraft 1001 with a captive round (151 px per metre
# along the missile axis): radome joint 0.455 m, bands centred at 1.58, 2.14 and 2.92 m, about 36 mm wide, wing
# root 1.62 to 1.95 m, fins 3.24 to 3.59 m. Colours follow the launch photographs of the live round: an off-white
# radome, a pale grey body, wings and fins in the same paint, a yellow band ahead of the wings and brown bands on
# the motor. The control fins turn on shafts in the body: no rollerons. Stencil blocks are random letter groups at
# 6 to 11 mm cap height: they read as lettering at film scale and say nothing.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
import bpy
import numpy as np

import dowlib as d
import acpaint as ap
from acpaint import Canvas, Mesh, smoothstep

OUT = d.bake_dir('amraam')
BLEND = os.path.join(OUT, 'amraam_geo.blend')
ARGS = d.args()
SIZE = 4096
L, R = 3.65, 0.089
NOSE = 0.455                                  # radome length
JOINTS = [NOSE, 0.93, 1.37, 3.24]             # radome | guidance | armament | rocket motor | control section
ISLANDS = [0.0, NOSE, 0.93, 1.37, 2.30, 3.24, L]
WING = dict(le0=1.62, te0=1.95, le1=1.875, te1=1.958, span=0.135)
FIN = dict(le0=3.245, te0=3.588, le1=3.452, te1=3.604, span=0.135)
HOOKS = (1.10, 2.05, 2.86)                    # forward, mid and aft hooks (ride in the launcher rail)
UMB = 1.66                                    # umbilical connector, under the launcher's umbilical housing
BANDS = [(1.580, 0.036, 'yellow'), (2.140, 0.036, 'brown'), (2.920, 0.036, 'brown')]
PID = dict(body=1, wing=2, fin=3, hook=4, umb=5, base=6, shoe=7, plug=8)


def Xm(s):
    return L / 2 - s


def profile():
    """(s, r) of the body skin from the radome tip to the base."""
    rho = (R * R + NOSE * NOSE) / (2 * R)
    a = 0.0042                                # rounded tip of the radome: a sphere tangent to the ogive
    phi = math.atan(NOSE / (rho - R))         # half-angle of the ogive at the tip
    c0 = a / math.sin(phi); st = c0 - a * math.sin(phi)
    sn = np.unique(np.concatenate([c0 - a + np.array([2e-4, 6e-4, 0.0014, 0.0026, 0.0042]), np.linspace(st, 0.012, 4), np.geomspace(0.016, NOSE, 34)]))
    rn = np.sqrt(np.maximum(rho * rho - (NOSE - sn) ** 2, 0)) + R - rho
    sph = np.sqrt(np.maximum(a * a - (sn - c0) ** 2, 0))
    rn = np.where(sn < st, sph, rn)
    pr = list(zip(sn, rn))
    for s in np.concatenate([np.linspace(NOSE, 3.60, 46)[1:], [3.622, 3.634, 3.642, 3.648]]):
        r = R if s <= 3.60 else R - 0.006 * ((s - 3.60) / 0.048) ** 1.6
        pr.append((float(s), float(r)))
    return pr


def body_mesh():
    pr = profile()
    s_all = np.array([p[0] for p in pr]); r_all = np.array([p[1] for p in pr])
    nT = 72
    th = np.linspace(0, 2 * np.pi, nT + 1)          # th = 0 at the top (towards the rail): the seam hides there
    m = Mesh()
    for k, (a, b) in enumerate(zip(ISLANDS[:-1], ISLANDS[1:])):      # separate UV islands (offset: welded rings would join them)
        keep = (s_all >= a - 1e-9) & (s_all <= b + 1e-9)
        s = s_all[keep]; r = r_all[keep]
        if s[0] > a + 1e-6 and a > 0:            # split exactly at the island boundary
            s = np.concatenate([[a], s]); r = np.concatenate([[np.interp(a, s_all, r_all)], r])
        if s[-1] < b - 1e-6 and b < L:
            s = np.concatenate([s, [b]]); r = np.concatenate([r, [np.interp(b, s_all, r_all)]])
        P = np.stack([np.broadcast_to(Xm(s)[:, None], (len(s), nT + 1)), r[:, None] * np.cos(th)[None, :], r[:, None] * np.sin(th)[None, :]], -1)
        arc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(s), np.diff(r)))]) + s[0]
        UV = np.stack([np.broadcast_to(arc[:, None], (len(s), nT + 1)), np.broadcast_to(((th - np.pi) * R + 2.0 * k)[None, :], (len(s), nT + 1))], -1)
        m.grid(P, UV, flip=None)
    s0, r0 = pr[0]
    tip = [(Xm(s0), r0 * math.cos(t), r0 * math.sin(t)) for t in th[:-1]]
    m.poly(tip, [(s0, 0.0)] * nT, out=(1, 0, 0))
    return m


def surface(sec, edge, notch=0.0, t_abs=0.011):
    """A wing or fin panel spanning +z from the body; notch: how far the leading edge is cut back at the root."""
    f = lambda k, z: sec[k + '0'] + (sec[k + '1'] - sec[k + '0']) * (z - R) / sec['span']
    zs = [R - 0.008, R + 0.022, R + 0.026, R + sec['span'] - 0.004, R + sec['span']] if notch else [R - 0.008, R + sec['span'] - 0.004, R + sec['span']]
    secs = []
    for i, z in enumerate(zs):
        le = f('le', max(z, R)) + (notch if (notch and i < 2) else 0.0); te = f('te', max(z, R))
        if z >= R + sec['span'] - 1e-6:         # the clipped tip: a little rounded off
            le += 0.004; te -= 0.002
        th = t_abs * (0.62 if z >= R + sec['span'] - 0.005 else 1.0) * (1 - 0.35 * (z - R) / sec['span'])
        secs.append(dict(z=z, le=Xm(le), te=Xm(te), t=th / (te - le)))
    return ap.wing(secs, nC=14, nSpan=3, profile='lens', x0=L / 2, edge=edge)


def shoe(sec):
    """Root fitting of a fixed wing: a low strap along the chord, its ends chamfered."""
    c0, c1 = sec['le0'] + 0.012, sec['te0'] - 0.008
    m = Mesh()
    for k, (a, b, h) in enumerate(((c0, c1, 0.0045), (c0 + 0.006, c1 - 0.004, 0.0062))):
        m.add(ap.box((Xm((a + b) / 2), R + h / 2 - 0.001, 0), (b - a, h, 0.030 - 0.010 * k)))
    return m


def spun(m, ang):
    """A copy of mesh m (which spans +z) turned about the missile axis so it stands at `ang` from the top."""
    o = Mesh(); c, s = math.cos(ang), math.sin(ang)
    o.v = [(x, y * s + z * c, -y * c + z * s) for x, y, z in m.v]
    o.f, o.uv = list(m.f), list(m.uv)
    return o


def hook(s):
    """A launch hook: saddle on the skin, stem, and the T-shoe that rides in the rail."""
    m = Mesh()
    m.add(ap.box((Xm(s), R + 0.0015, 0), (0.074, 0.007, 0.044)))           # saddle (sunk into the skin)
    m.add(ap.box((Xm(s), R + 0.0090, 0), (0.034, 0.012, 0.018)))           # stem
    m.add(ap.box((Xm(s), R + 0.0175, 0), (0.068, 0.0065, 0.040)))          # shoe
    m.add(ap.box((Xm(s) + 0.031, R + 0.0175, 0), (0.010, 0.0062, 0.026)))  # chamfered nose of the shoe
    return m


def umbilical():
    m = Mesh()
    m.add(ap.box((Xm(UMB), R + 0.0035, 0), (0.096, 0.010, 0.052)))         # mounting pad
    m.add(ap.box((Xm(UMB) - 0.014, R + 0.0085, 0), (0.056, 0.006, 0.040)))  # connector housing
    return m


def plug():
    """Round connector face on the umbilical and the screws of the pad (separate part for its own paint)."""
    m = Mesh()
    m.add(ap.rod((Xm(UMB) - 0.014, R + 0.0110, 0), (Xm(UMB) - 0.014, R + 0.0150, 0), 0.0135, 24))
    m.add(ap.rod((Xm(UMB) - 0.014, R + 0.0150, 0), (Xm(UMB) - 0.014, R + 0.0158, 0), 0.0098, 24))
    return m


def build():
    d.reset()
    parts = []

    def part(name, mesh, pid, bake=True, bevel=None, smooth=40.0, uvk=1.0):
        ob = ap.to_object(mesh, name, PID[pid], smooth, bevel)
        if uvk != 1.0:
            ap.scale_uv(ob, uvk)
        parts.append((ob, bake))
        return ob

    body = part('body', body_mesh(), 'body', smooth=50)
    wing, fin = surface(WING, 0.0006), surface(FIN, 0.0006, 0.058)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        part(f'wing{k}', spun(wing, a), 'wing', bake=(k == 0), smooth=40)
        part(f'fin{k}', spun(fin, a), 'fin', bake=(k == 0), smooth=40)
        part(f'shoe{k}', spun(shoe(WING), a), 'shoe', bake=(k == 0), bevel=(0.0012, 2), smooth=30, uvk=1.5)
    hg = Mesh()
    for s in HOOKS:
        hg.add(hook(s))
    part('hooks', hg, 'hook', bevel=(0.0010, 2), smooth=30, uvk=2.0)
    part('umbilical', umbilical(), 'umb', bevel=(0.0015, 2), smooth=30, uvk=2.0)
    part('plug', plug(), 'plug', smooth=30, uvk=2.0)
    # aft closure: a flat annulus round the nozzle exit, the nozzle's lip, and inside it the throat (motor_glow)
    base = ap.lathe([(R - 0.0060, 3.648), (0.0815, 3.6487), (0.0662, 3.6487), (0.0655, 3.6497), (0.0632, 3.6512), (0.0612, 3.6510), (0.0600, 3.6490)],
                    (L / 2, 0, 0), (-1, 0, 0), 64)
    part('base', base, 'base', smooth=30)
    glow = ap.lathe([(0.0600, 3.6490), (0.0560, 3.625), (0.0420, 3.590), (0.0300, 3.565), (0.0005, 3.560)], (L / 2, 0, 0), (-1, 0, 0), 48).flipped()
    ap.to_object(glow, 'motor_glow', 0, 50.0)
    for o, _ in parts:
        d.log(d.stats(o))
    targets = [o for o, b in parts if b]
    d.select(targets)                 # rectangle packing: the concave packer stacks the long body islands in one column
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', scale=True, merge_overlap=False, margin_method='FRACTION', margin=0.002, shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')
    # the three other wings / fins / shoes take the first one's layout
    for kind in ('wing', 'fin', 'shoe'):
        src = bpy.data.objects[kind + '0'].data.uv_layers.active.data; n = len(src); a = np.empty(n * 2, np.float32); src.foreach_get('uv', a)
        for k in (1, 2, 3):
            bpy.data.objects[f'{kind}{k}'].data.uv_layers.active.data.foreach_set('uv', a)
    sc = bpy.context.scene
    sc['texel'] = ap.texel_size(body, SIZE)
    d.log(f'texture {SIZE} px, {sc["texel"] * 1000:.2f} mm per texel')
    T = ap.join(targets, 'T'); ap.join([o for o, b in parts if not b], 'X')
    d.ensure_world()
    ap.bake_maps([T], SIZE, 'amraam', OUT, ao_size=SIZE // 2, ao_samples=32, ao_distance=0.35)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)


# ================================================================ paint
BODY, RADOME, TIPC = (206, 209, 210), (229, 228, 220), (92, 94, 96)
YELLOW, BROWN, INK = (204, 160, 40), (112, 76, 50), (44, 46, 50)
HOOKC, PLUGC = (60, 62, 64), (150, 128, 74)
V = (-0.02, 3.68, -0.30, 0.30); PPM = 2600      # unrolled body: x = s, y = arc length round the body from the top


def rand_line(rnd, n):
    al = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
    out, k = [], 0
    while k < n:
        w = rnd.randint(2, 6)
        out.append(''.join(al[rnd.randint(len(al))] for _ in range(w)))
        k += w + 1
        if rnd.rand() < 0.25:
            out[-1] += '-' + ''.join(al[rnd.randint(len(al))] for _ in range(rnd.randint(1, 4)))
    return ' '.join(out)[:n]


def stencil(c, rnd, s0, a0, lines, cap, weight=500, lead=1.55):
    """A block of random letter groups starting at station s0 and running aft, top line at arc a0 (upright for a
    viewer on that side of the body; in a mirrored view the block is anchored at its right end)."""
    for i, n in enumerate(lines):
        c.text(rand_line(rnd, n), s0, a0 - i * cap * lead, cap, (weight, False), 255, 'rs' if c.flip else 'ls', stretch=0.86)


def layers():
    Lr = {}
    for name in ('yellow', 'brown'):
        c = Canvas(*V, PPM)
        for s, w, col in BANDS:
            if col == name:
                c.rect(s - w / 2, V[2], s + w / 2, V[3])
        Lr[name] = c.sampler()
    c = Canvas(*V, PPM); r = Canvas(*V, PPM); rr = Canvas(*V, PPM)
    rnd = np.random.RandomState(120)
    for s in JOINTS:
        c.line([(s, V[2]), (s, V[3])], 0.0011)
        n = 12 if s == NOSE else 16
        for k in range(n):        # screws round each joint, both sides except at the radome
            a = (k + 0.5) / n * 2 * math.pi * R - math.pi * R
            for sg in ((1,) if s == NOSE else (1, -1)):
                r.dot(s + sg * 0.0135, a, 0.0026); rr.ring(s + sg * 0.0135, a, 0.0030, 0.0007)
    for s0, s1, a0, a1 in ((0.62, 0.78, 0.095, 0.150), (0.62, 0.78, -0.150, -0.095), (1.10, 1.24, -0.155, -0.100), (3.29, 3.40, 0.035, 0.085),
                           (3.29, 3.40, -0.085, -0.035), (2.38, 2.50, 0.180, 0.225)):          # access covers
        c.rrect(s0, a0, s1, a1, 0.006, 0.0010)
        for q in ((s0 + 0.009, a0 + 0.008), (s1 - 0.009, a0 + 0.008), (s0 + 0.009, a1 - 0.008), (s1 - 0.009, a1 - 0.008), ((s0 + s1) / 2, a0 + 0.008), ((s0 + s1) / 2, a1 - 0.008)):
            r.dot(q[0], q[1], 0.0021); rr.ring(q[0], q[1], 0.0024, 0.0006)
    for k in range(4):            # screws along the wing root straps
        a = (math.pi / 4 + k * math.pi / 2); a = (a if a < math.pi else a - 2 * math.pi) * R
        for sg in (-1, 1):
            r.dots((WING['le0'] + 0.03, a + sg * 0.0115), (WING['te0'] - 0.025, a + sg * 0.0115), 0.045, 0.0019)
            rr.dots((WING['le0'] + 0.03, a + sg * 0.0115), (WING['te0'] - 0.025, a + sg * 0.0115), 0.045, 0.0022)
    for s in HOOKS:               # screws of the hook saddles (on the skin either side of the saddle)
        for sg in (-1, 1):
            r.dot(s + sg * 0.046, 0.0, 0.0024); rr.ring(s + sg * 0.046, 0.0, 0.0028, 0.0007)
    Lr['line'] = c.sampler(); Lr['riv'] = r.sampler(); Lr['ring'] = rr.sampler()
    # stencils: port side upright as drawn; starboard drawn in a mirrored view (s reversed, arc negated)
    for side in ('P', 'S'):
        ink = Canvas(*V, PPM, flip_x=(side == 'S'))
        rnd = np.random.RandomState(31 if side == 'P' else 47)
        stencil(ink, rnd, 2.36, -0.100, [18, 24], 0.0068, 600)                # motor: the largest block
        stencil(ink, rnd, 2.36, -0.122, [30, 30, 20], 0.0036)
        stencil(ink, rnd, 0.585, -0.060, [16, 20, 12], 0.0040)                 # guidance section
        stencil(ink, rnd, 1.02, -0.112, [22, 16], 0.0038)                      # armament section
        stencil(ink, rnd, 3.275, -0.108, [14, 14, 10], 0.0032)                 # control section
        stencil(ink, rnd, 1.24, -0.050, [9], 0.0050, 600)
        ink.rrect(3.27, -0.140, 3.40, -0.104, 0.003, 0.0008)                    # data plate frame
        stencil(ink, rnd, 3.278, -0.110, [26, 26, 26, 18], 0.0028)
        for s in (BANDS[0][0], BANDS[1][0]):                                      # small legends beside the bands
            stencil(ink, rnd, s + 0.030, -0.070, [12], 0.0034)
        ink.blur(0.00025)                                                         # stencil ink spreads a little
        Lr['ink' + side] = ink.sampler()
    return Lr


_SHEEN = []


def sheen(P, N):
    if not _SHEEN:
        _SHEEN.append(ap.Triplanar(d.ambientcg_texture('PaintedMetal001', '2K')['Roughness'], 0.9))
    return _SHEEN[0](P, N)


def paint(M, texel, Lr):
    P, N, ID, AO = M['P'], M['N'], M['ID'], M['AO']
    s = L / 2 - P[..., 0]; y = P[..., 1]; z = P[..., 2]
    ang = np.arctan2(z, y); arc = ang * R; rad = np.hypot(y, z)
    lin = ap.srgb
    body = ID == PID['body']
    col = np.zeros(P.shape, np.float32); rough = np.full(ID.shape, 0.4, np.float32); metal = np.zeros(ID.shape, np.float32)
    n1 = ap.noise3(P, 0.30, 61, 2); n2 = ap.noise3(P, 0.035, 62, 2); n3 = ap.noise3(P, 0.006, 63, 1)
    sh = sheen(P, N)
    # ---- body: sections, radome, bands
    tint = ap.cell_tint([s], [JOINTS], 7)
    c = np.broadcast_to(lin(BODY), P.shape).copy()
    rdm = s < NOSE
    c = np.where(rdm[..., None], lin(RADOME), c)
    c = c * (1 + 0.022 * tint * ~rdm)[..., None]
    tip = smoothstep(0.016, 0.008, s)
    c = c + (lin(TIPC) - c) * tip[..., None]
    ye = Lr['yellow'](s, arc); br = Lr['brown'](s, arc)
    c = c + (lin(YELLOW) - c) * ye[..., None]; c = c + (lin(BROWN) - c) * br[..., None]
    rb = np.where(rdm, 0.30, 0.42) + 0.04 * (ye + br) - 0.12 * tip + 0.02 * tint
    g = Lr['line'](s, arc); rv = Lr['riv'](s, arc); rg = Lr['ring'](s, arc)
    ik = np.where(z < 0, Lr['inkP'](s, arc), Lr['inkS'](s, -arc))
    c = c * (1 - 0.55 * g - 0.10 * rv - 0.45 * rg)[..., None]
    c = c + (lin(INK) - c) * (0.85 * ik)[..., None]
    H = -0.00045 * g - 0.00025 * rg + 0.00008 * rv + 0.00002 * (ye + br) + 0.00001 * ik
    rb = rb + 0.10 * g + 0.06 * rg - 0.04 * rv - 0.05 * ik
    # handling: faint marks low on the body where it is hoisted, a breath of exhaust soot at the base
    lift = np.clip(ap.noise3(np.stack([P[..., 0] * 0.25, P[..., 1] * 3, P[..., 2] * 3], -1), 0.025, 70, 3) - 0.35, 0, 1) * smoothstep(-0.3, -0.8, np.cos(ang)) * ~rdm
    c = c * (1 - 0.06 * lift)[..., None]; rb = rb + 0.05 * lift
    soot = smoothstep(3.60, 3.648, s)
    c = c * (1 - 0.45 * soot)[..., None]; rb = rb + 0.1 * soot
    col = np.where(body[..., None], c, col); rough = np.where(body, rb, rough)
    H = H * body
    # ---- wings, fins and the wing root straps: the body paint, a slightly worn leading edge
    for k in ('wing', 'fin', 'shoe'):
        w = ID == PID[k]
        sec = WING if k != 'fin' else FIN
        span = np.clip((rad - R) / sec['span'], 0, 1)
        le = sec['le0'] + (sec['le1'] - sec['le0']) * span
        edge = smoothstep(0.010, 0.0, s - le) * (k != 'shoe')
        cc = lin(BODY) * (1 + 0.025 * ap.cell_tint([span], [[2.0]], 3 if k == 'wing' else 5) - 0.04 * edge)[..., None]
        col = np.where(w[..., None], cc, col)
        rough = np.where(w, 0.44 - 0.08 * edge, rough)
        if k == 'shoe':
            H = np.where(w, 0.0, H)
        else:
            root = ap.groove(np.abs(rad - (R + 0.0062)), 0.0012) * (k == 'wing')
            col = np.where(w[..., None], col * (1 - 0.3 * root)[..., None], col)
            H = np.where(w, -0.0002 * root, H)
    # ---- hooks, umbilical, base
    for k, base, ro, me in (('hook', HOOKC, 0.36, 0.85), ('umb', BODY, 0.42, 0.0), ('plug', PLUGC, 0.32, 1.0), ('base', (84, 86, 88), 0.48, 0.35)):
        w = ID == PID[k]
        col = np.where(w[..., None], lin(base) * (1 + 0.05 * n2)[..., None], col); rough = np.where(w, ro, rough); metal = np.where(w, me, metal)
    bs = ID == PID['base']                         # the aft closure: screws round the annulus, a sooty nozzle lip
    pa = np.arctan2(z, y); pr_ = rad
    scr = np.zeros(ID.shape, np.float32)
    for k in range(10):
        a0 = (k + 0.5) / 10 * 2 * np.pi - np.pi
        scr = np.maximum(scr, smoothstep(0.0034, 0.0022, np.hypot(pr_ * np.cos(pa) - 0.0738 * np.cos(a0), pr_ * np.sin(pa) - 0.0738 * np.sin(a0))))
    lip = bs & (pr_ < 0.0664)
    col = np.where(bs[..., None], col * (1 - 0.45 * scr)[..., None], col)
    col = np.where(lip[..., None], lin((30, 29, 28)) * (1 + 0.1 * n2)[..., None], col); rough = np.where(lip, 0.55, rough); metal = np.where(lip, 0.7, metal)
    H = np.where(bs, -0.0002 * scr, H)
    hk = ID == PID['hook']
    shoe_wear = hk & (y > R + 0.0150)             # the rail polishes the shoes
    col = np.where(shoe_wear[..., None], col * 1.6, col); rough = np.where(shoe_wear, 0.24, rough)
    um = ID == PID['umb']
    face = um & (y > R + 0.0080) & (np.abs(z) < 0.019)
    col = np.where(face[..., None], lin((70, 72, 74)), col); metal = np.where(face, 0.6, metal)
    # ---- the paint's own variation
    paintd = body | (ID == PID['wing']) | (ID == PID['fin']) | (ID == PID['shoe']) | um
    col = col * (1 + (0.014 * n1 + 0.008 * n2 + 0.006 * n3 - 0.035 * sh) * paintd)[..., None]
    rough = rough + (0.03 * n1 - 0.02 * n2 + 0.16 * sh) * paintd
    occ = np.clip(1 - AO, 0, 1)
    col = col * (1 - 0.22 * occ ** 1.5)[..., None]; rough = np.clip(rough + 0.05 * occ, 0.05, 1)
    nrm = ap.normal_from_height(H, np.full(ID.shape, texel, np.float32), ID)
    return col, rough, metal, AO, nrm


def paint_export():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    sc = bpy.context.scene; obj = bpy.data.objects
    M = ap.load_maps('amraam', OUT)
    Lr = layers()
    res = ap.in_strips(paint, M, sc['texel'], Lr)
    maps = ap.save_maps('amraam', OUT, *res, orm_size=SIZE // 2)
    mat = d.gltf_material('amraam', base=maps['base'], orm=maps['orm'], normal=maps['normal'])
    d.set_material(obj['T'], mat); d.set_material(obj['X'], mat)
    msl = ap.join([obj['T'], obj['X']], 'aim120')
    gm, bsdf, _, _ = d.new_material('motor_glow')
    bsdf.inputs['Base Color'].default_value = (0.012, 0.011, 0.010, 1); bsdf.inputs['Roughness'].default_value = 0.6; bsdf.inputs['Metallic'].default_value = 0.4
    d.set_material(obj['motor_glow'], gm)
    d.log(d.stats(msl))
    d.export_glb(d.out_path('fury', 'amraam.glb'), [msl, obj['motor_glow']], quality=int(os.environ.get('AMRAAM_Q', '90')))


if not ARGS or 'geo' in ARGS:
    build()
if not ARGS or 'paint' in ARGS:
    paint_export()
