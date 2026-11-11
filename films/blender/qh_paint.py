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


def font(weight=700):
    """Saira (SIL OFL) from the npm registry, cached: the closest open face to the Hermeus wordmark lettering."""
    base = os.path.join(CACHE, 'fonts', 'saira')
    f = os.path.join(base, 'package', 'files', f'saira-latin-{weight}-normal.woff')
    if not os.path.exists(f):
        tgz = fetch('https://registry.npmjs.org/@fontsource/saira/-/saira-5.3.0.tgz', os.path.join(CACHE, 'fonts', 'saira-5.3.0.tgz'))
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
        return self.lookup(s, np.full_like(s, math.radians(phi_deg)))


# ------------------------------------------------------------------ decals (vector artwork, drawn in metres)
DECAL_PX_PER_M = 1400.0


def canvas(w_m, h_m):
    W, H = int(w_m * DECAL_PX_PER_M), int(h_m * DECAL_PX_PER_M)
    return Image.new('L', (W, H), 0), W, H


def bez(p0, p1, p2, p3, n=24):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return ((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3).tolist()


def horse_mark(W, H):
    """Hermeus-style horse head facing right (+x), mane streaming back to the left: unit box -> pixels."""
    im = Image.new('L', (W, H), 0); g = ImageDraw.Draw(im)
    P = lambda pts: [(x * W, y * H) for x, y in pts]
    # head: forehead, face to the muzzle, jaw, throat into the neck
    head = (bez((0.50, 0.30), (0.62, 0.16), (0.74, 0.20), (0.86, 0.44), 20) +
            bez((0.86, 0.44), (0.92, 0.55), (0.99, 0.66), (0.985, 0.80), 16) +
            bez((0.985, 0.80), (0.98, 0.92), (0.90, 0.95), (0.84, 0.90), 12) +
            bez((0.84, 0.90), (0.76, 0.86), (0.70, 0.86), (0.62, 0.92), 12) +
            bez((0.62, 0.92), (0.52, 0.98), (0.40, 0.97), (0.30, 0.90), 14) +
            bez((0.30, 0.90), (0.40, 0.80), (0.46, 0.62), (0.50, 0.30), 14))
    g.polygon(P(head), fill=255)
    # ear
    g.polygon(P([(0.555, 0.25), (0.60, 0.02), (0.665, 0.22)]), fill=255)
    # mane: three long tapering streaks trailing left, with gaps
    for (y0, y1, x_end, th) in ((0.20, 0.34, 0.00, 0.10), (0.42, 0.52, 0.08, 0.09), (0.62, 0.72, 0.18, 0.08)):
        top = bez((0.58, y0), (0.42, y0 - 0.06), (0.22, y0 - 0.02), (x_end, y1 - 0.03), 20)
        bot = bez((x_end + 0.06, y1 + th * 0.2), (0.24, y1 + th * 0.6), (0.42, y1 + th * 0.4), (0.56, y0 + th + 0.06), 20)
        g.polygon(P(top + bot), fill=255)
    # negative space: eye notch and nostril
    g.polygon(P([(0.70, 0.36), (0.79, 0.40), (0.72, 0.42)]), fill=0)
    g.ellipse(P([(0.915, 0.74), (0.955, 0.80)]), fill=0)
    g.line(P([(0.62, 0.55), (0.80, 0.66)]), fill=0, width=max(2, int(0.025 * H)))
    return im


def wing_mark(W, H):
    """Hermeus wing mark as it is painted on the fin's starboard side: four feathered elements whose rounded ends
    trail left (aft) and converge to a point at lower right."""
    im = Image.new('L', (W, H), 0); g = ImageDraw.Draw(im)
    P = lambda pts: [(x * W, y * H) for x, y in pts]
    tip = (0.985, 0.985)
    els = [((0.00, 0.035), 0.155, (0.47, 0.04), (0.86, 0.30)),
           ((0.07, 0.275), 0.125, (0.48, 0.28), (0.80, 0.50)),
           ((0.19, 0.495), 0.105, (0.52, 0.50), (0.78, 0.66)),
           ((0.33, 0.685), 0.085, (0.58, 0.69), (0.78, 0.80))]
    for (p0, th, c1, c2) in els:
        x0, y0 = p0
        upper = bez((x0 + 0.02, y0), c1, c2, tip, 30)
        lower = bez(tip, (c2[0] - 0.05, c2[1] + th * 0.9), (c1[0] - 0.02, c1[1] + th), (x0 + 0.02, y0 + th), 30)
        cap = [(x0 + 0.02 - th * 0.5 * math.sin(a), y0 + th * 0.5 - th * 0.5 * math.cos(a)) for a in np.linspace(math.pi, 0, 10)]
        g.polygon(P(upper + lower + cap), fill=255)
    return im


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
    """Round dark-navy unit badge as photographed (white rim, ring band, light emblem); no legible text."""
    im = Image.new('RGB', (W, W), (0, 0, 0)); g = ImageDraw.Draw(im)
    al = Image.new('L', (W, W), 0); ga = ImageDraw.Draw(al)
    c = W / 2
    navy = (24, 32, 58)
    ga.ellipse([0, 0, W - 1, W - 1], fill=255)
    g.ellipse([0, 0, W - 1, W - 1], fill=(222, 224, 226))
    r1 = W * 0.47
    g.ellipse([c - r1, c - r1, c + r1, c + r1], fill=navy)
    # lettering band: short light ticks in two arcs (reads as small text at film distances, says nothing)
    rng = np.random.default_rng(7)
    for arc0, arc1 in ((-2.55, -0.6), (0.75, 2.4)):
        for a in np.linspace(arc0, arc1, 34):
            w = W * (0.012 + 0.008 * rng.random()); h = W * 0.045
            x, y = c + math.cos(a) * W * 0.40, c + math.sin(a) * W * 0.40
            ca, sa = math.cos(a + math.pi / 2), math.sin(a + math.pi / 2)
            pts = [(x + ca * dx - sa * dy, y + sa * dx + ca * dy) for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
            g.polygon(pts, fill=(196, 200, 206))
    r2 = W * 0.335
    g.ellipse([c - r2, c - r2, c + r2, c + r2], outline=(200, 204, 210), width=max(2, int(W * 0.012)))
    # emblem: a stylised bird with spread wings over a small shield, light grey
    lg = (206, 210, 216)
    for sgn in (-1, 1):
        wing = [(c, c - W * 0.03)] + [(c + sgn * W * (0.05 + 0.2 * t), c - W * (0.04 + 0.11 * math.sin(t * 2.6))) for t in np.linspace(0, 1, 12)] + \
               [(c + sgn * W * (0.25 - 0.18 * t), c - W * (0.0 - 0.03 * t)) for t in np.linspace(0, 1, 8)]
        g.polygon(wing, fill=lg)
    g.ellipse([c - W * 0.04, c - W * 0.13, c + W * 0.04, c - W * 0.05], fill=lg)
    g.polygon([(c - W * 0.07, c - W * 0.01), (c + W * 0.07, c - W * 0.01), (c + W * 0.06, c + W * 0.09), (c, c + W * 0.15), (c - W * 0.06, c + W * 0.09)], fill=lg)
    g.polygon([(c - W * 0.04, c + W * 0.01), (c + W * 0.04, c + W * 0.01), (c + W * 0.035, c + W * 0.08), (c, c + W * 0.12), (c - W * 0.035, c + W * 0.08)], fill=navy)
    for k in range(-2, 3):
        g.line([(c + k * W * 0.05, c + W * 0.17), (c + k * W * 0.08, c + W * 0.24)], fill=lg, width=max(2, int(W * 0.012)))
    rgb = srgb_to_lin(np.asarray(im, np.float32) / 255.0)
    return rgb, np.asarray(al, np.float32) / 255.0


def text_mask(text, h_m, weight=700, track=0.02, squeeze=1.0, width_m=None):
    """Text rendered at DECAL_PX_PER_M with cap height ~ h_m; returns (mask array, width_m)."""
    px = int(h_m * DECAL_PX_PER_M / 0.70)
    f = ImageFont.truetype(font(weight), px)
    bbox = [f.getbbox(ch) for ch in text]
    adv = [f.getlength(ch) for ch in text]
    W = int(sum(adv) + track * px * len(text) + px)
    im = Image.new('L', (W, int(px * 1.3)), 0); g = ImageDraw.Draw(im)
    x = 0.0
    for ch, a in zip(text, adv):
        g.text((x, 0), ch, font=f, fill=255)
        x += a + track * px
    bb = im.getbbox()
    im = im.crop(bb)
    if squeeze != 1.0:
        im = im.resize((int(im.width * squeeze), im.height), Image.LANCZOS)
    hpx = im.height
    scale = h_m * DECAL_PX_PER_M / hpx
    wpx = int(width_m * DECAL_PX_PER_M) if width_m else max(1, int(im.width * scale))
    im = im.resize((wpx, max(1, int(hpx * scale))), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0, im.width / DECAL_PX_PER_M


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
LONGI = [0.0, 31.0, 58.0, 86.0, 111.0, 130.0, 154.0, 180.0]     # joint around-angles (deg from the top)
STRING = [15.0, 44.0, 72.0, 98.0, 121.0, 142.0, 167.0]          # stringer rivet rows between them


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

    def metal(self, L, u, v, panel, ao, along_dir, across_dir, base_tone=0.80, hot=None):
        """Bare aluminium: per-panel tone, roughness and grain, scan mottling, polishing scratches."""
        n = len(u)
        r1, r2, r3, r4, r5, r6 = (hash01(panel, k) for k in range(6))
        tone = base_tone * (1 + (r1 - 0.5) * 0.08)                        # per-sheet brightness
        warm = (r2 - 0.5) * 0.025                                         # slight hue drift between sheets
        rough = 0.19 + 0.08 * r3 ** 1.3                                   # satin-polished sheets
        rough = np.where(r3 > 0.97, 0.31 + 0.05 * r4, rough)              # an odd milky sheet
        ang = (r4 - 0.5) * 0.22 + np.where(r5 > 0.9, math.pi / 2, 0.0)    # grain direction per sheet
        offu, offv = r5 * 37.0, r6 * 29.0
        mot = self.mottle.sample(u, v, None, offu, offv)
        clo = self.cloud.sample(u, v, r2 * 6.28, offv, offu)
        mc = self.mottle_c.sample(u, v, None, offv * 0.7, offu * 1.3)
        br = self.brush.sample(u, v, ang, offu * 0.3, offv * 0.5)
        scr = self.scratch.sample(u, v, r1 * 6.28, offu * 0.2, offv * 0.9)
        lum = tone * (1 + 0.018 * mc + 0.010 * clo)
        col = np.stack([lum * (1 + warm), lum * (1 + warm * 0.3), lum * (1 - warm * 0.8)], 1) * np.array([0.985, 0.99, 1.0], np.float32)
        L.base[:] = col
        L.rough[:] = np.clip(rough * (1 + 0.06 * mot + 0.045 * clo) + 0.015 * br + 0.012 * np.maximum(scr, 0), 0.08, 0.7)
        L.metal[:] = 1.0
        # anisotropic grain: along the sheet's rolling direction
        c, s = np.cos(ang), np.sin(ang)
        L.adir[:] = along_dir * c[:, None] + across_dir * s[:, None]
        L.astr[:] = 0.28 + 0.3 * r6
        # occlusion grime: dull and darken in crevices and under the wing root
        # (the occlusion itself goes to the ORM map; here only the grime that collects in enclosed spots)
        g = np.clip(1 - ao, 0, 1) ** 1.5
        L.base *= (1 - 0.12 * g)[:, None]
        L.rough += 0.10 * g
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
        L.base *= (1 + (0.05 + 0.06 * rnd)[:, None] * head[:, None] - 0.18 * ring[:, None])
        L.rough += 0.10 * head + 0.06 * ring
        L.astr *= (1 - 0.8 * head)
        L.h += (-0.00004 * ring + 0.000015 * head * (rnd - 0.3))


SKIN_TEXEL = 0.0019


def paint_fuselage(S, OUTS, skin, ff, decals):
    idx, P, N, pid, ao = S.gather([1])
    n = len(idx)
    log('fuselage texels', n)
    s, phi, a, hg, side = ff.coords(P)
    deg = np.degrees(phi)
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
    skin.metal(L, s, a, panel, ao, along, across, 0.80)
    # oil canning: each bay between rivet lines pillows slightly
    rows_s = sorted(FRAMES + INNER)
    s0, s1, js = bracket(rows_s, s)
    bu = np.clip((s - s0) / (s1 - s0), 0, 1)
    rows_p = sorted(LONGI + STRING)
    p0, p1, jp = bracket(rows_p, deg)
    a0 = ff.lookup(s, np.radians(p0)); a1 = ff.lookup(s, np.radians(p1))
    bv = np.clip((a - a0) / np.maximum(a1 - a0, 1e-3), 0, 1)
    bay = js.astype(np.int64) * 64 + jp * 2 + (side > 0)
    amp = 0.00025 + 0.00045 * hash01(bay, 3) ** 2
    pil = np.sin(math.pi * bu) * np.sin(math.pi * bv)
    L.h += amp * pil * np.where(hash01(bay, 5) > 0.25, 1.0, -0.6)
    L.h += 0.0002 * (fbm(s, a, 0.9, 3, seed=11) - 0.5)
    L.h += 0.00012 * (hash01(panel, 9) - 0.5)          # sheet-to-sheet level mismatch
    # joints
    k, dsf = nearest(FRAMES, s)
    present = ~((hash01(k, li, 7) > 0.72) & ~np.isin(np.array(FRAMES)[k], list(MAIN_FRAMES)))
    skin.seam(L, dsf, strength=present.astype(np.float32))
    kp, dpd = nearest(LONGI, deg)
    jcol = np.array(LONGI, np.float32)[kp]
    dl = a - ff.lookup(s, np.radians(jcol))
    top_seam = np.where((jcol < 1) & (s > 9.2), 0.0, 1.0)     # no dorsal seam under the boom
    skin.seam(L, dl, strength=top_seam)
    # fastener rows: double rows either side of frame joints, single rows at inner frames and stringers
    pr = 0.0024
    for off, stg in ((0.016, 0.0), (-0.016, 0.0125)):
        skin.rivets(L, a, dsf - off, 0.025, pr, 11 + (off > 0), strength=present.astype(np.float32), stagger=stg)
    for off in (0.014, -0.014):
        skin.rivets(L, s, dl - off, 0.027, pr, 21 + (off > 0), strength=top_seam)
    ki, dsi = nearest(INNER, s)
    skin.rivets(L, a, dsi, 0.030, pr * 0.95, 31, strength=0.8)
    kst, _ = nearest(STRING, deg)
    dst = a - ff.lookup(s, np.radians(np.array(STRING, np.float32)[kst]))
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
            aa0 = ff.lookup(ss_, np.full_like(ss_, math.radians(pa_))); aa1 = ff.lookup(ss_, np.full_like(ss_, math.radians(pb_)))
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
            sub.base *= (1 - 0.35 * ring[:, None] * ins[:, None]) * (1 - 0.25 * head[:, None] * ins[:, None])
            sub.rough += 0.12 * head * ins
            sub.h += (-0.00012 * ring + 0.00002 * head) * ins
            tint = 1 + (hash01(i, sd) - 0.5) * 0.05
            sub.base *= np.where(dist > 0, tint, 1.0)[:, None]
            L.base[m], L.rough[m], L.h[m], L.astr[m] = sub.base, sub.rough, sub.h, sub.astr
    # handling smudges near the access panels, the nose and the belly
    sm = skin.smear.sample(s, a, None, 3.0, 7.0)
    hot = np.zeros(n, np.float32)
    for (sa_, sb_, pa_, pb_) in access:
        cs, cp = 0.5 * (sa_ + sb_), 0.5 * (pa_ + pb_)
        hot += np.exp(-(((s - cs) / 0.7) ** 2 + ((deg - cp) / 22) ** 2))
    hot += 0.5 * np.exp(-((s - 4.9) / 1.2) ** 2) * sstep(120, 175, deg)
    hot = np.clip(hot, 0, 1) * sstep(0.2, 1.4, sm + 0.6 * fbm(s, a, 0.6, 3, seed=5))
    L.rough += 0.06 * hot
    L.base *= (1 - 0.03 * hot)[:, None]
    # flow streaks aft of fasteners and vents, stronger on the belly
    st = fbm(s * 0.04, a * 2.2, 0.08, 3, seed=17)
    stre = sstep(0.62, 0.85, st) * (0.35 + 0.65 * sstep(90, 170, deg)) * sstep(1.0, 3.0, s)
    L.base *= (1 - 0.035 * stre)[:, None]; L.rough += 0.025 * stre
    # heat: straw and bronze tint toward the nozzle, exhaust soot on the last metre
    heat = sstep(11.4, 13.4, s)
    tint = np.array([1.02, 0.93, 0.80], np.float32)
    L.base *= (1 + heat[:, None] * (tint - 1) * (0.6 + 0.4 * fbm(s, a, 0.5, 3, seed=23))[:, None])
    soot = sstep(12.6, 13.38, s) * (0.5 + 0.5 * fbm(s, a, 0.35, 4, seed=29))
    over(L, soot * 0.55, col=np.array([0.05, 0.048, 0.045], np.float32), rough=0.6, metal=0.4)
    L.astr *= (1 - 0.7 * heat)
    # oil and hydraulic weeping on the belly behind the engine-bay doors
    oil = sstep(150, 178, deg) * sstep(9.0, 10.5, s) * sstep(0.55, 0.8, fbm(s * 0.15, a * 1.5, 0.12, 3, seed=31))
    over(L, oil * 0.25, col=np.array([0.10, 0.085, 0.06], np.float32), rough=0.25, metal=0.6)
    # markings
    for dc in decals:
        dc(L, s, a, side, deg)
    write(OUTS, idx, L)


def fus_decals(ff):
    """Markings as photographed: wordmark + horse (horse forward, facing the nose, both sides), unit badge,
    EXPERIMENTAL, four flush ports per side, the dorsal antenna patch."""
    out = []
    black = hexlin('#101112')
    # wordmark: text cap height 0.205 m (projected 0.20 on the curved upper side); horse 0.67 m long ahead of it
    TH = 0.245
    tm, tw = text_mask('QUARTERHORSE', TH, 600, track=0.035, width_m=1.86)
    hm = np.asarray(horse_mark(int(0.70 * DECAL_PX_PER_M), int(0.33 * DECAL_PX_PER_M)), np.float32) / 255.0
    T = Decal(None, tm, tw, TH)
    Hs = Decal(None, hm, 0.70, 0.33)
    Hp = Decal(None, hm[:, ::-1].copy(), 0.70, 0.33)
    s_txt_aft, s_txt_fwd = 5.55, 5.55 - tw       # text spans s from ~3.7 to 5.55
    s_h_aft, s_h_fwd = s_txt_fwd - 0.07, s_txt_fwd - 0.07 - 0.70
    phi_c = 50.0                                  # centre around-angle of the wordmark band (z = 0.75 m)

    def paint_coat(L, m, alpha, col=black, rough=0.42, thick=0.00006):
        sub_a = alpha
        over_m(L, m, sub_a, col, rough)
        L.h[m] += thick * sub_a
        L.astr[m] *= (1 - sub_a)

    def wordmark(L, s, a, side, deg):
        m = (deg > 26) & (deg < 74) & (s > s_h_fwd - 0.1) & (s < s_txt_aft + 0.1)
        if not m.any():
            return
        ss, aa, sd = s[m], a[m], side[m]
        ac = ff.arc_at(ss, phi_c)
        y = aa - ac + TH / 2                       # image y down = increasing arc from the top
        # starboard: image x runs forward (decreasing s); port: aft (increasing s)
        xt = np.where(sd < 0, s_txt_aft - ss, ss - s_txt_fwd)
        _, at = T.sample(xt, y)
        xh = np.where(sd < 0, s_h_aft - ss, ss - s_h_fwd)
        yh = aa - ac + 0.17
        _, ah_s = Hs.sample(xh, yh)
        _, ah_p = Hp.sample(xh, yh)
        ah = np.where(sd < 0, ah_s, ah_p)
        paint_coat(L, m, np.maximum(at, ah))
    out.append(wordmark)

    srgb, salpha = seal(int(0.49 * DECAL_PX_PER_M))
    SD = Decal(srgb, salpha, 0.49, 0.49)

    def badge(L, s, a, side, deg):
        m = (deg > 70) & (deg < 112) & (s > 1.25) & (s < 1.85)
        if not m.any():
            return
        ss, aa, sd = s[m], a[m], side[m]
        ac = ff.arc_at(ss, 88.0)
        x = np.where(sd < 0, 1.54 + 0.245 - ss, ss - (1.54 - 0.245))
        rgb, al = SD.sample(x, aa - ac + 0.245)
        over_m(L, m, al, rgb, 0.38)
        L.h[m] += 0.00007 * al
        L.astr[m] *= (1 - al)
    out.append(badge)

    em, ew = text_mask('EXPERIMENTAL', 0.084, 700, track=0.03, width_m=0.59)
    ED = Decal(None, em, ew, 0.084)

    def experimental(L, s, a, side, deg):
        m = (deg > 52) & (deg < 84) & (s > 0.3) & (s < 1.25)
        if not m.any():
            return
        ss, aa, sd = s[m], a[m], side[m]
        ac = ff.arc_at(ss, 68.0)
        s_fwd, s_aft = 0.49, 0.49 + ew
        x = np.where(sd < 0, s_aft - ss, ss - s_fwd)
        _, al = ED.sample(x, aa - ac + 0.042)
        paint_coat(L, m, al)
    out.append(experimental)

    def ports(L, s, a, side, deg):
        for (sc, pc) in ((1.61, 44.0), (2.57, 47.5), (1.59, 135.0), (2.56, 134.5)):
            m = (np.abs(s - sc) < 0.12) & (np.abs(deg - pc) < 14)
            if not m.any():
                continue
            ss, aa = s[m], a[m]
            ac = ff.arc_at(ss, pc)
            dx, dy = ss - sc, aa - ac
            r = np.hypot(dx, dy)
            ang = np.arctan2(dy, dx)
            hexr = 0.040 / np.maximum(np.cos(((ang + math.pi / 6) % (math.pi / 3)) - math.pi / 6), 0.5)
            ring = sstep(0.087, 0.080, r) * sstep(0.058, 0.066, r)
            disc = sstep(0.066, 0.060, r)
            hexm = sstep(hexr + 0.003, hexr - 0.002, r)
            col = np.zeros((len(r), 3), np.float32) + 0.86
            over_m(L, m, ring, np.array([0.30, 0.31, 0.32], np.float32), 0.35)           # dark seal ring
            over_m(L, m, disc * (1 - hexm), np.array([0.88, 0.88, 0.87], np.float32), 0.12, metal=1.0)  # polished insert
            over_m(L, m, hexm, np.array([0.70, 0.71, 0.72], np.float32), 0.3, metal=1.0)
            L.h[m] += -0.0003 * hexm - 0.00015 * ring
    out.append(ports)

    def vents(L, s, a, side, deg):
        # small flush features seen on the photos: an aft-facing slot, drains, a round flush antenna
        for (sc, pc, kind) in ((1.15, 112.0, 'slot'), (2.2, 103.0, 'drain'), (2.25, 106.0, 'drain'), (3.26, 125.0, 'round'), (5.85, 129.0, 'drain'), (4.1, 128.0, 'slot')):
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
        m = (deg < 12) & (s > 1.5) & (s < 1.9)
        if not m.any():
            return
        ss, aa = s[m], a[m]
        q = sstep(0.003, 0.0, np.maximum(np.abs(ss - 1.70) - 0.125, 0) + np.maximum(aa - 0.06, 0))
        over_m(L, m, q, hexlin('#1a2a5c'), 0.35, metal=0.0)
        L.h[m] += 0.0002 * q
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
        skin.metal(L, u, v, panel, ao, along, across, 0.79)
        # bay pillowing between rib and spar rows
        r0, r1, _ = bracket(WING_RIBS, y)
        x0, x1, _ = bracket(WING_SPARS + [0.86], x)
        bu = np.clip((y - r0) / (r1 - r0), 0, 1); bv = np.clip((x - x0) / np.maximum(x1 - x0, 1e-3), 0, 1)
        bay = panel * 3
        L.h += (0.00022 + 0.0004 * hash01(bay, 2) ** 2) * np.sin(math.pi * bu) * np.sin(math.pi * bv) * np.where(up, 1, -0.7)
        L.h += 0.0002 * (fbm(u, v, 0.8, 3, seed=41) - 0.5)
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
        # leading edge: polished, a little erosion and bug/dust spatter on the strake chine
        lez = sstep(0.04, 0.0, x * c)
        L.rough = L.rough * (1 - 0.5 * lez) + 0.1 * lez
        spat = sstep(0.75, 0.9, fbm(s * 4, y * 4, 0.05, 2, seed=43)) * sstep(0.10, 0.0, x * c)
        over(L, spat * 0.6, col=np.array([0.42, 0.38, 0.33], np.float32), rough=0.6, metal=0.0)
        # trailing edge and the hinge gap darken (grime), elevon heat near the nozzle
        L.base *= (1 - 0.25 * sstep(0.03, 0.0, (1 - x) * c))[:, None]
        heat = sstep(1.4, 0.7, y) * sstep(11.8, 13.2, s)
        L.base *= (1 + heat[:, None] * (np.array([1.02, 0.94, 0.82], np.float32) - 1))
        # dust on the upper surfaces, streaks behind the elevon actuator fairings below
        dust = (up & ~elev) * sstep(0.55, 0.8, fbm(u, v, 1.4, 3, seed=47))
        over(L, dust * 0.18, col=np.array([0.55, 0.50, 0.44], np.float32), rough=0.5, metal=0.0)
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
        ribs = [1.42, 1.76, 2.10, 2.44, 2.79]
        spars = [0.06, 0.30, 0.56]
        ri = np.searchsorted(np.array(ribs, np.float32), z)
        si = np.searchsorted(np.array(spars, np.float32), x)
        panel = ((ri * 8 + si) * 2 + (sd > 0)) * 2 + rud + 7000
        along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
        along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(N, along)
        u, v = s, z + (sd > 0) * 9.0
        skin.metal(L, u, v, panel, ao, along, across, 0.80)
        r0, r1, _ = bracket([FIN_Z0] + ribs + [FIN_Z1], z)
        bu = np.clip((z - r0) / (r1 - r0), 0, 1)
        x0, x1, _ = bracket(spars + [1.0], x)
        bv = np.clip((x - x0) / np.maximum(x1 - x0, 1e-3), 0, 1)
        L.h += (0.00022 + 0.00035 * hash01(panel, 2) ** 2) * np.sin(math.pi * bu) * np.sin(math.pi * bv)
        k, dz = nearest(ribs, z)
        skin.seam(L, dz)
        for off, stg in ((0.013, 0.0), (-0.013, 0.012)):
            skin.rivets(L, s, dz - off, 0.025, 0.0023, 81 + (off > 0), stagger=stg)
        ks, dxs = nearest(spars, x)
        ds = dxs * c
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
        wm = np.asarray(wing_mark(int(1.14 * DECAL_PX_PER_M), int(0.87 * DECAL_PX_PER_M)), np.float32) / 255.0
        WS, WP = Decal(None, wm, 1.14, 0.87), Decal(None, wm[:, ::-1].copy(), 1.14, 0.87)
        s_fwd, s_aft, z_top = 12.80, 13.94, 2.47
        m = (s > s_fwd - 0.05) & (s < s_aft + 0.05) & (z > 1.55) & (z < 2.52)
        if m.any():
            ss, zz, sdm = s[m], z[m], sd[m]
            # starboard: image x runs forward (image left = aft); port: image x runs aft (mirrored artwork)
            _, a_s = WS.sample(s_aft - ss, z_top - zz)
            _, a_p = WP.sample(ss - s_fwd, z_top - zz)
            al = np.where(sdm < 0, a_s, a_p)
            over_m(L, m, al, hexlin('#0e0f10'), 0.40)
            L.h[m] += 0.00007 * al; L.astr[m] *= (1 - al)
        fw, fh = 0.55, 0.31
        fs_f, fz_t = 12.36, 1.625
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
        over(L, heat * 0.4, col=np.array([0.07, 0.065, 0.06], np.float32), rough=0.55, metal=0.4)
        write(OUTS, idx, L)
    # --- chute boom
    idx, P, N, pid, ao = S.gather([15])
    if len(idx):
        n = len(idx)
        s = (X0 - P[:, 0]).astype(np.float32); z = P[:, 2].astype(np.float32); y = P[:, 1].astype(np.float32)
        sd = np.where(N[:, 1] >= 0, 1, -1)
        sideface = np.abs(N[:, 1]) > 0.6
        L = Layers(n)
        frames = [10.30, 10.95, 11.62, 12.35, 13.0, 13.63, 14.37, 15.0]
        fi = np.searchsorted(np.array(frames, np.float32), s)
        band = (z > 0.955).astype(np.int64)
        panel = ((fi * 4 + band * 2 + sideface) * 2 + (sd > 0)) + 9000
        along = np.zeros((n, 3), np.float32); along[:, 0] = -1.0
        along -= N * (along * N).sum(1, keepdims=True); along /= np.linalg.norm(along, axis=1, keepdims=True) + 1e-9
        across = np.cross(N, along)
        u, v = s, np.where(sideface, z, y) + (sd > 0) * 5.0
        skin.metal(L, u, v, panel, ao, along, across, 0.80)
        k, dsf = nearest(frames, s)
        skin.seam(L, dsf)
        skin.rivets(L, v, dsf - 0.014, 0.025, 0.0023, 101)
        skin.rivets(L, v, dsf + 0.014, 0.025, 0.0023, 102, stagger=0.0125)
        dzb = (z - 0.955) * sideface
        skin.seam(L, dzb, strength=sideface.astype(np.float32) * (s > 10.5))
        skin.rivets(L, s, dzb - 0.012, 0.026, 0.0022, 103, strength=sideface.astype(np.float32) * (s > 10.5))
        # N21QH: both sides, reads left to right from outside
        rm, rw = text_mask('N21QH', 0.225, 600, track=0.04, width_m=0.66)
        R = Decal(None, rm, rw, 0.225)
        s_c, z_c = 11.68, 1.015
        m = sideface & (np.abs(s - s_c) < rw / 2 + 0.05) & (np.abs(z - z_c) < 0.15)
        if m.any():
            ss, zz, sdm = s[m], z[m], sd[m]
            x = np.where(sdm < 0, (s_c + rw / 2) - ss, ss - (s_c - rw / 2))
            _, al = R.sample(x, (z_c + 0.1125) - zz)
            over_m(L, m, al, hexlin('#0e0f10'), 0.42)
            L.h[m] += 0.00007 * al; L.astr[m] *= (1 - al)
        # exhaust soot and heat on the boom's underside above the nozzle
        under = sstep(-0.2, -0.8, N[:, 2])
        soot = (under * 0.7 + 0.3 * sstep(0.85, 0.74, z)) * sstep(13.0, 14.6, s) * (0.6 + 0.4 * fbm(s, y, 0.3, 3, seed=53))
        over(L, soot * 0.7, col=np.array([0.045, 0.043, 0.04], np.float32), rough=0.62, metal=0.3)
        L.base *= (1 + sstep(13.2, 14.6, s)[:, None] * (np.array([1.03, 0.95, 0.84], np.float32) - 1))
        write(OUTS, idx, L)
    # --- nose fairing (black), air-data boom (steel), blade antennas (dark composite)
    for pidv, col, rough, metal in ((16, hexlin('#0c0d0e'), 0.28, 0.0), (17, np.array([0.55, 0.56, 0.57], np.float32), 0.22, 1.0), (18, hexlin('#2a2b2d'), 0.5, 0.0)):
        idx, P, N, pid, ao = S.gather([pidv])
        if not len(idx):
            continue
        n = len(idx)
        L = Layers(n)
        u, v = P[:, 0] * 3.1, P[:, 1] * 3.1 + P[:, 2] * 2.3
        nz = fbm(u, v, 0.5, 4, seed=pidv)
        L.base[:] = col[None, :] * (0.9 + 0.2 * nz)[:, None]
        L.rough[:] = rough * (0.85 + 0.35 * nz)
        L.metal[:] = metal
        if pidv == 17:   # the tip and the vanes darker, a heat-blued collar band
            tip = sstep(-1.0, -1.2, X0 - P[:, 0])
            L.base *= (1 - 0.55 * tip)[:, None]
        g = np.clip(1 - ao, 0, 1)
        L.base *= (1 - 0.35 * g)[:, None]
        L.h += 0.00012 * (nz - 0.5)
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
    # rubbed, slightly brighter edges on the mechanism (links, clevises, rib tops)
    over(L, np.clip(edge * 2.5, 0, 1) * np.isin(pid, [33, 34]) * 0.45, col=np.array([0.26, 0.255, 0.25], np.float32), rough=0.32, metal=1.0)
    # inlet: lip polished like the skin, duct a matte grey that darkens with depth; compressor face dark titanium
    lip = (pid == 2) & (s < 0.035) & ~inward
    duct = (pid == 2) & ~lip
    L.base[lip] = 0.78; L.rough[lip] = 0.18; L.metal[lip] = 1.0
    depth = np.clip(s / 2.7, 0, 1)
    L.base[duct] = (srgb_to_lin(np.array([0.42, 0.42, 0.41], np.float32)) * (1 - 0.7 * depth[duct])[:, None]).astype(np.float32)
    L.rough[duct] = 0.6; L.metal[duct] = 0.0
    fan = pid == 3
    L.base[fan] = srgb_to_lin(np.array([0.34, 0.34, 0.35], np.float32)) * (0.8 + 0.4 * nz[fan])[:, None]
    L.rough[fan] = 0.35; L.metal[fan] = 1.0
    g = np.clip(1 - ao, 0, 1)
    L.base *= (1 - 0.5 * g)[:, None]
    L.h += 0.0003 * (nz2 - 0.5) + 0.0001 * (fbm(s * 9, th * 6, 0.2, 2, seed=63) - 0.5)
    # emission pattern for the afterburner glow (flame holder brightest, liner corrugations, hot streaks)
    em = np.zeros((n, 3), np.float32)
    fh = pid == 37
    ln = pid == 36
    em[fh] = np.array([1.0, 0.45, 0.16], np.float32) * (0.55 + 0.45 * nz[fh])[:, None]
    corr = 0.5 + 0.5 * np.cos(th * 40)
    em[ln] = np.array([1.0, 0.5, 0.2], np.float32) * ((0.35 + 0.65 * corr[ln]) * (0.5 + 0.5 * nz2[ln]) * (0.5 + 0.5 * sstep(13.3, 11.7, s[ln])))[:, None]
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
    # tyres: rubber, tread lighter where worn, a dusty lower half
    ty = pid == 50
    if ty.any():
        L.base[ty] = srgb_to_lin(np.array([0.085, 0.085, 0.09], np.float32)) * (0.85 + 0.3 * nz2[ty])[:, None]
        L.rough[ty] = 0.82 - 0.1 * nz[ty]
        # tread band: worn lighter grey; sidewall: subtle moulded rings
        wheel_c = np.where(np.abs(P[ty, 1]) > 0.5, GROUND + MAIN_WHEEL['r'], GROUND + NOSE_WHEEL['r'])
        sx = np.where(np.abs(P[ty, 1]) > 0.5, X(MAIN_WHEEL['s']), X(NOSE_WHEEL['s']))
        rad = np.hypot(P[ty, 0] - sx, P[ty, 2] - wheel_c)
        R = np.where(np.abs(P[ty, 1]) > 0.5, MAIN_WHEEL['r'], NOSE_WHEEL['r'])
        tread = sstep(R - 0.03, R - 0.012, rad)
        L.base[ty] *= (1 + 0.45 * tread)[:, None]
        L.rough[ty] = np.clip(L.rough[ty] - 0.08 * tread, 0, 1)
        rings = 0.5 + 0.5 * np.cos(rad * 2 * math.pi / 0.009)
        L.h[ty] += 0.00008 * rings * (1 - tread) + 0.0004 * (nz2[ty] - 0.5) * tread
        dust = sstep(-0.3, -0.9, (P[ty, 2] - wheel_c) / R) * 0.5
        L.base[ty] = L.base[ty] * (1 - dust[:, None]) + srgb_to_lin(np.array([0.36, 0.32, 0.27], np.float32)) * dust[:, None]
    hub = pid == 51
    if hub.any():
        L.base[hub] = srgb_to_lin(np.array([0.74, 0.74, 0.72], np.float32)) * (0.9 + 0.15 * nz[hub])[:, None]
        L.rough[hub] = 0.38
        bd = np.clip(1 - ao[hub], 0, 1)
        over_m(L, hub, 0.6 * bd + 0.25 * nz2[hub], np.array([0.12, 0.10, 0.08], np.float32), 0.6)   # brake dust
    chrome = pid == 54
    if chrome.any():
        L.base[chrome] = 0.92; L.metal[chrome] = 1.0
        L.rough[chrome] = 0.06 + 0.06 * nz2[chrome]
        oil = sstep(0.5, 0.8, nz[chrome])
        over_m(L, chrome, oil * 0.5, np.array([0.5, 0.45, 0.35], np.float32), 0.15, metal=1.0)
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
        skin.metal(sub, sd, zd, panel, ao[dout], along, across, 0.80)
        # rivet rows round the edge and along two stringers
        for key, (s0d, s1d, z0d, z1d) in (('n', DOORS['nose'][:4]), ('m', DOORS['main'][:4])):
            m = (sd > s0d - 0.02) & (sd < s1d + 0.02)
            if not m.any():
                continue
            ex = np.minimum(sd - s0d, s1d - sd); ez = np.minimum(zd - z1d, z0d - zd)
            dmin = np.minimum(ex, ez)
            alongd = np.where(ex < ez, zd, sd)
            head, ring, rnd = rivet_row(alongd, dmin - 0.016, 0.028, 0.0024, 120)
            for stz in np.linspace(z1d, z0d, 5)[1:-1]:
                h2, r2, _ = rivet_row(sd, zd - stz, 0.032, 0.0023, 121)
                head = np.maximum(head, h2 * 0.8); ring = np.maximum(ring, r2 * 0.8)
            sub.base[m] *= (1 + 0.06 * head[m][:, None] - 0.2 * ring[m][:, None])
            sub.h[m] += -0.00004 * ring[m]
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
    L.base *= (1 - 0.45 * g * painted - 0.25 * g * ~painted)[:, None]
    L.rough += 0.15 * g * painted
    stain = sstep(0.62, 0.82, fbm(u * 0.5, v * 4.0, 0.15, 3, seed=73)) * painted
    over(L, stain * 0.5, col=np.array([0.22, 0.17, 0.10], np.float32), rough=0.25)
    wear = np.clip(edge * 2.2 - 0.2, 0, 1) * painted * sstep(0.4, 0.7, nz2)
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
    ao = pad(np.clip(0.35 + 0.65 * S.ao, 0, 1), pidx)
    nn = pad(n_ts, pidx)
    nn[~np.isfinite(nn).all(2) | (np.linalg.norm(nn, axis=2) < 0.5)] = (0, 0, 1)
    an = pad(np.stack([ax, ay, OUTS['astr']], 2), pidx)
    os.makedirs(OUT, exist_ok=True)

    def save(name, arr):
        im = Image.fromarray(np.clip(np.round(arr * 255), 0, 255).astype(np.uint8)[::-1])
        im.save(os.path.join(OUT, f'{key}_{name}.png'), compress_level=1)
    save('base', lin_to_srgb(base))
    save('orm', np.stack([ao, np.clip(rough, 0.03, 1), np.clip(metal, 0, 1)], 2))
    save('normal', nn * 0.5 + 0.5)
    if key in ('skin', 'wing', 'gear'):
        save('aniso', np.stack([an[..., 0] * 0.5 + 0.5, an[..., 1] * 0.5 + 0.5, np.clip(an[..., 2], 0, 1)], 2))
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
