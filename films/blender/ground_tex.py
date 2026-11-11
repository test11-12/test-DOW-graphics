# Photoscanned ground materials for the terrain's material layers -> assets/shared/tex/ground/
#   node tools/blender.mjs ground_tex [layer ...]        (default: every layer below)
#
# Each layer is one Poly Haven scan (CC0), kept at its real-world size, processed with numpy / Pillow:
#   <layer>_albedo.webp  RGB albedo (sRGB)
#   <layer>_normal.webp  tangent-space normal (OpenGL, +y = image up) as one grey image twice as wide as tall:
#                        left half x, right half y. Grey keeps lossy WebP from mixing the axes (luma only, full
#                        resolution, no chroma subsampling).
#   <layer>_orm.webp     half resolution: R occlusion, G roughness, B 0, A height (0..1, high-passed: the terrain
#                        supplies the slopes)
# The very lowest frequencies of colour and height are partly flattened: a blotch that fills a quarter of the
# tile would otherwise repeat visibly under hex tiling. Large-scale variation comes from the terrain recipe.
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import numpy as np
from PIL import Image
import dowlib as d

SIZE = 1024
# name: (Poly Haven id, flatten 0..1, normal-map size, notes)
LAYERS = {
    'concrete_broom': ('concrete_floor_03', 0.65, 1024, 'runway PCC slabs, broom / tine texture (lines run along image v)'),
    'concrete_worn': ('concrete_floor_worn_001', 0.75, 1024, 'smoother, worn slabs: tone and stains'),
    'asphalt': ('asphalt_04', 0.6, 512, 'sun-bleached asphalt shoulders, fine cracks'),
    'soil': ('dry_ground_rocks', 0.55, 1024, 'desert soil with small stones (basin floor)'),
    'soil_fine': ('gravelly_sand', 0.6, 1024, 'fine gravelly sand: service track and patch variation'),
    'gravel': ('rocks_ground_09', 0.5, 512, 'graded gravel, broken rock'),
    'caliche': ('sandy_gravel', 0.6, 512, 'pale caliche / calcrete crust with grit'),
}
OUT = d.out_path('shared', 'tex', 'ground', 'x').rsplit(os.sep, 1)[0]


def load(path, mode=None):
    im = Image.open(path)
    if mode:
        im = im.convert(mode)
    return im


def fit(im, size):
    """Resize a tileable image to size x size, wrapping at the borders so the result still tiles."""
    if im.size == (size, size):
        return im
    a = np.asarray(im)
    pad = max(4, a.shape[0] // 64)
    wrapped = np.pad(a, ((pad, pad), (pad, pad)) + ((0, 0),) * (a.ndim - 2), mode='wrap')
    k = size / a.shape[0]
    big = Image.fromarray(wrapped).resize((round(wrapped.shape[1] * k), round(wrapped.shape[0] * k)), Image.LANCZOS)
    p = round(pad * k)
    return big.crop((p, p, p + size, p + size))


def gblur_wrap(a, sigma):
    """Gaussian blur of a 2-D float array with wrap-around (FFT)."""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def process(name, src, flatten, nsize):
    jp = d.polyhaven_texture(src, '1k', maps=('Diffuse', 'arm'), fmt='jpg')
    pp = d.polyhaven_texture(src, '1k', maps=('nor_gl', 'Displacement'), fmt='png')
    # albedo: partly flatten the lowest frequencies of luminance, in linear light
    alb = np.asarray(fit(load(jp['Diffuse'], 'RGB'), SIZE)).astype(np.float64) / 255.0
    lin = srgb_to_lin(alb)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    low = gblur_wrap(lum, SIZE / 10.0)
    gain = (lum.mean() / np.maximum(low, 1e-4)) ** flatten
    lin = lin * gain[..., None]
    # height: high-pass (relief is local; the terrain supplies the slopes), normalised by percentiles
    hi = np.asarray(fit(load(pp['Displacement']), SIZE)).astype(np.float64)
    if hi.ndim == 3:
        hi = hi[..., 0]
    hi = hi - gblur_wrap(hi, SIZE / 8.0)
    lo_, hi_ = np.percentile(hi, [1.0, 99.5])
    hgt = np.clip((hi - lo_) / max(hi_ - lo_, 1e-6), 0, 1)
    q = lambda c: (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(q(lin_to_srgb(lin)), 'RGB').save(os.path.join(OUT, f'{name}_albedo.webp'), 'WEBP', quality=90, method=6)
    # normal: renormalise; x | y side by side as grey
    n = np.asarray(fit(load(pp['nor_gl'], 'RGB'), nsize)).astype(np.float64) / 255.0 * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    Image.fromarray(q(np.hstack([n[..., 0], n[..., 1]]) * 0.5 + 0.5), 'L').save(
        os.path.join(OUT, f'{name}_normal.webp'), 'WEBP', quality=90, method=6)
    # occlusion, roughness and height at half resolution
    arm = np.asarray(fit(load(jp['arm'], 'RGB'), SIZE // 2)).astype(np.float64) / 255.0
    hh = np.asarray(Image.fromarray(q(hgt)).resize((SIZE // 2, SIZE // 2), Image.BOX)).astype(np.float64) / 255.0
    orm = np.dstack([arm[..., 0], arm[..., 1], np.zeros_like(hh), hh])
    Image.fromarray(q(orm), 'RGBA').save(os.path.join(OUT, f'{name}_orm.webp'), 'WEBP', quality=92, alpha_quality=100, method=6)
    mean = lin.reshape(-1, 3).mean(0)
    sizes = {k: os.path.getsize(os.path.join(OUT, f'{name}_{k}.webp')) // 1024 for k in ('albedo', 'normal', 'orm')}
    d.log(f'{name:15s} <- {src:24s} mean albedo (linear) {np.round(mean, 3)}  rough {arm[..., 1].mean():.2f}  KB {sizes}')
    return {'src': src, 'mean': [round(float(x), 4) for x in mean], 'rough': round(float(arm[..., 1].mean()), 3)}


os.makedirs(OUT, exist_ok=True)
want = d.args() or list(LAYERS)
info = {}
for nm in want:
    src, fl, ns, _ = LAYERS[nm]
    info[nm] = process(nm, src, fl, ns)
meta = os.path.join(d.bake_dir('ground'), 'ground_tex.json')
old = json.load(open(meta)) if os.path.exists(meta) else {}
old.update(info)
json.dump(old, open(meta, 'w'), indent=1)
d.log('wrote', OUT, '; stats in', meta)
