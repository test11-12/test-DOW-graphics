"""Hermeus Quarterhorse Mk 2.1: shape definitions shared by the Blender modeller (qh_geo.py) and the texture
painter (qh_paint.py). Pure numpy. Stations s are metres aft of the inlet lip; Blender frame +X forward, +Z up,
+Y port (X = X0 - s)."""
import math
import numpy as np

X0 = 8.3                 # inlet lip at X = 8.3; nozzle exit 14.6 m aft (X = -6.3)
NOZ_Z = 0.06             # nozzle axis height
GROUND = -1.495          # nose-tyre contact height
MAIN_DROP = 0.13         # the main tyres stand this much lower in the body frame: the aircraft sits about 1.5 deg nose-down
NOZZLE_EXIT_S = 14.58


def X(s):
    return X0 - np.asarray(s, float) if not np.isscalar(s) else X0 - s


# ------------------------------------------------------------------ small math
def pchip(xk, yk, x):
    """Monotone cubic interpolation (Fritsch-Carlson), vectorised; clamps outside the knots."""
    xk = np.asarray(xk, float); yk = np.asarray(yk, float); x = np.clip(np.asarray(x, float), xk[0], xk[-1])
    h = np.diff(xk); dl = np.diff(yk) / h
    m = np.zeros_like(yk)
    m[0], m[-1] = dl[0], dl[-1]
    for i in range(1, len(xk) - 1):
        if dl[i - 1] * dl[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
    i = np.clip(np.searchsorted(xk, x) - 1, 0, len(xk) - 2)
    t = (x - xk[i]) / h[i]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    return h00 * yk[i] + h10 * h[i] * m[i] + h01 * yk[i + 1] + h11 * h[i] * m[i + 1]


#        s      zc     hw     ht     hb     nt    nb
FUS = np.array([
    [0.03, 0.231, 0.462, 0.476, 0.478, 2.0, 2.0],
    [0.30, 0.236, 0.500, 0.510, 0.515, 2.0, 2.0],
    [0.60, 0.245, 0.536, 0.546, 0.555, 2.0, 2.05],
    [1.00, 0.255, 0.580, 0.590, 0.600, 2.0, 2.10],
    [1.50, 0.262, 0.625, 0.652, 0.662, 2.0, 2.15],
    [2.00, 0.268, 0.660, 0.708, 0.715, 2.0, 2.20],
    [2.50, 0.268, 0.686, 0.752, 0.764, 2.0, 2.25],
    [3.00, 0.265, 0.702, 0.790, 0.804, 2.0, 2.30],
    [4.00, 0.258, 0.719, 0.850, 0.860, 2.0, 2.35],
    [5.00, 0.243, 0.728, 0.884, 0.894, 2.0, 2.40],
    [6.00, 0.225, 0.732, 0.908, 0.925, 2.0, 2.40],
    [7.00, 0.205, 0.732, 0.922, 0.934, 2.0, 2.40],
    [8.00, 0.195, 0.725, 0.898, 0.910, 2.0, 2.40],
    [9.00, 0.185, 0.705, 0.872, 0.885, 2.0, 2.35],
    [10.0, 0.175, 0.680, 0.828, 0.832, 2.0, 2.30],
    [11.0, 0.160, 0.650, 0.774, 0.772, 2.0, 2.25],
    [12.0, 0.130, 0.618, 0.705, 0.700, 2.0, 2.15],
    [12.8, 0.100, 0.594, 0.640, 0.630, 2.0, 2.05],
    [13.4, 0.076, 0.578, 0.582, 0.576, 2.0, 2.00],
])
FUS_S0, FUS_S1 = 0.03, 13.40
FUS_N = 128
# fuselage UV pieces: (s0, s1, texel-density factor) - the close shots look at s 3..10
FUS_PIECES = [(0.03, 3.0, 1.0), (3.0, 7.0, 1.32), (7.0, 10.3, 1.22), (10.3, 13.4, 0.92)]


def fus_params(s):
    s = np.asarray(s, float)
    return [pchip(FUS[:, 0], FUS[:, k], s) for k in range(1, 7)]


def fus_dense(s, M=2048):
    """Dense cross-section loops (y, z) for stations s, starting at the bottom centreline and running up the
    starboard side (-y), over the top and down the port side. Returns P (len(s), M, 2), cumulative arc (len(s), M+1)."""
    s = np.atleast_1d(np.asarray(s, float))
    zc, hw, ht, hb, nt, nb = [a[:, None] for a in fus_params(s)]
    psi = np.linspace(0, 2 * math.pi, M, endpoint=False)[None, :]
    c, sn = np.cos(psi), np.sin(psi)
    lower = c >= 0
    h = np.where(lower, hb, ht); n = np.where(lower, nb, nt)
    z = zc - h * np.sign(c) * np.abs(c) ** (2 / n)
    y = -hw * np.sign(sn) * np.abs(sn) ** (2 / n)
    P = np.stack([y, z], -1)
    d = np.linalg.norm(np.diff(np.concatenate([P, P[:, :1]], 1), axis=1), axis=-1)
    arc = np.concatenate([np.zeros((len(s), 1)), np.cumsum(d, 1)], 1)
    return P, arc


def fus_ring(s, N):
    """N points per station, uniform in arc length from the bottom centre. Returns (len(s), N, 2) and girths."""
    P, arc = fus_dense(s)
    girth = arc[:, -1]
    Pc = np.concatenate([P, P[:, :1]], 1)
    out = np.zeros((len(P), N, 2))
    for i in range(len(P)):
        t = np.arange(N) / N * girth[i]
        out[i, :, 0] = np.interp(t, arc[i], Pc[i, :, 0])
        out[i, :, 1] = np.interp(t, arc[i], Pc[i, :, 1])
    return out, girth


def fus_stations():
    s = list(np.arange(0.03, 0.6, 0.04)) + list(np.arange(0.6, 2.0, 0.08)) + list(np.arange(2.0, 13.0, 0.1)) + list(np.arange(13.0, 13.401, 0.05))
    s = sorted(set(round(float(v), 4) for v in s + [p[0] for p in FUS_PIECES] + [FUS_S1]))
    return np.array([v for v in s if FUS_S0 - 1e-9 <= v <= FUS_S1 + 1e-9])


STRAKE = np.array([(0.50, 2.40), (0.62, 2.62), (0.70, 2.80), (0.80, 3.06), (0.97, 4.0), (1.13, 5.0), (1.31, 6.0), (1.52, 7.0), (1.65, 7.57)])
TIP_Y, TIP_LE, TIP_TE = 4.42, 12.42, 12.91
ROOT_Y, ROOT_TE = 0.50, 13.31
ELEVONS = [(0.98, 2.00), (2.02, 3.02), (3.04, 4.29)]
HINGE_GAP = 0.010
ELEVON_DROOP = 2.0
ANHEDRAL = 4.2


def wing_le(y):
    y = np.asarray(y, float)
    a = np.interp(y, STRAKE[:, 0], STRAKE[:, 1])
    b = 7.57 + (y - 1.65) / (TIP_Y - 1.65) * (TIP_LE - 7.57)
    return np.where(y <= 1.65, a, b)


def wing_te(y):
    y = np.asarray(y, float)
    return ROOT_TE + (y - ROOT_Y) / (TIP_Y - ROOT_Y) * (TIP_TE - ROOT_TE)


def elevon_chord(y):
    c = wing_te(y) - wing_le(y)
    return np.minimum(0.60, 0.58 * c)


def wing_tau(y):
    return np.interp(y, [0.5, 0.72, 1.0, 1.65, 4.42], [0.020, 0.016, 0.022, 0.034, 0.032])


def wing_camber_z(s, y):
    """Mean-surface height: the strake rises forward along the fuselage chine; anhedral outboard (the side photos show
    the near wing's upper surface from a camera barely above it: the tip sits about a quarter metre below the root)."""
    zr = pchip([2.40, 2.8, 4.0, 5.5, 7.6, 10.0, 13.4], [0.47, 0.45, 0.33, 0.22, 0.12, 0.06, 0.02], s)
    return zr - np.maximum(np.asarray(y, float) - 0.72, 0) * math.tan(math.radians(ANHEDRAL))


def naca_t(x, tau, te=0.0):
    """NACA 4-digit half-thickness (fraction of chord) plus a linear finite trailing edge te."""
    x = np.clip(x, 0, 1)
    yt = 5 * tau * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 - 0.1036 * x**4)
    return yt + te * x


def cos_space(n):
    return 0.5 - 0.5 * np.cos(math.pi * np.linspace(0, 1, n))


def wing_surface_z(s, y, upper=True):
    sl, st = wing_le(y), wing_te(y)
    c = st - sl
    x = (np.asarray(s, float) - sl) / c
    t = naca_t(x, wing_tau(y), 0.0012 / c) * c
    return wing_camber_z(s, y) + (t if upper else -t)


def wing_loop(y, K, x_cut=None):
    """Closed airfoil loop at span y: upper TE->LE (K pts) + lower LE->TE (K-1 pts). With x_cut, points aft of the
    cut collapse onto a blunt hinge face, so loops with and without the cut share the same parametrisation."""
    sl, st = float(wing_le(y)), float(wing_te(y))
    c = st - sl
    tau = float(wing_tau(y))
    xs = cos_space(K)
    t = naca_t(xs, tau, 0.0012 / c) * c
    s = sl + xs * c
    zc = wing_camber_z(s, y)
    zu, zl = zc + t, zc - t
    if x_cut is not None:
        sc = sl + x_cut * c
        tc = float(naca_t(np.array([x_cut]), tau, 0.0012 / c)[0]) * c
        zcc = float(wing_camber_z(np.array([sc]), y)[0])
        aft = xs > x_cut
        f = (xs[aft] - x_cut) / (1 - x_cut)
        s = s.copy(); zu = zu.copy(); zl = zl.copy()
        s[aft] = sc
        zu[aft] = zcc + (tc) * (1 - f) + 0.0
        zl[aft] = zcc - (tc) * (1 - f)
    up = np.stack([X0 - s, np.full(K, y), zu], 1)[::-1]
    lo = np.stack([X0 - s, np.full(K, y), zl], 1)[1:]
    return np.concatenate([up, lo], 0)


# fin: re-measured with a camera matched to the 4K side photograph (82 m away, 11 deg aft of the beam, 2.7 m up)
FIN_Z0, FIN_Z1 = 1.205, 3.09
FIN_LE = (10.30, 14.90)
FIN_TE = (14.77, 15.85)
FIN_HINGE = (13.55, 15.22)
FIN_TAU = 0.030


def fin_lerp(pair, z):
    return pair[0] + (z - FIN_Z0) / (FIN_Z1 - FIN_Z0) * (pair[1] - pair[0])


def fin_loop(z, K, x0, x1):
    """Fin section at height z between chord fractions x0..x1: port face TE->LE then starboard LE->TE."""
    sl, st = fin_lerp(FIN_LE, z), fin_lerp(FIN_TE, z)
    c = st - sl
    xs = x0 + (x1 - x0) * (cos_space(K) if x0 <= 0 else (1 - np.cos(np.linspace(0, math.pi / 2, K))))
    s = sl + xs * c
    t = naca_t(xs, FIN_TAU, 0.0012 / c) * c
    p = np.stack([X0 - s, t, np.full(K, z)], 1)[::-1]
    q = np.stack([X0 - s, -t, np.full(K, z)], 1)
    return p, q, s, t


BOOM_END_TOP, BOOM_END_BOT, BOOM_ZB = 15.56, 15.32, 0.735


ADB_Z = 0.925


NF = 16


NOSE_WHEEL = dict(s=4.47, y=0.0, r=0.200, w=0.127)
MAIN_WHEEL = dict(s=9.40, y=1.15, r=0.305, w=0.190)


DOORS = dict(nose=(4.56, 5.755, -0.60, -1.13, 0.255), main=(8.02, 9.51, -0.20, -0.80, 1.30))



# ------------------------------------------------------------------ wing-root / strake fairing
# The fuselage is not a tube with a plate stuck to it: a concave shoulder rises from the strake and the wing's upper
# surface to a junction line well up the fuselage side (the bright sloping band under the upper fuselage in the side
# photos). FAIR_H: height of that junction above the root mean surface; FAIR_W: width of the blend on the wing.
FAIR_S = [2.50, 3.2, 4.2, 6.0, 7.6, 9.0, 11.0, 12.4, 13.0, 13.34]
FAIR_H = [0.0, 0.07, 0.15, 0.27, 0.37, 0.45, 0.52, 0.47, 0.30, 0.03]
FAIR_W = [0.30, 0.40, 0.50, 0.70, 0.85, 0.85, 0.80, 0.48, 0.42, 0.05]
FAIR_K = 12


def wing_le_span(s):
    """Spanwise position of the leading edge at station s (inverse of wing_le)."""
    s = np.asarray(s, float)
    a = np.interp(s, STRAKE[:, 1], STRAKE[:, 0])
    b = 1.65 + (s - 7.57) / (TIP_LE - 7.57) * (TIP_Y - 1.65)
    return np.where(s <= 7.57, a, b)


def fairing_ends(s):
    """Inner (on the fuselage) and outer (on the wing's upper surface) ends of the fairing section at stations s:
    returns yf, zj, yo, zo (arrays)."""
    s = np.atleast_1d(np.asarray(s, float))
    zc, hw, ht, hb, nt, nb = fus_params(s)
    zw = wing_camber_z(s, np.full_like(s, 0.72))
    zj = np.minimum(zw + pchip(FAIR_S, FAIR_H, s), zc + 0.93 * ht)
    yf = hw * np.maximum(1 - (np.maximum(zj - zc, 0) / ht) ** nt, 1e-4) ** (1 / nt)
    yo = np.minimum(yf + pchip(FAIR_S, FAIR_W, s), wing_le_span(s) - 0.02)
    y_te = ROOT_Y + (ROOT_TE - s) / (ROOT_TE - TIP_TE) * (TIP_Y - ROOT_Y)          # span where the trailing edge is at s
    yo = np.where(s > 12.5, np.minimum(yo, np.minimum(0.955, y_te - 0.015)), yo)   # stay inboard of the elevon
    yo = np.maximum(yo, yf + 0.015)
    zo = np.array([float(wing_surface_z(np.array([si]), yi, upper=True)[0]) for si, yi in zip(s, yo)]) + 0.004
    return yf, zj, yo, zo


def fairing_section(s, K=FAIR_K):
    """K points (y, z) across the fairing at station s, from the fuselage junction out to the wing."""
    yf, zj, yo, zo = [float(a[0]) for a in fairing_ends([s])]
    yc = yf + 0.30 * (yo - yf)
    zc_ = zo + (yo - yc) * math.tan(math.radians(ANHEDRAL))
    zc_ = min(zc_, zj)
    t = np.linspace(0, 1, K)
    y = (1 - t) ** 2 * yf + 2 * t * (1 - t) * yc + t ** 2 * yo
    z = (1 - t) ** 2 * zj + 2 * t * (1 - t) * zc_ + t ** 2 * zo
    zu = np.array([float(wing_surface_z(np.array([s]), yi, upper=True)[0]) if yi >= 0.5 else -9.0 for yi in y]) + 0.004
    z = np.maximum(z, np.where(t > 0.02, zu, -9.0))
    return np.stack([y, z], 1)
