"""How qh_marks/*.png were made: dark artwork traced from Hermeus's released 4K side photograph of Mk 2.1 / Mk 2.2
(the fin's wing mark and the horse head beside the wordmark), so the markings are as photographed, not redrawn.

    python3 -I trace.py <mk21_22.jpg> fin    -> fin_wing.png  (4K crop 810,1010 - 1030,1178; x6; threshold 0.5)
    python3 -I trace.py <mk21_22.jpg> horse  -> horse.png     (4K crop 2584,1293 - 2722,1342; x12; threshold 0.6)

Steps: darkness relative to the surrounding skin, bicubic upsampling, a slight blur, threshold, keep the large
connected parts, crop to the artwork, then a smoothing pass (blur + re-threshold) that removes JPEG wobble. The horse's
two hair-thin face lines (about one source pixel) do not survive the threshold and are added back as tapered strokes
along the lines in the photograph."""
import collections
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))


def trace(photo, box, up, thr, blur, minfrac):
    im = Image.open(photo).convert('L').crop(box)
    a = np.asarray(im, np.float32)
    bg, ink = np.percentile(a, 75), np.percentile(a, 3)
    d = np.clip((bg - a) / max(bg - ink, 1), 0, 1)
    big = Image.fromarray((d * 255).astype(np.uint8)).resize((im.width * up, im.height * up), Image.BICUBIC).filter(ImageFilter.GaussianBlur(blur * up))
    m = np.asarray(big, np.float32) / 255 > thr
    H, W = m.shape
    lab = np.zeros((H, W), np.int32); n = 0; sizes = {}
    for yy in range(H):
        for xx in np.nonzero(m[yy] & (lab[yy] == 0))[0]:
            if lab[yy, xx]:
                continue
            n += 1; q = collections.deque([(yy, xx)]); lab[yy, xx] = n; c = 0
            while q:
                py, px = q.popleft(); c += 1
                for ny, nx in ((py + 1, px), (py - 1, px), (py, px + 1), (py, px - 1)):
                    if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n; q.append((ny, nx))
            sizes[n] = c
    mk = np.isin(lab, [k for k, v in sizes.items() if v > minfrac * H * W])
    ys, xs = np.nonzero(mk)
    return mk[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def smooth(m, r):
    a = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    return np.asarray(a, np.float32) / 255 > 0.5


def bez(p0, p1, p2, p3, n=40):
    t = np.linspace(0, 1, n)[:, None]; p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def stroke(g, pts, w0, w1):
    d = np.gradient(pts, axis=0); d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([-d[:, 1], d[:, 0]], 1); w = np.linspace(w0, w1, len(pts))[:, None] / 2
    g.polygon([tuple(p) for p in np.concatenate([pts + nrm * w, (pts - nrm * w)[::-1]])], fill=255)


if __name__ == '__main__':
    photo, which = sys.argv[1], sys.argv[2]
    if which == 'fin':
        m = smooth(trace(photo, (810, 1010, 1030, 1178), 6, 0.5, 0.55, 0.01), 4.0)
        Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(HERE, 'fin_wing.png'), optimize=True)
    else:
        m = smooth(trace(photo, (2584, 1293, 2722, 1342), 12, 0.6, 0.4, 0.0005), 7.0)
        im = Image.fromarray((m * 255).astype(np.uint8)); g = ImageDraw.Draw(im)
        stroke(g, bez((835, 40), (960, 95), (1130, 170), (1335, 262)), 15, 10)      # forehead line, ear to nose
        stroke(g, bez((878, 132), (1000, 152), (1150, 205), (1318, 262)), 12, 9)    # inner face line
        im.save(os.path.join(HERE, 'horse.png'), optimize=True)
