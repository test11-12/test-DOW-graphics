# Close-range ground materials for film 2 ("Fox Three"): photoscanned CC0 asphalt for the Edwards flight line,
# re-balanced so it tiles without visible repetition, packed for the terrain shading pass as a texture array:
#   assets/fury/tex/ground_<name>_a.webp   albedo (sRGB), large-scale tone removed (the recipe adds its own)
#   assets/fury/tex/ground_<name>_n.webp   R,G: tangent-space normal x,y (OpenGL, +v up), B: roughness
#   assets/fury/tex/ground_<name>_h.webp   R: height (0..1, mean 0.5), G: ambient occlusion, B: cavity
# Rows are stored bottom-up (OpenGL texture convention), so the shader's v axis matches the normal map's +Y.
#   node tools/blender.mjs fury_ground [--preview]
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import numpy as np
from PIL import Image
import dowlib as d

SIZE = 2048
# name: (source, tile size in metres as scanned)
SETS = {
    'asphalt': ('asphalt_02', 3.0),
}
PREVIEW = '--preview' in d.args()
WORK = os.environ.get('DOW_PREVIEW_DIR', os.path.join(d.CACHE, 'previews', 'fury_ground'))
# --try a,b,c: preview other Poly Haven sources instead of building (written to WORK only)
TRY = next((a.split('=', 1)[1] for a in d.args() if a.startswith('--try=')), None)
if TRY:
    SETS = {s: (s, 0) for s in TRY.split(',')}
    PREVIEW = True


def load(path, mode='RGB'):
    im = Image.open(path).convert(mode)
    if im.size != (SIZE, SIZE):
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def blur_wrap(a, sigma):
    """Gaussian blur with wrap-around (the scans tile), via FFT."""
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2.0 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def save(arr, path):
    arr = np.flipud(np.clip(arr, 0, 1))          # bottom-up rows
    Image.fromarray((arr * 255.0 + 0.5).astype(np.uint8), 'RGB').save(path, 'WEBP', quality=90, method=6)
    d.log('wrote', os.path.relpath(path, d.FILMS), f'{os.path.getsize(path) / 1e6:.2f} MB')


def crack_mask(lum, hgt, k=2.1):
    """Thin dark, sunken lines (cracks) as a soft 0..1 mask. A repeated crack is the first thing that gives a
    tiled scan away; the recipe draws its own cracks and sealant where the pavement layout puts them."""
    def band(a):
        hp = blur_wrap(a, 3.0) - blur_wrap(a, 22.0)
        return hp / max(1e-6, hp.std())
    score = -(band(lum) * 0.6 + band(hgt) * 0.4)
    m = (score > k).astype(np.float32)
    m = (blur_wrap(m, 4.0) > 0.10).astype(np.float32)          # join the fragments along a crack
    m = m * (blur_wrap(m, 12.0) > 0.06)                         # drop isolated specks (grains)
    m = (blur_wrap(m, 7.0) > 0.03).astype(np.float32)           # grow over the crack's rim
    return np.clip(blur_wrap(m, 3.0) * 1.6, 0, 1)


def fill_from_offsets(chans, mask, offsets):
    """Replace masked texels with texels from shifted copies of the same scan whose own mask is clear there."""
    remaining = mask.copy()
    out = [c.copy() for c in chans]
    for dy, dx in offsets:
        rm = np.roll(mask, (dy, dx), (0, 1))
        w = remaining * (1.0 - rm)
        for i, c in enumerate(chans):
            src = np.roll(c, (dy, dx), (0, 1))
            ww = w if c.ndim == 2 else w[..., None]
            out[i] = out[i] * (1 - ww) + src * ww
        remaining = remaining - w
    d.log('crack fill: unresolved fraction', round(float(remaining.mean()), 5))
    return out


os.makedirs(WORK, exist_ok=True)
for name, (src, tile) in SETS.items():
    maps = d.polyhaven_texture(src, '2k', maps=('Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement'))
    d.log(name, {k: os.path.basename(v) for k, v in maps.items()})
    col = srgb_to_lin(load(maps['Diffuse']))
    nrm = load(maps['nor_gl'])
    rough = load(maps['Rough'], 'L')
    ao = load(maps['AO'], 'L') if 'AO' in maps else np.ones((SIZE, SIZE), np.float32)
    hgt = load(maps['Displacement'], 'L') if 'Displacement' in maps else np.full((SIZE, SIZE), 0.5, np.float32)
    lum = (col * np.array([0.2126, 0.7152, 0.0722])).sum(-1)
    if not TRY or '--cracks' in d.args():
        cm = crack_mask(lum, hgt)
        d.log(name, 'crack coverage', round(float(cm.mean()), 4))
        if PREVIEW:
            Image.fromarray((cm[::2, ::2] * 255).astype(np.uint8)).save(os.path.join(WORK, f'{name}_cracks.png'))
        offs = [(0, 431), (0, -517), (389, 0), (-611, 0), (701, 263), (-283, 811), (557, -401), (0, 1024), (1024, 0)]
        col, nrm, rough, ao, hgt = fill_from_offsets([col, nrm, rough, ao, hgt], cm, offs)
    # flatten the scan's large-scale tone (lighting gradients, blotches) so repeats do not read; keep detail
    lum = (col * np.array([0.2126, 0.7152, 0.0722])).sum(-1)
    big = blur_wrap(lum, SIZE / 10.0)
    col = col * (lum.mean() / np.maximum(big, 1e-3))[..., None]
    rough = rough - blur_wrap(rough, SIZE / 10.0) + rough.mean()
    hgt = hgt - blur_wrap(hgt, SIZE / 8.0)
    hgt = 0.5 + hgt / max(1e-4, 4.0 * hgt.std())
    cav = np.clip(0.5 + (hgt - blur_wrap(hgt, 6.0)) * 2.0, 0, 1)
    d.log(name, 'albedo mean (linear)', col.reshape(-1, 3).mean(0).round(4), 'rough mean', round(float(rough.mean()), 3))
    if not TRY:
        save(lin_to_srgb(col), d.out_path('fury', 'tex', f'ground_{name}_a.webp'))
        save(np.stack([nrm[..., 0], nrm[..., 1], np.clip(rough, 0, 1)], -1), d.out_path('fury', 'tex', f'ground_{name}_n.webp'))
        save(np.stack([np.clip(hgt, 0, 1), ao, cav], -1), d.out_path('fury', 'tex', f'ground_{name}_h.webp'))
    if PREVIEW:
        Image.fromarray((lin_to_srgb(col)[:1024, :1024] * 255).astype(np.uint8)).save(os.path.join(WORK, f'{name}_crop.png'))
        tiled = np.tile(lin_to_srgb(col)[::4, ::4], (3, 3, 1))
        Image.fromarray((tiled * 255).astype(np.uint8)).save(os.path.join(WORK, f'{name}_tiled.jpg'), quality=88)
        Image.open(maps['Diffuse']).convert('RGB').resize((1024, 1024)).save(os.path.join(WORK, f'{name}_src.jpg'), quality=88)
