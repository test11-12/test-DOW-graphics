"""Texture synthesis for the Quarterhorse (films/blender/quarterhorse.py, stage 'paint'). numpy + Pillow only, so it
also runs outside Blender:   python3 -I films/blender/qh_paint.py [skin wing hot gear]

Input: per-texel data maps baked by quarterhorse.py (object-space position, normal, part id, occlusion, edge mask).
Everything is painted as a function of the surface itself - station s, arc length round the fuselage, span, chord
fraction - so panel joints, fastener rows, oil canning and markings land where they are on the aircraft and stay
continuous across UV seams. Photoscanned CC0 metal (ambientCG) supplies the mill-finish mottling, smears and fine
scratches, sampled per panel with its own offset and grain direction so nothing tiles.

Output (cache/bakes/quarterhorse/paint): <set>_base.png (sRGB), <set>_orm.png (R occlusion, G roughness, B metal),
<set>_normal.png (OpenGL tangent space), <set>_aniso.png (glTF KHR_materials_anisotropy: RG direction, B strength),
hot_emissive.png.
"""
import math
import os
import sys
import tarfile
import time
import urllib.request
import zipfile
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qh_shape import *   # noqa: F401,F403

CACHE = os.environ.get('DOW_CACHE', '/opt/dow-cache')
WORK = os.path.join(CACHE, 'bakes', 'quarterhorse')
OUT = os.path.join(WORK, 'paint')
SIZES = {'skin': 4096, 'wing': 4096, 'hot': 2048, 'gear': 2048}
UA = {'User-Agent': 'dow-films-asset-builder/1.0'}
PREVIEW = os.environ.get('QH_PREVIEW_DIR', '/tmp/claude-0/-home-user-test-DOW-graphics/24d856ac-11c5-5d46-b31d-fe2100eb7024/scratchpad/work/quarterhorse/paint')


def log(*a):
    print('[qh-paint]', *a, flush=True)


# ------------------------------------------------------------------ sources
def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r, open(dest + '.part', 'wb') as f:
        shutil.copyfileobj(r, f)
    os.replace(dest + '.part', dest)
    return dest


def acg(asset, res='2K'):
    """ambientCG material (CC0), same cache layout as dowlib.ambientcg_texture."""
    d = os.path.join(CACHE, 'ambientcg', asset, f'{res}-JPG')
    z = fetch(f'https://ambientcg.com/get?file={asset}_{res}-JPG.zip', d + '.zip')
    if not os.path.isdir(d):
        with zipfile.ZipFile(z) as zf:
            zf.extractall(d)
    out = {}
    for fn in os.listdir(d):
        for key in ('Color', 'NormalGL', 'Roughness', 'Displacement', 'Metalness'):
            if f'_{key}.' in fn:
                out[key] = os.path.join(d, fn)
    return out


LETTERING = 'barlow-semi-condensed'


def font(weight=700, family=LETTERING):
    """A fontsource face (SIL OFL) from the npm registry, cached. Barlow Semi Condensed Bold is the closest open face
    to the photographed lettering (narrow letters, widely tracked, stems about a fifth of the cap height)."""
    base = os.path.join(CACHE, 'fonts', family)
    f = os.path.join(base, 'package', 'files', f'{family}-latin-{weight}-normal.woff')
    if not os.path.exists(f):
        tgz = fetch(f'https://registry.npmjs.org/@fontsource/{family}/-/{family}-5.3.0.tgz', os.path.join(CACHE, 'fonts', f'{family}-5.3.0.tgz'))
        with tarfile.open(tgz) as t:
            t.extractall(base)
    return f


def load_gray(path, size):
    im = Image.open(path).convert('L')
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


def load_rgb(path, size):
    im = Image.open(path).convert('RGB')
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


class Scan:
    """A photoscan map prefiltered to the texel scale it is sampled at: tile metres per repeat at px pixels."""
    def __init__(self, arr, tile):
        self.a = arr; self.tile = tile; self.n = arr.shape[0]

    def sample(self, u, v, rot=None, off_u=0.0, off_v=0.0):
        """Bilinear, wrapped. u, v in metres; rot (radians, per texel) turns the grain."""
        if rot is not None:
            c, s = np.cos(rot), np.sin(rot)
            u, v = c * u - s * v, s * u + c * v
        x = (u + off_u) / self.tile * self.n
        y = (v + off_v) / self.tile * self.n
        return bilinear(self.a, x, y)


def bilinear(a, x, y):
    n0, n1 = a.shape[0], a.shape[1]
    x0 = np.floor(x); y0 = np.floor(y)
    fx = (x - x0).astype(np.float32); fy = (y - y0).astype(np.float32)
    x0 = x0.astype(np.int64) % n1; y0 = y0.astype(np.int64) % n0
    x1 = (x0 + 1) % n1; y1 = (y0 + 1) % n0
    if a.ndim == 3:
        fx = fx[:, None]; fy = fy[:, None]
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy) + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy)


# ------------------------------------------------------------------ noise
_NOISE = {}


def noise_tex(seed=1, n=256, blur=1.2):
    """Tileable smooth value-noise tile in 0..1 (cached)."""
    k = (seed, n, blur)
    if k not in _NOISE:
        r = np.random.default_rng(seed)
        a = r.random((n, n)).astype(np.float32)
        im = Image.fromarray((a * 255).astype(np.uint8))
        big = np.asarray(im.resize((n * 4, n * 4), Image.BICUBIC), np.float32) / 255.0
        big = np.tile(big, (3, 3))
        im = Image.fromarray((big * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur * 4))
        big = np.asarray(im, np.float32)[n * 4:n * 8, n * 4:n * 8] / 255.0
        big = (big - big.min()) / (big.max() - big.min() + 1e-6)
        _NOISE[k] = big
    return _NOISE[k]


def fbm(u, v, scale, octaves=4, seed=1, lac=2.03, gain=0.5):
    """Fractal noise in metric 2D coordinates (scale = metres per lattice tile), roughly 0..1."""
    t = noise_tex(seed)
    n = t.shape[0]
    acc = np.zeros_like(u, dtype=np.float32); w = 1.0; tot = 0.0; f = 1.0
    for o in range(octaves):
        # ~6 px per feature in the 1024 px tile: `scale` is the feature size in metres; the tile repeats every ~170 x scale
        acc += w * bilinear(t, (u * f / scale) * 6.0 + o * 37.1, (v * f / scale) * 6.0 + o * 91.7)
        tot += w; w *= gain; f *= lac
    return acc / tot


def hash01(*keys):
    """Deterministic 0..1 per integer key tuple (vectorised)."""
    with np.errstate(over='ignore'):
        h = np.uint64(1469598103934665603)
        for k in keys:
            k = np.asarray(k).astype(np.int64).astype(np.uint64)
            h = (h ^ (k + np.uint64(0x9E3779B97F4A7C15))) * np.uint64(1099511628211)
            h ^= h >> np.uint64(29)
        return ((h * np.uint64(0x2545F4914F6CDD1D)) >> np.uint64(40)).astype(np.float64) / float(1 << 24)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb_to_lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def hexlin(h):
    h = h.lstrip('#')
    return srgb_to_lin(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32))


# ------------------------------------------------------------------ layers: line, row and pillow helpers
def line_profile(d, w):
    """Anti-aliased groove profile, 1 on the line falling to 0 at |d| ~ 2w."""
    return np.exp(-(d / w) ** 2)


def rivet_row(along, across, pitch, r, seed, stagger=0.0, jitter=0.0012):
    """Flush rivet heads along a row: returns (head mask 0..1, ring mask 0..1, per-rivet random 0..1)."""
    k = np.round((along - stagger) / pitch)
    rnd = hash01(k, seed)
    dl = along - stagger - k * pitch + (rnd - 0.5) * jitter
    dist = np.sqrt(dl * dl + across * across)
    head = sstep(r * 1.05, r * 0.55, dist)
    ring = np.exp(-((dist - r) / (r * 0.45)) ** 2)
    return head, ring, rnd


class Layers:
    """Per-texel PBR accumulators for a set of gathered texels."""
    def __init__(self, n):
        self.base = np.zeros((n, 3), np.float32)
        self.rough = np.zeros(n, np.float32)
        self.metal = np.zeros(n, np.float32)
        self.h = np.zeros(n, np.float32)          # height (m) for the normal map
        self.adir = np.zeros((n, 3), np.float32)  # anisotropy direction (object space, tangent to the surface)
        self.astr = np.zeros(n, np.float32)
        self.emis = None
        self.aomul = None


def over(L, mask, col=None, rough=None, metal=None, h=None, astr=None):
    """Composite a coat over the layers with coverage mask 0..1."""
    m = np.clip(mask, 0, 1).astype(np.float32)
    if col is not None:
        col = np.asarray(col, np.float32)
        L.base = L.base * (1 - m[:, None]) + (col if col.ndim == 2 else col[None, :]) * m[:, None]
    if rough is not None:
        L.rough = L.rough * (1 - m) + rough * m
    if metal is not None:
        L.metal = L.metal * (1 - m) + metal * m
    if h is not None:
        L.h = L.h + h * m
    if astr is not None:
        L.astr = L.astr * (1 - m) + astr * m


# ------------------------------------------------------------------ fuselage frame: (s, arc from the top, side)
class FusFrame:
    def __init__(self):
        S = np.linspace(-0.2, 13.8, 561)
        P, arc = fus_dense(S, 2048)
        zc = fus_params(S)[0]
        M = P.shape[1]
        # starboard half: the loop runs bottom (k=0) -> side -> top (k=M/2)
        half = P[:, :M // 2 + 1]
        a_from_bottom = arc[:, :M // 2 + 1]
        hg = a_from_bottom[:, -1]
        a_top = hg[:, None] - a_from_bottom
        phi = np.arctan2(np.abs(half[..., 0]), half[..., 1] - zc[:, None])   # 0 top .. pi bottom
        PH = np.linspace(0, math.pi, 1441)
        A = np.zeros((len(S), len(PH)), np.float32)
        for i in range(len(S)):
            o = np.argsort(phi[i])
            A[i] = np.interp(PH, phi[i][o], a_top[i][o])
        self.S, self.PH, self.A, self.hg = S, PH, A, hg.astype(np.float32)
        self.zc = zc.astype(np.float32)
        # The panel layout and the markings were measured as around-angles on an elliptical section (matched to the 4K
        # side photograph). The upper section is now boxier, so a layout angle is mapped to the angle on the new section
        # that lies at the same height: lines and lettering keep their side-view positions on the steeper flank.
        _, hw, ht, _, nt, _ = [np.asarray(a, float) for a in fus_params(S)]
        G = np.radians(np.linspace(0, 90, 361))

        def zeta(phi, n, hw_, ht_):     # height above the centre of the section point on the ray at phi from the top
            return np.cos(phi) * ((np.sin(phi) / hw_) ** n + (np.cos(phi) / ht_) ** n) ** (-1 / n)
        Gd = np.degrees(G)
        self.MAP = np.zeros((len(S), len(G)), np.float32)       # old angle -> new angle
        self.INV = np.zeros((len(S), len(G)), np.float32)       # new angle -> old angle
        for i in range(len(S)):
            zo = zeta(G, 2.0, hw[i], ht[i]); zn = zeta(G, nt[i], hw[i], ht[i])
            self.MAP[i] = np.interp(zo, zn[::-1], Gd[::-1])
            self.INV[i] = np.interp(Gd, self.MAP[i], Gd)
        self.G = Gd.astype(np.float32)

    def _map(self, s, deg, inverse=False):
        """Bilinear lookup in MAP (or INV) at stations s, angles deg (degrees); the lower half (>= 90) is unchanged."""
        S, G, M = self.S, self.G, (self.INV if inverse else self.MAP)
        s = np.asarray(s, np.float32)
        d = np.asarray(deg, np.float32) * np.ones_like(s)
        fi = np.clip((s - S[0]) / (S[1] - S[0]), 0, len(S) - 1.001)
        i = fi.astype(np.int64); di = (fi - i).astype(np.float32)
        j = np.clip(d / (G[1] - G[0]), 0, len(G) - 1.001); jj = j.astype(np.int64); dj = (j - jj).astype(np.float32)
        out = (M[i, jj] * (1 - di) * (1 - dj) + M[i + 1, jj] * di * (1 - dj) + M[i, jj + 1] * (1 - di) * dj + M[i + 1, jj + 1] * di * dj)
        return np.where(d < 90, out, d).astype(np.float32)

    def new_deg(self, s, deg_old):
        """Around-angle on the current section that lies at the height `deg_old` had on the elliptical one."""
        return self._map(s, deg_old)

    def old_deg(self, s, deg_new):
        return self._map(s, deg_new, inverse=True)

    def arc_old(self, s, deg_old):
        """Arc from the top at station s for a layout angle given on the elliptical section (z-matched)."""
        return self.lookup(s, np.radians(self.new_deg(s, deg_old)))

    def lookup(self, s, phi):
        S, PH, A = self.S, self.PH, self.A
        fi = np.clip((s - S[0]) / (S[1] - S[0]), 0, len(S) - 1.001)
        fj = np.clip(phi / (PH[1] - PH[0]), 0, len(PH) - 1.001)
        i = fi.astype(np.int64); j = fj.astype(np.int64)
        di = (fi - i).astype(np.float32); dj = (fj - j).astype(np.float32)
        return (A[i, j] * (1 - di) * (1 - dj) + A[i + 1, j] * di * (1 - dj) + A[i, j + 1] * (1 - di) * dj + A[i + 1, j + 1] * di * dj)

    def coords(self, P):
        s = (X0 - P[:, 0]).astype(np.float32)
        zc = np.interp(s, self.S, self.zc).astype(np.float32)
        phi = np.arctan2(np.abs(P[:, 1]), P[:, 2] - zc).astype(np.float32)
        a = self.lookup(s, phi)
        hg = np.interp(s, self.S, self.hg).astype(np.float32)
        side = np.where(P[:, 1] >= 0, 1, -1).astype(np.int8)    # +1 port, -1 starboard
        return s, phi, a, hg, side

    def arc_at(self, s, phi_deg):
        """Arc from the top for a layout angle in the elliptical (photo-matched) space."""
        return self.arc_old(s, np.full_like(s, phi_deg, dtype=np.float32))


# ------------------------------------------------------------------ decals (vector artwork, drawn in metres)
DECAL_PX_PER_M = 1400.0


def canvas(w_m, h_m):
    W, H = int(w_m * DECAL_PX_PER_M), int(h_m * DECAL_PX_PER_M)
    return Image.new('L', (W, H), 0), W, H


def bez(p0, p1, p2, p3, n=24):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return ((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3).tolist()


MARKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qh_marks')


def traced(name, W, H):
    """Artwork traced from the released photographs (qh_marks/trace.py), resampled to W x H (mode L)."""
    return Image.open(os.path.join(MARKS, name)).convert('L').resize((W, H), Image.LANCZOS)


def horse_mark_drawn(W, H):
    """The horse-head mark beside the wordmark, traced from the starboard-side photo: head at the right facing
    forward, a long crest streak with two barbs, a second mane streak, a bold neck stroke and the jaw ending in
    the muzzle. Unit box -> pixels (box aspect about 3.0 : 1)."""
    S = 4
    im = Image.new('L', (W * S, H * S), 0); g = ImageDraw.Draw(im)
    P = lambda pts: [(x * W * S, y * H * S) for x, y in pts]
    # crest: a thick mane streak from the trailing tip up to the ear, two barbs on its back
    crest = (bez((0.0, 0.46), (0.10, 0.40), (0.20, 0.25), (0.33, 0.165), 16) + bez((0.33, 0.165), (0.42, 0.105), (0.50, 0.07), (0.59, 0.0), 12) +
             bez((0.615, 0.10), (0.60, 0.16), (0.59, 0.20), (0.57, 0.235), 6) + bez((0.57, 0.235), (0.42, 0.22), (0.28, 0.40), (0.14, 0.49), 16) + [(0.0, 0.52)])
    g.polygon(P(crest), fill=255)
    for (x0, y0, x1, y1, x2, y2) in ((0.205, 0.285, 0.255, 0.115, 0.305, 0.20), (0.325, 0.19, 0.38, 0.045, 0.425, 0.125)):   # barbs
        g.polygon(P([(x0, y0), (x1, y1), (x2, y2)]), fill=255)
    # face: a fine line from the ear down to the muzzle
    face = (bez((0.59, 0.0), (0.70, 0.11), (0.84, 0.40), (0.975, 0.68), 20) + bez((0.955, 0.70), (0.84, 0.47), (0.72, 0.24), (0.615, 0.125), 20))
    g.polygon(P(face), fill=255)
    # second mane streak, running into the cheek
    st2 = (bez((0.175, 0.67), (0.30, 0.56), (0.44, 0.38), (0.67, 0.385), 20) + bez((0.66, 0.47), (0.52, 0.47), (0.40, 0.62), (0.175, 0.70), 20))
    g.polygon(P(st2), fill=255)
    # neck stroke
    neck = (bez((0.36, 0.86), (0.46, 0.76), (0.55, 0.62), (0.62, 0.50), 12) + bez((0.66, 0.54), (0.61, 0.72), (0.56, 0.88), (0.49, 0.99), 12))
    g.polygon(P(neck), fill=255)
    # cheek and jaw, tapering to the muzzle with its nostril hook
    jaw = (bez((0.655, 0.40), (0.74, 0.50), (0.84, 0.66), (0.955, 0.72), 14) + bez((0.955, 0.72), (1.0, 0.74), (1.0, 0.90), (0.95, 0.925), 10) +
           bez((0.95, 0.925), (0.85, 0.91), (0.74, 0.84), (0.675, 0.66), 14))
    g.polygon(P(jaw), fill=255)
    g.ellipse(P([(0.945, 0.775), (0.975, 0.865)]), fill=0)           # nostril
    return im.resize((W, H), Image.LANCZOS)


def horse_mark(W, H):
    """The horse head beside the wordmark, traced from the 4K side photograph (starboard: head forward, at image right)."""
    return traced('horse.png', W, H)


def wing_mark(W, H):
    """The fin's wing mark, traced from the 4K side photograph (starboard side: a long top feather sweeping up and
    aft to a point, hooking down at the front into a tail, three feathers tucked under it)."""
    return traced('fin_wing.png', W, H)


def wing_mark_drawn(W, H):
    """Hermeus wing mark as painted on the fin's starboard side (traced from the tail photo): a bold top feather from
    a point at upper left that wraps round the right side and comes down to a point at lower right, with three
    shorter feathers tucked under it."""
    S = 4
    im = Image.new('L', (W * S, H * S), 0); g = ImageDraw.Draw(im)
    P = lambda pts: [(x * W * S, y * H * S) for x, y in pts]
    top = (bez((0.0, 0.0), (0.10, 0.20), (0.40, 0.33), (0.70, 0.40), 24) + bez((0.70, 0.40), (0.84, 0.44), (0.95, 0.50), (1.0, 0.60), 14) +
           bez((1.0, 0.60), (0.93, 0.68), (0.90, 0.84), (0.985, 1.0), 16) + bez((0.985, 1.0), (0.86, 0.90), (0.80, 0.74), (0.84, 0.615), 16) +
           bez((0.84, 0.615), (0.74, 0.555), (0.50, 0.525), (0.30, 0.475), 20) + bez((0.30, 0.475), (0.14, 0.42), (0.03, 0.22), (0.0, 0.0), 16))
    g.polygon(P(top), fill=255)
    f2 = (bez((0.055, 0.375), (0.20, 0.505), (0.50, 0.545), (0.70, 0.605), 22) + bez((0.70, 0.605), (0.77, 0.635), (0.82, 0.69), (0.835, 0.78), 10) +
          bez((0.835, 0.78), (0.76, 0.70), (0.62, 0.675), (0.48, 0.67), 14) + bez((0.48, 0.67), (0.30, 0.665), (0.13, 0.58), (0.055, 0.375), 18))
    g.polygon(P(f2), fill=255)
    f3 = (bez((0.195, 0.655), (0.32, 0.725), (0.55, 0.705), (0.70, 0.735), 18) + bez((0.70, 0.735), (0.76, 0.755), (0.81, 0.80), (0.83, 0.865), 8) +
          bez((0.83, 0.865), (0.74, 0.815), (0.62, 0.81), (0.50, 0.815), 12) + bez((0.50, 0.815), (0.36, 0.82), (0.25, 0.77), (0.195, 0.655), 14))
    g.polygon(P(f3), fill=255)
    f4 = (bez((0.375, 0.875), (0.48, 0.905), (0.62, 0.875), (0.74, 0.865), 14) + bez((0.74, 0.865), (0.79, 0.865), (0.83, 0.885), (0.85, 0.915), 6) +
          bez((0.85, 0.915), (0.74, 0.925), (0.64, 0.975), (0.54, 0.975), 12) + bez((0.54, 0.975), (0.46, 0.97), (0.40, 0.93), (0.375, 0.875), 10))
    g.polygon(P(f4), fill=255)
    return im.resize((W, H), Image.LANCZOS)


def us_flag(W, H, union_left=True):
    """US flag as an RGB image (linear colours), union toward +x if union_left is False."""
    red, white, blue = hexlin('#B22234'), hexlin('#E8E8E6'), hexlin('#3C3B6E')
    a = np.zeros((H, W, 3), np.float32)
    rows = (np.arange(H)[:, None] * 13 // H)
    a[:] = np.where((rows % 2 == 0)[..., None], red, white)
    uh, uw = int(H * 7 / 13), int(W * 0.4)
    a[:uh, :uw] = blue
    im = Image.new('L', (uw, uh), 0); g = ImageDraw.Draw(im)
    for r in range(9):
        n = 6 if r % 2 == 0 else 5
        for c in range(n):
            cx = (c + (0.5 if r % 2 == 0 else 1.0)) * uw / 6.0 - uw / 12 + uw / 12
            cy = (r + 0.5) * uh / 9.0
            rr = uh * 0.032
            pts = [(cx + rr * math.cos(math.pi / 2 + k * 4 * math.pi / 5), cy - rr * math.sin(math.pi / 2 + k * 4 * math.pi / 5)) for k in range(5)]
            g.polygon(pts, fill=255)
    st = np.asarray(im, np.float32)[..., None] / 255.0
    a[:uh, :uw] = a[:uh, :uw] * (1 - st) + white * st
    if not union_left:
        a = a[:, ::-1]
    return a


def seal(W):
    """Round dark unit seal as photographed: a near-black disc with a pale metal rim, a band of small light lettering
    (drawn as illegible marks: no text is reproduced), three small stars each side, a thin pale inner circle and a
    muted grey emblem. Returns (linear rgb, alpha)."""
    S = 3
    Ws = W * S
    im = Image.new('RGB', (Ws, Ws), (0, 0, 0)); g = ImageDraw.Draw(im)
    al = Image.new('L', (Ws, Ws), 0); ga = ImageDraw.Draw(al)
    c = Ws / 2
    field = (13, 15, 22)
    ga.ellipse([0, 0, Ws - 1, Ws - 1], fill=255)
    g.ellipse([0, 0, Ws - 1, Ws - 1], fill=(236, 236, 233))                      # bold near-white rim, 0.025 m on 0.545 m
    r1 = Ws * 0.454
    g.ellipse([c - r1, c - r1, c + r1, c + r1], fill=field)
    rng = np.random.default_rng(7)
    for arc0, arc1 in ((-2.62, -0.52), (0.62, 2.52)):                              # lettering band: fine light marks
        for a in np.linspace(arc0, arc1, 46):
            if rng.random() < 0.12:
                continue                                                           # word gaps
            w = Ws * (0.006 + 0.008 * rng.random()); h = Ws * (0.026 + 0.010 * rng.random())
            x, y = c + math.cos(a) * Ws * 0.405, c + math.sin(a) * Ws * 0.405
            ca, sa = math.cos(a + math.pi / 2), math.sin(a + math.pi / 2)
            pts = [(x + ca * dx - sa * dy, y + sa * dx + ca * dy) for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
            g.polygon(pts, fill=(128, 130, 134))
    for side in (-1, 1):                                                           # three small stars each side
        for a in (-0.22, 0.0, 0.22):
            x, y = c + side * math.cos(a) * Ws * 0.405, c + math.sin(a) * Ws * 0.405
            rr = Ws * 0.016
            pts = [(x + rr * (1 if k % 2 == 0 else 0.45) * math.cos(-math.pi / 2 + k * math.pi / 5), y + rr * (1 if k % 2 == 0 else 0.45) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]
            g.polygon(pts, fill=(170, 172, 176))
    r2 = Ws * 0.345
    g.ellipse([c - r2, c - r2, c + r2, c + r2], outline=(150, 153, 160), width=max(2, int(Ws * 0.009)))
    # emblem: spread wings over crossed shafts, muted grey, finely drawn
    lg = (92, 95, 102)
    for sgn in (-1, 1):
        for k in range(5):                                                         # five primaries per wing
            t0 = 0.05 + 0.045 * k
            p = [(c + sgn * Ws * 0.03, c - Ws * 0.02), (c + sgn * Ws * (0.10 + t0), c - Ws * (0.13 - 0.018 * k)),
                 (c + sgn * Ws * (0.12 + t0), c - Ws * (0.115 - 0.018 * k)), (c + sgn * Ws * 0.05, c + Ws * 0.0)]
            g.polygon(p, fill=lg)
    g.ellipse([c - Ws * 0.03, c - Ws * 0.11, c + Ws * 0.03, c - Ws * 0.05], fill=lg)
    g.polygon([(c - Ws * 0.05, c - Ws * 0.03), (c + Ws * 0.05, c - Ws * 0.03), (c + Ws * 0.045, c + Ws * 0.06), (c, c + Ws * 0.10), (c - Ws * 0.045, c + Ws * 0.06)], fill=lg)
    for sgn in (-1, 1):
        g.line([(c - sgn * Ws * 0.17, c + Ws * 0.02), (c + sgn * Ws * 0.17, c + Ws * 0.20)], fill=lg, width=max(2, int(Ws * 0.010)))
    im = im.resize((W, W), Image.LANCZOS); al = al.resize((W, W), Image.LANCZOS)
    rgb = srgb_to_lin(np.asarray(im, np.float32) / 255.0)
    return rgb, np.asarray(al, np.float32) / 255.0


def text_mask(text, h_m, weight=700, track=0.02, squeeze=1.0, width_m=None, family=LETTERING, min_track=0.03):
    """Text with cap height h_m (metres), rendered at DECAL_PX_PER_M. With width_m the run spans exactly width_m: the
    letter spacing grows when there is room; when the letters at their own width would need negative spacing (glyphs
    colliding), they are condensed instead (`squeeze`, horizontal scale) and keep a spacing of min_track x the cap
    height. Returns (mask array, width_m, top_offset_m): the image top may sit above the cap line when a glyph rises
    above it; top_offset_m is the cap line's offset from the image top (0 for caps-only text)."""
    big = 600
    f = ImageFont.truetype(font(weight, family), big)
    hb = Image.new('L', (big * 2, big * 2), 0); ImageDraw.Draw(hb).text((big // 2, big // 2), 'H', font=f, fill=255)
    bb = hb.getbbox(); cap_px = bb[3] - bb[1]; cap_top = bb[1] - big // 2
    k = h_m * DECAL_PX_PER_M / cap_px                      # final px per big px
    adv = [f.getlength(ch) for ch in text]
    ink0 = f.getbbox(text[0])[0]; ink1 = adv[-1] - f.getbbox(text[-1])[2]
    natural = sum(adv) - ink0 - ink1
    gaps = max(len(text) - 1, 1)
    if width_m:
        target = width_m * DECAL_PX_PER_M / k
        extra = (target - natural) / gaps
        floor = min_track * cap_px
        if extra < floor:                                   # condense the letters rather than overlap them
            squeeze = (target - floor * gaps) / natural
            extra = floor
    else:
        extra = track * big
    assert extra >= 0 and 0.6 < squeeze <= 1.0, (text, extra, squeeze)
    # lay out at full glyph width with the spacing pre-divided by the squeeze, then scale the run horizontally
    ex = extra / squeeze
    Wb = int(natural + ex * (len(text) - 1) + 4); Hb = int(big * 1.4)
    im = Image.new('L', (Wb, Hb), 0); g = ImageDraw.Draw(im)
    x = -ink0 + 2
    for ch, a in zip(text, adv):
        g.text((x, 0), ch, font=f, fill=255)
        x += a + ex
    top = cap_top
    ib = im.getbbox(); y0 = min(ib[1], top); y1 = ib[3]
    im = im.crop((0, y0, Wb, y1))
    W = max(1, int(round(im.width * k * squeeze))); H = max(1, int(round(im.height * k)))
    im = im.resize((W, H), Image.LANCZOS)
    if squeeze < 0.999 or width_m:
        log(f'text {text!r}: cap {h_m:.3f} m, squeeze {squeeze:.3f}, spacing {extra / cap_px:.3f} cap')
    return np.asarray(im, np.float32) / 255.0, W / DECAL_PX_PER_M, (top - y0) * k / DECAL_PX_PER_M


class Decal:
    """A decal in a 2D surface frame (metres): u0/v0 = image top-left in frame coordinates, image x along +du, y along +dv."""
    def __init__(self, img, alpha, w_m, h_m):
        self.img, self.alpha, self.w, self.h = img, alpha, w_m, h_m
        # prefilter to roughly the texel footprint (~2 mm) so sampling does not alias
        if alpha is not None:
            self.alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255.0

    def sample(self, x_m, y_m):
        """x_m, y_m: offsets from the image's top-left in metres (image x right, y down). Returns (rgb or None, alpha)."""
        H, W = self.alpha.shape
        x = x_m / self.w * W - 0.5; y = y_m / self.h * H - 0.5
        inside = (x > -1) & (x < W) & (y > -1) & (y < H)
        a = np.zeros_like(x_m, dtype=np.float32)
        if inside.any():
            xi, yi = np.clip(x[inside], 0, W - 1.001), np.clip(y[inside], 0, H - 1.001)
            a[inside] = bilinear(self.alpha, xi, yi)
        rgb = None
        if self.img is not None:
            rgb = np.zeros((len(x_m), 3), np.float32)
            if inside.any():
                xi, yi = np.clip(x[inside], 0, W - 1.001), np.clip(y[inside], 0, H - 1.001)
                Hc, Wc = self.img.shape[:2]
                rgb[inside] = bilinear(self.img, xi * Wc / W, yi * Hc / H)
        return rgb, a


# ------------------------------------------------------------------ set data
class SetData:
    def __init__(self, key):
        self.key = key
        self.size = SIZES[key]
        self.pos = np.load(os.path.join(WORK, f'{key}_pos.npy'))
        self.nrm = np.load(os.path.join(WORK, f'{key}_nrm.npy')).astype(np.float32)
        self.pid = np.load(os.path.join(WORK, f'{key}_pid.npy'))
        ao = np.load(os.path.join(WORK, f'{key}_ao.npy')).astype(np.float32)
        self.ao = np.asarray(Image.fromarray(ao).resize((self.size, self.size), Image.BILINEAR), np.float32)
        ep = os.path.join(WORK, f'{key}_edge.npy')
        self.edge = np.load(ep).astype(np.float32) if os.path.exists(ep) else None
        self.valid = self.pid > 0
        # AO is 0 outside coverage and at half resolution: fill holes inside islands from neighbours
        self.ao = fill_from_valid(self.ao, (self.ao > 0.02) | ~self.valid, iters=3)
        log(key, 'coverage', round(float(self.valid.mean()), 3))

    def gather(self, pids):
        m = np.isin(self.pid, pids)
        idx = np.flatnonzero(m.ravel())
        P = self.pos.reshape(-1, 3)[idx]
        N = self.nrm.reshape(-1, 3)[idx]
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
        return idx, P, N, self.pid.ravel()[idx], self.ao.ravel()[idx]


def pad_index(valid, iters):
    """Index of the nearest valid texel (4-neighbour flood, `iters` texels deep); -1 where none."""
    H, W = valid.shape
    idx = np.where(valid, np.arange(H * W, dtype=np.int64).reshape(H, W), -1)
    for _ in range(iters):
        for sh, ax in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
            nb = np.roll(idx, sh, ax)
            take = (idx < 0) & (nb >= 0)
            idx[take] = nb[take]
    return idx


def box_blur(a, r):
    """Separable (2r+1)^2 box filter with clamped edges (cumulative sums), any trailing channels."""
    a = a.astype(np.float32)
    for ax in (0, 1):
        n = a.shape[ax]
        pw = [(0, 0)] * a.ndim; pw[ax] = (r + 1, r)
        c = np.cumsum(np.pad(a, pw, mode='edge'), axis=ax, dtype=np.float32)
        a = (np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, np.arange(0, n), axis=ax)) / (2 * r + 1)
        del c
    return a


def pad(a, idx):
    H, W = idx.shape
    flat = a.reshape(H * W, -1)
    src = np.where(idx.ravel() >= 0, idx.ravel(), np.arange(H * W))
    return flat[src].reshape(a.shape)


def fill_from_valid(a, ok, iters=8):
    """Replace texels where ok is False by the mean of ok neighbours, repeatedly (small holes, island padding)."""
    a = a.copy(); ok = ok.copy()
    for _ in range(iters):
        acc = np.zeros_like(a); cnt = np.zeros(a.shape[:2], np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sa = np.roll(a, (dy, dx), (0, 1)); so = np.roll(ok, (dy, dx), (0, 1))
            acc += sa * (so[..., None] if a.ndim == 3 else so)
            cnt += so
        new = (~ok) & (cnt > 0)
        if not new.any():
            break
        a[new] = (acc[new] / (cnt[new][..., None] if a.ndim == 3 else cnt[new]))
        ok = ok | new
    return a


# ------------------------------------------------------------------ fuselage skin
FRAMES = [0.06, 0.97, 1.95, 2.93, 4.20, 5.45, 6.50, 7.68, 8.85, 9.95, 10.55, 11.25, 12.05, 12.75, 13.37]
MAIN_FRAMES = {2.93, 7.68, 12.75, 13.37, 0.06}
INNER = [0.52, 1.46, 2.44, 3.57, 4.83, 5.98, 7.09, 8.27, 9.40, 10.25, 10.90, 11.65, 12.40, 13.06]
# joint around-angles (deg from the top, elliptical layout space): the 24-deg joint is the crisp shoulder line the overhead
# photographs show (it maps onto the boxier section's shoulder, about 0.82 of the half-width out)
LONGI = [0.0, 24.0, 58.0, 92.0, 111.0, 130.0, 154.0, 180.0]
STRING = [15.0, 44.0, 72.0, 98.0, 121.0, 142.0, 167.0]          # stringer rivet rows between them
WATERLINE = 92.0         # the joint below which the lower-fuselage alloy starts


def nearest(sorted_vals, x):
    """Index of and signed distance to the nearest value in sorted_vals (array) for each x."""
    v = np.asarray(sorted_vals, np.float32)
    j = np.clip(np.searchsorted(v, x), 1, len(v) - 1)
    lo, hi = v[j - 1], v[j]
    pick_hi = (hi - x) < (x - lo)
    k = np.where(pick_hi, j, j - 1)
    return k, x - v[k]


def bracket(sorted_vals, x):
    v = np.asarray(sorted_vals, np.float32)
    j = np.clip(np.searchsorted(v, x), 1, len(v) - 1)
    return v[j - 1], v[j], j - 1


class Skin:
    """Bare-metal aircraft skin model shared by the fuselage, wing, fin and boom painters."""
    def __init__(self, texel):
        self.texel = texel
        A = acg('Metal012'); B = acg('Metal014'); Cm = acg('Metal049B'); D = acg('Metal009'); E = acg('Metal050B')
        # prefilter scans to roughly the texel size at the tile scale they are used at
        self.mottle = Scan(load_gray(A['Roughness'], 1024), 1.6)
        self.mottle_c = Scan(load_gray(A['Color'], 1024), 1.6)
        self.cloud = Scan(load_gray(B['Roughness'], 768), 2.4)
        self.smear = Scan(load_gray(Cm['Color'], 1024), 1.1)
        self.brush = Scan(load_gray(D['Roughness'], 1024), 0.9)
        self.scratch = Scan(load_gray(E['Roughness'], 1024), 1.3)
        for sc in (self.mottle, self.mottle_c, self.cloud, self.smear, self.brush, self.scratch):
            a = sc.a; sc.a = (a - a.mean()) / (a.std() + 1e-6)     # zero-mean, unit-variance detail

    def metal(self, L, u, v, panel, ao, along_dir, across_dir, base_tone=0.90, lower=None, cross_frac=0.06, tone_var=0.028,
              rough0=0.48, rough_var=0.03, mottle=0.003, cloud=0.0):
        """Bare satin aluminium. Sheets differ in tone, in their brushing direction and above all in their polish: a
        polished sheet mirrors the sky and the cloud, a dull one scatters and reads pale, which is the patchwork the
        overhead photographs show. The photoscans add mill-finish mottling (`mottle`, tone) and a soft cloudy sheen
        inside each sheet (`cloud`, roughness). `lower` (0..1 per texel) is the darker, warmer lower-fuselage alloy."""
        r1, r2, r3, r4, r5, r6 = (hash01(panel, k) for k in range(6))
        tone = base_tone * (1 + (r1 - 0.5) * tone_var)                    # per-sheet brightness
        warm = (r2 - 0.5) * 0.006                                         # barely perceptible hue drift
        rough = rough0 + rough_var * (r3 - 0.5)                           # per-sheet polish
        cross = (r5 > 1 - cross_frac)                                     # the odd sheet is brushed across
        ang = (r4 - 0.5) * 0.16 + np.where(cross, math.pi / 2, 0.0)       # brushing direction per sheet
        offu, offv = r5 * 37.0, r6 * 29.0
        mot = self.mottle.sample(u, v, None, offu, offv)
        br = self.brush.sample(u, v, ang, offu * 0.3, offv * 0.5)
        scr = self.scratch.sample(u, v, r1 * 6.28, offu * 0.2, offv * 0.9)
        lum = tone * (1 + mottle * np.clip(mot, -2, 2))
        col = np.stack([lum * (1 + warm), lum * (1 + warm * 0.3), lum * (1 - warm * 0.8)], 1) * np.array([1.0, 0.996, 0.988], np.float32)
        rr = rough * (1 + 0.006 * np.clip(mot, -2, 2)) + 0.012 * np.clip(br, -2, 2) + 0.005 * np.clip(scr, 0, 2)
        if cloud:
            rr = rr + cloud * np.clip(self.cloud.sample(u, v, None, offu * 0.7, offv * 0.4), -2, 2)
        if lower is not None:
            # the lower-fuselage alloy as photographed: a darker rose-grey (red highest, green lowest, never brassy),
            # one even tone with barely any sheet-to-sheet change, a slightly softer sheen
            lo = lower[:, None]
            low = LOWER_ALLOY * (1 + (r1 - 0.5) * 0.008)[:, None] * (1 + 0.002 * np.clip(mot, -2, 2))[:, None]
            col = col * (1 - lo) + low * lo
            rr = rr * (1 - lower) + (LOWER_ROUGH + 0.004 * np.clip(mot, -2, 2) + 0.006 * np.clip(br, -2, 2)) * lower
        L.base[:] = col
        L.rough[:] = np.clip(rr, 0.12, 0.7)
        L.metal[:] = 1.0
        # anisotropic sheen: the sheets are brushed lengthwise, so the highlight spreads across the grain (the glTF
        # anisotropy direction is the direction of the stretched highlight)
        c, s = np.cos(ang), np.sin(ang)
        L.adir[:] = across_dir * c[:, None] + along_dir * s[:, None]
        L.astr[:] = 0.32 + 0.10 * r6
        if lower is not None:
            L.astr[:] *= (1 - 0.6 * lower)
        # the occlusion itself goes to the ORM map; enclosed corners are only a touch duller
        g = np.clip(1 - ao, 0, 1) ** 1.5
        L.base *= (1 - 0.035 * g)[:, None]
        L.rough += 0.03 * g
        return r1, r3

    def seam(self, L, d, strength=1.0, width=None, sealant=True, step=0.0):
        """Butt joint: fine groove (sealant), slight level mismatch between the two sheets."""
        w = width or max(0.0011, 0.75 * self.texel)
        p = line_profile(d, w) * strength
        cover = np.clip(0.0009 / w, 0.15, 1.0)          # a sub-texel line drawn wider but fainter
        if sealant:
            over(L, p * 0.55 * cover * 1.6, col=np.array([0.20, 0.205, 0.21], np.float32), rough=0.55, metal=0.3)
        L.h -= 0.00022 * p
        if step:
            L.h += step * sstep(-w, w, d)

    def rivets(self, L, along, across, pitch, r, seed, strength=1.0, stagger=0.0):
        head, ring, rnd = rivet_row(along, across, pitch, r, seed, stagger)
        head = head * strength; ring = ring * strength
        # heads: slightly lighter, rougher (sanded flush); the countersink ring holds a little dirt
        L.base *= (1 + (0.01 + 0.02 * rnd)[:, None] * head[:, None] - 0.26 * ring[:, None])
        L.rough += 0.05 * head + 0.08 * ring
        L.astr *= (1 - 0.8 * head)
        L.h += (-0.00004 * ring + 0.000015 * head * (rnd - 0.3))
        # the row as a whole: the dimpled, primed band along the fasteners, wide enough (about 9 mm) to survive the
        # texture's mip chain, so a fastener row still reads as a faint line where the single heads are sub-pixel
        band = np.exp(-(across / 0.0045) ** 2) * strength
        L.base *= (1 - 0.07 * band)[:, None]
        L.rough += 0.05 * band


SKIN_TEXEL = 0.0019
BLACK = np.array([0.006, 0.006, 0.0065], np.float32)   # markings as black metal: F0 under 1 %, no diffuse, so full sun does not grey them
# upper skin, wings and fin: per-sheet tone +-2.5 %, polish 0.39..0.51, mill mottle +-1.6 %, and a cloudy sheen inside each
# sheet: the photographs' variation is mostly mottling and streaks within the sheets, with subtler steps between them
UPPER_SHEETS = dict(tone_var=0.05, rough0=0.45, rough_var=0.12, mottle=0.016, cloud=0.03)
# the lower-fuselage alloy (linear F0): rose-grey as photographed (c_mid 71,64,65 / c_nose 85,74,74), darker than the
# upper skin; red highest, green lowest
LOWER_ALLOY = np.array([0.48, 0.447, 0.455], np.float32)
# a satin finish that mirrors its surroundings (c_mid): at a dawn sun a rougher lobe drags the orange sun across the
# whole sun-facing belly and reads as brass
LOWER_ROUGH = 0.36
LETTER_WEIGHT = 800      # ExtraBold: stems about a fifth of the cap height, as photographed
# N21QH and EXPERIMENTAL are a narrower, heavier cut than the wordmark (the H stem is about a quarter of the cap height):
# Barlow Condensed ExtraBold (SIL OFL), only lightly condensed to the measured widths
CONDENSED = 'barlow-condensed'
# the wordmark: wider, rounder letters set tight (the 4K photograph), Barlow ExtraBold (SIL OFL)
WORDMARK = 'barlow'


def paint_fuselage(S, OUTS, skin, ff, decals):
    idx, P, N, pid, ao = S.gather([1])
    n = len(idx)
    log('fuselage texels', n)
    s, phi, a, hg, side = ff.coords(P)
    # the layout works in the photo-matched elliptical angle space (FusFrame.new_deg / old_deg)
    deg = ff.old_deg(s, np.degrees(phi))
    L = Layers(n)
    # sheets: between joints (frames x longitudinal joints); some frame joints are absent (long sheets)
    fi = np.clip(np.searchsorted(np.array(FRAMES, np.float32), s) - 1, 0, len(FRAMES) - 1)
    li = np.clip(np.searchsorted(np.array(LONGI, np.float32), deg) - 1, 0, len(LONGI) - 2)
    merge = (hash01(fi, li, 7) > 0.72) & ~np.isin(np.array(FRAMES)[np.clip(fi, 0, len(FRAMES) - 1)], list(MAIN_FRAMES))
    fi_eff = np.where(merge, np.maximum(fi - 1, 0), fi)
    panel = (fi_eff.astype(np.int64) * 32 + li) * 4 + (side > 0)
    # surface directions for the grain: along the body axis and round it
    along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
    along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
    across = np.cross(N, along)
    # lower fuselage: the darker, warmer alloy below the waterline joint (a crisp sheet edge)
    lower = sstep(-0.003, 0.003, a - ff.lookup(s, np.full_like(s, math.radians(WATERLINE))))
    # upper sheets: the overhead photographs show a patchwork - polished sheets mirroring the sky beside duller pale ones
    skin.metal(L, s, a, panel, ao, along, across, 0.90, lower=lower, cross_frac=0.0, **UPPER_SHEETS)
    # oil canning: each bay between rivet lines pillows slightly
    rows_s = sorted(FRAMES + INNER)
    s0, s1, js = bracket(rows_s, s)
    bu = np.clip((s - s0) / (s1 - s0), 0, 1)
    rows_p = sorted(LONGI + STRING)
    p0, p1, jp = bracket(rows_p, deg)
    a0 = ff.arc_old(s, p0); a1 = ff.arc_old(s, p1)
    bv = np.clip((a - a0) / np.maximum(a1 - a0, 1e-3), 0, 1)
    bay = js.astype(np.int64) * 64 + jp * 2 + (side > 0)
    amp = 0.00016 + 0.00030 * hash01(bay, 3) ** 2
    pil = np.sin(math.pi * bu) * np.sin(math.pi * bv)
    L.h += amp * pil * np.where(hash01(bay, 5) > 0.25, 1.0, -0.6)
    L.h += 0.00006 * (fbm(s, a, 0.9, 3, seed=11) - 0.5)
    L.h += 0.00010 * (hash01(panel, 9) - 0.5)          # sheet-to-sheet level mismatch
    # joints
    k, dsf = nearest(FRAMES, s)
    present = ~((hash01(k, li, 7) > 0.72) & ~np.isin(np.array(FRAMES)[k], list(MAIN_FRAMES)))
    skin.seam(L, dsf, strength=present.astype(np.float32))
    kp, dpd = nearest(LONGI, deg)
    jcol = np.array(LONGI, np.float32)[kp]
    dl = a - ff.arc_old(s, jcol)
    top_seam = np.where((jcol < 1) & (s > 9.2), 0.0, 1.0)     # no dorsal seam under the boom
    skin.seam(L, dl, strength=top_seam)
    # fastener rows: double rows either side of frame joints, single rows at inner frames and stringers
    pr = 0.0029
    for off, stg in ((0.016, 0.0), (-0.016, 0.0125)):
        skin.rivets(L, a, dsf - off, 0.025, pr, 11 + (off > 0), strength=present.astype(np.float32), stagger=stg)
    for off in (0.014, -0.014):
        skin.rivets(L, s, dl - off, 0.027, pr, 21 + (off > 0), strength=top_seam)
    ki, dsi = nearest(INNER, s)
    skin.rivets(L, a, dsi, 0.030, pr * 0.95, 31, strength=0.8)
    kst, _ = nearest(STRING, deg)
    dst = a - ff.arc_old(s, np.array(STRING, np.float32)[kst])
    skin.rivets(L, s, dst, 0.036, pr * 0.9, 41, strength=0.55 * (s > 2.9))
    # access panels with screw rows (rounded rectangles in (s, arc))
    rng = np.random.default_rng(2101)
    access = [(3.15, 3.75, 20, 44), (6.62, 7.40, 18, 40), (8.95, 9.75, 62, 82), (10.62, 11.15, 60, 80), (5.55, 6.30, 120, 140),
              (8.30, 8.80, 132, 150), (11.30, 11.95, 118, 140), (3.05, 3.85, 140, 165), (9.95, 10.45, 140, 162), (12.10, 12.70, 50, 75),
              (1.05, 1.80, 120, 150), (4.30, 4.95, 96, 108), (7.75, 8.70, 92, 106), (12.15, 12.65, 110, 128)]
    for i, (sa_, sb_, pa_, pb_) in enumerate(access):
        for sd in (1, -1):
            m = (side == sd) & (s > sa_ - 0.05) & (s < sb_ + 0.05) & (deg > pa_ - 6) & (deg < pb_ + 6)
            if not m.any():
                continue
            ss_, aa_ = s[m], a[m]
            aa0 = ff.arc_at(ss_, pa_); aa1 = ff.arc_at(ss_, pb_)
            r = 0.025
            ex = np.maximum(np.maximum(sa_ + r - ss_, ss_ - (sb_ - r)), 0)
            ey = np.maximum(np.maximum(aa0 + r - aa_, aa_ - (aa1 - r)), 0)
            inside_d = np.minimum(np.minimum(ss_ - sa_, sb_ - ss_), np.minimum(aa_ - aa0, aa1 - aa_))
            dist = np.where((ex > 0) | (ey > 0), np.hypot(ex, ey) - r, -inside_d) * -1    # >0 inside
            sub = Layers(int(m.sum()))
            sub.base, sub.rough, sub.metal, sub.h, sub.adir, sub.astr = L.base[m], L.rough[m], L.metal[m], L.h[m], L.adir[m], L.astr[m]
            skin.seam(sub, dist, strength=1.0)
            # screws 18 mm inside the edge, 45 mm pitch; a lighter, rougher sheet tone on the panel itself
            alongp = np.where(np.minimum(ss_ - sa_, sb_ - ss_) < np.minimum(aa_ - aa0, aa1 - aa_), aa_, ss_)
            head, ring, rnd = rivet_row(alongp, dist - 0.018, 0.045, 0.0034, 900 + i)
            ins = (dist > 0.004).astype(np.float32)
            sub.base *= (1 - 0.30 * ring[:, None] * ins[:, None]) * (1 - 0.10 * head[:, None] * ins[:, None])
            sub.rough += 0.08 * head * ins
            sub.h += (-0.00012 * ring + 0.00002 * head) * ins
            tint = 1 + (hash01(i, sd) - 0.5) * 0.02
            sub.base *= np.where(dist > 0, tint, 1.0)[:, None]
            L.base[m], L.rough[m], L.h[m], L.astr[m] = sub.base, sub.rough, sub.h, sub.astr
    # faint handling marks round the access panels: sheen only, no colour
    sm = skin.smear.sample(s, a, None, 3.0, 7.0)
    hot = np.zeros(n, np.float32)
    for (sa_, sb_, pa_, pb_) in access:
        cs, cp = 0.5 * (sa_ + sb_), 0.5 * (pa_ + pb_)
        hot += np.exp(-(((s - cs) / 0.5) ** 2 + ((deg - cp) / 16) ** 2))
    L.rough += 0.02 * np.clip(hot, 0, 1) * sstep(0.2, 1.4, sm)
    # heat: an even straw tint toward the engine, a little more on the lower alloy; faint exhaust dulling at the tail
    heat = sstep(10.8, 13.4, s) * (0.55 + 0.45 * lower)
    tint = np.array([1.0, 0.97, 0.905], np.float32)
    L.base *= (1 + heat[:, None] * (tint - 1))
    L.astr *= (1 - 0.4 * heat)
    soot = sstep(13.0, 13.4, s) * (0.7 + 0.3 * fbm(s * 0.05, a * 2.0, 0.1, 2, seed=29))
    over(L, soot * 0.16, col=np.array([0.10, 0.095, 0.09], np.float32), rough=0.5, metal=0.7)
    # markings
    for dc in decals:
        dc(L, s, a, side, deg)
    write(OUTS, idx, L)


def fus_decals(ff):
    """Markings as photographed: wordmark + horse (horse forward, facing the nose, both sides), unit badge,
    EXPERIMENTAL, four flush ports per side, the dorsal antenna patch."""
    out = []
    black = BLACK
    # wordmark, measured on the 4K side view: 1.86 m long, cap height 0.175 m as projected, upright, widely tracked; the
    # horse mark (traced) 0.70 x 0.20 m as projected starts 0.078 m ahead of the last letter. On the boxier section the
    # band (the 50-deg line of the photo-matched layout) lies on the near-vertical flank, 7 deg off vertical: 0.177 m of
    # skin projects to the measured 0.175 m (it was 0.202 m on the elliptical section)
    TH = 0.177
    tm, tw, ttop = text_mask('QUARTERHORSE', TH, LETTER_WEIGHT, width_m=1.86, family=WORDMARK)
    HW, HH = 0.71, 0.203
    hm = np.asarray(horse_mark(int(HW * DECAL_PX_PER_M), int(HH * DECAL_PX_PER_M)), np.float32) / 255.0
    T = Decal(None, tm, tw, tm.shape[0] / DECAL_PX_PER_M)
    Hs = Decal(None, hm, HW, HH)
    Hp = Decal(None, hm[:, ::-1].copy(), HW, HH)
    s_txt_aft, s_txt_fwd = 5.79, 5.79 - tw       # text spans s from ~3.93 to 5.79 (matched-camera overlay)
    s_h_aft, s_h_fwd = s_txt_fwd - 0.078, s_txt_fwd - 0.078 - HW
    phi_c = 50.0                                  # centre around-angle of the wordmark band

    def paint_coat(L, m, alpha, col=black, rough=0.55, thick=0.00006):
        sub_a = alpha
        over_m(L, m, sub_a, col, rough, metal=1.0)
        L.h[m] += thick * sub_a
        L.astr[m] *= (1 - sub_a)

    def wordmark(L, s, a, side, deg):
        m = (deg > 26) & (deg < 74) & (s > s_h_fwd - 0.1) & (s < s_txt_aft + 0.1)
        if not m.any():
            return
        ss, aa, sd = s[m], a[m], side[m]
        ac = ff.arc_at(ss, phi_c)
        y = aa - ac + TH / 2 + ttop                # image y down = increasing arc from the top
        # starboard: image x runs forward (decreasing s); port: aft (increasing s)
        xt = np.where(sd < 0, s_txt_aft - ss, ss - s_txt_fwd)
        _, at = T.sample(xt, y)
        xh = np.where(sd < 0, s_h_aft - ss, ss - s_h_fwd)
        yh = aa - ac + HH / 2 - 0.014
        _, ah_s = Hs.sample(xh, yh)
        _, ah_p = Hp.sample(xh, yh)
        ah = np.where(sd < 0, ah_s, ah_p)
        paint_coat(L, m, np.maximum(at, ah))
    out.append(wordmark)

    SEAL_S, SEAL_D = 1.67, 0.545                  # badge centre station and diameter (matched-camera overlay)
    srgb, salpha = seal(int(SEAL_D * DECAL_PX_PER_M))
    SD = Decal(srgb, salpha, SEAL_D, SEAL_D)

    def badge(L, s, a, side, deg):
        m = (deg > 66) & (deg < 114) & (s > SEAL_S - 0.31) & (s < SEAL_S + 0.31)
        if not m.any():
            return
        ss, aa, sd = s[m], a[m], side[m]
        ac = ff.arc_at(ss, 88.0)
        x = np.where(sd < 0, SEAL_S + SEAL_D / 2 - ss, ss - (SEAL_S - SEAL_D / 2))
        rgb, al = SD.sample(x, aa - ac + SEAL_D / 2)
        over_m(L, m, al, rgb, 0.5)
        # the dark field as 'black metal' like the lettering (no dielectric sheen to grey it in the sun); the pale ring
        # and emblem stay ordinary paint
        darkf = al * sstep(0.10, 0.04, rgb.mean(1))
        L.metal[m] = np.maximum(L.metal[m] * (1 - al), darkf)
        L.base[m] = L.base[m] * (1 - darkf[:, None]) + (rgb * 1.6 + 0.006) * darkf[:, None]
        L.rough[m] = L.rough[m] * (1 - darkf) + 0.6 * darkf
        L.h[m] += 0.00007 * al
        L.astr[m] *= (1 - al)
    out.append(badge)

    # 0.627 m long at a 0.088 m cap height: narrower than the face sets it, so the letters are condensed (never
    # overlapped, which fused the I and M into a blot)
    em, ew, etop = text_mask('EXPERIMENTAL', 0.088, LETTER_WEIGHT, width_m=0.627, family=CONDENSED)
    ED = Decal(None, em, ew, em.shape[0] / DECAL_PX_PER_M)

    def experimental(L, s, a, side, deg):
        m = (deg > 52) & (deg < 86) & (s > 0.4) & (s < 1.45)
        if not m.any():
            return
        ss, aa, sd = s[m], a[m], side[m]
        ac = ff.arc_at(ss, 68.0)
        s_aft = 1.31; s_fwd = s_aft - ew          # matched-camera overlay (was 0.11 m forward of the photo)
        x = np.where(sd < 0, s_aft - ss, ss - s_fwd)
        _, al = ED.sample(x, aa - ac + 0.027 + etop)
        paint_coat(L, m, al)
    out.append(experimental)

    def ports(L, s, a, side, deg):
        for (sc, pc) in ((1.67, 44.0), (2.74, 47.5), (1.65, 135.0), (2.73, 134.5)):
            m = (np.abs(s - sc) < 0.12) & (np.abs(deg - pc) < 14)
            if not m.any():
                continue
            ss, aa = s[m], a[m]
            ac = ff.arc_at(ss, pc)
            dx, dy = ss - sc, aa - ac
            r = np.hypot(dx, dy)
            ang = np.arctan2(dy, dx)
            hexr = 0.040 / np.maximum(np.cos(((ang + math.pi / 6) % (math.pi / 3)) - math.pi / 6), 0.5)
            lw = 0.0028
            band = sstep(0.086, 0.082, r) * sstep(0.056, 0.060, r)                          # the ring itself
            lines = np.maximum(np.exp(-((r - 0.085) / lw) ** 2), np.exp(-((r - 0.057) / lw) ** 2))
            hexm = sstep(hexr + 0.002, hexr - 0.002, r)
            hexl = np.exp(-((r - hexr) / lw) ** 2)
            # the photographs show these as the brightest small features on the nose: a near-white ring round a
            # near-white hex insert (matte paint), a thin dark outline outside, a faint line round the hex
            white = srgb_to_lin(np.array([0.85, 0.85, 0.83], np.float32))
            outer = np.exp(-((r - 0.0855) / lw) ** 2)
            over_m(L, m, np.maximum(band, hexm), white, 0.62, metal=0.0)
            over_m(L, m, outer * 0.85, np.array([0.06, 0.06, 0.063], np.float32), 0.55, metal=0.0)
            over_m(L, m, hexl * 0.3, np.array([0.10, 0.10, 0.105], np.float32), 0.6, metal=0.0)
            L.h[m] += -0.0002 * np.maximum(outer, 0.3 * hexl)
            L.astr[m] *= (1 - np.maximum(band, hexm))
    out.append(ports)

    def vents(L, s, a, side, deg):
        # small flush features seen on the photos: an aft-facing slot, drains, a round flush antenna
        # the two dark dots seen from above sit on the shoulder line (24 deg in layout space)
        for (sc, pc, kind) in ((1.30, 112.0, 'slot'), (2.34, 103.0, 'drain'), (2.39, 106.0, 'drain'), (3.42, 125.0, 'round'), (6.0, 129.0, 'drain'), (4.25, 128.0, 'slot'),
                               (3.50, 24.0, 'dot'), (4.43, 24.0, 'dot')):
            m = (np.abs(s - sc) < 0.1) & (np.abs(deg - pc) < 10)
            if not m.any():
                continue
            ss, aa = s[m], a[m]
            ac = ff.arc_at(ss, pc)
            dx, dy = ss - sc, aa - ac
            if kind == 'slot':
                q = sstep(0.004, 0.0, np.maximum(np.abs(dx) - 0.035, 0) + np.maximum(np.abs(dy) - 0.006, 0))
                over_m(L, m, q, np.array([0.02, 0.02, 0.02], np.float32), 0.6, metal=0.0)
                L.h[m] -= 0.0008 * q
            elif kind == 'dot':          # small dark flush fitting (seen from above in the overhead photographs)
                q = sstep(0.016, 0.012, np.hypot(dx, dy))
                over_m(L, m, q, np.array([0.025, 0.025, 0.027], np.float32), 0.5, metal=0.0)
                L.h[m] -= 0.0003 * q
            elif kind == 'drain':
                q = sstep(0.006, 0.003, np.hypot(dx, dy))
                over_m(L, m, q, np.array([0.03, 0.03, 0.03], np.float32), 0.6, metal=0.0)
                L.h[m] -= 0.0005 * q
            else:
                r = np.hypot(dx, dy)
                q = sstep(0.05, 0.045, r)
                over_m(L, m, q, np.array([0.12, 0.12, 0.12], np.float32), 0.5, metal=0.2)
                L.h[m] -= 0.0009 * q * (1 - r / 0.05)
    out.append(vents)

    def dorsal_patch(L, s, a, side, deg):
        m = (deg < 16) & (s > 1.45) & (s < 1.95)
        if not m.any():
            return
        ss, aa = s[m], a[m]
        # a deep navy square, crisp-edged, matte (the overhead photographs)
        q = sstep(0.0012, 0.0, np.maximum(np.abs(ss - 1.69) - 0.15, 0) + np.maximum(aa - 0.095, 0))
        over_m(L, m, q, hexlin('#10204f'), 0.6, metal=0.0)
        L.h[m] += 0.0002 * q
        L.astr[m] *= (1 - q)
    out.append(dorsal_patch)
    return out


def over_m(L, m, alpha, col, rough, metal=0.0):
    a = np.clip(alpha, 0, 1).astype(np.float32)
    col = np.asarray(col, np.float32)
    c = col if col.ndim == 2 else col[None, :]
    L.base[m] = L.base[m] * (1 - a[:, None]) + c * a[:, None]
    L.rough[m] = L.rough[m] * (1 - a) + rough * a
    L.metal[m] = L.metal[m] * (1 - a) + metal * a


# ------------------------------------------------------------------ wing set: wings, elevons, fin, rudder, boom, nose bits
WING_RIBS = [0.75, 0.98, 1.65, 2.33, 3.02, 3.66, 4.29]
WING_SPARS = [0.065, 0.30, 0.52, 0.72]


def paint_wing_set(S, OUTS, skin):
    # --- wings and elevons
    idx, P, N, pid, ao = S.gather([10, 11, 12])
    if len(idx):
        n = len(idx)
        s = (X0 - P[:, 0]).astype(np.float32)
        y = np.abs(P[:, 1]).astype(np.float32)
        up = N[:, 2] >= 0
        le, te = wing_le(y).astype(np.float32), wing_te(y).astype(np.float32)
        c = np.maximum(te - le, 0.05)
        x = (s - le) / c
        sd = np.where(P[:, 1] >= 0, 1, -1)
        elev = pid == 12
        L = Layers(n)
        ri = np.clip(np.searchsorted(np.array(WING_RIBS, np.float32), y) - 1, -1, len(WING_RIBS) - 1) + 1
        si = np.clip(np.searchsorted(np.array(WING_SPARS, np.float32), x) - 1, -1, len(WING_SPARS) - 1) + 1
        panel = ((ri * 8 + si) * 2 + up) * 4 + (sd > 0) * 2 + elev + 5000
        along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
        along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(N, along)
        u, v = s, y + up * 7.0
        skin.metal(L, u, v, panel, ao, along, across, 0.90, lower=(~up).astype(np.float32), cross_frac=0.0, **UPPER_SHEETS)
        # elevons: their own sheets, a shade duller than the wing ahead of them (the overhead photographs)
        L.rough += 0.04 * elev * up
        # bay pillowing between rib and spar rows
        r0, r1, _ = bracket(WING_RIBS, y)
        x0, x1, _ = bracket(WING_SPARS + [0.86], x)
        bu = np.clip((y - r0) / (r1 - r0), 0, 1); bv = np.clip((x - x0) / np.maximum(x1 - x0, 1e-3), 0, 1)
        bay = panel * 3
        L.h += (0.00010 + 0.0002 * hash01(bay, 2) ** 2) * np.sin(math.pi * bu) * np.sin(math.pi * bv) * np.where(up, 1, -0.7)
        L.h += 0.00006 * (fbm(u, v, 0.8, 3, seed=41) - 0.5)
        # joints and fastener rows
        k, dr = nearest(WING_RIBS, y)
        skin.seam(L, dr)
        for off, stg in ((0.014, 0.0), (-0.014, 0.012)):
            skin.rivets(L, s, dr - off, 0.026, 0.0024, 51 + (off > 0), stagger=stg)
        ks, dxs = nearest(WING_SPARS, x)
        ds = dxs * c
        skin.seam(L, ds, strength=(~elev).astype(np.float32))
        for off in (0.013, -0.013):
            skin.rivets(L, y, ds - off, 0.026, 0.0024, 61 + (off > 0), strength=(~elev).astype(np.float32))
        # elevons: hinge-line rows, trailing-edge row, a rib at mid-span
        xh = 1 - (elevon_chord(y) / c)
        dh = (x - xh) * c
        skin.rivets(L, y, dh - 0.03, 0.03, 0.0023, 71, strength=elev.astype(np.float32))
        skin.rivets(L, y, (1 - x) * c - 0.03, 0.03, 0.0021, 72, strength=elev.astype(np.float32))
        # leading edge: a touch more polished; the trailing edge and hinge gap a little duller; faint straw near the nozzle
        lez = sstep(0.04, 0.0, x * c)
        L.rough = L.rough * (1 - 0.25 * lez) + 0.26 * 0.25 * lez
        L.base *= (1 - 0.08 * sstep(0.02, 0.0, (1 - x) * c))[:, None]
        heat = sstep(1.3, 0.7, y) * sstep(11.8, 13.2, s)
        L.base *= (1 + 0.6 * heat[:, None] * (np.array([1.0, 0.97, 0.905], np.float32) - 1))
        write(OUTS, idx, L)
    # --- wing-root / strake fairings: long formed strips, joints at the fuselage frames, fastener rows down both edges
    idx, P, N, pid, ao = S.gather([19])
    if len(idx):
        n = len(idx)
        s = (X0 - P[:, 0]).astype(np.float32)
        y = np.abs(P[:, 1]).astype(np.float32)
        sd = np.where(P[:, 1] >= 0, 1, -1)
        st = np.linspace(2.5, 13.34, 500)
        yf_t, zj_t, yo_t, zo_t = fairing_ends(st)
        yf = np.interp(s, st, yf_t).astype(np.float32); yo = np.interp(s, st, yo_t).astype(np.float32)
        wid = np.maximum(np.hypot(yo - yf, np.interp(s, st, zj_t - zo_t)), 0.03).astype(np.float32)
        t = np.clip((y - yf) / np.maximum(yo - yf, 1e-3), 0, 1)
        L = Layers(n)
        fr = np.array([2.93, 4.20, 5.45, 6.50, 7.68, 8.85, 9.95, 11.25, 12.05, 12.75], np.float32)
        fi = np.searchsorted(fr, s)
        panel = fi * 2 + (sd > 0) + 15000
        along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
        along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(N, along)
        skin.metal(L, s, y + (sd > 0) * 9.0, panel, ao, along, across, 0.90, cross_frac=0.0, **UPPER_SHEETS)
        k, dsf = nearest(fr, s)
        skin.seam(L, dsf)
        for off, stg in ((0.014, 0.0), (-0.014, 0.0125)):
            skin.rivets(L, t * wid, dsf - off, 0.026, 0.0024, 131 + (off > 0), stagger=stg)
        wide = (wid > 0.10).astype(np.float32)
        skin.rivets(L, s, t * wid - 0.016, 0.026, 0.0023, 133, strength=wide)
        skin.rivets(L, s, (1 - t) * wid - 0.016, 0.026, 0.0023, 134, strength=wide)
        # small pale stencil strips across the strake shelf aft of mid-span (c_mid): plain marks, no lettering
        for sc_, tc_, ln_ in ((10.55, 0.34, 0.15), (10.62, 0.70, 0.09)):
            q = sstep(0.0015, 0.0, np.maximum(np.abs(s - sc_) - 0.012, 0) + np.maximum(np.abs(t * wid - tc_ * wid) - ln_ / 2, 0))
            over(L, q * 0.9, col=srgb_to_lin(np.array([0.84, 0.84, 0.82], np.float32)), rough=0.6, metal=0.0)
            L.astr *= (1 - q)
        heat = sstep(11.8, 13.2, s)
        L.base *= (1 + 0.6 * heat[:, None] * (np.array([1.0, 0.97, 0.905], np.float32) - 1))
        write(OUTS, idx, L)
    # --- fin and rudder
    idx, P, N, pid, ao = S.gather([13, 14])
    if len(idx):
        n = len(idx)
        s = (X0 - P[:, 0]).astype(np.float32)
        z = P[:, 2].astype(np.float32)
        sd = np.where(N[:, 1] >= 0, 1, -1)
        zc = np.clip(z, FIN_Z0, FIN_Z1)
        le = fin_lerp(FIN_LE, zc); te = fin_lerp(FIN_TE, zc)
        c = te - le
        x = (s - le) / c
        rud = pid == 14
        L = Layers(n)
        # irregular rib joints (c_tail), and the spar lines: a narrow leading-edge strip, a long spar line parallel to the
        # leading edge, and a rear spar at a chord fraction ahead of the hinge
        ribs = [1.47, 1.88, 2.36, 2.72]
        spl = np.stack([le + 0.075, le + 0.43, le + 0.60 * c], 1)
        ri = np.searchsorted(np.array(ribs, np.float32), z)
        si = (s[:, None] > spl).sum(1)
        panel = ((ri * 8 + si) * 2 + (sd > 0)) * 2 + rud + 7000
        along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
        along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(N, along)
        u, v = s, z + (sd > 0) * 9.0
        skin.metal(L, u, v, panel, ao, along, across, 0.90, cross_frac=0.16, **UPPER_SHEETS)
        r0, r1, _ = bracket([FIN_Z0] + ribs + [FIN_Z1], z)
        bu = np.clip((z - r0) / (r1 - r0), 0, 1)
        lo_ = np.where(si == 0, le, spl[np.arange(n), np.clip(si - 1, 0, 2)])
        hi_ = np.where(si >= 3, te, spl[np.arange(n), np.clip(si, 0, 2)])
        bv = np.clip((s - lo_) / np.maximum(hi_ - lo_, 1e-3), 0, 1)
        L.h += (0.00010 + 0.00018 * hash01(panel, 2) ** 2) * np.sin(math.pi * bu) * np.sin(math.pi * bv)
        k, dz = nearest(ribs, z)
        skin.seam(L, dz)
        for off, stg in ((0.013, 0.0), (-0.013, 0.012)):
            skin.rivets(L, s, dz - off, 0.025, 0.0023, 81 + (off > 0), stagger=stg)
        dsp = s[:, None] - spl
        ds = dsp[np.arange(n), np.argmin(np.abs(dsp), 1)]
        skin.seam(L, ds, strength=(~rud).astype(np.float32))
        skin.rivets(L, z, ds - 0.012, 0.025, 0.0023, 91, strength=(~rud).astype(np.float32))
        skin.rivets(L, z, ds + 0.012, 0.025, 0.0023, 92, strength=(~rud).astype(np.float32), stagger=0.012)
        # rudder hinge line: orange-brown fittings on the fin side, as photographed
        hz = fin_lerp(FIN_HINGE, zc)
        dh = s - hz       # >0 aft of the hinge (on the rudder)
        fit_along = (zc - FIN_Z0)
        kk = np.round(fit_along / 0.19)
        dl = fit_along - kk * 0.19
        fit = sstep(0.004, 0.0, np.maximum(np.abs(dl) - 0.022, 0) + np.maximum(np.abs(dh + 0.045) - 0.012, 0)) * (kk >= 1) * (kk <= 9)
        over(L, fit, col=hexlin('#9a5a2c'), rough=0.55, metal=0.0, h=0.0004)
        skin.rivets(L, zc, dh + 0.085, 0.03, 0.0022, 93, strength=(~rud).astype(np.float32))
        skin.rivets(L, zc, dh - 0.03, 0.03, 0.0021, 94, strength=rud.astype(np.float32))
        # markings: wing mark (feathers trail aft on both sides) and the flag (union forward on both sides)
        # traced artwork in the box the matched-camera overlay gives it: 1.19 x 0.89 m, aft edge at s 14.00, top at z 2.43
        WMW, WMH = 1.19, 0.89
        wm = np.asarray(wing_mark(int(WMW * DECAL_PX_PER_M), int(WMH * DECAL_PX_PER_M)), np.float32) / 255.0
        WS, WP = Decal(None, wm, WMW, WMH), Decal(None, wm[:, ::-1].copy(), WMW, WMH)
        s_aft, z_top = 14.00, 2.43
        s_fwd = s_aft - WMW
        m = (s > s_fwd - 0.05) & (s < s_aft + 0.05) & (z > z_top - WMH - 0.05) & (z < z_top + 0.05)
        if m.any():
            ss, zz, sdm = s[m], z[m], sd[m]
            # starboard: image x runs forward (image left = aft); port: image x runs aft (mirrored artwork)
            _, a_s = WS.sample(s_aft - ss, z_top - zz)
            _, a_p = WP.sample(ss - s_fwd, z_top - zz)
            al = np.where(sdm < 0, a_s, a_p)
            over_m(L, m, al, BLACK, 0.55, metal=1.0)
            L.h[m] += 0.00007 * al; L.astr[m] *= (1 - al)
        fw, fh = 0.55, 0.31
        fs_f, fz_t = 12.17, 1.625
        flag_s = us_flag(int(fw * DECAL_PX_PER_M), int(fh * DECAL_PX_PER_M), union_left=False)   # starboard: union at right = forward
        flag_p = us_flag(int(fw * DECAL_PX_PER_M), int(fh * DECAL_PX_PER_M), union_left=True)    # port: union at left = forward
        FS = Decal(flag_s, np.ones(flag_s.shape[:2], np.float32), fw, fh)
        FP = Decal(flag_p, np.ones(flag_p.shape[:2], np.float32), fw, fh)
        m = (s > fs_f - 0.03) & (s < fs_f + fw + 0.03) & (z > fz_t - fh - 0.03) & (z < fz_t + 0.03)
        if m.any():
            ss, zz, sdm = s[m], z[m], sd[m]
            rs, a_s = FS.sample((fs_f + fw) - ss, fz_t - zz)
            rp, a_p = FP.sample(ss - fs_f, fz_t - zz)
            rgb = np.where((sdm < 0)[:, None], rs, rp); al = np.where(sdm < 0, a_s, a_p)
            over_m(L, m, al, rgb, 0.38)
            L.h[m] += 0.00008 * al; L.astr[m] *= (1 - al)
        # fin tip light / antenna: dark cap at the top of the leading edge
        tipm = sstep(0.006, 0.0, np.maximum(z - (FIN_Z1 - 0.05), 0) * 0 + np.maximum((FIN_Z1 - 0.04) - z, 0)) * sstep(0.004, 0.0, np.maximum(x - 0.12, 0))
        over(L, tipm, col=np.array([0.03, 0.03, 0.03], np.float32), rough=0.4, metal=0.0)
        heat = sstep(1.5, 1.2, z) * sstep(13.8, 14.6, s)
        over(L, heat * 0.08, col=np.array([0.10, 0.095, 0.09], np.float32), rough=0.5, metal=0.7)
        write(OUTS, idx, L)
    # --- chute boom
    idx, P, N, pid, ao = S.gather([15])
    if len(idx):
        n = len(idx)
        s = (X0 - P[:, 0]).astype(np.float32); z = P[:, 2].astype(np.float32); y = P[:, 1].astype(np.float32)
        sd = np.where(N[:, 1] >= 0, 1, -1)
        sideface = np.abs(N[:, 1]) > 0.6
        L = Layers(n)
        frames = [10.30, 10.95, 11.45, 12.15, 13.0, 13.63, 14.37, 15.0]
        fi = np.searchsorted(np.array(frames, np.float32), s)
        band = (z > 0.955).astype(np.int64)
        panel = ((fi * 4 + band * 2 + sideface) * 2 + (sd > 0)) + 9000
        along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
        along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(N, along)
        u, v = s, np.where(sideface, z, y) + (sd > 0) * 5.0
        skin.metal(L, u, v, panel, ao, along, across, 0.90, **UPPER_SHEETS)
        k, dsf = nearest(frames, s)
        skin.seam(L, dsf)
        skin.rivets(L, v, dsf - 0.014, 0.025, 0.0023, 101)
        skin.rivets(L, v, dsf + 0.014, 0.025, 0.0023, 102, stagger=0.0125)
        dzb = (z - 0.955) * sideface
        skin.seam(L, dzb, strength=sideface.astype(np.float32) * (s > 10.5))
        skin.rivets(L, s, dzb - 0.012, 0.026, 0.0022, 103, strength=sideface.astype(np.float32) * (s > 10.5))
        # N21QH: both sides, reads left to right from outside
        rm, rw, rtop = text_mask('N21QH', 0.205, LETTER_WEIGHT, width_m=0.62, family=CONDENSED)
        R = Decal(None, rm, rw, rm.shape[0] / DECAL_PX_PER_M)
        s_c, z_c = 11.75, 1.015
        m = sideface & (np.abs(s - s_c) < rw / 2 + 0.05) & (np.abs(z - z_c) < 0.15)
        if m.any():
            ss, zz, sdm = s[m], z[m], sd[m]
            x = np.where(sdm < 0, (s_c + rw / 2) - ss, ss - (s_c - rw / 2))
            _, al = R.sample(x, (z_c + 0.1025 + rtop) - zz)
            over_m(L, m, al, BLACK, 0.55, metal=1.0)
            L.h[m] += 0.00007 * al; L.astr[m] *= (1 - al)
        # exhaust soot and heat on the boom's underside above the nozzle
        under = sstep(-0.2, -0.8, N[:, 2])
        soot = (under * 0.7 + 0.3 * sstep(0.85, 0.74, z)) * sstep(13.0, 14.6, s) * (0.6 + 0.4 * fbm(s, y, 0.3, 3, seed=53))
        over(L, soot * 0.22, col=np.array([0.10, 0.095, 0.09], np.float32), rough=0.5, metal=0.7)
        L.base *= (1 + 0.6 * sstep(13.2, 14.6, s)[:, None] * (np.array([1.0, 0.97, 0.905], np.float32) - 1))
        write(OUTS, idx, L)
    # --- nose fairing (black), air-data boom (steel), blade antennas (dark composite)
    # the nose fairing is a flat-finish dark composite (a gloss black read as a lacquered egg)
    for pidv, col, rough, metal in ((16, hexlin('#0c0d0e'), 0.52, 0.0), (17, np.array([0.66, 0.67, 0.68], np.float32), 0.30, 1.0), (18, hexlin('#2a2b2d'), 0.5, 0.0)):
        idx, P, N, pid, ao = S.gather([pidv])
        if not len(idx):
            continue
        n = len(idx)
        L = Layers(n)
        u, v = P[:, 0] * 3.1, P[:, 1] * 3.1 + P[:, 2] * 2.3
        nz = fbm(u, v, 0.5, 4, seed=pidv)
        L.base[:] = col[None, :] * (0.96 + 0.08 * nz)[:, None]
        L.rough[:] = rough * (0.92 + 0.16 * nz)
        L.metal[:] = metal
        if pidv == 17:   # the tip and the vanes darker, a heat-blued collar band
            tip = sstep(-1.38, -1.50, X0 - P[:, 0])
            L.base *= (1 - 0.35 * tip)[:, None]
        g = np.clip(1 - ao, 0, 1)
        L.base *= (1 - 0.15 * g)[:, None]
        L.h += 0.00004 * (nz - 0.5)
        write(OUTS, idx, L)


# ------------------------------------------------------------------ hot section
def heat_tint(t):
    """Temper colours of heat-treated steel / titanium for 0 (cool) .. 1 (hottest): straw, bronze, purple, blue, grey."""
    stops = [(0.0, (0.60, 0.60, 0.60)), (0.18, (0.70, 0.62, 0.42)), (0.34, (0.62, 0.42, 0.22)), (0.5, (0.42, 0.22, 0.30)),
             (0.64, (0.20, 0.22, 0.48)), (0.80, (0.30, 0.40, 0.55)), (1.0, (0.28, 0.28, 0.30))]
    t = np.clip(t, 0, 1)
    out = np.zeros((len(t), 3), np.float32)
    for (a, ca), (b, cb) in zip(stops[:-1], stops[1:]):
        m = (t >= a) & (t <= b)
        f = ((t[m] - a) / (b - a))[:, None]
        out[m] = np.array(ca, np.float32) * (1 - f) + np.array(cb, np.float32) * f
    return srgb_to_lin(out)


def paint_hot(S, OUTS):
    idx, P, N, pid, ao = S.gather([2, 3, 30, 31, 32, 33, 34, 35, 36, 37])
    n = len(idx)
    L = Layers(n)
    s = (X0 - P[:, 0]).astype(np.float32)
    yy, zz = P[:, 1], P[:, 2] - NOZ_Z
    th = np.arctan2(zz, yy)
    r = np.hypot(yy, zz)
    radial = np.stack([np.zeros(n), yy / np.maximum(r, 1e-6), zz / np.maximum(r, 1e-6)], 1)
    inward = (N * radial).sum(1) < -0.3
    edge = S.edge.ravel()[idx] if S.edge is not None else np.zeros(n, np.float32)
    nz = fbm(s * 1.0, th * 0.5, 0.35, 4, seed=61)
    nz2 = fbm(s * 3.0, th * 2.0, 0.25, 3, seed=62)
    # base: heat-darkened titanium and Inconel: near-black greys with a faint blue-bronze bloom
    dark = srgb_to_lin(np.array([0.23, 0.225, 0.22], np.float32))
    L.base[:] = dark[None, :] * (0.75 + 0.5 * nz)[:, None]
    L.rough[:] = 0.40 + 0.16 * nz2
    L.metal[:] = 1.0
    # temper colours, restrained: strongest on the divergent flaps' inner faces near the throat
    t_in = np.clip(1 - (s - 13.9) / 0.75, 0, 1) * inward
    t = np.where(np.isin(pid, [32, 35]), 0.35 + 0.5 * t_in + 0.2 * (nz - 0.5), 0.5 + 0.3 * (nz - 0.5))
    tint = heat_tint(t)
    k = np.where(np.isin(pid, [32, 35]) & inward, 0.45, np.where(np.isin(pid, [30, 31]), 0.16, 0.22))
    L.base = L.base * (1 - k[:, None]) + tint * (0.35 * k)[:, None] * (0.6 + 0.4 * nz)[:, None]
    # soot: inner surfaces, the flame-holder and liner, the shroud's aft lip
    soot = np.where(inward, 0.5 + 0.4 * nz2, 0.15 + 0.3 * sstep(13.6, 13.78, s))
    soot = np.where(np.isin(pid, [36, 37]), 0.75 + 0.2 * nz, soot)
    over(L, soot, col=np.array([0.028, 0.027, 0.025], np.float32), rough=0.72, metal=0.2)
    # rubbed, slightly brighter edges on the mechanism (links, clevises, rib tops); the hardware stays satin (its 6 mm
    # bevels are sub-pixel in every shot, and a polished one strings glints down the nozzle throat)
    over(L, np.clip(edge * 2.5, 0, 1) * np.isin(pid, [33, 34]) * 0.45, col=np.array([0.26, 0.255, 0.25], np.float32), rough=0.5, metal=1.0)
    # inlet: the lip roll is plain skin metal; inside, the duct falls quickly to a dark matte grey (a dark intake
    # face, as photographed); compressor face dark titanium
    inl = pid == 2
    dk = sstep(0.034, 0.10, s[inl])                          # 0 on the lip roll .. 1 in the duct
    depth = np.clip(s[inl] / 1.2, 0, 1)
    duct_col = srgb_to_lin(np.array([0.20, 0.20, 0.205], np.float32))[None, :] * (1 - 0.8 * depth)[:, None]
    L.base[inl] = (0.89 * (1 - dk))[:, None] + duct_col * dk[:, None]
    L.rough[inl] = 0.33 * (1 - dk) + 0.62 * dk
    L.metal[inl] = 1 - dk
    aomul = np.ones(n, np.float32)
    aomul[inl] = 1 - 0.9 * sstep(0.05, 0.6, s[inl])
    aomul[np.isin(pid, [3, 36, 37])] = 0.15
    L.aomul = aomul
    fan = pid == 3
    L.base[fan] = srgb_to_lin(np.array([0.34, 0.34, 0.35], np.float32)) * (0.8 + 0.4 * nz[fan])[:, None]
    L.rough[fan] = 0.35; L.metal[fan] = 1.0
    L.rough[np.isin(pid, [33, 34])] = np.maximum(L.rough[np.isin(pid, [33, 34])], 0.5)
    g = np.clip(1 - ao, 0, 1)
    L.base *= (1 - 0.5 * g)[:, None]
    L.h += 0.0003 * (nz2 - 0.5) + 0.0001 * (fbm(s * 9, th * 6, 0.2, 2, seed=63) - 0.5)
    # emission pattern for the afterburner glow: the flame holder's rings and spokes brightest, the liner an even glow
    # (its corrugations only a faint ripple: a strongly striped liner reads as a toaster element through the exit)
    em = np.zeros((n, 3), np.float32)
    fh = pid == 37
    ln = pid == 36
    em[fh] = np.array([1.0, 0.45, 0.16], np.float32) * (0.75 + 0.25 * nz[fh])[:, None]
    corr = 0.5 + 0.5 * np.cos(th * 40)
    em[ln] = np.array([1.0, 0.5, 0.2], np.float32) * ((0.88 + 0.12 * corr[ln]) * (0.75 + 0.25 * nz2[ln]) * (0.6 + 0.4 * sstep(13.3, 11.7, s[ln])))[:, None]
    L.emis = em
    write(OUTS, idx, L)


# ------------------------------------------------------------------ landing gear
def paint_gear(S, OUTS, skin):
    idx, P, N, pid, ao = S.gather(list(range(50, 62)))
    n = len(idx)
    L = Layers(n)
    s = (X0 - P[:, 0]).astype(np.float32)
    edge = S.edge.ravel()[idx] if S.edge is not None else np.zeros(n, np.float32)
    u, v = P[:, 0] * 1.0 + P[:, 1] * 0.7, P[:, 2] * 1.0 + P[:, 1] * 0.4
    nz = fbm(u, v, 0.3, 4, seed=71)
    nz2 = fbm(u * 3, v * 3, 0.2, 3, seed=72)
    white = srgb_to_lin(np.array([0.80, 0.80, 0.78], np.float32))
    L.base[:] = white * (0.92 + 0.12 * nz)[:, None]
    L.rough[:] = 0.42 + 0.12 * nz2
    L.metal[:] = 0.0
    g = np.clip(1 - ao, 0, 1)
    # tyres: matte rubber (dark grey, never black), a slightly scrubbed tread band, moulded sidewall rings, and the
    # pale dust a desert runway leaves on the sidewalls and in the grooves (the wheel turns: dust is even all round)
    ty = pid == 50
    if ty.any():
        main = np.abs(P[ty, 1]) > 0.5
        wheel_c = np.where(main, GROUND - MAIN_DROP + MAIN_WHEEL['r'], GROUND + NOSE_WHEEL['r'])
        sx = np.where(main, X(MAIN_WHEEL['s']), X(NOSE_WHEEL['s']))
        dx_, dz_ = P[ty, 0] - sx, P[ty, 2] - wheel_c
        rad = np.hypot(dx_, dz_)
        R = np.where(main, MAIN_WHEEL['r'], NOSE_WHEEL['r'])
        angc = np.arctan2(dz_, dx_) * R                       # metres round the circumference
        fine = fbm(angc * 6.0, rad * 6.0, 0.05, 3, seed=74)
        patch = fbm(angc, rad * 2.0, 0.25, 3, seed=75)
        rubber = srgb_to_lin(np.array([0.150, 0.150, 0.155], np.float32))
        tread = sstep(R - 0.034, R - 0.014, rad)
        L.base[ty] = rubber[None, :] * (0.90 + 0.20 * fine)[:, None] * (1 + 0.22 * tread)[:, None]
        L.rough[ty] = 0.90 - 0.06 * tread
        L.metal[ty] = 0.0
        rings = 0.5 + 0.5 * np.cos(rad * 2 * math.pi / 0.009)
        L.h[ty] += 0.00008 * rings * (1 - tread) * sstep(0.62, 0.72, rad / R) + 0.00025 * (fine - 0.5) * tread
        dustc = srgb_to_lin(np.array([0.47, 0.43, 0.37], np.float32))
        dust = (1 - tread) * (0.12 + 0.22 * patch) * sstep(0.55, 0.80, rad / R) + tread * 0.08 * sstep(0.45, 0.75, fine)
        dust += 0.35 * np.clip(1 - ao[ty], 0, 1) * tread        # packed into the grooves
        dust = np.clip(dust, 0, 0.6)
        L.base[ty] = L.base[ty] * (1 - dust[:, None]) + dustc[None, :] * dust[:, None]
        L.rough[ty] = L.rough[ty] * (1 - dust) + 0.95 * dust
    hub = pid == 51
    if hub.any():
        L.base[hub] = srgb_to_lin(np.array([0.80, 0.80, 0.78], np.float32)) * (0.93 + 0.10 * nz[hub])[:, None]
        L.rough[hub] = 0.40
        bd = np.clip(1 - ao[hub], 0, 1)
        over_m(L, hub, 0.30 * bd + 0.05 * nz2[hub], np.array([0.12, 0.10, 0.08], np.float32), 0.6)   # brake dust
        # the open middle of the wheel (cap and its three lobes) reads as a dark three-lobed hole in the pale disc
        main = np.abs(P[hub, 1]) > 0.5
        wc = np.where(main, GROUND - MAIN_DROP + MAIN_WHEEL['r'], GROUND + NOSE_WHEEL['r'])
        sx = np.where(main, X(MAIN_WHEEL['s']), X(NOSE_WHEEL['s']))
        Rw = np.where(main, MAIN_WHEEL['r'], NOSE_WHEEL['r'])
        rad = np.hypot(P[hub, 0] - sx, P[hub, 2] - wc) / Rw
        th = np.arctan2(P[hub, 2] - wc, P[hub, 0] - sx)
        lobe_r = 0.185 * (1 + 0.24 * np.cos(3 * th - math.pi / 2))
        over_m(L, hub, sstep(lobe_r + 0.012, lobe_r - 0.012, rad), np.array([0.025, 0.024, 0.023], np.float32), 0.55)
    chrome = pid == 54
    if chrome.any():
        L.base[chrome] = 0.92; L.metal[chrome] = 1.0
        L.rough[chrome] = 0.06 + 0.06 * nz2[chrome]
        oil = sstep(0.5, 0.8, nz[chrome])
        over_m(L, chrome, oil * 0.15, np.array([0.5, 0.45, 0.35], np.float32), 0.15, metal=1.0)
    brake = pid == 56
    if brake.any():
        L.base[brake] = srgb_to_lin(np.array([0.36, 0.34, 0.32], np.float32)) * (0.85 + 0.3 * nz[brake])[:, None]
        L.metal[brake] = 1.0; L.rough[brake] = 0.5
    lines = pid == 58
    if lines.any():
        L.base[lines] = 0.03; L.rough[lines] = 0.5
    dout = pid == 59
    if dout.any():
        ns = int(dout.sum())
        sub = Layers(ns)
        Nd = N[dout]
        along = np.zeros((ns, 3), np.float32); along[:, 0] = -1.0
        along -= Nd * (along * Nd).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(Nd, along)
        sd = s[dout]; zd = P[dout, 2]
        panel = (np.abs(P[dout, 1]) > 0.6).astype(np.int64) * 4 + (P[dout, 1] > 0) + 12000
        # The doors face the low sun almost square-on. A smooth flat panel inside the sun's lobe lights up evenly as a
        # card, so: a satin sheet (rougher than the skin), duller toward the hinge and a touch smoother toward the free
        # edge, on a bowed panel whose lower edge curls in (geometry) - the glint becomes a band with falloff, and the
        # curl mirrors the pavement as the bright lower edge the photographs show. Fastener rows round the edges and
        # one row above the curl, as photographed (no quilted grid); soft oil-canning between them.
        skin.metal(sub, sd, zd, panel, ao[dout], along, across, 0.22, tone_var=0.05)
        sub.astr *= 0.5
        sub.h += 0.0007 * (fbm(sd, zd, 0.28, 3, seed=77) - 0.5)
        for key, (s0d, s1d, z0d, z1d) in (('n', DOORS['nose'][:4]), ('m', DOORS['main'][:4])):
            m = (sd > s0d - 0.02) & (sd < s1d + 0.02)
            if not m.any():
                continue
            frac = np.clip((z0d - zd) / (z0d - z1d), 0, 1)                    # 0 at the hinge .. 1 at the free edge
            sub.rough[m] = (0.56 - 0.06 * frac + 0.06 * (fbm(sd, zd, 0.35, 3, seed=78) - 0.5))[m]
            # the panel is formed with a bow across its height (more than the geometry's): a 15 mm rise in the normal
            # map sweeps the facing through ~10 deg, so the sun's glint becomes a band across the door, not a card
            sub.h[m] += (0.015 * np.sin(math.pi * frac))[m]
            sub.base[m] *= (0.90 + 0.12 * frac[m])[:, None]
            ex = np.minimum(sd - s0d, s1d - sd); ez = np.minimum(zd - z1d, z0d - zd)
            dmin = np.minimum(ex, ez)
            alongd = np.where(ex < ez, zd, sd)
            head, ring, rnd = rivet_row(alongd, dmin - 0.022, 0.045, 0.0055, 120)
            disc = np.maximum(head, ring)
            zr = z1d + 0.10 * np.sign(z0d - z1d)                               # the row above the curl
            h2, r2, _ = rivet_row(sd, zd - zr, 0.045, 0.0055, 121)
            disc = np.maximum(disc, np.maximum(h2, r2) * (ex > 0.03))
            band = np.exp(-((dmin - 0.022) / 0.0045) ** 2) + np.exp(-((zd - zr) / 0.0045) ** 2) * (ex > 0.03)
            # one pillow per bay (above and below the row), pressed in or out at random
            bayv = np.where(np.abs(zd - z1d) > 0.10, np.clip((np.abs(zd - z1d) - 0.10) / (np.abs(z0d - z1d) - 0.10), 0, 1), np.abs(zd - z1d) / 0.10)
            bayu = np.clip(ex / np.maximum((s1d - s0d) * 0.5, 1e-3), 0, 1)
            pil = np.sin(math.pi * np.clip(bayv, 0, 1)) * np.sin(math.pi * 0.5 * bayu)
            hinge = line_profile(zd - (z0d - 0.05 * np.sign(z0d - z1d)), 0.004)   # the hinge strip's lower edge
            edge_d = sstep(0.014, 0.0, dmin)
            dk = np.clip(0.35 * disc + 0.07 * band + 0.5 * hinge + 0.3 * edge_d, 0, 0.7)
            sub.base[m] *= (1 - dk[m])[:, None]
            sub.rough[m] += 0.1 * disc[m] + 0.05 * band[m]
            sub.h[m] += -0.0004 * disc[m] - 0.0006 * hinge[m] + (0.0009 * pil * np.where(hash01(np.abs(zd - z1d) > 0.10, len(key)) > 0.5, 1.0, -1.0))[m]
        L.base[dout], L.rough[dout], L.metal[dout], L.h[dout] = sub.base, sub.rough, sub.metal, sub.h
        L.adir[dout], L.astr[dout] = sub.adir, sub.astr
    inner = pid == 60
    if inner.any():
        L.base[inner] = srgb_to_lin(np.array([0.78, 0.78, 0.75], np.float32)) * (0.9 + 0.15 * nz[inner])[:, None]
        L.rough[inner] = 0.5
    wells = pid == 61
    if wells.any():
        L.base[wells] = srgb_to_lin(np.array([0.10, 0.10, 0.10], np.float32)) * (0.8 + 0.4 * nz[wells])[:, None]
        L.rough[wells] = 0.75
    painted = np.isin(pid, [51, 52, 53, 60])
    # grime in crevices, hydraulic fluid stains below joints, worn edges showing metal
    tyre_m = pid == 50
    L.base *= (1 - 0.25 * g * painted - 0.10 * g * (~painted & ~tyre_m))[:, None]
    L.rough += 0.08 * g * painted
    stain = sstep(0.62, 0.82, fbm(u * 0.5, v * 4.0, 0.15, 3, seed=73)) * painted
    over(L, stain * 0.10, col=np.array([0.30, 0.25, 0.18], np.float32), rough=0.3)
    wear = 0.5 * np.clip(edge * 2.2 - 0.2, 0, 1) * painted * sstep(0.5, 0.75, nz2)
    over(L, wear, col=np.array([0.55, 0.55, 0.54], np.float32), rough=0.3, metal=1.0)
    L.h += 0.00012 * (nz2 - 0.5) * painted
    write(OUTS, idx, L)


# ------------------------------------------------------------------ assembly: normals from height, encode, pad
def write(OUTS, idx, L):
    OUTS['base'].reshape(-1, 3)[idx] = L.base
    OUTS['rough'].ravel()[idx] = L.rough
    OUTS['metal'].ravel()[idx] = L.metal
    OUTS['h'].ravel()[idx] = L.h
    OUTS['adir'].reshape(-1, 3)[idx] = L.adir
    OUTS['astr'].ravel()[idx] = L.astr
    if L.aomul is not None:
        if 'aomul' not in OUTS:
            OUTS['aomul'] = np.ones_like(OUTS['rough'])
        OUTS['aomul'].ravel()[idx] = L.aomul
    if L.emis is not None:
        if 'emis' not in OUTS:
            OUTS['emis'] = np.zeros_like(OUTS['base'])
        OUTS['emis'].reshape(-1, 3)[idx] = L.emis


def tangent_frame(S):
    """Per-texel tangent (dP/du), bitangent (dP/dv) unit vectors and metres-per-texel along u and v."""
    P, V = S.pos, S.valid
    H, W = V.shape

    def diff(axis):
        fwd = np.roll(P, -1, axis) - P; bwd = P - np.roll(P, 1, axis)
        vf = np.roll(V, -1, axis) & V; vb = np.roll(V, 1, axis) & V
        lf = np.linalg.norm(fwd, axis=2); lb = np.linalg.norm(bwd, axis=2)
        # treat big jumps as island borders (another island adjacent in UV space)
        vf &= lf < 0.05; vb &= lb < 0.05
        dpos = np.where((vf & vb)[..., None], (fwd + bwd) * 0.5, np.where(vf[..., None], fwd, np.where(vb[..., None], bwd, 0.0)))
        ok = vf | vb
        return dpos.astype(np.float32), ok, vf, vb
    du, oku, vfu, vbu = diff(1)
    dv, okv, vfv, vbv = diff(0)
    return du, dv, oku, okv, (vfu, vbu, vfv, vbv)


def height_to_normal(S, h, du, dv, flags):
    vfu, vbu, vfv, vbv = flags
    lu = np.linalg.norm(du, axis=2) + 1e-9; lv = np.linalg.norm(dv, axis=2) + 1e-9

    def grad(axis, vf, vb, l):
        hf = np.roll(h, -1, axis) - h; hb = h - np.roll(h, 1, axis)
        g = np.where(vf & vb, (hf + hb) * 0.5, np.where(vf, hf, np.where(vb, hb, 0.0)))
        return g / l
    gu = grad(1, vfu, vbu, lu); gv = grad(0, vfv, vbv, lv)
    # tangent-space normal with T along +u and B along +v (MikkTSpace-style, handedness carried by the tangent sign)
    N = S.nrm
    Tu = du / lu[..., None]; Tv = dv / lv[..., None]
    T = Tu - N * (Tu * N).sum(2, keepdims=True); T /= np.linalg.norm(T, axis=2, keepdims=True) + 1e-9
    Bc = np.cross(N, T)
    sgn = np.sign((Bc * Tv).sum(2)); sgn[sgn == 0] = 1
    B = Bc * sgn[..., None]
    # gradient components along T and B (v direction may be skewed against T: project)
    cosuv = (Tv * T).sum(2)
    gB = (gv - gu * cosuv) / np.maximum(np.sqrt(np.maximum(1 - cosuv ** 2, 1e-4)), 1e-2)
    n = np.stack([-gu, -gB, np.ones_like(gu)], 2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n.astype(np.float32), T, B


def finish(S, OUTS):
    key = S.key
    t0 = time.time()
    h = OUTS['h']
    du, dv, oku, okv, flags = tangent_frame(S)
    n_ts, T, B = height_to_normal(S, h, du, dv, flags)
    del du, dv
    # anisotropy direction in tangent space
    a3 = OUTS['adir']
    ax = (a3 * T).sum(2); ay = (a3 * B).sum(2)
    ln = np.sqrt(ax * ax + ay * ay) + 1e-9
    ax, ay = ax / ln, ay / ln
    del T, B
    valid = S.valid
    # anisotropy direction is a line, not an arrow: keep it in one half-plane so filtering never averages to zero
    flip = ax < 0
    ax[flip] *= -1; ay[flip] *= -1
    bad = ~np.isfinite(ax) | ~np.isfinite(ay) | (np.hypot(ax, ay) < 0.5)
    ax[bad], ay[bad] = 1.0, 0.0
    pidx = pad_index(valid, 16)
    base = pad(OUTS['base'], pidx)
    rough = pad(OUTS['rough'], pidx)
    metal = pad(OUTS['metal'], pidx)
    aov = np.clip(0.35 + 0.65 * S.ao, 0, 1)
    if key in ('skin', 'wing'):
        # a little extra cover on surfaces facing the ground (the airframe hides part of the sky from the pavement under
        # it). The image-based light is all this darkens - never the sun - so a heavy term here (it was 0.68) leaves a
        # sun-facing belly lit by the low sun's specular tail alone, which reads as brass; the probe's envGround.shade
        # now carries the rest of the ground's cover
        aov = aov * (1 - 0.22 * sstep(0.10, -0.60, S.nrm[..., 2]))
    if 'aomul' in OUTS:
        aov = aov * OUTS['aomul']
    ao = pad(aov, pidx)
    nn = pad(n_ts, pidx)
    nn[~np.isfinite(nn).all(2) | (np.linalg.norm(nn, axis=2) < 0.5)] = (0, 0, 1)
    # specular anti-aliasing (Toksvig): the GPU's mip chain averages the normal map flat, and the relief it averaged away
    # (seams, fastener rings, sealant lines) must survive as roughness, or each sub-pixel bevel catches the sun as a lone
    # glint that crawls as the airframe moves. Variance of the normals over a 5x5 footprint (about mip 2, the scale of
    # most shots) widens the lobe: alpha'^2 = alpha^2 + 2 var; wherever there is such relief the lobe is no sharper than
    # roughness 0.35.
    nbar = box_blur(nn, 2)
    ln = np.linalg.norm(nbar, axis=2)
    var = np.clip((1 - ln) / np.maximum(ln, 1e-3), 0, 0.5)
    del nbar, ln
    rough = (np.clip(rough, 0.03, 1) ** 4 + 2.0 * var) ** 0.25
    rough = np.where(var > 4e-4, np.maximum(rough, 0.35), rough)
    log(key, 'spec-AA: texels widened', round(float((var > 4e-4).mean()), 3))
    del var
    an = pad(np.stack([ax, ay, OUTS['astr']], 2), pidx)
    os.makedirs(OUT, exist_ok=True)

    def save(name, arr):
        im = Image.fromarray(np.clip(np.round(arr * 255), 0, 255).astype(np.uint8)[::-1])
        im.save(os.path.join(OUT, f'{key}_{name}.png'), compress_level=1)
    save('base', lin_to_srgb(base))
    save('orm', np.stack([ao, np.clip(rough, 0.03, 1), np.clip(metal, 0, 1)], 2))
    save('normal', nn * 0.5 + 0.5)
    if key in ('skin', 'wing', 'gear'):
        # half resolution: per-sheet brushing direction and strength are smooth, and the GLB stays under 12 MB
        a8 = np.clip(np.round(np.stack([an[..., 0] * 0.5 + 0.5, an[..., 1] * 0.5 + 0.5, np.clip(an[..., 2], 0, 1)], 2) * 255), 0, 255).astype(np.uint8)[::-1]
        Image.fromarray(a8).resize((a8.shape[1] // 2, a8.shape[0] // 2), Image.BOX).save(os.path.join(OUT, f'{key}_aniso.png'), compress_level=1)
    if 'emis' in OUTS:
        em = pad(OUTS['emis'], pidx)
        im = Image.fromarray(np.clip(np.round(lin_to_srgb(em) * 255), 0, 255).astype(np.uint8)[::-1]).resize((1024, 1024), Image.LANCZOS)
        im.save(os.path.join(OUT, f'{key}_emissive.png'))
    log(key, 'encoded in', round(time.time() - t0), 's')


def preview_sheet(key):
    """Downsized look at the maps for quick inspection."""
    os.makedirs(PREVIEW, exist_ok=True)
    tiles = []
    for m in ('base', 'orm', 'normal'):
        p = os.path.join(OUT, f'{key}_{m}.png')
        if os.path.exists(p):
            tiles.append(Image.open(p).convert('RGB').resize((1024, 1024), Image.LANCZOS))
    sheet = Image.new('RGB', (1024 * len(tiles), 1024))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * 1024, 0))
    sheet.save(os.path.join(PREVIEW, f'{key}_maps.jpg'), quality=88)


def paint(keys):
    ff = FusFrame()
    skin = Skin(SKIN_TEXEL)
    for key in keys:
        t0 = time.time()
        S = SetData(key)
        H = W = S.size
        OUTS = {'base': np.zeros((H, W, 3), np.float32), 'rough': np.full((H, W), 0.5, np.float32), 'metal': np.zeros((H, W), np.float32),
                'h': np.zeros((H, W), np.float32), 'adir': np.zeros((H, W, 3), np.float32), 'astr': np.zeros((H, W), np.float32)}
        if key == 'skin':
            paint_fuselage(S, OUTS, skin, ff, fus_decals(ff))
        elif key == 'wing':
            paint_wing_set(S, OUTS, skin)
        elif key == 'hot':
            paint_hot(S, OUTS)
        elif key == 'gear':
            paint_gear(S, OUTS, skin)
        log(key, 'painted in', round(time.time() - t0), 's')
        finish(S, OUTS)
        preview_sheet(key)
        del S, OUTS


if __name__ == '__main__':
    keys = [a for a in sys.argv[1:] if a in SIZES] or list(SIZES)
    paint(keys)
