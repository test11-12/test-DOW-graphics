"""Materials of the Corsair: scanned source materials (ambientCG, CC0) for the Blender bake and the numpy
weathering pass that finishes the baked base colour and roughness from baked position / normal / occlusion.

The boat in the released photographs is clean and uniformly haze grey, so the weathering is what the sea does
in one run: a wet, darker band where the spray sheet runs aft, salt dried above it, faint runs under the rail
and the side fittings, wet patches and salt on the deck.
"""
import bpy
import numpy as np

import dowlib as d
import boatkit as k
import corsair_geo as geo

PAINT = np.array([0.275, 0.295, 0.315])
SRC = {  # kind: source material (scanned detail from ambientCG; colours are paint / material albedo, linear)
    'hull': dict(base=PAINT * 0.74, scan='Metal032', scale=0.9, rough=(0.30, 0.44), var=0.05, nrm=0.4, wavy=0.004),
    'deck': dict(base=PAINT * 1.25, scan='Metal032', scale=1.1, rough=(0.36, 0.50), var=0.05, nrm=0.35, wavy=0.0015),
    'grip': dict(base=PAINT * 1.12, scan='Metal032', scale=1.1, rough=(0.62, 0.74), var=0.04, nrm=0.0),
    'box': dict(base=PAINT * 1.20, scan='Metal032', scale=1.3, rough=(0.34, 0.48), var=0.05, nrm=0.35, wavy=0.0015),
    'louvre': dict(base=(0.022, 0.022, 0.024), scan='Plastic006', scale=3.0, rough=(0.60, 0.75), var=0.0, nrm=0.2),
    'boxlid': dict(base=PAINT * 1.35, scan='Metal032', scale=1.3, rough=(0.38, 0.52), var=0.05, nrm=0.2),
    'dark': dict(base=(0.012, 0.012, 0.013), scan='Plastic006', scale=3.0, rough=(0.55, 0.68), var=0.0, nrm=0.2),
    'mast': dict(base=PAINT * 0.97, scan='Metal032', scale=2.0, rough=(0.28, 0.40), var=0.04, nrm=0.15),
    'steel': dict(base=(0.60, 0.60, 0.585), scan='Metal009', scale=4.0, rough=(0.20, 0.36), var=0.06, nrm=0.5, metal=1.0),
    'alu': dict(base=(0.40, 0.41, 0.42), scan='Metal038', scale=2.5, rough=(0.42, 0.60), var=0.10, nrm=1.0, metal=1.0),
    'rubber': dict(base=(0.030, 0.030, 0.032), scan='Rubber004', scale=5.0, rough=(0.60, 0.80), var=0.15, nrm=0.8),
    'black': dict(base=(0.018, 0.018, 0.020), scan='Plastic006', scale=4.0, rough=(0.36, 0.52), var=0.0, nrm=0.5),
    'white': dict(base=(0.70, 0.71, 0.70), scan='Plastic006', scale=3.0, rough=(0.28, 0.42), var=0.0, nrm=0.3),
}
# final glTF materials the engine addresses by name: (atlas, kind) -> name
FINAL = {('hull', None): 'hull', ('deck', 'grip'): 'deck_grip', ('deck', 'box'): 'enginebox', ('deck', 'boxlid'): 'enginebox', ('deck', 'louvre'): 'enginebox',
         ('deck', None): 'deck', ('gear', 'mast'): 'mast', ('gear', None): 'gear'}
# colours of the mask bake: R paint (takes water marks, salt, streaks), G non-skid, B rubber
IDCOL = {'hull': (1, 0, 0), 'deck': (1, 0, 0), 'grip': (1, 1, 0), 'box': (1, 0, 0), 'boxlid': (1, 0, 0), 'louvre': (1, 0, 0), 'mast': (1, 0, 0), 'rubber': (0, 0, 1),
         'white': (0.5, 0, 0)}
_range = {}


def scan_images(asset):
    t = d.ambientcg_texture(asset, '2K')
    col, rough, nrm = d.image(t['Color']), d.image(t['Roughness'], True), d.image(t['NormalGL'], True)
    if asset not in _range:
        _range[asset] = (np.percentile(d.pixels(col)[::8, ::8, :3].mean(axis=2), [2, 98]), np.percentile(d.pixels(rough)[::8, ::8, 0], [2, 98]))
    return col, rough, nrm


def src_mat(kind):
    name = 'src_' + kind
    m = bpy.data.materials.get(name)
    if m:
        return m
    s = SRC[kind]
    m, bsdf, nodes, links = d.new_material(name)
    nt = m.node_tree
    col, rough, nrm = scan_images(s['scan'])
    (c0, c1), (r0, r1) = _range[s['scan']]
    tc = d.texcoord(nt)
    co = tc.outputs['Object']
    tcol = d.tex(nt, col, co, 'BOX', 0.3, scale=s['scale'])
    trgh = d.tex(nt, rough, co, 'BOX', 0.3, scale=s['scale'])

    def remap(sock, a, b, lo, hi):
        n = nodes.new('ShaderNodeMapRange')
        n.inputs['From Min'].default_value, n.inputs['From Max'].default_value = a, b
        n.inputs['To Min'].default_value, n.inputs['To Max'].default_value = lo, hi
        links.new(sock, n.inputs['Value'])
        return n.outputs['Result']
    bw = nodes.new('ShaderNodeRGBToBW')
    links.new(tcol.outputs['Color'], bw.inputs['Color'])
    var = remap(bw.outputs['Val'], float(c0), float(c1), 1 - s['var'], 1 + s['var'])
    mul = nodes.new('ShaderNodeVectorMath')
    mul.operation = 'SCALE'
    mul.inputs[0].default_value = tuple(float(v) for v in s['base'])
    links.new(var, mul.inputs['Scale'])
    links.new(mul.outputs['Vector'], bsdf.inputs['Base Color'])
    links.new(remap(trgh.outputs['Color'], float(r0), float(r1), *s['rough']), bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = s.get('metal', 0.0)
    nsock = None
    if s['nrm'] > 0:
        tn = d.tex(nt, nrm, co, 'BOX', 0.3, scale=s['scale'])
        nsock = d.normal_map(nt, tn.outputs['Color'], s['nrm'])
    if s.get('wavy'):   # plating that is fair but not optically flat: reflections wander a little
        nz = nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 2.6
        nz.inputs['Detail'].default_value = 1.0
        links.new(co, nz.inputs['Vector'])
        bp = nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = 1.0
        bp.inputs['Distance'].default_value = s['wavy']
        links.new(nz.outputs['Fac'], bp.inputs['Height'])
        if nsock is not None:
            links.new(nsock, bp.inputs['Normal'])
        nsock = bp.outputs['Normal']
    if nsock is not None:
        links.new(nsock, bsdf.inputs['Normal'])
    return m


def table(fn, n=512):
    xs = np.linspace(-geo.XB, geo.XB, n)
    ys = np.array([fn(float(x)) for x in xs], np.float32)
    return lambda x: np.interp(x, xs, ys).astype(np.float32)


ZG, ZC = table(geo.zg), table(geo.zc)
SALT = np.array([0.60, 0.61, 0.60], np.float32)
V = lambda *a: np.array(a, np.float32)


def weather_hull(P, N, ao, idm, base, rough):
    """Paint finished by the sea: a wet, darker band where the spray sheet runs aft, dried salt above it, runs
    below the rail and the fittings, a faint scum line at the static waterline, a scuffed bottom."""
    x, z = P[..., 0], P[..., 2]
    hc = z - ZC(x)                                           # height above the chine
    tops = k.sstep(-0.01, 0.03, hc) * k.sstep(-0.75, -0.4, N[..., 2])
    transom = k.sstep(0.6, 0.9, -N[..., 0])
    tone = k.fbm(P, 0.8, 3, seed=3)
    base *= (1 + 0.05 * (tone - 0.5))[..., None]
    # runs: fine vertical streaking, stronger just under the rub rail
    Ps = P * V(1, 1, 0.04)
    runs = k.fbm(Ps, 38.0, 3, seed=11)
    below_rail = np.clip((ZG(x) - 0.07 - z) / 0.5, 0, 1)
    run_m = k.sstep(0.52, 0.78, runs) * tops * (0.35 + 0.65 * np.exp(-below_rail * 3.0)) * k.sstep(0.0, 0.03, below_rail)
    base *= (1 - 0.07 * run_m)[..., None]
    rough += 0.06 * run_m
    # under the four side fittings
    for bx in (0.49, -2.40):
        zt = float(geo.zg(bx)) - 0.45
        w = np.exp(-((x - bx) / 0.045) ** 2) * k.sstep(0.0, 0.03, zt - z) * np.exp(-np.clip(zt - z, 0, 1) / 0.22) * tops
        base *= (1 - 0.13 * w * (0.6 + 0.8 * runs))[..., None]
        rough += 0.08 * w
    # spray band along the topsides, rising aft; the planing bottom aft is wet all over
    n1 = k.fbm(P * V(1, 0, 0) + 7.0, 1.3, 3, seed=5)
    n2 = k.fbm(P, 9.0, 3, seed=6)
    wl = 0.07 + 0.20 * k.sstep(2.2, -1.6, x) + 0.10 * (n1 - 0.5) + 0.05 * (n2 - 0.5)
    wet = (1 - k.sstep(wl - 0.04, wl + 0.02, hc)) * k.sstep(2.9, 1.9, x + 0.5 * (n1 - 0.5))
    wet = np.maximum(wet, transom * (1 - k.sstep(0.05, 0.22, z + 0.1 * (n2 - 0.5))))
    base *= (1 - 0.27 * wet)[..., None]
    drops = k.sstep(0.60, 0.72, k.fbm(P, 55.0, 2, seed=8)) * tops * k.sstep(wl + 0.30, wl, hc) * (1 - wet)
    gloss = np.clip(wet + 0.6 * drops, 0, 1)                  # beads above the band only change the sheen
    rough[:] = rough * (1 - gloss) + (0.08 + 0.07 * n2) * gloss
    # dried salt: a pale, matt fringe above the wet line and faint blotches higher up
    fringe = k.sstep(wl - 0.01, wl + 0.03, hc) * (1 - k.sstep(wl + 0.04, wl + 0.26, hc)) * tops
    blot = k.sstep(0.55, 0.8, k.fbm(P, 6.0, 3, seed=9)) * tops * 0.35
    salt = np.clip(fringe * (0.35 + 0.65 * k.fbm(Ps, 24.0, 3, seed=10)) + blot * k.sstep(1.0, 0.2, below_rail * 2), 0, 1) * (1 - wet)
    base[:] = base * (1 - 0.22 * salt[..., None]) + SALT * (0.22 * salt[..., None])
    rough += 0.25 * salt
    # static waterline: a thin, faintly brown line
    line = np.exp(-((z - 0.012 - 0.012 * (n2 - 0.5)) / 0.011) ** 2) * (1 - 0.6 * wet)
    base *= 1 - 0.10 * line[..., None] * V(0.8, 0.95, 1.2)
    # bottom: long scuffs fore and aft
    scuff = k.sstep(0.55, 0.8, k.fbm(P * V(0.05, 1, 1), 30.0, 3, seed=12)) * (1 - tops) * (1 - transom)
    base *= (1 - 0.06 * scuff)[..., None]
    rough += 0.10 * scuff * (1 - wet)
    # grime where the rail and fittings shade the paint
    g = 1 - k.sstep(0.35, 0.95, ao)
    base *= (1 - 0.22 * g)[..., None]
    return base, rough


def weather_deck(P, N, ao, idm, base, rough):
    """Deck paint: salt dried in the gutters and along edges, runs down the cowl sides, wet patches where
    spray has just landed (darker and glossier, also on the non-skid)."""
    x = P[..., 0]
    up = k.sstep(0.80, 0.96, N[..., 2])
    grip = idm[..., 1]
    tone = k.fbm(P, 0.9, 3, seed=21)
    base *= (1 + 0.05 * (tone - 0.5))[..., None]
    # runs down sloping and upright faces
    Ps = P * V(1, 1, 0.05)
    runs = k.sstep(0.50, 0.78, k.fbm(Ps, 34.0, 3, seed=22)) * (1 - up)
    base *= (1 - 0.06 * runs)[..., None]
    rough += 0.07 * runs
    # spray that has just landed: wet areas (glossier, a little darker; the non-skid darkens more), denser aft,
    # with fine beads around them
    n1 = k.fbm(P, 2.6, 4, seed=23)
    n2 = k.fbm(P, 14.0, 3, seed=24)
    thr = 0.57 - 0.06 * k.sstep(0.0, -3.0, x)
    wet = k.sstep(thr, thr + 0.03, n1 + 0.12 * (n2 - 0.5)) * up
    beads = k.sstep(0.62, 0.70, k.fbm(P, 90.0, 2, seed=25)) * up * (1 - wet) * (0.3 + 0.7 * k.sstep(thr - 0.25, thr, n1))
    base *= (1 - (0.05 + 0.03 * grip) * wet - 0.03 * beads)[..., None]
    rough[:] = rough * (1 - wet) + (0.07 + 0.22 * grip + 0.05 * n2) * wet
    rough[:] = rough * (1 - 0.75 * beads) + 0.09 * 0.75 * beads
    # salt: tide marks round the wet areas, dried splashes on dry paint, crusts in the gutters and corners
    rim = k.sstep(thr - 0.06, thr - 0.005, n1 + 0.12 * (n2 - 0.5)) * (1 - wet) * up
    speck = k.sstep(0.60, 0.74, k.fbm(P, 42.0, 2, seed=26)) * up * (1 - wet) * k.sstep(0.38, 0.62, k.fbm(P, 1.1, 3, seed=27))
    cav = 1 - k.sstep(0.45, 0.92, ao)
    salt = np.clip(0.6 * rim * (0.4 + 0.6 * n2) + 0.45 * speck + 0.55 * cav * (0.5 + 0.5 * n2), 0, 1) * (1 - wet)
    base[:] = base * (1 - 0.17 * salt[..., None]) + SALT * (0.17 * salt[..., None])
    rough += 0.15 * salt * (1 - 0.6 * grip)
    # dirt in the tightest corners
    g = 1 - k.sstep(0.15, 0.6, ao)
    base *= (1 - 0.30 * g)[..., None]
    return base, rough


def weather_gear(P, N, ao, idm, base, rough):
    """Mast, fittings and rub rail: rail scuffed pale along its face, salt on upward faces, shadowed joints."""
    paint, rubber = idm[..., 0], idm[..., 2]
    up = k.sstep(0.5, 0.95, N[..., 2])
    n2 = k.fbm(P, 16.0, 3, seed=31)
    scuff = k.sstep(0.50, 0.75, k.fbm(P * V(0.04, 1, 1), 26.0, 3, seed=32)) * rubber * (1 - up)
    base[:] = base * (1 - 0.5 * scuff[..., None]) + np.float32(0.11) * (0.5 * scuff[..., None])
    rough += 0.10 * scuff
    salt = k.sstep(0.45, 0.8, k.fbm(P, 7.0, 3, seed=33)) * up * (0.5 * paint + rubber) * (0.5 + 0.5 * n2)
    base[:] = base * (1 - 0.12 * salt[..., None]) + SALT * (0.12 * salt[..., None])
    rough += 0.15 * salt
    g = 1 - k.sstep(0.25, 0.8, ao)
    base *= (1 - 0.30 * g * np.clip(paint + rubber, 0, 1))[..., None]
    return base, rough


WEATHER = {'hull': weather_hull, 'deck': weather_deck, 'gear': weather_gear}


def grip_detail(path):
    """Tiling detail for the non-skid (added in the shader by src/corsair_boat.js): RG = normal xy, B = height,
    cut from a photoscanned granular rubber surface (Poly Haven rubberized_track, CC0)."""
    from PIL import Image
    t = d.polyhaven_texture('rubberized_track', '2k', maps=('nor_gl', 'Displacement'))
    nrm = np.asarray(Image.open(t['nor_gl']).convert('RGB'), np.float32)[:1024, :1024] / 255
    hgt = np.asarray(Image.open(t['Displacement']).convert('L'), np.float32)[:1024, :1024] / 255
    det = np.dstack([nrm[..., 0], nrm[..., 1], np.clip((hgt - hgt.mean()) * 3.0 + 0.5, 0, 1)])
    w = np.clip(np.minimum(np.arange(1024), 1023 - np.arange(1024)) / 96.0, 0, 1)      # cross-fade the borders so it tiles
    m = (w[None, :] * w[:, None])[..., None]
    det = det * m + np.roll(det, (512, 512), (0, 1)) * (1 - m)
    det[..., :2] = (det[..., :2] - 0.5) * 1.25 + 0.5
    return k.save_webp(det[::-1], path, quality=88)
