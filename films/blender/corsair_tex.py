"""Materials of the Corsair: scanned source materials (ambientCG, CC0) for the Blender bake and the numpy
weathering pass that finishes the baked base colour and roughness from baked position / normal / occlusion.

The boat in the released photographs is clean and uniformly haze grey, so the weathering is what the sea does
in one run: a wet, darker band where the spray sheet runs aft, salt dried above it, faint runs under the rail
and the side fittings, wet patches and salt on the deck.
"""
import os

import bpy
import numpy as np

import dowlib as d
import boatkit as k
import corsair_geo as geo

PAINT = np.array([0.280, 0.310, 0.350])   # one cool haze grey for the whole boat (the photographs show no two-tone)
LOUVRE = tuple(PAINT * 0.70)                # vent blades: the box paint, a shade darker (powder coat on the blades)
SRC = {  # kind: source material (scanned detail from ambientCG; colours are paint / material albedo, linear)
    'hull': dict(base=PAINT * 0.80, scan='Metal032', scale=0.9, rough=(0.24, 0.36), var=0.05, nrm=0.4, wavy=0.004),
    'deck': dict(base=PAINT * 0.90, scan='Metal032', scale=1.1, rough=(0.30, 0.44), var=0.05, nrm=0.35, wavy=0.0015),
    'grip': dict(base=PAINT * 0.80, scan='Metal032', scale=1.1, rough=(0.44, 0.56), var=0.04, nrm=0.0),
    'box': dict(base=PAINT * 0.88, scan='Metal032', scale=1.3, rough=(0.34, 0.48), var=0.05, nrm=0.35, wavy=0.0015),
    'louvre': dict(base=LOUVRE, scan='Metal032', scale=3.0, rough=(0.40, 0.52), var=0.03, nrm=0.0),
    'boxlid': dict(base=PAINT * 0.92, scan='Metal032', scale=1.3, rough=(0.38, 0.52), var=0.05, nrm=0.2),
    'dark': dict(base=(0.030, 0.031, 0.033), scan='Plastic006', scale=3.0, rough=(0.80, 0.90), var=0.0, nrm=0.0),
    'railpaint': dict(base=PAINT * 0.74, scan='Metal032', scale=2.0, rough=(0.20, 0.30), var=0.04, nrm=0.3),
    'mast': dict(base=(0.66, 0.67, 0.69), scan='Metal038', scale=2.5, rough=(0.40, 0.50), var=0.04, nrm=0.25, metal=1.0),
    'steel': dict(base=(0.60, 0.60, 0.585), scan='Metal009', scale=4.0, rough=(0.20, 0.36), var=0.06, nrm=0.5, metal=1.0),
    'alu': dict(base=(0.40, 0.41, 0.42), scan='Metal038', scale=2.5, rough=(0.42, 0.60), var=0.10, nrm=1.0, metal=1.0),
    'rubber': dict(base=(0.030, 0.030, 0.032), scan='Rubber004', scale=5.0, rough=(0.46, 0.62), var=0.12, nrm=0.6),
    'black': dict(base=(0.018, 0.018, 0.020), scan='Plastic006', scale=4.0, rough=(0.36, 0.52), var=0.0, nrm=0.5),
    'white': dict(base=(0.78, 0.785, 0.775), scan='Plastic006', scale=3.0, rough=(0.24, 0.34), var=0.0, nrm=0.2),
}
# final glTF materials the engine addresses by name: (atlas, kind) -> name ('vent': the plenum behind the louvres,
# hatch gaps and holes, which src/corsair_boat.js treats as cavities; 'ventblade': the louvre blades, which get
# the sky in full and part of the sun)
FINAL = {('hull', None): 'hull', ('deck', 'grip'): 'deck_grip', ('deck', 'box'): 'enginebox', ('deck', 'boxlid'): 'enginebox', ('deck', 'louvre'): 'ventblade', ('deck', 'dark'): 'vent',
         ('deck', None): 'deck', ('gear', 'mast'): 'mast', ('gear', None): 'gear'}
# colours of the mask bake: R paint (takes water marks, salt, streaks), G non-skid (deck atlas) or the painted
# deck-edge flange (gear atlas), B rubber (gear atlas) or the inside of a vent (deck atlas; G 0.5 = a blade)
IDCOL = {'hull': (1, 0, 0), 'deck': (1, 0, 0), 'grip': (1, 1, 0), 'box': (1, 0, 0), 'boxlid': (1, 0, 0), 'louvre': (0, 0.5, 1), 'dark': (0, 0, 1), 'mast': (0.5, 0, 0), 'rubber': (0, 0, 1),
         'white': (0.5, 0, 0), 'railpaint': (1, 1, 0)}
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
ZK, BC = table(geo.zk), table(geo.bc)
YI = table(lambda x: max(geo.bg(x) - geo.RIM, 0.0))
SALT = np.array([0.60, 0.61, 0.60], np.float32)
V = lambda *a: np.array(a, np.float32)


def _flow(x, z, deg):
    """Coordinates along and across water running aft and `deg` degrees downwards on a side."""
    th = np.radians(deg)
    along = -x * np.cos(th) - z * np.sin(th)
    across = -x * np.sin(th) + z * np.cos(th)
    return along, across


def satin(P, base, rough, k_tone=1.0):
    """Painted plate is satin, not plastic: soft, long spray-gun passes and slight mottling in tone and sheen."""
    band = k.fbm(P * V(0.35, 1.0, 2.6), 1.2, 3, seed=41)
    mott = k.fbm(P, 3.5, 3, seed=42)
    base *= (1 + k_tone * (0.035 * (band - 0.5) + 0.02 * (mott - 0.5)))[..., None]
    rough += 0.06 * (band - 0.5) + 0.03 * (mott - 0.5)
    return mott


def weather_hull(P, N, ao, idm, base, rough, mask):
    """The topsides of a boat running at speed: a clean dark boot line on the chine; a wet, darker, glossy band
    whose edge is dragged aft into fingers and rivulets; scattered droplets above it; a dried salt tide line; and
    dry, slightly chalky paint high up. The planing bottom is wet all over. Masks: R water film, G droplets,
    B salt (used by the shader layer in src/corsair_boat.js)."""
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    zc, zg = ZC(x), ZG(x)
    hc = z - zc
    H = np.maximum(zg - 0.06 - zc, 0.05)
    s = hc / H                                                  # 0 at the chine, 1 under the rail
    transom = k.sstep(0.6, 0.9, -N[..., 0])
    flank = k.sstep(-0.75, -0.4, N[..., 2]) * (1 - transom)
    side = k.sstep(-0.004, 0.006, hc) * flank
    bottom = (1 - k.sstep(-0.004, 0.006, hc)) * (1 - transom)
    aft = k.sstep(2.6, -2.2, x)
    mott = satin(P, base, rough)
    n1 = k.fbm(P * V(1, 0, 0) + 7.0, 1.1, 3, seed=5)
    wl = 0.17 + 0.13 * aft + 0.06 * (n1 - 0.5)                  # top of the solid wet band (fraction of the side)
    # dry and slightly chalky high up: lighter, less saturated and flat
    dry = k.sstep(wl + 0.20, wl + 0.42, s) * side
    lum = base.mean(-1, keepdims=True)
    base *= (1 + 0.13 * dry)[..., None]
    base += (lum * 1.13 - base) * (0.45 * dry)[..., None]
    rough[:] = rough + (0.55 + 0.05 * (mott - 0.5) - rough) * (0.85 * dry)
    # lifting strakes: the down-facing ledge of each is in its own shadow and the bottom just inboard of it is
    # stained darker by the water that leaves it (two crisp dark lines converging on the stem)
    K0, bc_ = ZK(x), np.maximum(BC(x), 0.05)
    tz_ = (zc - K0)
    Lb = np.sqrt(bc_ * bc_ + tz_ * tz_)
    q = (np.abs(y) * bc_ + (z - K0) * tz_) / (Lb * Lb)            # 0 at the keel, 1 at the chine
    led = np.zeros_like(x)
    for fs in (0.36, 0.68):
        w0 = 0.036 / Lb
        band = k.sstep(fs - w0 - 0.07 / Lb, fs - w0 - 0.005 / Lb, q) * (1 - k.sstep(fs - w0 - 0.003 / Lb, fs - w0 + 0.004 / Lb, q))
        ledge = (np.abs(q - fs) < w0 * 1.15) * k.sstep(-0.94, -0.985, N[..., 2])
        led = np.maximum(led, np.maximum(0.55 * ledge, 0.16 * band))
    led *= bottom * k.sstep(3.55, 3.2, x)
    base *= (1 - led)[..., None]
    # runs: fine vertical streaking below the rail and under the side fittings
    Ps = P * V(1, 1, 0.04)
    runs = k.fbm(Ps, 38.0, 3, seed=11)
    below_rail = np.clip((zg - 0.07 - z) / 0.5, 0, 1)
    run_m = k.sstep(0.55, 0.80, runs) * side * np.exp(-below_rail * 3.0) * k.sstep(0.0, 0.03, below_rail)
    base *= (1 - 0.05 * run_m)[..., None]
    rough += 0.05 * run_m
    for bx in (0.49, -2.40):
        zt = float(geo.zg(bx)) - 0.45
        w = np.exp(-((x - bx) / 0.045) ** 2) * k.sstep(0.0, 0.03, zt - z) * np.exp(-np.clip(zt - z, 0, 1) / 0.22) * side
        base *= (1 - 0.10 * w * (0.6 + 0.8 * runs))[..., None]
        rough += 0.06 * w
    # water: a solid wet band low on the side; above it, spray-wet streaks a few centimetres wide running aft and
    # a little down (the boat's own wind and gravity), thinning out with height; fine rivulets among them
    al, ac = _flow(x, z, 9)
    # streaks 5 to 12 cm wide (5 px or more from the chase camera), crisp-edged, longest low down
    stk = k.fbm(np.stack([al * 0.55, ac * 7.0, y * 0], -1), 1.0, 4, seed=43)
    up_ = np.clip((s - wl) / 0.50, 0, 1)                           # 0 at the band, 1 at the top of the streaks
    streak = k.sstep(0.46 + 0.16 * up_, 0.485 + 0.16 * up_, stk) * (1 - k.sstep(0.80, 1.0, up_)) * (s > wl - 0.02)
    streak *= side * k.sstep(3.0, 1.2, x)
    band = (1 - k.sstep(wl - 0.006, wl + 0.006, s)) * side * k.sstep(3.25, 2.5, x)
    riv = k.sstep(0.64, 0.70, k.fbm(np.stack([al * 0.5, ac * 26.0, y * 0], -1), 1.0, 3, seed=44))
    riv *= k.sstep(wl + 0.60, wl + 0.02, s) * side * k.sstep(3.0, 1.0, x)
    n2 = k.fbm(P, 9.0, 3, seed=6)
    # transom: wet low down, water running down it in streaks from the deck edge
    tstk = k.sstep(0.55, 0.68, k.fbm(np.stack([y * 26.0, z * 0.9, x * 0], -1), 1.0, 4, seed=48))
    wet_t = transom * np.maximum(1 - k.sstep(0.02, 0.22, z + 0.10 * (n2 - 0.5)), 0.85 * tstk)
    film = np.clip(np.maximum.reduce([band, 0.92 * streak, 0.8 * riv, bottom * k.sstep(3.4, 2.7, x), wet_t]), 0, 1)
    wl_e = wl
    # boot line: a clean dark stripe 40 mm deep on the chine, always wet
    boot = k.sstep(-0.003, 0.0015, hc) * (1 - k.sstep(0.0385, 0.0415, hc)) * flank * k.sstep(3.35, 3.05, x)
    base *= (1 - 0.55 * film)[..., None]
    rough[:] = rough * (1 - 0.40 * film)
    base *= (1 - 0.80 * boot)[..., None]
    rough[:] = rough * (1 - boot) + 0.18 * boot
    # dried salt: a broken tide line above the wet line, a faint haze on the upper topsides forward
    tide = k.sstep(wl + 0.40, wl + 0.43, s) * (1 - k.sstep(wl + 0.44, wl + 0.52, s)) * side
    tide *= 0.35 + 0.65 * k.fbm(np.stack([al * 2.0, ac * 30.0, y * 0], -1), 1.0, 3, seed=45)
    haze = k.sstep(0.55, 0.8, k.fbm(P, 5.0, 3, seed=46)) * side * k.sstep(0.35, 0.9, s) * k.sstep(-0.5, 1.5, x) * 0.35
    salt = np.clip(tide + haze, 0, 1) * (1 - film) * (1 - boot)
    base[:] = base * (1 - 0.18 * salt[..., None]) + SALT * (0.18 * salt[..., None])
    rough += 0.18 * salt
    # static waterline: a thin, faintly brown line
    line = np.exp(-((z - 0.012 - 0.012 * (n2 - 0.5)) / 0.011) ** 2) * (1 - 0.6 * film)
    base *= 1 - 0.08 * line[..., None] * V(0.8, 0.95, 1.2)
    # grime where the rail and fittings shade the paint
    g = 1 - k.sstep(0.35, 0.95, ao)
    base *= (1 - 0.14 * g)[..., None]
    # droplets above the band (thrown up by the bow, carried aft), and ripples on the film
    dens = k.sstep(wl_e + 0.65, wl_e + 0.04, s) * side * (0.35 + 0.65 * k.fbm(P, 4.0, 3, seed=47)) * k.sstep(3.2, 1.8, x)
    dens = np.maximum(dens * (1 - film), 0.35 * film * (1 - bottom))
    mask[..., 0], mask[..., 1], mask[..., 2] = np.maximum(film, boot), np.clip(dens, 0, 1), salt
    return base, rough


def weather_deck(P, N, ao, idm, base, rough, mask):
    """Deck at speed: spray lands on the foredeck as droplets and streaks that run aft (the boat trims bow-up),
    water sheets across the aft well and the engine-box lid and lies in the gutters; dried salt in the gutters,
    round fittings, along the edges of the non-skid and as tide marks; a little dirt in the tightest corners."""
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    up = k.sstep(0.80, 0.96, N[..., 2])
    slope = k.sstep(0.25, 0.5, N[..., 2]) * (1 - up)
    grip = idm[..., 1]
    mott = satin(P, base, rough, 0.8)
    n1 = k.fbm(P, 1.6, 4, seed=51)
    n2 = k.fbm(P, 12.0, 3, seed=52)
    ay = np.abs(y)
    # the gutter inside the gunwale lip and the aft well behind the cowl ramp
    gut = k.sstep(-0.012, 0.004, ay - YI(x)) * (1 - k.sstep(0.050, 0.064, ay - YI(x))) * up * (z < ZG(x) - 0.005)
    well = k.sstep(-0.95, -1.15, x) * up * (z < ZG(x) + 0.02)
    lid = up * (x < -1.95) * (z > ZG(x) + 0.3)                    # engine-box lid
    # streaks running aft over the cowl top (spray that landed and was blown aft)
    flow = k.fbm(np.stack([x * 0.9, y * 24.0, z * 24.0], -1), 1.0, 4, seed=53)
    fore = k.sstep(1.0, 3.2, x)
    streak = up * k.sstep(0.70 - 0.08 * fore, 0.76 - 0.08 * fore, flow + 0.12 * (n1 - 0.5)) * k.sstep(-1.0, -0.6, x)
    streak *= k.sstep(0.35, 0.6, k.fbm(np.stack([x * 3.0, y * 9.0, z * 9.0], -1), 1.0, 3, seed=56))
    # runs down the cowl chamfers, slanting aft
    al, ac = _flow(x, z, 55)
    runs = slope * k.sstep(0.62, 0.78, k.fbm(np.stack([al * 1.5, ac * 45.0, y * 0], -1), 1.0, 3, seed=54))
    edge_x = -1.45 + 0.30 * (k.fbm(np.stack([y * 3.0, x * 0, z * 0], -1), 1.0, 3, seed=57) - 0.5) + 0.10 * (n2 - 0.5)
    sheet = well * k.sstep(edge_x + 0.10, edge_x - 0.10, x) * (0.75 + 0.25 * k.sstep(0.3, 0.6, n2))
    sheet = np.maximum(sheet, well * k.sstep(0.50, 0.62, n1))
    lidw = lid * k.sstep(0.42, 0.56, n1 + 0.15 * (n2 - 0.5))
    boxside = (x < -1.98) * (np.abs(N[..., 2]) < 0.3) * (z > ZG(x) + 0.02)
    shed = boxside * k.sstep(0.55, 0.68, k.fbm(np.stack([x * 28.0, y * 28.0, z * 0.9], -1), 1.0, 4, seed=58))
    # the lower foredeck ahead of the step takes green water and spray all the time: a thin film over most of it,
    # in sheets with crisp edges (the bow camera looks along it and sees the sky in it)
    patch = k.sstep(0.40, 0.47, k.fbm(np.stack([x * 1.4, y * 3.2, z * 1.4], -1), 1.6, 4, seed=59) + 0.12 * k.sstep(2.9, 3.4, x))
    fwet = (up + 0.6 * slope) * k.sstep(2.12, 2.30, x) * (0.55 + 0.45 * patch)
    film = np.clip(np.maximum.reduce([gut, sheet, lidw, streak, 0.8 * runs, 0.85 * shed, fwet]), 0, 1)
    thin = fwet >= np.maximum.reduce([gut, sheet, lidw, streak, 0.8 * runs, 0.85 * shed]) - 1e-4
    base *= (1 - np.where(thin, 0.10, 0.24 + 0.06 * grip) * film)[..., None]
    rough[:] = rough * (1 - 0.30 * film)
    # salt: crusts in the gutters' edges and corners, tide marks round the wet areas, round fittings, along the
    # edges of the non-skid
    rim = k.sstep(0.30, 0.52, n1 + 0.35 * k.sstep(-1.4, -3.3, x)) * (1 - k.sstep(0.40, 0.55, n1 + 0.35 * k.sstep(-1.4, -3.3, x))) * well
    cav = 1 - k.sstep(0.45, 0.92, ao)
    edge = k.sstep(0.03, 0.4, grip) * (1 - k.sstep(0.6, 0.97, grip))
    speck = k.sstep(0.62, 0.78, k.fbm(P, 30.0, 2, seed=26)) * up * k.sstep(0.35, 0.65, k.fbm(P, 1.1, 3, seed=27))
    salt = np.clip(0.7 * rim * (0.4 + 0.6 * n2) + 0.6 * cav * (0.5 + 0.5 * n2) + 0.25 * speck + 0.3 * edge, 0, 1) * (1 - film)
    base[:] = base * (1 - 0.22 * salt[..., None]) + SALT * (0.22 * salt[..., None])
    rough += 0.12 * salt * (1 - 0.6 * grip)
    g = 1 - k.sstep(0.15, 0.6, ao)
    base *= (1 - 0.22 * g)[..., None]
    # droplets: thick on the foredeck near the bow and the edges, scattered aft, on the lids and the well
    edgefac = k.sstep(0.35, 0.75, ay / np.maximum(YI(x), 0.2))
    dens = (0.45 + 0.35 * fore + 0.15 * edgefac) * (0.55 + 0.45 * k.fbm(P, 3.0, 3, seed=55)) * (up + 0.4 * slope)
    dens = np.maximum(dens * (1 - film), 0.4 * film)
    dens *= 1 - idm[..., 2]
    mask[..., 0], mask[..., 1], mask[..., 2] = film * (1 - idm[..., 2]), np.clip(dens, 0, 1), salt
    return base, rough


def weather_gear(P, N, ao, idm, base, rough, mask):
    """Mast, fittings and rub rail: rail scuffed along its face and wet on its underside, salt on upward faces,
    shadowed joints."""
    paint, rubber = idm[..., 0], idm[..., 2]
    up = k.sstep(0.5, 0.95, N[..., 2])
    n2 = k.fbm(P, 16.0, 3, seed=31)
    scuff = k.sstep(0.55, 0.78, k.fbm(P * V(0.04, 1, 1), 26.0, 3, seed=32)) * rubber * (1 - up)
    base[:] = base * (1 - 0.35 * scuff[..., None]) + np.float32(0.09) * (0.35 * scuff[..., None])
    rough += 0.08 * scuff
    low = rubber * k.sstep(-0.1, -0.5, N[..., 2]) * (P[..., 2] < ZG(P[..., 0]))
    base *= (1 - 0.25 * low)[..., None]
    rough[:] = rough * (1 - 0.8 * low) + 0.12 * 0.8 * low
    salt = k.sstep(0.50, 0.82, k.fbm(P, 7.0, 3, seed=33)) * up * (0.4 * paint + 0.6 * rubber) * (0.5 + 0.5 * n2)
    base[:] = base * (1 - 0.10 * salt[..., None]) + SALT * (0.10 * salt[..., None])
    rough += 0.12 * salt
    # the painted deck-edge flange: its underside is a thin dark shadow line against the topside; the outer face
    # is wet and a little glossier than the topside
    rail = k.sstep(0.25, 0.75, idm[..., 1]) * paint
    under = rail * k.sstep(-0.15, -0.55, N[..., 2])
    base *= (1 - 0.70 * under)[..., None]
    rough[:] = rough * (1 - 0.25 * rail * (1 - under))
    g = 1 - k.sstep(0.25, 0.8, ao)
    base *= (1 - 0.25 * g * np.clip(paint + rubber, 0, 1))[..., None]
    return base, rough


WEATHER = {'hull': weather_hull, 'deck': weather_deck, 'gear': weather_gear}


def drops_detail(path, size=1024, tile=0.25, seed=7):
    """Tiling water droplets for the shader layer (src/corsair_boat.js), `tile` metres a side: RG = normal xy,
    B = cap height, A = a random number per drop (a drop shows where it is below the droplet-density mask, so
    one texture serves sparse and dense spray). Spherical caps with a 65 degree contact angle; sizes follow a
    long-tailed distribution from 0.3 mm to 3.5 mm radius."""
    from PIL import Image
    rng = np.random.default_rng(seed)
    px = tile / size
    hgt = np.zeros((size, size), np.float32)
    ids = np.ones((size, size), np.float32)
    th = np.radians(65)
    cover, target = 0.0, 0.30 * size * size
    while cover < target:
        r_mm = float(np.clip(0.26 * np.exp(rng.exponential(0.78)), 0.3, 3.0))
        r = r_mm / 1000 / px
        Rs = r / np.sin(th)
        cx, cy = rng.uniform(0, size, 2)
        ex = 1.0 + 0.25 * rng.random()                           # a little elongated, any direction
        ang = rng.uniform(0, np.pi)
        rr = int(np.ceil(r * ex)) + 2
        xs = np.arange(int(cx) - rr, int(cx) + rr + 1)
        ys = np.arange(int(cy) - rr, int(cy) + rr + 1)
        X, Y = np.meshgrid(xs + 0.5 - cx, ys + 0.5 - cy)
        u = (X * np.cos(ang) + Y * np.sin(ang)) / ex
        v = -X * np.sin(ang) + Y * np.cos(ang)
        d2 = u * u + v * v
        h = np.sqrt(np.maximum(Rs * Rs - d2, 0)) - Rs * np.cos(th)
        h = np.where(d2 < r * r, h, 0.0).astype(np.float32)
        iy, ix = np.ix_(ys % size, xs % size)
        sub = hgt[iy, ix]
        win = h > sub
        if win.any():
            hgt[iy, ix] = np.where(win, h, sub)
            ids[iy, ix] = np.where(win, rng.random(), ids[iy, ix])
        cover += np.pi * r * r
    gy, gx = np.gradient(np.pad(hgt, 1, mode='wrap'))
    gx, gy = gx[1:-1, 1:-1], gy[1:-1, 1:-1]
    nz = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    nx, ny = -gx * nz, -gy * nz
    out = np.zeros((size, size, 4), np.float32)
    out[..., 0], out[..., 1] = 0.5 + 0.5 * nx, 0.5 - 0.5 * ny        # rows run down the image: +v is up
    out[..., 2] = np.clip(hgt / max(hgt.max(), 1e-6) * 2.2, 0, 1)
    out[..., 3] = ids
    a = (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(a, 'RGBA').save(path, 'WEBP', lossless=True, quality=100, method=6)
    d.log('drops', path, f'{os.path.getsize(path) / 1e3:.0f} kB')
    return path


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
