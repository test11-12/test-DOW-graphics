# Anduril YFQ-44A "Fury" (launch aircraft, tail AI / 1003) -> assets/fury/fury.glb
#   node tools/blender.mjs fury            build, bake, paint, export
#   node tools/blender.mjs fury geo        geometry, UVs and the baked position / normal / occlusion maps only
#   node tools/blender.mjs fury paint      repaint and export from the cached geometry (no Cycles)
#   node tools/blender.mjs fury paint B    repaint only texture set B (A body, B wings and launchers, C gear and details)
#   node tools/blender.mjs fury shape      untextured export for checking the silhouette
# Geometry: fury_geo.py. Paint: drawn in metres in side elevation and plan from the released photographs
# (lib/acpaint.py) and projected onto the skin. Markings are only those the photographs show.
import gc
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, HERE)
import bpy
import numpy as np

import dowlib as d
import acpaint as ap
import fury_geo as G
from acpaint import Canvas, smoothstep, lerp
from fury_geo import X0, CH, PID, WING, STAB, RAIL_Z, RAIL_Y, RAIL_S0, RAIL_S1

OUT = d.bake_dir('fury_ac')
BLEND = os.path.join(OUT, 'fury_geo.blend')
SIZE = {'A': 4096, 'B': 4096, 'C': 2048}
UVK = {'rail': 1.3, 'railhw': 1.3, 'pipe': 0.55, 'cone': 0.5, 'duct': 0.4, 'dark': 0.5, 'tyre': 0.8}
ARGS = d.args()


# ================================================================ geometry -> objects, UVs, baked maps
def build(shape_only=False):
    d.reset()
    parts = []

    def part(name, mesh, pid, tset, mirror=False, bevel=None, smooth=35.0):
        ob = ap.to_object(mesh, name, PID[pid], smooth, bevel)
        if pid in UVK:
            ap.scale_uv(ob, UVK[pid])
        parts.append((ob, tset, mirror))
        return ob

    fus = part('fuselage', G.fuselage(), 'fus', 'A', smooth=38)
    part('blister', G.blister(), 'blister', 'A')
    part('spine', G.spine(), 'spine', 'A')
    body, lip, duct, splitter = G.box_parts()
    part('box', body, 'box', 'A', bevel=(0.014, 3, 22), smooth=30)
    part('lip', lip, 'lip', 'A', bevel=(0.006, 2, 30), smooth=30)
    part('duct', duct, 'duct', 'A', smooth=60)
    part('splitter', splitter, 'splitter', 'A', bevel=(0.004, 2), smooth=30)
    part('fin', G.fin_mesh(), 'fin', 'A', smooth=50)
    wing = part('wing', G.wing_mesh(), 'wing', 'B', mirror=True, smooth=50)
    part('stab', G.stab_mesh(), 'stab', 'B', mirror=True, smooth=50)
    shroud, pipe, cone = G.nozzle_parts()
    part('shroud', shroud, 'shroud', 'C', smooth=50)
    part('pipe', pipe, 'pipe', 'C', smooth=60)
    part('cone', cone, 'cone', 'C', smooth=40)
    beam, beam_aft, hw, pylon = G.launcher_parts()
    part('rail', beam, 'rail', 'B', mirror=True, bevel=(0.004, 2, 25), smooth=30)
    part('rail_aft', beam_aft, 'rail', 'B', mirror=True, bevel=(0.004, 2, 25), smooth=30)
    part('railhw', hw, 'railhw', 'B', mirror=True, bevel=(0.0015, 1), smooth=30)
    part('pylon', pylon, 'pylon', 'B', mirror=True, smooth=50)
    ac, aside, pivots = G.antenna_parts()
    blades = part('blades', ac, 'blade', 'C', bevel=(0.002, 2), smooth=30)
    part('probes', aside, 'probe', 'C', mirror=True, smooth=50)
    part('pivots', pivots, 'pylon', 'C', smooth=50)
    for k, pid in (('red', 'lens_r'), ('green', 'lens_g'), ('tail', 'lens_w')):
        part('lens_' + k, G.lens(G.NAV[k], 0.016), pid, 'C', smooth=80)
    gear = G.gear_parts()
    bev = {'door': (0.003, 2), 'doorin': (0.002, 1), 'strut': None, 'tyre': None, 'bay': (0.0015, 1)}
    for k, (mc, mr) in gear.items():
        if mc.f:
            part('gear_' + k, mc, k, 'G', bevel=bev.get(k), smooth=42 if k not in ('door', 'doorin') else 30)
        if mr.f:
            part('gearR_' + k, mr, k, 'G', mirror=True, bevel=bev.get(k), smooth=42 if k not in ('door', 'doorin') else 30)
    for o, _, _ in parts:
        d.log(d.stats(o))

    sc = bpy.context.scene
    if not shape_only:
        for tex, sets in (('A', 'A'), ('B', 'B'), ('C', 'CG')):
            objs = [o for o, t, _ in parts if t in sets]
            ap.pack(objs, 0.0025 if tex != 'C' else 0.004)
            ref = {'A': fus, 'B': wing, 'C': blades}[tex]
            sc['texel_' + tex] = ap.texel_size(ref, SIZE[tex])
            d.log(f'texture {tex}: {SIZE[tex]} px, {sc["texel_" + tex] * 1000:.2f} mm per texel')
    # one object per (set, mirrored?) and the port copies of the mirrored ones
    groups = {}
    for o, t, m in parts:
        groups.setdefault((t, m), []).append(o)
    objs = {}
    for (t, m), lst in groups.items():
        objs[t + ('_R' if m else '')] = ap.join(lst, t + ('_R' if m else ''))
    for t in ('B', 'C', 'G'):
        objs[t + '_L'] = ap.mirrored_copy(objs[t + '_R'], t + '_L')
    if shape_only:
        return objs
    d.ensure_world()
    for tex, names in (('A', ['A']), ('B', ['B_R']), ('C', ['C', 'C_R', 'G', 'G_R'])):
        ap.bake_maps([objs[n] for n in names], SIZE[tex], tex, OUT, ao_size=SIZE[tex] // 2 if tex != 'C' else SIZE[tex], ao_samples=24, ao_distance=1.0)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    return objs


# ================================================================ livery, drawn in metres
# Tones measured on the take-off photograph of 1003 against its own sunlit base grey: the splinter patches about 0.6
# of the base (sRGB), the starboard face of the fin about 0.63; the lower fuselage below the chine aft of the wing
# root and the keel box read near-black there, a darker grey that the low sun leaves in shade.
BODY, DARK, PALE, MID = (112, 120, 130), (57, 63, 73), (124, 132, 141), (92, 100, 110)
LOW, FIN_S = (112, 120, 130), (72, 79, 88)     # undersides of the wings and stabilators; the darker starboard face of the fin
KEEL, LOWAFT = (90, 97, 106), (64, 70, 78)     # keel box sides; lower aft fuselage below the chine
NOSE_Y = 0.06                              # side-view heights were read from the nose tip, which droops below the wing plane
INK, DKINK = (214, 219, 222), (36, 40, 45)
PPM_S, PPM_W = 700, 1000
SV = (-0.1, 10.3, -0.95, 1.95)          # side view window: s0, s1, y0, y1
WV = (4.2, 10.3, 0.0, 3.45)             # plan view window: s0, s1, |z|0, |z|1
# lower edge of the darker upper colour along the flank (s, y), read off the launch photograph
SPLINTER = [(2.80, 0.50), (2.88, 0.42), (3.08, 0.42), (3.17, 0.31), (3.45, 0.31), (3.56, 0.42), (4.03, 0.43), (4.12, 0.32), (5.00, 0.32),
            (5.15, 0.185), (6.37, 0.185), (6.52, 0.36), (7.08, 0.37), (7.12, 0.355), (7.75, 0.355), (8.18, 0.48)]
FRAMES = [0.62, 1.55, 2.60, 3.40, 4.40, 5.20, 6.00, 6.80, 7.60, 8.30, 9.00, 9.55]
FIN_RIBS = [0.62, 0.98, 1.36, 1.765]
WING_RIBS = [0.95, 1.45, 1.85, 2.40, 2.95]
WING_SPARS = [0.10, 0.42, 0.72]
STAB_RIBS = [0.60, 1.00, 1.40]


def side_canvas(flip=False, ss=2):
    return Canvas(SV[0], SV[1], SV[2], SV[3], PPM_S, ss, 0, flip)


def plan_canvas(ss=2):
    return Canvas(WV[0], WV[1], WV[2], WV[3], PPM_W, ss, 0, False)


def fin_pt(yy, c):
    return (G.fin_le(yy) + (G.fin_te(yy) - G.fin_le(yy)) * c, yy)


def wing_pt(z, c):
    return (G.wing_le(z) + (G.wing_te(z) - G.wing_le(z)) * c, z)


def stab_pt(z, c):
    return (G.stab_le(z) + (G.stab_te(z) - G.stab_le(z)) * c, z)


def usaf_symbol(c, cx, cy, s):
    """The low-visibility wing-and-star emblem, width s metres."""
    v = 190
    for m in (1, -1):
        c.poly([(cx + m * 0.05 * s, cy + 0.08 * s), (cx + m * 0.50 * s, cy + 0.44 * s), (cx + m * 0.455 * s, cy + 0.20 * s), (cx + m * 0.115 * s, cy - 0.045 * s)], v)
        c.poly([(cx + m * 0.135 * s, cy - 0.085 * s), (cx + m * 0.43 * s, cy + 0.125 * s), (cx + m * 0.385 * s, cy - 0.045 * s), (cx + m * 0.155 * s, cy - 0.20 * s)], v)
        c.poly([(cx + m * 0.085 * s, cy + 0.185 * s), (cx + m * 0.30 * s, cy + 0.355 * s), (cx + m * 0.275 * s, cy + 0.385 * s), (cx + m * 0.062 * s, cy + 0.215 * s)], 0)
    c.poly([(cx, cy + 0.115 * s), (cx + 0.095 * s, cy - 0.02 * s), (cx, cy - 0.125 * s), (cx - 0.095 * s, cy - 0.02 * s)], v)
    c.dot(cx, cy - 0.29 * s, 0.10 * s, v)


def side_layers():
    """Layers of the side elevation, as samplers over (s, y)."""
    L = {}
    # ---- tones
    c = side_canvas()
    c.poly([(SPLINTER[0][0], 1.2)] + SPLINTER + [(SPLINTER[-1][0], 1.2)])
    ys = np.linspace(G.FIN_BASE - 0.1, G.FIN_TOP + 0.02, 24)
    c.poly([(G.fin_le(v) - 0.05, v) for v in ys] + [(G.fin_le(v) + 0.115, v) for v in ys[::-1]])                # fin leading-edge strip
    c.poly([fin_pt(G.FIN_TOP - 0.07, -0.2), fin_pt(G.FIN_TOP - 0.07, 1.2), fin_pt(G.FIN_TOP + 0.05, 1.2), fin_pt(G.FIN_TOP + 0.05, -0.2)])   # fin cap
    L['dark'] = c.sampler()
    c = side_canvas()
    gill = [(7.42, -0.175), (7.53, -0.065), (8.42, -0.065), (8.42, -0.175)]
    c.poly(gill)
    L['mid'] = c.sampler()
    # ---- pale markings common to both flanks
    def common(c):
        usaf_symbol(c, 7.205, 0.070, 0.24)
        c.line([(9.495, 0.262), (9.615, 0.262), (9.555, 0.158)], 0.009, closed=True)                         # warning triangle, outline
        # fin badge: a shield with a chevron, as far as the photographs resolve it
        bx, by = fin_pt(1.435, 0.30)
        sh = [(bx - 0.070, by + 0.085), (bx + 0.070, by + 0.085), (bx + 0.070, by - 0.010), (bx + 0.045, by - 0.060), (bx, by - 0.090), (bx - 0.045, by - 0.060), (bx - 0.070, by - 0.010)]
        c.line(sh, 0.0055, 185, closed=True)
        c.poly([(bx - 0.040, by + 0.048), (bx - 0.020, by + 0.048), (bx, by - 0.012), (bx + 0.020, by + 0.048), (bx + 0.040, by + 0.048), (bx + 0.010, by - 0.050), (bx - 0.010, by - 0.050)], 170)

    def lettering(c, port):
        v = 255; q = 1 if port else -1
        for k in range(4):      # forward gills: four slashes above the wing root, raked the same way in either view
            x = 4.625 + (k - 1.5) * 0.066 * q
            c.poly([(x - 0.040 * q, 0.045), (x - 0.010 * q, 0.045), (x + 0.040 * q, 0.125), (x + 0.010 * q, 0.125)], 215)
        for k in range(4):      # aft gills, on their panel
            x = 7.965 + (k - 1.5) * 0.070 * q
            c.poly([(x - 0.038 * q, -0.158), (x - 0.006 * q, -0.158), (x + 0.038 * q, -0.092), (x + 0.006 * q, -0.092)], 215)
        # designation and its small legend, inside the dark panel (reads nose-to-tail on the port side)
        x = 5.28 if port else 6.34
        wdt = c.text('YFQ-44A', x, 0.245, 0.128, (700, True), v, 'ls')
        lx = (x + wdt + 0.07) if port else (x - wdt - 0.07)
        for i, t in enumerate(('Anduril Industries', 'Collaborative', 'Combat', 'Aircraft')):
            c.text(t, lx, 0.345 - i * 0.031, 0.0165, (500, False), 200, 'ls')
        # maker's name and mark behind the sensor window
        x = 3.00 if port else 3.50
        tri = lambda xa: [(xa, 0.052), (xa + (0.034 if port else -0.034), 0.118), (xa + (0.068 if port else -0.068), 0.052)]
        c.line(tri(x), 0.008); a = tri(x)
        c.line([((a[0][0] + a[1][0]) / 2 + (0.006 if port else -0.006), 0.052), (a[1][0], 0.086), ((a[2][0] + a[1][0]) / 2 - (0.006 if port else -0.006), 0.052)], 0.007)
        c.text('ANDURIL', x + (0.095 if port else -0.095), 0.055, 0.055, (600, False), v, 'ls', tracking=0.06)
        c.text('U.S. AIR FORCE', 6.30 if port else 7.27, -0.352, 0.074, (600, False), 170, 'ls', tracking=0.10)
        # fin: tail code, serial
        ax, ay = fin_pt(1.01, 0.39)
        c.text('AI', ax, 0.905, 0.215, (600, False), v, 'ms', tracking=0.05)
        sx, sy = fin_pt(0.725, 0.47)
        w4 = c.text('1003', sx, 0.668, 0.112, (600, False), v, 'ms', tracking=0.04)
        ex = sx - (w4 / 2 + 0.045) * (1 if port else -1)
        c.text('AF', ex, 0.735, 0.036, (600, False), v, 'ms')
        c.text('25', ex, 0.676, 0.036, (600, False), v, 'ms')

    for port in (True, False):
        c = side_canvas(flip=not port)
        common(c); lettering(c, port)
        L['inkP' if port else 'inkS'] = c.sampler()
    # ---- dark features
    c = side_canvas()
    c.poly([(2.60, 0.000), (2.80, 0.000), (2.88, 0.130), (2.68, 0.130)])                  # sensor window
    c.rect(2.05, -0.076, 2.40, -0.062)                                                    # slot
    c.poly([(1.70, 0.150), (1.86, 0.150), (1.80, 0.215)])                                 # small window on the nose
    hx, hy = 8.95, 0.19
    c.poly([(hx - 0.125, hy), (hx - 0.075, hy + 0.062), (hx + 0.075, hy + 0.062), (hx + 0.125, hy), (hx + 0.075, hy - 0.062), (hx - 0.075, hy - 0.062)])
    L['dk'] = c.sampler()
    # ---- panel breaks (grooves) and fasteners
    c = side_canvas(); r = side_canvas()
    gw = 0.0028

    def panel(x0, y0, x1, y1, rad=0.03, riv=True):
        c.rrect(x0, y0, x1, y1, rad, gw)
        if riv:
            e = 0.022
            for a, b in (((x0 + rad, y0 + e), (x1 - rad, y0 + e)), ((x0 + rad, y1 - e), (x1 - rad, y1 - e)), ((x0 + e, y0 + rad), (x0 + e, y1 - rad)), ((x1 - e, y0 + rad), (x1 - e, y1 - rad))):
                r.dots(a, b, 0.045, 0.0032)
    c.line([(0.62, 0.03), (2.60, 0.095)], gw); c.line([(2.60, -0.095), (7.60, -0.095)], gw); c.line([(3.40, 0.40), (8.30, 0.40)], gw)
    c.line([(7.60, -0.095), (8.30, 0.02), (9.55, 0.12)], gw)
    for x0, y0, x1, y1 in ((3.62, -0.07, 4.30, 0.13), (6.60, -0.07, 7.00, 0.13), (7.66, 0.02, 8.16, 0.22), (8.38, 0.03, 8.72, 0.21), (9.14, 0.05, 9.43, 0.20),
                           (5.30, 0.42, 5.90, 0.47), (1.05, 0.02, 1.42, 0.12)):
        panel(x0, y0, x1, y1)
    c.line([(1.58, 0.105), (1.66, 0.245), (1.90, 0.245), (1.98, 0.105)], gw, closed=True)                    # panel round the nose window
    c.line([(hx - 0.14, hy), (hx - 0.083, hy + 0.072), (hx + 0.083, hy + 0.072), (hx + 0.14, hy), (hx + 0.083, hy - 0.072), (hx - 0.083, hy - 0.072)], gw, closed=True)
    c.line([(2.585, -0.012), (2.795, -0.012), (2.895, 0.142), (2.685, 0.142)], gw, closed=True)
    c.rrect(5.18, -0.615, 6.36, -0.275, 0.02, 0.0045); r.dots((5.24, -0.30), (6.30, -0.30), 0.06, 0.0035)   # main-gear door in the keel side
    c.line([(3.05, -0.44), (7.2, -0.44)], gw)
    # fin: rudder hinge and cut, ribs, spar
    c.line([fin_pt(0.36, 0.72), fin_pt(1.765, 0.72)], 0.0048); c.line([fin_pt(1.765, 0.72), fin_pt(1.765, 1.02)], 0.0048); c.line([fin_pt(0.36, 0.72), fin_pt(0.36, 1.02)], 0.0048)
    for yy in FIN_RIBS:
        c.line([fin_pt(yy, 0.09), fin_pt(yy, 0.72)], gw)
        r.dots(fin_pt(yy + 0.018, 0.12), fin_pt(yy + 0.018, 0.70), 0.05, 0.003)
    c.line([fin_pt(0.40, 0.40), fin_pt(1.765, 0.40)], gw)
    r.dots(fin_pt(0.40, 0.69), fin_pt(1.74, 0.69), 0.045, 0.0032); r.dots(fin_pt(0.40, 0.745), fin_pt(1.74, 0.745), 0.045, 0.0032)
    L['line'] = c.sampler(); L['riv'] = r.sampler()
    c.blur(0.010); L['seal'] = c.sampler()
    return L


def plan_layers():
    """Plan-view layers over (s, |z|): upper and lower surfaces of the wings and stabilators, the deck and belly."""
    L = {}
    wz0, wz1 = WING['z0'] - 0.1, WING['z1'] + 0.05
    sz0, sz1 = STAB['z0'] - 0.1, STAB['z1'] + 0.05
    for surf in ('top', 'bot'):
        c = plan_canvas()
        # leading-edge strips and tips, both surfaces
        c.poly([(G.wing_le(wz0) - 0.05, wz0), (G.wing_le(wz1) - 0.05, wz1), (G.wing_le(wz1) + 0.13, wz1), (G.wing_le(wz0) + 0.13, wz0)])
        c.poly([(4.0, WING['z1'] - 0.20), (9.0, WING['z1'] - 0.20), (9.0, wz1), (4.0, wz1)])
        c.poly([(G.stab_le(sz0) - 0.05, sz0), (G.stab_le(sz1) - 0.05, sz1), (G.stab_le(sz1) + 0.11, sz1), (G.stab_le(sz0) + 0.11, sz0)])
        c.poly([(8.5, STAB['z1'] - 0.085), (10.3, STAB['z1'] - 0.085), (10.3, sz1), (8.5, sz1)])
        if surf == 'top':   # the darker angular patches on the upper surfaces
            c.poly([wing_pt(0.95, 0.30), wing_pt(1.55, 0.30), wing_pt(1.72, 0.22), wing_pt(2.50, 0.22), wing_pt(2.92, 0.37), wing_pt(2.45, 0.50), wing_pt(1.80, 0.50), wing_pt(1.62, 0.60), wing_pt(0.95, 0.60)])
            c.poly([stab_pt(0.62, 0.36), stab_pt(0.86, 0.25), stab_pt(1.36, 0.25), stab_pt(1.52, 0.44), stab_pt(1.10, 0.68), stab_pt(0.62, 0.68)])
        L[surf + '_dark'] = c.sampler()
        c = plan_canvas(); r = plan_canvas(); gw = 0.0024
        for z in WING_RIBS:
            c.line([wing_pt(z, 0.0), wing_pt(z, 1.0 if z in (0.95, 2.95) else 0.72)], gw)
            r.dots(wing_pt(z + 0.016, 0.19), wing_pt(z + 0.016, 0.70), 0.05, 0.0028)
        for f in WING_SPARS[:2]:
            c.line([wing_pt(WING['z0'], f), wing_pt(WING['z1'] - 0.20, f)], gw)
            r.dots(wing_pt(WING['z0'] + 0.05, f + 0.012), wing_pt(WING['z1'] - 0.23, f + 0.012), 0.05, 0.0028)
        c.line([wing_pt(0.95, 0.72), wing_pt(2.95, 0.72)], 0.0055)                                             # flaperon hinge and end cuts
        for z in (0.95, 2.95):
            c.line([wing_pt(z, 0.72), wing_pt(z, 1.02)], 0.0055)
        c.line([wing_pt(WING['z0'], 0.72), wing_pt(0.95, 0.72)], gw); c.line([wing_pt(2.95, 0.72), wing_pt(WING['z1'] - 0.20, 0.72)], gw)
        c.line([(4.0, WING['z1'] - 0.20), (9.0, WING['z1'] - 0.20)], gw)
        r.dots(wing_pt(0.99, 0.695), wing_pt(2.91, 0.695), 0.045, 0.003)
        for z in STAB_RIBS:
            c.line([stab_pt(z, 0.0), stab_pt(z, 1.0)], gw); r.dots(stab_pt(z + 0.014, 0.12), stab_pt(z + 0.014, 0.92), 0.05, 0.0028)
        for f in (0.15, 0.55):
            c.line([stab_pt(STAB['z0'], f), stab_pt(STAB['z1'] - 0.085, f)], gw)
        c.line([(8.5, STAB['z1'] - 0.085), (10.3, STAB['z1'] - 0.085)], gw)
        if surf == 'top':
            for (za, zb, fa, fb) in ((1.05, 1.38, 0.47, 0.64), (2.02, 2.32, 0.24, 0.38)):
                p = [wing_pt(za, fa), wing_pt(zb, fa), wing_pt(zb, fb), wing_pt(za, fb)]
                c.line(p, gw, closed=True)
        else:
            for (za, zb, fa, fb) in ((0.98, 1.36, 0.22, 0.40), (2.05, 2.36, 0.46, 0.66), (2.50, 2.86, 0.22, 0.38), (1.50, 1.74, 0.46, 0.68)):
                p = [wing_pt(za, fa), wing_pt(zb, fa), wing_pt(zb, fb), wing_pt(za, fb)]
                c.line(p, gw, closed=True)
                for i in range(4):
                    a, b = p[i], p[(i + 1) % 4]; mx, my = sum(q[0] for q in p) / 4, sum(q[1] for q in p) / 4
                    ins = lambda q: (q[0] + (mx - q[0]) * 0.07, q[1] + (my - q[1]) * 0.07)
                    r.dots(ins(a), ins(b), 0.05, 0.0028, ends=False)
            c.rrect(5.40, RAIL_Z - 0.085, 7.02, RAIL_Z + 0.085, 0.03, 0.003)                                  # pylon mounting plate
            r.dots((5.46, RAIL_Z - 0.065), (6.96, RAIL_Z - 0.065), 0.075, 0.0034); r.dots((5.46, RAIL_Z + 0.065), (6.96, RAIL_Z + 0.065), 0.075, 0.0034)
            # belly: nose-gear doors, keel seam
            c.rrect(3.20, 0.0, 4.04, 0.105, 0.01, 0.0045); c.line([(4.04, 0.0), (8.0, 0.0)], 0.004)
        L[surf + '_line'] = c.sampler(); L[surf + '_riv'] = r.sampler()
        c.blur(0.009); L[surf + '_seal'] = c.sampler()
    return L


_SHEEN = []


def sheen(P, N):
    """Sheen break-up from a photoscanned painted panel (ambientCG PaintedMetal001 roughness, CC0)."""
    if not _SHEEN:
        _SHEEN.append(ap.Triplanar(d.ambientcg_texture('PaintedMetal001', '2K')['Roughness'], 1.6))
    return _SHEEN[0](P, N)


def lin(c):
    return ap.srgb(c)


def tone(col, target, w):
    return col + (lin(target) - col) * w[..., None]


def finish(col, rough, metal, H, M, texel, uvk_of=None):
    """Common last steps: occlusion grime, the normal map from the height field."""
    ID, AO = M['ID'], M['AO']
    occ = np.clip(1 - AO, 0, 1)
    col = col * (1 - 0.22 * occ ** 1.5)[..., None]
    rough = np.clip(rough + 0.06 * occ, 0.04, 1.0)
    tm = np.full(ID.shape, texel, np.float32)
    if uvk_of:
        for pid, k in uvk_of.items():
            tm[ID == pid] = texel / k
    nrm = ap.normal_from_height(H, tm, ID)
    return col, rough, metal, np.clip(AO * 1.0, 0, 1), nrm


def paint_body(M, texel, S, T):
    P, N, ID = M['P'], M['N'], M['ID']
    s = X0 - P[..., 0]; y = P[..., 1]; z = P[..., 2]; az = np.abs(z); port = z < 0
    ny = N[..., 1]; nz = np.abs(N[..., 2])
    fus = (ID == 1) | (ID == 2) | (ID == 3); fin = ID == 8; box = (ID == 4) | (ID == 5) | (ID == 7); duct = ID == 6
    sidew = smoothstep(0.30, 0.55, nz); topw = smoothstep(0.45, 0.70, ny) * (fus | box); botw = smoothstep(0.45, 0.70, -ny) * (fus | box)
    sidew = np.where(fin, 1.0, sidew).astype(np.float32)
    yoff = G._F['y'](s).astype(np.float32)
    ym = y; y = np.where(fin, ym, ym + NOSE_Y).astype(np.float32)
    # ---- tones
    dark = S['dark'](s, y) * (((ID == 1) | (ID == 3)) | fin)
    under = ((ID == 1) & (ym < CH + yoff - 0.004)).astype(np.float32)
    aftw = smoothstep(4.85, 5.45, s).astype(np.float32)
    low = np.where(box, 1.0, under).astype(np.float32)
    mid = S['mid'](s, y) * sidew * ((ID == 1) | (ID == 4))
    col = np.broadcast_to(lin(BODY), P.shape).copy()
    col = tone(col, PALE, (fin & port).astype(np.float32)); col = tone(col, FIN_S, (fin & ~port).astype(np.float32))
    col = tone(col, LOW, under * (1 - aftw)); col = tone(col, LOWAFT, under * aftw); col = tone(col, KEEL, box.astype(np.float32))
    col = tone(col, MID, mid); col = tone(col, DARK, dark)
    rough = 0.56 + 0.02 * low - 0.04 * dark
    # ---- per-panel tone and sheen, paint mottle
    band = np.digitize(y, [-0.095, 0.40]) + 24 * (ym < CH + yoff - 0.004) + 3 * port + 6 * (ny > 0.75) + 12 * (ny < -0.6)
    tA = ap.cell_tint([s, band.astype(np.float32)], [FRAMES, np.arange(0.5, 24, 1.0)], 3)
    tB = ap.cell_tint([s, band.astype(np.float32)], [FRAMES, np.arange(0.5, 24, 1.0)], 11)
    finc = (s - G.fin_le(ym)) / np.maximum(G.fin_te(ym) - G.fin_le(ym), 0.1)
    tF = ap.cell_tint([y, finc, port.astype(np.float32)], [FIN_RIBS, [0.09, 0.40, 0.72], [0.5]], 5)
    tA = np.where(fin, tF, tA)
    n1 = ap.noise3(P, 0.9, 1, 2); n2 = ap.noise3(P, 0.11, 2, 2); n3 = ap.noise3(P, 0.025, 3, 1)
    sh = sheen(P, N)
    col = col * (1 + 0.030 * tA + 0.028 * n1 + 0.014 * n2 + 0.006 * n3 - 0.05 * sh)[..., None]
    rough = rough + 0.035 * tB + 0.03 * n1 - 0.02 * n2 + 0.22 * sh
    # ---- markings
    ink = np.where(port, S['inkP'](s, y), S['inkS'](s, y)) * sidew * (fus | fin | (ID == 4))
    dkl = (y < -0.27).astype(np.float32)           # the lettering low on the aft fuselage is darker than its paint
    col = tone(col, INK, 0.93 * ink * (1 - dkl)); col = tone(col, DKINK, 0.75 * ink * dkl); rough = rough - 0.07 * ink
    dk = S['dk'](s, y) * sidew * ((ID == 1) | (ID == 4))
    col = tone(col, DKINK, dk); rough = rough - 0.16 * dk
    # ---- panel breaks, fasteners, sealant
    fr = np.min(np.abs(s[..., None] - np.asarray(FRAMES, np.float32)), -1)
    frame = ap.groove(fr, 0.0022) * (fus | box) * (s < 9.6)
    sealf = np.exp(-(fr / 0.012) ** 2) * (fus | box)
    g = np.maximum(frame, np.maximum(S['line'](s, y) * sidew, T['top_line'](s, az) * topw * 0 + T['bot_line'](s, az) * botw))
    rv = S['riv'](s, y) * sidew
    seal = np.maximum(sealf * 0.8, S['seal'](s, y) * sidew * 2.2); seal = np.clip(seal, 0, 1) * (1 - g)
    radome = (s < 0.62) & fus
    col = col * (1 - 0.035 * radome)[..., None]; rough = rough - 0.05 * radome
    col = col * (1 - 0.5 * g - 0.10 * rv + 0.022 * seal)[..., None]
    rough = rough + 0.14 * g - 0.04 * rv - 0.055 * seal
    H = -0.0006 * g - 0.00018 * rv + 0.00010 * seal + 0.00006 * ink
    # ---- exhaust: heat-darkened paint round the nozzle, the duct
    hot = smoothstep(9.45, 9.86, s) * fus
    col = col * (1 - 0.45 * hot)[..., None]; rough = rough - 0.08 * hot
    col = np.where(duct[..., None], lin((9, 10, 11)), col); rough = np.where(duct, 0.8, rough)
    metal = np.zeros_like(rough)
    return finish(col, rough, metal, H, M, texel)


def paint_wings(M, texel, S, T):
    P, N, ID = M['P'], M['N'], M['ID']
    s = X0 - P[..., 0]; z = np.abs(P[..., 2]); ny = N[..., 1]
    up = ny >= 0
    wing = ID == 10
    pick = lambda k: np.where(up, T['top_' + k](s, z), T['bot_' + k](s, z))
    dark = pick('dark')
    ws = wing | (ID == 11)
    dark = dark * ws
    col = np.broadcast_to(lin(PALE), P.shape).copy(); col = tone(col, LOW, (~up).astype(np.float32)); col = tone(col, DARK, dark)
    rough = 0.60 - 0.04 * dark
    cw = (s - G.wing_le(z)) / np.maximum(G.wing_te(z) - G.wing_le(z), 0.1); cs = (s - G.stab_le(z)) / np.maximum(G.stab_te(z) - G.stab_le(z), 0.1)
    tW = ap.cell_tint([z, cw, up.astype(np.float32)], [WING_RIBS, WING_SPARS, [0.5]], 21)
    tS = ap.cell_tint([z, cs, up.astype(np.float32)], [STAB_RIBS, [0.15, 0.55], [0.5]], 22)
    tR = ap.cell_tint([z, np.where(wing, cw, cs), up.astype(np.float32)], [WING_RIBS, WING_SPARS, [0.5]], 23)
    tA = np.where(wing, tW, tS)
    n1 = ap.noise3(P, 0.8, 4, 2); n2 = ap.noise3(P, 0.10, 5, 2); n3 = ap.noise3(P, 0.02, 6, 1)
    sh = sheen(P, N)
    col = col * (1 + 0.026 * tA + 0.026 * n1 + 0.013 * n2 + 0.006 * n3 - 0.05 * sh)[..., None]
    rough = rough + 0.035 * tR + 0.03 * n1 - 0.02 * n2 + 0.22 * sh
    g = pick('line') * ws; rv = pick('riv') * ws; seal = np.clip(pick('seal') * 2.2, 0, 1) * (1 - g) * ws
    col = col * (1 - 0.5 * g - 0.10 * rv + 0.022 * seal)[..., None]
    rough = rough + 0.14 * g - 0.04 * rv - 0.055 * seal
    H = -0.0006 * g - 0.00018 * rv + 0.00010 * seal
    metal = np.zeros_like(rough)
    # ---- launcher flanks: seams, fasteners, holes, stencil blocks; scuffing where missiles ride
    rail = ID == PID['rail']; hw = ID == PID['railhw']; pyl = ID == PID['pylon']; lau = rail | hw | pyl
    y = P[..., 1]; nz = np.abs(N[..., 2]); zs = P[..., 2]
    col = np.where(rail[..., None], lin((150, 156, 161)), col); col = np.where(hw[..., None], lin((54, 57, 61)), col); col = np.where(pyl[..., None], lin(BODY), col)
    rough = np.where(rail, 0.52, np.where(hw, 0.42, np.where(pyl, 0.58, rough))); metal = np.where(hw, 0.7, 0.0).astype(np.float32)
    housing = hw & (y > RAIL_Y - 0.046)          # snubber and umbilical housings are painted like the beam; only the guide rails are bare
    col = np.where(housing[..., None], lin((128, 134, 139)), col); rough = np.where(housing, 0.5, rough); metal = np.where(housing, 0.0, metal)
    lm = (1 + 0.03 * n1 + 0.02 * n2 + 0.008 * n3)
    col = np.where(lau[..., None], col * lm[..., None], col)
    Lr = launcher_layers()
    sw = smoothstep(0.5, 0.8, nz) * rail
    g = Lr['line'](s, y) * sw; dt = Lr['dot'](s, y) * sw; ik = Lr['ink'](s, y) * sw
    col = col * (1 - 0.5 * g - 0.72 * dt)[..., None]; col = tone(col, (40, 43, 47), 0.75 * ik)
    rough = rough + 0.12 * g + 0.1 * dt; H = H - 0.0005 * g - 0.0009 * dt
    scuff = np.clip(ap.noise3(np.stack([P[..., 0] * 0.25, P[..., 1] * 3, zs * 3], -1), 0.03, 40, 3) - 0.15, 0, 1) * rail
    col = col * (1 - 0.10 * scuff)[..., None]; rough = rough + 0.08 * scuff
    under = rail & (ny < -0.6)
    col = np.where(under[..., None], col * 0.55, col); metal = np.where(under, 0.5, metal); rough = np.where(under, 0.4, rough)
    # ---- pylon: its seam to the wing and a fastener line
    gp = ap.groove(np.abs(y - (RAIL_Y + 0.052)), 0.002) * pyl
    col = col * (1 - 0.4 * gp)[..., None]; H = H - 0.0005 * gp
    # faint chordwise streaking on the underside, aft of the flaperon hinge and the pylon
    st = ap.noise3(np.stack([P[..., 0] * 0.06, P[..., 1], P[..., 2]], -1), 0.03, 9, 2)
    lower = (~up) * smoothstep(0.55, 0.9, np.where(wing, cw, cs)) * ws
    col = col * (1 - 0.035 * lower * np.clip(st, 0, 1))[..., None]
    return finish(col, rough, metal, H, M, texel, {PID[k]: v for k, v in UVK.items()})


def launcher_layers():
    V = (3.85, 7.10, -0.50, -0.17); ppm = 1600
    L = {}
    c = Canvas(*V, ppm); dts = Canvas(*V, ppm); ink = Canvas(*V, ppm)
    yb, yt = RAIL_Y - 0.050, RAIL_Y + 0.036
    for x in (4.24, 4.95, 5.62, 6.30):
        c.line([(x, yb), (x, yt)], 0.0022)
    c.line([(RAIL_S0 + 0.27, RAIL_Y - 0.012), (RAIL_S1 - 0.05, RAIL_Y - 0.012)], 0.0022)
    rnd = np.random.RandomState(7)
    for x in np.arange(RAIL_S0 + 0.34, RAIL_S1 - 0.08, 0.115):                # fastener rows along the flank
        dts.dot(x, RAIL_Y + 0.020, 0.0042); dts.dot(x, RAIL_Y - 0.036, 0.0042)
    for x in (4.52, 4.60, 5.18, 5.86, 5.94, 6.52):                            # lightening / access holes
        dts.dot(x, RAIL_Y - 0.004 + rnd.uniform(-0.004, 0.004), 0.0085)
    for x in (4.40, 5.05, 6.12):                                              # latch slots
        dts.rect(x, RAIL_Y - 0.029, x + 0.038, RAIL_Y - 0.022)
    al = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
    for x, lines, cap in ((4.64, (14, 18, 10), 0.0042), (5.40, (8,), 0.0058), (6.02, (16, 12), 0.0038), (6.48, (6,), 0.0050)):   # stencil blocks: random letter groups
        for k, n in enumerate(lines):
            t = ' '.join(''.join(al[rnd.randint(len(al))] for _ in range(rnd.randint(2, 6))) for _ in range(6))[:n]
            ink.text(t, x, RAIL_Y + 0.010 - k * cap * 1.6, cap, (500, False), 255, 'ls', stretch=0.86)
    L['line'] = c.sampler(); L['dot'] = dts.sampler(); L['ink'] = ink.sampler()
    return L


WHEELS = [(G.X(G.NOSE_GEAR['s']), G.GROUND + G.NOSE_GEAR['r'], 0.0, G.NOSE_GEAR['r'], G.NOSE_GEAR['w']),
          (G.X(G.MAIN_GEAR['s']), G.GROUND + G.MAIN_GEAR['r'], G.MAIN_GEAR['z'], G.MAIN_GEAR['r'], G.MAIN_GEAR['w'])]


def paint_misc(M, texel, S, T):
    P, N, ID = M['P'], M['N'], M['ID']
    s = X0 - P[..., 0]; y = P[..., 1]; z = P[..., 2]; nz = np.abs(N[..., 2]); ny = N[..., 1]
    col = np.zeros(P.shape, np.float32); rough = np.full(ID.shape, 0.5, np.float32); metal = np.zeros(ID.shape, np.float32)
    H = np.zeros(ID.shape, np.float32); em = np.zeros(P.shape, np.float32)
    n1 = ap.noise3(P, 0.35, 31, 2); n2 = ap.noise3(P, 0.05, 32, 2); n3 = ap.noise3(P, 0.012, 33, 1)
    table = {  # pid: colour, roughness, metal
        'pylon': (BODY, 0.56, 0.0), 'tyre': ((24, 24, 25), 0.88, 0.0), 'hub': ((150, 153, 156), 0.46, 0.3), 'strut': ((214, 215, 212), 0.42, 0.0),
        'chrome': ((232, 234, 236), 0.10, 1.0), 'dark': ((9, 9, 10), 0.9, 0.0), 'door': (KEEL, 0.57, 0.0), 'doorin': ((198, 200, 192), 0.55, 0.0),
        'bay': ((186, 189, 184), 0.62, 0.0),
        'steel': ((128, 131, 134), 0.38, 0.85), 'blade': ((23, 24, 26), 0.48, 0.1), 'probe': ((30, 31, 33), 0.42, 0.4),
        'shroud': ((50, 50, 51), 0.42, 0.85), 'pipe': ((15, 14, 14), 0.78, 0.5), 'cone': ((34, 32, 31), 0.55, 0.8),
        'lens_r': ((40, 8, 8), 0.2, 0.0), 'lens_g': ((8, 36, 14), 0.2, 0.0), 'lens_w': ((40, 40, 38), 0.2, 0.0)}
    for k, (c, r, m) in table.items():
        w = ID == PID[k]
        col[w] = lin(c); rough[w] = r; metal[w] = m
    col = col * (1 + 0.03 * n1 + 0.02 * n2 + 0.008 * n3)[..., None]; rough = rough + 0.04 * n1 - 0.03 * n2
    # ---- tyres: tread grooves and a dusty contact band; rims slightly soiled
    ty = ID == PID['tyre']
    for (wx, wy, wz, wr, ww) in WHEELS:
        dz = np.abs(np.abs(z) - wz); rr = np.hypot(P[..., 0] - wx, y - wy)
        near = ty & (rr < wr * 1.05) & (dz < ww)
        gr = np.zeros(ID.shape, np.float32)
        for q in (0.0, 0.17, 0.33):
            gr = np.maximum(gr, ap.groove(np.abs(dz - q * ww), 0.0035))
        gr = gr * smoothstep(wr * 0.93, wr * 0.97, rr) * near
        dust = smoothstep(wr * 0.9, wr, rr) * near
        col = tone(col * (1 - 0.5 * gr)[..., None], (70, 66, 60), 0.16 * dust); H = H - 0.0015 * gr
        side = smoothstep(wr * 0.86, wr * 0.80, rr) * near
        rb = ap.groove(np.abs(rr - wr * 0.70), 0.003) * near
        H = H + 0.0006 * rb; rough = rough - 0.08 * side
    # ---- struts and hubs: slight soiling low down, a little hydraulic seep below the oleo glands, brake dust on the hubs
    gearp = (ID == PID['strut']) | (ID == PID['hub'])
    low = smoothstep(-0.75, -1.05, y) * gearp
    col = col * (1 - 0.10 * low)[..., None]
    seep = np.clip(ap.noise3(np.stack([P[..., 0] * 4.0, P[..., 1] * 0.5, P[..., 2] * 4.0], -1), 0.02, 41, 2) - 0.2, 0, 1) * smoothstep(-0.55, -0.85, y) * (ID == PID['strut'])
    col = tone(col, (120, 92, 58), 0.35 * seep); rough = rough - 0.12 * seep
    hb = ID == PID['hub']
    col = np.where(hb[..., None], tone(col, (96, 88, 78), 0.18 * np.clip(1 - M['AO'], 0, 1) * 2.0), col)
    # ---- bays: primer, grime gathering in the corners and along the frames
    bay = ID == PID['bay']
    gb = np.clip(ap.noise3(P, 0.06, 43, 3) * 0.5 + 0.5, 0, 1)
    col = np.where(bay[..., None], col * (1 - (0.35 * np.clip(1 - M['AO'], 0, 1) + 0.06 * gb))[..., None], col)
    rough = np.where(bay, rough + 0.06 * gb, rough)
    # ---- nozzle: heat tint on the shroud, soot inside
    sh = ID == PID['shroud']
    heat = ap.noise3(np.stack([P[..., 0] * 3, P[..., 1], P[..., 2]], -1), 0.08, 50, 2)
    col = np.where(sh[..., None], col * (1 + 0.15 * heat[..., None]), col)
    rough = np.where(sh, rough + 0.08 * heat, rough)
    # ---- position lights
    for k, e in (('lens_r', (1.0, 0.05, 0.03)), ('lens_g', (0.05, 1.0, 0.25)), ('lens_w', (1.0, 0.95, 0.85))):
        em[ID == PID[k]] = e
    out = finish(col, rough, metal, H, M, texel, {PID[k]: v for k, v in UVK.items()})
    return out + (em,)


# ================================================================ paint, materials, export
def split_pid(ob, pid, name):
    """Move the faces of part `pid` out of ob into a new object."""
    me = ob.data; v = np.empty(len(me.polygons), np.float32); me.attributes['pid'].data.foreach_get('value', v)
    sel = np.rint(v).astype(int) == pid
    d.select([ob], ob)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
    me.polygons.foreach_set('select', sel)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
    new = [o for o in bpy.context.selected_objects if o != ob][0]
    new.name = name; new.data.name = name
    return new


def paint_export():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    sc = bpy.context.scene
    obj = bpy.data.objects
    S = side_layers(); T = plan_layers()
    d.log('layers drawn')
    mats = {}
    for tex, fn, name in (('A', paint_body, 'fury_body'), ('B', paint_wings, 'fury_wing'), ('C', paint_misc, 'fury_misc')):
        if len(ARGS) > 1 and tex not in ARGS[1]:
            maps = {k: d.image(os.path.join(OUT, f'{name}_{k}.png'), k != 'base' and k != 'emissive') for k in ('base', 'orm', 'normal') + (('emissive',) if tex == 'C' else ())}
        else:
            M = ap.load_maps(tex, OUT)
            res = ap.in_strips(fn, M, sc['texel_' + tex], S, T)
            maps = ap.save_maps(name, OUT, res[0], res[1], res[2], res[3], res[4], res[5] if len(res) > 5 else None, orm_size=SIZE[tex] // 2 if tex != 'C' else None)
            d.log('painted', name)
            del M, res
            gc.collect()
        mats[tex] = d.gltf_material(name, base=maps['base'], orm=maps['orm'], normal=maps['normal'], emissive=maps.get('emissive'), emissive_strength=2.5)
    for n, tex in (('A', 'A'), ('B_R', 'B'), ('B_L', 'B'), ('C', 'C'), ('C_R', 'C'), ('C_L', 'C'), ('G', 'C'), ('G_R', 'C'), ('G_L', 'C')):
        d.set_material(obj[n], mats[tex])
    body = obj['A']; body.name = 'body'
    wings = ap.join([obj['B_R'], obj['B_L']], 'wings')
    misc = ap.join([obj['C'], obj['C_R'], obj['C_L']], 'misc')
    gmesh = ap.join([obj['G'], obj['G_R'], obj['G_L']], 'gear_mesh')
    tyres = split_pid(gmesh, PID['tyre'], 'tyres_own')      # the film swaps these for the ramp tyres (assets/fury/tyres.glb)
    out = [body, wings, misc, gmesh, tyres]
    gear = bpy.data.objects.new('gear', None); sc.collection.objects.link(gear); gmesh.parent = gear; tyres.parent = gear; out.append(gear)
    for k, p in G.NAV.items():
        e = bpy.data.objects.new('nav_' + k, None); sc.collection.objects.link(e); e.location = (p[0], -p[2], p[1]); out.append(e)
    for o in (body, wings, misc, gmesh, tyres):
        d.log(d.stats(o))
    path = d.out_path('fury', 'fury.glb')
    d.export_glb(path, out, quality=int(os.environ.get('FURY_Q', '92')))
    if 'clean' in ARGS:     # look-development variant without the landing gear (assets/_test is not committed)
        d.export_glb(d.out_path('_test', 'fury_clean.glb'), [body, wings, misc], quality=85)
    if 'preview' in ARGS:
        d.preview(os.path.join(OUT, 'preview.png'), target=(0.3, 0, 0), cam=(3.0, 16.0, 1.2), lens=70, size=(1280, 540), sun_el=40, sun_az=200)


def shape():
    objs = build(shape_only=True)
    cols = {'A': (0.19, 0.21, 0.24), 'B': (0.36, 0.38, 0.40), 'C': (0.3, 0.3, 0.3), 'G': (0.5, 0.5, 0.5)}
    for n, o in objs.items():
        mat, bsdf, _, _ = d.new_material('shape_' + n)
        bsdf.inputs['Base Color'].default_value = (*cols[n[0]], 1); bsdf.inputs['Roughness'].default_value = 0.55
        d.set_material(o, mat)
    d.export_glb(d.out_path('fury', 'fury.glb'), list(objs.values()))


if 'shape' in ARGS:
    shape()
else:
    if not ARGS or 'geo' in ARGS:
        build()
    if not ARGS or 'paint' in ARGS:
        paint_export()
