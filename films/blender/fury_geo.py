# Anduril YFQ-44A "Fury": geometry. Imported by fury.py (the generator); kept apart from the paint.
# Body frame: +x forward, +y up, +z starboard, metres; s = metres aft of the nose tip. Dimensions are read
# off released photographs (side elevation of the missile launch, scaled by the 3.65 m AIM-120) and are
# estimates. The constants shared with the film (films/src/fury_assets.js: FURY) are marked [FURY].
import math

import numpy as np

import acpaint as ap
from acpaint import Mesh, pchip

X0 = 5.2                                   # [FURY] nose tip is X0 ahead of the model origin
CH = -0.20                                 # [FURY] chine / wing plane
GROUND = -1.20                             # [FURY] ground plane when standing on the wheels
RAIL_Z, RAIL_S0, RAIL_S1, RAIL_Y = 1.85, 3.93, 6.73, -0.40       # [FURY] launcher rail
MSL_LEN, MSL_R, MSL_NOSE_S, MSL_Y = 3.65, 0.089, 3.07, -0.557    # [FURY] missile on the rail
WING = dict(z0=0.60, z1=3.30, le0=4.50, te0=6.55, le1=6.25, te1=7.55)      # both edges swept back, a long tip chord
STAB = dict(z0=0.20, z1=1.84, le0=7.95, te0=9.45, le1=9.20, te1=10.00, y=CH + 0.01)
NOSE_GEAR = dict(s=3.60, r=0.180, w=0.115)                       # [FURY]
MAIN_GEAR = dict(s=5.75, z=0.86, r=0.235, w=0.155)               # [FURY]
NOZ_Y, NOZ_R, NOZ_S = CH + 0.25, 0.20, 9.90                      # [FURY] nozzleY, nozzleR, nozzleX = X(NOZ_S)
FIN_BASE, FIN_TOP = 0.25, 1.84                                   # [FURY] finTopY


def X(s):
    return X0 - s


def fin_le(y):
    return 8.15 + (y + 0.2 - 0.78) * 0.9055


def fin_te(y):
    return 9.47 + (y + 0.2 - 0.62) * 0.3007


def wing_le(z):
    return WING['le0'] + (WING['le1'] - WING['le0']) * (z - WING['z0']) / (WING['z1'] - WING['z0'])


def wing_te(z):
    return WING['te0'] + (WING['te1'] - WING['te0']) * (z - WING['z0']) / (WING['z1'] - WING['z0'])


def stab_le(z):
    return STAB['le0'] + (STAB['le1'] - STAB['le0']) * (z - STAB['z0']) / (STAB['z1'] - STAB['z0'])


def stab_te(z):
    return STAB['te0'] + (STAB['te1'] - STAB['te0']) * (z - STAB['z0']) / (STAB['z1'] - STAB['z0'])


# part ids the painter keys on
PID = dict(fus=1, blister=2, spine=3, box=4, lip=5, duct=6, splitter=7, fin=8, wing=10, stab=11,
           shroud=20, pipe=21, cone=22, rail=30, railhw=31, pylon=32,
           tyre=40, hub=41, strut=42, chrome=43, dark=44, door=45, doorin=46, steel=47,
           blade=50, probe=51, lens_r=52, lens_g=53, lens_w=54)

# fuselage: s, y offset of the chine line, half width, height above, depth below, and the section exponents:
# upper half  y = ht * (1 - |z/w|^nt)^(1/mt)   (mt = 1: a sharp chine; nt, mt = 2: an ellipse), lower likewise
DROOP = 0.06                               # the nose tip sits this far below the chine / wing plane
FUS = [
    (0.00, -0.0600, 0.004, 0.004, 0.003, 2.0, 1.0, 2.0, 1.0),
    (0.25, -0.0504, 0.070, 0.082, 0.020, 2.0, 1.0, 2.0, 1.0),
    (0.50, -0.0417, 0.136, 0.157, 0.036, 2.0, 1.0, 2.0, 1.0),
    (1.00, -0.0267, 0.262, 0.307, 0.060, 2.1, 1.0, 2.0, 1.0),
    (1.50, -0.0150, 0.378, 0.440, 0.080, 2.2, 1.0, 2.0, 1.0),
    (2.00, -0.0067, 0.482, 0.547, 0.090, 2.4, 1.0, 2.0, 1.0),
    (2.60, -0.0010, 0.578, 0.621, 0.086, 2.7, 1.0, 2.0, 1.0),
    (3.50, 0.00, 0.672, 0.652, 0.080, 3.0, 1.0, 2.0, 1.0),
    (4.40, 0.00, 0.715, 0.645, 0.080, 3.2, 1.0, 2.0, 1.0),
    (6.00, 0.00, 0.715, 0.640, 0.140, 3.2, 1.0, 2.0, 1.0),
    (7.20, 0.00, 0.680, 0.635, 0.400, 3.0, 1.05, 2.2, 1.3),
    (8.20, 0.06, 0.540, 0.580, 0.280, 2.5, 1.35, 2.2, 1.7),
    (9.00, 0.23, 0.350, 0.310, 0.310, 2.1, 1.8, 2.0, 2.0),
    (9.55, 0.25, 0.245, 0.235, 0.235, 2.0, 2.0, 2.0, 2.0),
    (9.86, 0.25, 0.212, 0.212, 0.212, 2.0, 2.0, 2.0, 2.0),
]
_F = {k: pchip([r[0] for r in FUS], [r[i + 1] for r in FUS]) for i, k in enumerate(('y', 'w', 'ht', 'hb', 'nt', 'mt', 'nb', 'mb'))}
FUS_SPLIT = (3.40, 6.80)          # ring seams between the three UV islands


def fus_point(s, th):
    """Point on the fuselage at station s (m aft of the nose) and section angle th (0 = crown, pi/2 =
    starboard chine, pi = keel)."""
    s = np.asarray(s, float); th = np.asarray(th, float)
    a = np.abs(np.sin(th)); top = np.cos(th) >= 0
    cy = CH + _F['y'](s)
    yt = _F['ht'](s) * np.power(np.maximum(1 - np.power(a, _F['nt'](s)), 0), 1 / _F['mt'](s))
    yb = -_F['hb'](s) * np.power(np.maximum(1 - np.power(a, _F['nb'](s)), 0), 1 / _F['mb'](s))
    return np.stack([X(s) + 0 * th, cy + np.where(top, yt, yb), _F['w'](s) * np.sin(th)], -1)


def deck(s):
    """Height of the fuselage crown."""
    return CH + _F['y'](s) + _F['ht'](s)


def flank(s, f):
    """Point on the starboard upper flank at a fraction f (0 crown .. 1 chine) of the half width."""
    return fus_point(s, math.asin(f))


def fuselage():
    nT = 88
    cuts = [0.0, 0.5, FUS_SPLIT[0], FUS_SPLIT[1], 9.86]
    ns = [10, 40, 42, 44]
    m = Mesh()
    th = np.pi + 2 * np.pi * np.arange(nT + 1) / nT
    # denser where the section turns sharply (the chines)
    th = th + 0.22 * np.sin(2 * (th - np.pi))
    segs = [(0, 2), (2, 3), (3, 4)]
    for k, (a, b) in enumerate(segs):           # six islands: three lengths, each split along the crown into a port and a starboard half
        ss = np.unique(np.concatenate([np.linspace(cuts[i], cuts[i + 1], ns[i] + 1) for i in range(a, b)]))
        P = fus_point(ss[:, None], th[None, :])
        arc = np.concatenate([np.zeros((len(ss), 1)), np.cumsum(np.linalg.norm(np.diff(P, axis=1), axis=2), axis=1)], 1)
        arc -= arc[:, nT // 2:nT // 2 + 1]
        UV = np.stack([np.broadcast_to(ss[:, None], arc.shape), arc], -1)
        h = nT // 2
        m.grid(P[:, :h + 1], UV[:, :h + 1] + np.array([0.0, 20.0 * k])); m.grid(P[:, h:], UV[:, h:] + np.array([0.0, 20.0 * k + 10.0]))
    tip = fus_point(0.0, th[:-1])
    m.poly(tip, [(0.0, 0.0)] * nT, out=(1, 0, 0))
    return m


def half_loft(stations, base_y, n=2.4, nT=20, nS=40, sink=0.03):
    """Fairing sitting on the fuselage crown: stations [(s, half width, height)], upper half of a
    super-ellipse, sunk a little into the skin."""
    ss = np.linspace(stations[0][0], stations[-1][0], nS + 1)
    w = pchip([q[0] for q in stations], [q[1] for q in stations])(ss)
    h = pchip([q[0] for q in stations], [q[2] for q in stations])(ss)
    th = np.linspace(-np.pi / 2, np.pi / 2, nT + 1)
    e = 2 / n
    c = np.sign(np.cos(th)) * np.abs(np.cos(th)) ** e; sn = np.sign(np.sin(th)) * np.abs(np.sin(th)) ** e
    by = np.array([base_y(s) for s in ss]) - sink
    P = np.stack([np.broadcast_to(X(ss)[:, None], (nS + 1, nT + 1)), by[:, None] + (h + sink)[:, None] * c[None, :], w[:, None] * sn[None, :]], -1)
    arc = np.concatenate([np.zeros((nS + 1, 1)), np.cumsum(np.linalg.norm(np.diff(P, axis=1), axis=2), axis=1)], 1)
    UV = np.stack([np.broadcast_to(ss[:, None], arc.shape), arc - arc[:, nT // 2:nT // 2 + 1]], -1)
    return Mesh().grid(P, UV, flip=None)


def spine():
    m = half_loft([(3.00, 0.010, 0.0), (3.30, 0.100, 0.050), (4.20, 0.150, 0.072), (6.40, 0.170, 0.078), (7.60, 0.160, 0.078),
                   (8.10, 0.100, 0.066), (8.45, 0.030, 0.030)], deck, n=2.7, nS=60)
    bump = half_loft([(4.50, 0.004, 0.0), (4.56, 0.075, 0.105), (4.68, 0.105, 0.130), (4.90, 0.095, 0.118), (5.08, 0.060, 0.094), (5.22, 0.004, 0.06)],
                     lambda s: float(deck(s)), n=2.3, nS=28, nT=16)
    return m.add(bump)


def blister():
    return half_loft([(1.62, 0.004, 0.0), (1.70, 0.045, 0.078), (1.84, 0.072, 0.100), (2.10, 0.070, 0.078), (2.42, 0.040, 0.032), (2.66, 0.004, 0.0)],
                     lambda s: float(deck(s)), n=2.1, nS=30, nT=18)


# ventral inlet and keel box: s, bottom y, half width at the top, half width at the bottom, s of the top edge
BOX = [(3.00, CH - 0.400, 0.470, 0.345, 2.60), (3.30, CH - 0.430, 0.490, 0.360, 3.05), (3.70, CH - 0.440, 0.505, 0.375, 3.70),
       (4.50, CH - 0.440, 0.515, 0.385, 4.50), (6.00, CH - 0.440, 0.515, 0.385, 6.00), (6.70, CH - 0.425, 0.500, 0.370, 6.70),
       (7.25, CH - 0.385, 0.450, 0.320, 7.25), (7.70, CH - 0.300, 0.380, 0.240, 7.70), (8.05, CH - 0.190, 0.280, 0.140, 8.05)]


def box_ring(q):
    s, yb, wt, wb, st = q; yt = CH - 0.03; c = 0.06; sm = st + (s - st) * 0.75
    return [[X(st), yt, wt], [X(sm), yb + c, wb + 0.045], [X(s), yb, wb], [X(s), yb, -wb], [X(sm), yb + c, -wb - 0.045], [X(st), yt, -wt]]


def box_parts():
    rings = [box_ring(q) for q in BOX]
    body = ap.ring_loft(rings, closed=False, caps=(False, False))        # open on top: that face is inside the fuselage

    def inset(ring, k, dx=0.0):
        r = np.asarray(ring, float); cy = r[:, 1].mean()
        return np.stack([r[:, 0] - dx, r[:, 1] + (cy - r[:, 1]) * k * 2.2, r[:, 2] * (1 - k * 1.4)], 1)
    r0 = inset(rings[0], 0.05, 0.004); r1 = inset(rings[1], 0.07); r2 = inset(rings[2], 0.16, 0.2); r2[:, 1] += 0.03; r2[:, 2] *= 0.92
    r3 = r2.copy(); r3[:, 0] -= 0.9; r3[:, 1] += 0.1; r3[:, 2] *= 0.6
    lip = ap.ring_loft([np.asarray(rings[0]), r0])
    duct = ap.ring_loft([r0, r1, r2, r3], caps=(False, True)).flipped()
    y = CH - 0.092
    splitter = ap.plate([[X(2.40), y, 0], [X(2.63), y, 0.47], [X(3.30), y, 0.50], [X(3.30), y, -0.50], [X(2.63), y, -0.47]], [0, 1, 0], 0.014)
    return body, lip, duct, splitter


def wing_mesh():
    W = WING; f = 0.974
    sec = [dict(z=W['z0'], le=X(W['le0']), te=X(W['te0']), y=CH, t=0.050),
           dict(z=W['z1'] - 0.07, le=X(wing_le(W['z1'] - 0.07)), te=X(wing_te(W['z1'] - 0.07)), y=CH, t=0.044),
           dict(z=W['z1'], le=X(W['le1'] + 0.07), te=X(W['te1'] - 0.02), y=CH, t=0.026)]
    return ap.wing(sec, nC=30, nSpan=10, x0=X0, edge=0.0015)


def stab_mesh():
    S = STAB
    sec = [dict(z=S['z0'], le=X(S['le0']), te=X(S['te0']), y=S['y'], t=0.045),
           dict(z=S['z1'] - 0.06, le=X(stab_le(S['z1'] - 0.06)), te=X(stab_te(S['z1'] - 0.06)), y=S['y'], t=0.042),
           dict(z=S['z1'], le=X(S['le1'] + 0.06), te=X(S['te1'] - 0.015), y=S['y'], t=0.026)]
    return ap.wing(sec, nC=22, nSpan=8, x0=X0, edge=0.0012)


def fin_mesh():
    b, t = FIN_BASE, FIN_TOP
    k = 0.66      # below this height the leading edge runs forward into a low dorsal fillet
    sec = [dict(z=b, le=X(6.90), te=X(fin_te(b)), t=0.026), dict(z=k, le=X(fin_le(k)), te=X(fin_te(k)), t=0.050),
           dict(z=t - 0.05, le=X(fin_le(t - 0.05)), te=X(fin_te(t - 0.05)), t=0.046),
           dict(z=t, le=X(fin_le(t) + 0.05), te=X(fin_te(t) - 0.012), t=0.028)]
    m = ap.wing(sec, nC=24, nSpan=10, x0=X0, edge=0.0012)
    # span -> up; the section's upper surface becomes the port side
    m.v = [(x, z, -y) for x, y, z in m.v]
    return m


def nozzle_parts():
    o = (X0, NOZ_Y, 0.0); ax = (-1, 0, 0)
    shroud = ap.lathe([(0.2125, 9.80), (0.2110, 9.88), (0.2050, 9.925), (0.1970, 9.945), (0.1880, 9.925)], o, ax, 56)
    pipe = ap.lathe([(0.1880, 9.925), (0.1790, 9.75), (0.1850, 9.45), (0.2000, 9.10), (0.2000, 8.86)], o, ax, 48).flipped()
    cone = ap.lathe([(0.0005, 9.42), (0.040, 9.37), (0.085, 9.18), (0.105, 8.96), (0.2000, 8.90)], o, ax, 28)
    for k in range(14):
        an = k / 14 * 2 * np.pi; c, sn = math.cos(an), math.sin(an)
        cone.add(ap.plate([[X(8.92), NOZ_Y + 0.10 * c, 0.10 * sn], [X(8.92), NOZ_Y + 0.198 * c, 0.198 * sn], [X(9.02), NOZ_Y + 0.198 * c, 0.198 * sn],
                           [X(9.04), NOZ_Y + 0.095 * c, 0.095 * sn]], [0, -sn, c], 0.006))
    return shroud, pipe, cone


def launcher_parts():
    """LAU-style rail launcher and its pylon on the starboard wing (mirrored for the port wing)."""
    z, y0 = RAIL_Z, RAIL_Y
    prof = np.array([(0.055, -0.050), (0.055, 0.036), (0.040, 0.058), (-0.040, 0.058), (-0.055, 0.036), (-0.055, -0.050)])   # (z, y)
    st = [(RAIL_S0, 0.10, 0.22), (RAIL_S0 + 0.025, 0.40, 0.55), (RAIL_S0 + 0.075, 0.68, 0.80), (RAIL_S0 + 0.15, 0.88, 0.94), (RAIL_S0 + 0.27, 1.0, 1.0),
          (RAIL_S1 - 0.14, 1.0, 1.0), (RAIL_S1 - 0.04, 0.93, 0.97), (RAIL_S1, 0.84, 0.92)]
    mid = (RAIL_S0 + RAIL_S1) / 2
    ring = lambda s, ky, kz: [[X(s), y0 - 0.050 + (py + 0.050) * ky, z + pz * kz] for pz, py in prof]
    # two halves, so that no UV island is as long as the whole beam
    beam = ap.ring_loft([ring(*q) for q in st[:5]] + [ring(mid, 1.0, 1.0)], caps=(True, False))
    beam_aft = ap.ring_loft([ring(mid, 1.0, 1.0)] + [ring(*q) for q in st[5:]], caps=(False, True))
    hw = Mesh()
    for sg in (1, -1):      # the guide rails under the beam
        hw.add(ap.box((X((RAIL_S0 + RAIL_S1) / 2 + 0.08), y0 - 0.056, z + sg * 0.036), (RAIL_S1 - RAIL_S0 - 0.42, 0.012, 0.016)))
    hw.add(ap.box((X((RAIL_S0 + RAIL_S1) / 2 + 0.08), y0 - 0.051, z), (RAIL_S1 - RAIL_S0 - 0.46, 0.004, 0.056)))
    for s in (4.36, 5.30, 6.42):  # snubber / detent housings on the flanks
        for sg in (1, -1):
            hw.add(ap.box((X(s), y0 - 0.022, z + sg * 0.058), (0.11, 0.040, 0.012)))
    hw.add(ap.box((X(4.72), y0 + 0.064, z), (0.30, 0.016, 0.070)))     # umbilical housing on top, ahead of the pylon
    # pylon: a raked slab from the beam up into the wing
    yb, yt = y0 + 0.050, CH + 0.004
    sec = [dict(z=0.0, le=X(5.26), te=X(6.84), t=0.046), dict(z=yt - yb, le=X(5.50), te=X(7.00), t=0.046)]
    py = ap.wing(sec, nC=14, nSpan=3, profile='lens', cap=False, uv=False)
    py.v = [(x, yb + zz, z - yy) for x, yy, zz in py.v]
    return beam, beam_aft, hw, py


def wheel(c, r, w, seg=44):
    """Tyre, hub and the dark relief of a wheel whose axle runs along z, centred at c."""
    t = [(r * 0.50, -w * 0.38), (r * 0.56, -w * 0.46), (r * 0.70, -w * 0.50), (r * 0.86, -w * 0.49), (r * 0.955, -w * 0.42), (r * 0.992, -w * 0.28), (r, -w * 0.12),
         (r, w * 0.12), (r * 0.992, w * 0.28), (r * 0.955, w * 0.42), (r * 0.86, w * 0.49), (r * 0.70, w * 0.50), (r * 0.56, w * 0.46), (r * 0.50, w * 0.38)]
    tyre = ap.lathe(t, c, (0, 0, 1), seg)
    h = [(0.0005, w * 0.30), (r * 0.09, w * 0.30), (r * 0.12, w * 0.22), (r * 0.30, w * 0.16), (r * 0.42, w * 0.26), (r * 0.47, w * 0.385), (r * 0.51, w * 0.40),
         (r * 0.51, -w * 0.40), (r * 0.47, -w * 0.385), (r * 0.42, -w * 0.26), (r * 0.30, -w * 0.16), (r * 0.12, -w * 0.22), (r * 0.09, -w * 0.30), (0.0005, -w * 0.30)]
    hub = ap.lathe(h, c, (0, 0, 1), 32)
    dark = Mesh()
    for k in range(8):
        a = k / 8 * 2 * np.pi
        for sg in (1, -1):
            p = (c[0] + math.cos(a) * r * 0.36, c[1] + math.sin(a) * r * 0.36, c[2] + sg * w * 0.21)
            dark.add(ap.rod(p, (p[0], p[1], p[2] + sg * 0.004), r * 0.048, 10))
            b = (c[0] + math.cos(a + 0.39) * r * 0.21, c[1] + math.sin(a + 0.39) * r * 0.21, c[2] + sg * w * 0.19)
            hub.add(ap.rod(b, (b[0], b[1], b[2] + sg * 0.012), r * 0.030, 6))
    return tyre, hub, dark


def gear_parts():
    """Landing gear, down. Returns {pid name: (centre mesh, starboard mesh to mirror)}."""
    out = {k: [Mesh(), Mesh()] for k in ('tyre', 'hub', 'dark', 'strut', 'chrome', 'door', 'doorin', 'steel')}

    def put(k, m, side=0):
        out[k][side].add(m)
    # ---- nose gear: single wheel in a half fork, oleo, torque links, drag brace, landing light
    x, r, w = X(NOSE_GEAR['s']), NOSE_GEAR['r'], NOSE_GEAR['w']; ya = GROUND + r; top = CH - 0.40
    ty, hb, dk = wheel((x, ya, 0), r, w); put('tyre', ty); put('hub', hb); put('dark', dk)
    put('steel', ap.rod((x, ya, -0.075), (x, ya, 0.092), 0.019, 12))
    put('strut', ap.rod((x, ya, 0.086), (x + 0.03, ya + 0.165, 0.086), 0.022, 12).add(ap.rod((x + 0.03, ya + 0.165, 0.090), (x + 0.03, ya + 0.215, 0.0), 0.024, 12))
        .add(ap.rod((x + 0.03, ya + 0.19, 0), (x + 0.03, ya + 0.235, 0), 0.036, 16)))
    put('chrome', ap.rod((x + 0.03, ya + 0.225, 0), (x + 0.03, ya + 0.345, 0), 0.0185, 16))
    put('strut', ap.rod((x + 0.03, ya + 0.335, 0), (x + 0.03, top + 0.10, 0), 0.034, 18).add(ap.rod((x + 0.03, ya + 0.325, 0), (x + 0.03, ya + 0.365, 0), 0.044, 18))
        .add(ap.rod((x + 0.03, ya + 0.47, 0), (x + 0.03, ya + 0.50, 0), 0.041, 18)))
    for sg in (1, -1):      # torque links behind the oleo
        put('strut', ap.plate([[x - 0.005, ya + 0.20, 0], [x - 0.085, ya + 0.275, 0], [x - 0.075, ya + 0.290, 0], [x + 0.0, ya + 0.225, 0]], [0, 0, 1], 0.012).moved(dz=sg * 0.022))
        put('strut', ap.plate([[x - 0.085, ya + 0.275, 0], [x - 0.005, ya + 0.350, 0], [x + 0.0, ya + 0.330, 0], [x - 0.072, ya + 0.268, 0]], [0, 0, 1], 0.012).moved(dz=sg * 0.022))
    put('steel', ap.rod((x - 0.08, ya + 0.279, -0.032), (x - 0.08, ya + 0.279, 0.032), 0.008, 8))
    put('strut', ap.rod((x + 0.03, ya + 0.40, 0), (x + 0.44, top + 0.04, 0), 0.016, 10))                     # drag brace
    put('steel', ap.rod((x + 0.07, ya + 0.43, 0), (x + 0.105, ya + 0.43, 0), 0.030, 14, 0.034))              # landing light
    put('chrome', ap.rod((x + 0.105, ya + 0.43, 0), (x + 0.108, ya + 0.43, 0), 0.031, 14))
    put('steel', ap.rod((x + 0.045, ya + 0.20, 0.05), (x + 0.05, ya + 0.55, 0.035), 0.004, 6))              # brake / steering line
    for sg in (1, -1):      # bay doors, hinged along the bay edges
        o = [[X(3.22), top - 0.015, sg * 0.105], [X(4.02), top - 0.015, sg * 0.105], [X(4.00), top - 0.215, sg * 0.16], [X(3.26), top - 0.19, sg * 0.16]]
        n = np.array([0, 0.27, sg * 1.0]); n /= np.linalg.norm(n)
        put('door', ap.plate(o, n, 0.012))
        inner = [[p[0] + (0.03 if i in (0, 3) else -0.03), p[1] + (-0.02 if i < 2 else 0.02), p[2]] for i, p in enumerate(o)]
        put('doorin', ap.plate(inner, n, 0.010).moved(dy=-0.004 * n[1], dz=-sg * 0.009))
        for sx in (3.40, 3.84):
            put('steel', ap.rod((X(sx), top + 0.02, sg * 0.08), (X(sx), top - 0.10, sg * 0.127), 0.006, 6))
    put('dark', ap.box((X(3.62), top + 0.004, 0), (0.98, 0.006, 0.215)))
    # ---- main gear (starboard; mirrored): trailing arm out of the keel box, shock strut, wheel outboard
    x, z, r, w = X(MAIN_GEAR['s']), MAIN_GEAR['z'], MAIN_GEAR['r'], MAIN_GEAR['w']; ya = GROUND + r; zi = 0.47; yt = CH - 0.37
    ty, hb, dk = wheel((x, ya, z), r, w); put('tyre', ty, 1); put('hub', hb, 1); put('dark', dk, 1)
    pv = (x + 0.36, ya + 0.19, 0.70)
    put('steel', ap.rod((x, ya, z - 0.15), (x, ya, z + 0.03), 0.026, 12), 1)
    put('strut', ap.rod((x, ya, z - 0.135), pv, 0.031, 14).add(ap.rod(pv, (x + 0.30, yt, zi), 0.043, 18))
        .add(ap.rod((x + 0.13, ya + 0.37, 0.615), (x + 0.20, yt + 0.02, zi), 0.031, 14)).add(ap.rod(pv, (x + 0.62, yt + 0.03, zi), 0.018, 10))
        .add(ap.rod((x + 0.02, ya + 0.055, z - 0.135), (x + 0.075, ya + 0.20, 0.665), 0.026, 12))
        .add(ap.rod((pv[0], pv[1], pv[2] - 0.045), (pv[0], pv[1], pv[2] + 0.045), 0.040, 14)), 1)
    put('chrome', ap.rod((x + 0.06, ya + 0.165, 0.675), (x + 0.125, ya + 0.355, 0.62), 0.0165, 14), 1)
    put('steel', ap.rod((x - 0.01, ya + 0.02, z - 0.14), (x - 0.01, ya + 0.02, z - 0.205), 0.088, 20).add(ap.rod((x - 0.01, ya + 0.02, z - 0.205), (x - 0.01, ya + 0.02, z - 0.235), 0.050, 14))
        .add(ap.rod((x + 0.03, ya + 0.09, z - 0.19), (x + 0.26, yt + 0.02, zi + 0.02), 0.0045, 6)), 1)
    o = [[X(5.20), yt - 0.075, 0.44], [X(6.34), yt - 0.075, 0.44], [X(6.30), yt - 0.36, 0.59], [X(5.24), yt - 0.36, 0.59]]
    n = np.array([0, 0.46, 1.0]); n /= np.linalg.norm(n)
    put('door', ap.plate(o, n, 0.014), 1)
    inner = [[p[0] + (0.035 if i in (0, 3) else -0.035), p[1] + (-0.025 if i < 2 else 0.025), p[2]] for i, p in enumerate(o)]
    put('doorin', ap.plate(inner, n, 0.012).moved(dy=-0.005 * n[1], dz=-0.010), 1)
    for sx in (5.42, 6.12):
        put('steel', ap.rod((X(sx), yt + 0.01, 0.42), (X(sx), yt - 0.20, 0.50), 0.007, 6), 1)
    put('dark', ap.box((X(5.77), CH - 0.255, 0.4775), (1.24, 0.30, 0.006), ap.rot_x(0.26)), 1)
    return out


def blade(s, y, h, c, sweep, th, up=1):
    """Swept blade antenna standing on the centre line."""
    o = [[X(s) + c * 0.5, y, 0], [X(s) - c * 0.5, y, 0], [X(s) - c * 0.5 - sweep * 0.6, y + h * up, 0], [X(s) - c * 0.5 - sweep * 0.6 + c * 0.42, y + h * up, 0]]
    return ap.plate(o, [0, 0, 1], th)


def antenna_parts():
    c = Mesh(); side = Mesh(); probe = Mesh()
    c.add(blade(7.05, float(deck(7.05)) + 0.06, 0.185, 0.20, 0.17, 0.012))
    for s in (3.70, 4.10, 4.42):
        c.add(blade(s, float(deck(s)) + 0.058, 0.042, 0.065, 0.02, 0.006))
    c.add(blade(8.02, CH + float(_F['y'](8.02)) - float(_F['hb'](8.02)) + 0.015, 0.20, 0.20, 0.15, 0.014, -1))
    # L-shaped air-data probe on the nose flank; two small probes on the inlet side wall (starboard; mirrored)
    p = flank(1.78, 0.80); q = p + np.array([-0.035, 0.035, 0.085])
    side.add(ap.rod(p - np.array([-0.06, 0.01, 0.01]), q, 0.016, 8, 0.011)).add(ap.rod(q + np.array([-0.03, 0, 0]), q + np.array([0.30, 0.012, 0.0]), 0.011, 8, 0.006))
    side.add(ap.rod((X(3.72), -0.41, 0.50), (X(3.72), -0.41, 0.575), 0.007, 6)).add(ap.rod((X(3.72), -0.41, 0.575), (X(3.60), -0.41, 0.578), 0.006, 6, 0.004))
    side.add(ap.rod((X(4.28), -0.555, 0.46), (X(4.28), -0.60, 0.52), 0.006, 6)).add(ap.rod((X(4.28), -0.60, 0.52), (X(4.20), -0.60, 0.523), 0.005, 6, 0.003))
    for sg in (1, -1):      # stabilator pivot fairings
        probe.add(ap.rod((X(8.92), STAB['y'], sg * 0.20), (X(8.92), STAB['y'], sg * 0.48), 0.05, 12))
    return c, side, probe


NAV = dict(green=(X(WING['le1'] + 0.17), CH + 0.004, WING['z1'] - 0.012), red=(X(WING['le1'] + 0.17), CH + 0.004, -(WING['z1'] - 0.012)),
           tail=(X(fin_te(1.70)) - 0.014, 1.70, 0.0))


def lens(p, r=0.022):
    P = np.array([[[p[0] + 1.8 * r * math.cos(a) * math.cos(b), p[1] + 0.6 * r * math.sin(b), p[2] + 0.6 * r * math.sin(a) * math.cos(b)]
                   for a in np.linspace(0, 2 * np.pi, 13)] for b in np.linspace(-np.pi / 2, np.pi / 2, 7)])
    return Mesh().grid(P)
