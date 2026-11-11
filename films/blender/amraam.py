# AIM-120 AMRAAM -> assets/fury/amraam.glb
#   node tools/blender.mjs amraam            build, bake, paint, export
#   node tools/blender.mjs amraam paint      repaint and export from the cached geometry
# 3.65 m long, 178 mm body, 447 mm across the cruciform wings and fins (hung in an X on the rail, hangers up).
# Body frame: +x forward, +y up (towards the launcher), +z starboard; origin at mid-length; s = metres aft of the tip.
# Colours and bands follow the released launch photographs: white radome, pale grey body, a yellow band ahead
# of the wings and brown bands on the motor. Stencil blocks are greeked: no real lettering is reproduced.
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
SIZE = 2048
L, R = 3.65, 0.089
NOSE = 0.54                                   # radome length
JOINTS = [NOSE, 1.02, 1.48, 3.22]             # radome | guidance | warhead | motor | control
WING = dict(le0=1.64, te0=2.02, le1=1.905, te1=2.005, span=0.135)
FIN = dict(le0=3.25, te0=3.60, le1=3.445, te1=3.612, span=0.135)
HANGERS = (1.30, 2.06, 2.80)
BANDS = [(1.555, 0.050, 'yellow'), (2.150, 0.050, 'brown'), (2.900, 0.050, 'brown')]
PID = dict(body=1, wing=2, fin=3, hanger=4, raceway=5, base=6, hub=7)


def Xm(s):
    return L / 2 - s


def body_mesh():
    rho = (R * R + NOSE * NOSE) / (2 * R)
    sn = np.unique(np.concatenate([[0.0012, 0.004, 0.009], np.linspace(0.016, NOSE, 26)]))
    rn = np.sqrt(np.maximum(rho * rho - (NOSE - sn) ** 2, 0)) + R - rho
    a = 0.006                                 # the blunt metal tip
    rn = np.maximum(rn, np.where(sn < a, np.sqrt(np.maximum(2 * a * sn - sn * sn, 0)), a * (sn < 0.02)))
    prof = list(zip(sn, rn)) + [(s, R) for s in (0.70, 1.02, 1.25, 1.48, 1.825)]
    aft = [(1.825, R), (2.2, R), (2.7, R), (3.22, R), (3.50, R), (3.600, R), (3.630, R - 0.0015), (3.648, R - 0.0055)]
    nT = 56
    th = np.linspace(0, 2 * np.pi, nT + 1)
    m = Mesh()
    for pr in (prof, aft):
        s = np.array([p[0] for p in pr]); r = np.array([p[1] for p in pr])
        P = np.stack([np.broadcast_to(Xm(s)[:, None], (len(s), nT + 1)), r[:, None] * np.cos(th)[None, :], r[:, None] * np.sin(th)[None, :]], -1)
        arc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(s), np.diff(r)))]) + s[0]
        UV = np.stack([np.broadcast_to(arc[:, None], (len(s), nT + 1)), np.broadcast_to(((th - np.pi) * R)[None, :], (len(s), nT + 1))], -1)
        m.grid(P, UV, flip=None)
    tip = [(Xm(sn[0]), rn[0] * math.cos(t), rn[0] * math.sin(t)) for t in th[:-1]]
    m.poly(tip, [(0.0, 0.0)] * nT, out=(1, 0, 0))
    return m


def surface(sec, edge, notch=0.0):
    """A wing or fin panel spanning +z from the body; notch: how far the leading edge is cut back at the root."""
    f = lambda k, z: sec[k + '0'] + (sec[k + '1'] - sec[k + '0']) * (z - R) / sec['span']
    zs = [R - 0.008, R + 0.026, R + 0.030, R + sec['span']] if notch else [R - 0.008, R + sec['span']]
    secs = []
    for i, z in enumerate(zs):
        le = f('le', max(z, R)) + (notch if (notch and i < 2) else 0.0); te = f('te', max(z, R))
        secs.append(dict(z=z, le=Xm(le), te=Xm(te), t=0.011 / (te - le)))
    m = ap.wing(secs, nC=10, nSpan=2, profile='lens', x0=L / 2, edge=edge)
    # root fitting: a low shoe along the chord
    c0, c1 = sec['le0'] + notch + 0.01, sec['te0'] - 0.01
    m.add(ap.box((Xm((c0 + c1) / 2), 0, R + 0.0015), (c1 - c0, 0.026, 0.011)))
    return m


def spun(m, ang):
    """A copy of mesh m (which spans +z) turned about the missile axis so it stands at `ang` from the top."""
    o = Mesh(); c, s = math.cos(ang), math.sin(ang)
    o.v = [(x, y * s + z * c, -y * c + z * s) for x, y, z in m.v]
    o.f, o.uv = list(m.f), list(m.uv)
    return o


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
    wing, fin = surface(WING, 0.0008), surface(FIN, 0.0008, 0.075)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        part(f'wing{k}', spun(wing, a), 'wing', bake=(k == 0), smooth=40)
        part(f'fin{k}', spun(fin, a), 'fin', bake=(k == 0), smooth=40)
        hub = ap.rod((Xm(3.40), R - 0.004, 0), (Xm(3.40), R + 0.006, 0), 0.026, 14)
        hub.v = [(x, y * math.cos(a) + z * math.sin(a), -y * math.sin(a) + z * math.cos(a)) for x, y, z in hub.v]
        part(f'hub{k}', hub, 'hub', bake=(k == 0), smooth=40)
    hg = Mesh()
    for s in HANGERS:       # hangers: a stem and the T head that rides in the rail
        hg.add(ap.box((Xm(s), R + 0.004, 0), (0.060, 0.016, 0.022))).add(ap.box((Xm(s), R + 0.013, 0), (0.070, 0.006, 0.046)))
    hg.add(ap.box((Xm(1.66), R + 0.003, 0), (0.085, 0.014, 0.050)))      # umbilical receptacle
    part('hangers', hg, 'hanger', bevel=(0.0012, 1), smooth=30)
    a = math.radians(128)   # cable raceway along the motor, lower starboard quarter
    rw = ap.box((Xm(2.36), 0, 0), (1.70, 0.012, 0.032))
    rw.v = [(x, (R + 0.004) * math.cos(a) + y * math.cos(a) - z * math.sin(a), (R + 0.004) * math.sin(a) + y * math.sin(a) + z * math.cos(a)) for x, y, z in rw.v]
    part('raceway', rw, 'raceway', bevel=(0.003, 2), smooth=30)
    base = ap.lathe([(R - 0.0055, 3.648), (0.0705, 3.650), (0.0660, 3.6465)], (L / 2, 0, 0), (-1, 0, 0), 40)
    part('base', base, 'base', smooth=30)
    glow = ap.lathe([(0.0660, 3.6465), (0.0540, 3.615), (0.0300, 3.545), (0.0005, 3.545)], (L / 2, 0, 0), (-1, 0, 0), 32).flipped()
    g = ap.to_object(glow, 'motor_glow', 0, 50.0)
    for o, _ in parts:
        d.log(d.stats(o))
    targets = [o for o, b in parts if b]
    ap.pack(targets, 0.004)
    # the three other wings / fins / hubs take the first one's layout
    for kind in ('wing', 'fin', 'hub'):
        src = bpy.data.objects[kind + '0'].data.uv_layers.active.data; n = len(src); a = np.empty(n * 2, np.float32); src.foreach_get('uv', a)
        for k in (1, 2, 3):
            bpy.data.objects[f'{kind}{k}'].data.uv_layers.active.data.foreach_set('uv', a)
    sc = bpy.context.scene
    sc['texel'] = ap.texel_size(body, SIZE)
    d.log(f'texture {SIZE} px, {sc["texel"] * 1000:.2f} mm per texel')
    T = ap.join(targets, 'T'); ap.join([o for o, b in parts if not b], 'X')
    d.ensure_world()
    ap.bake_maps([T], SIZE, 'amraam', OUT, ao_size=SIZE // 2, ao_samples=32, ao_distance=0.5)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)


BODY, RADOME, WINGC, FINC, CTRL = (182, 186, 189), (226, 227, 224), (112, 116, 120), (146, 150, 154), (166, 169, 172)
YELLOW, BROWN, INK = (212, 168, 34), (118, 80, 50), (38, 40, 44)


def layers():
    """Unrolled body: x = s, y = arc length round the body from the top (positive to starboard)."""
    V = (-0.02, 3.68, -0.30, 0.30); ppm = 2000
    Lr = {}
    for name in ('yellow', 'brown'):
        c = Canvas(*V, ppm)
        for s, w, col in BANDS:
            if col == name:
                c.rect(s, V[2], s + w, V[3])
        Lr[name] = c.sampler()
    c = Canvas(*V, ppm); r = Canvas(*V, ppm); ink = Canvas(*V, ppm)
    for s in JOINTS + [3.60]:
        c.line([(s, V[2]), (s, V[3])], 0.0016)
        for k in range(16):       # screws round each joint
            a = (k + 0.5) / 16 * 2 * math.pi * R - math.pi * R
            r.dot(s + 0.014, a, 0.0034)
            if s > NOSE:
                r.dot(s - 0.014, a, 0.0034)
    for s0, s1, a0, a1 in ((0.66, 0.84, 0.10, 0.17), (1.12, 1.30, -0.16, -0.09), (3.28, 3.40, 0.02, 0.08), (2.30, 2.46, 0.20, 0.26)):   # access covers
        c.rrect(s0, a0, s1, a1, 0.008, 0.0014)
        for q in ((s0 + 0.012, a0 + 0.010), (s1 - 0.012, a0 + 0.010), (s0 + 0.012, a1 - 0.010), (s1 - 0.012, a1 - 0.010)):
            r.dot(q[0], q[1], 0.0026)
    rnd = np.random.RandomState(120)
    for s0, a0, n, wmax in ((2.26, 0.105, 4, 0.20), (2.26, -0.150, 3, 0.16), (1.10, 0.110, 2, 0.11), (0.62, -0.128, 2, 0.09), (3.27, -0.120, 2, 0.08), (2.62, 0.118, 2, 0.12)):
        for k in range(n):    # greeked stencil blocks: word-like dashes
            x = s0; end = s0 + wmax * rnd.uniform(0.6, 1.0)
            while x < end:
                w = rnd.uniform(0.006, 0.022)
                ink.rect(x, a0 - k * 0.0105, min(x + w, end), a0 - k * 0.0105 + 0.0052)
                x += w + 0.004
    for k in range(4):        # screws along the wing and fin root fittings
        a = (math.pi / 4 + k * math.pi / 2); a = (a if a < math.pi else a - 2 * math.pi) * R
        for s0, s1 in ((WING['le0'] + 0.03, WING['te0'] - 0.03), (FIN['le0'] + 0.10, FIN['te0'] - 0.03)):
            for sg in (-1, 1):
                r.dots((s0, a + sg * 0.021), (s1, a + sg * 0.021), 0.055, 0.003)
    Lr['line'] = c.sampler(); Lr['riv'] = r.sampler(); Lr['ink'] = ink.sampler()
    return Lr


def paint(M, texel):
    P, N, ID, AO = M['P'], M['N'], M['ID'], M['AO']
    s = L / 2 - P[..., 0]; y = P[..., 1]; z = P[..., 2]
    arc = np.arctan2(z, y) * R; rad = np.hypot(y, z)
    Lr = layers()
    lin = ap.srgb
    body = ID == PID['body']
    col = np.zeros(P.shape, np.float32); rough = np.full(ID.shape, 0.4, np.float32); metal = np.zeros(ID.shape, np.float32)
    n1 = ap.noise3(P, 0.30, 61, 2); n2 = ap.noise3(P, 0.035, 62, 2); n3 = ap.noise3(P, 0.008, 63, 1)
    # ---- body sections
    sec = np.digitize(s, JOINTS)
    tint = ap.cell_tint([s], [JOINTS], 7)
    c = np.broadcast_to(lin(BODY), P.shape).copy()
    c = np.where((s < NOSE)[..., None], lin(RADOME), c); c = np.where((s > JOINTS[3])[..., None], lin(CTRL), c)
    c = np.where((s < 0.012)[..., None], lin((96, 98, 100)), c)
    c = c * (1 + 0.035 * tint)[..., None]
    ye = Lr['yellow'](s, arc); br = Lr['brown'](s, arc)
    c = c + (lin(YELLOW) - c) * ye[..., None]; c = c + (lin(BROWN) - c) * br[..., None]
    rb = np.where(s < NOSE, 0.27, np.where(s > JOINTS[3], 0.36, 0.40)) + 0.05 * (ye + br)
    mb = np.where(s < 0.012, 0.9, np.where(s > JOINTS[3], 0.25, 0.0))
    g = Lr['line'](s, arc); rv = Lr['riv'](s, arc); ik = Lr['ink'](s, arc)
    c = c * (1 - 0.6 * g - 0.62 * rv)[..., None]; c = c + (lin(INK) - c) * (0.9 * ik)[..., None]
    H = -0.0005 * g - 0.0004 * rv
    rb = rb + 0.1 * rv + 0.03 * tint
    # handling marks: faint dark scuffs along the body, a little soot at the tail
    scuff = np.clip(ap.noise3(np.stack([P[..., 0] * 0.2, P[..., 1] * 2.5, P[..., 2] * 2.5], -1), 0.03, 70, 3) - 0.25, 0, 1) * (s > NOSE)
    c = c * (1 - 0.07 * scuff)[..., None]; rb = rb + 0.06 * scuff
    soot = smoothstep(3.52, 3.65, s)
    c = c * (1 - 0.35 * soot)[..., None]
    col = np.where(body[..., None], c, col); rough = np.where(body, rb, rough); metal = np.where(body, mb, metal)
    H = H * body
    # ---- wings and fins: bare grey metal, a root fillet line and leading-edge polish
    for k, base, ro, me, le0, te0 in (('wing', WINGC, 0.40, 0.75, WING['le0'], WING['te0']), ('fin', FINC, 0.42, 0.6, FIN['le0'], FIN['te0'])):
        w = ID == PID[k]
        span = np.clip((rad - R) / 0.135, 0, 1)
        cc = lin(base) * (1 + 0.05 * n1 + 0.03 * n2)[..., None]
        root = ap.groove(np.abs(rad - (R + 0.012)), 0.0014)
        cc = cc * (1 - 0.35 * root)[..., None]
        col = np.where(w[..., None], cc, col); rough = np.where(w, ro + 0.05 * n2, rough); metal = np.where(w, me, metal)
        H = np.where(w, -0.0003 * root, H)
    for k, base, ro, me in (('hanger', (72, 75, 79), 0.38, 0.8), ('raceway', BODY, 0.42, 0.0), ('base', (30, 29, 28), 0.6, 0.6), ('hub', (120, 123, 126), 0.4, 0.7)):
        w = ID == PID[k]
        col = np.where(w[..., None], lin(base) * (1 + 0.04 * n2)[..., None], col); rough = np.where(w, ro, rough); metal = np.where(w, me, metal)
    col = col * (1 + 0.018 * n1 + 0.012 * n2 + 0.006 * n3)[..., None]
    rough = rough + 0.035 * n1 - 0.025 * n2
    occ = np.clip(1 - AO, 0, 1)
    col = col * (1 - 0.25 * occ ** 1.5)[..., None]; rough = np.clip(rough + 0.05 * occ, 0.05, 1)
    nrm = ap.normal_from_height(H, np.full(ID.shape, texel, np.float32), ID)
    return col, rough, metal, AO, nrm


def paint_export():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    sc = bpy.context.scene; obj = bpy.data.objects
    M = ap.load_maps('amraam', OUT)
    res = paint(M, sc['texel'])
    maps = ap.save_maps('amraam', OUT, *res)
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
