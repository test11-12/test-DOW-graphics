# Flight-line props for film 2 ("Fox Three"), modelled for close-up: wheel chocks roped in pairs, a traffic cone, a
# tow bar, a wheeled fire extinguisher, a ground power cart, an aluminium maintenance stand and a drip tray. Generic
# airfield furniture only: no unit markings and no text. Every prop is one mesh with its own baked glTF set (base
# colour, ORM, normal) built from CC0 photoscans (ambientCG): worn at convex edges, grimy where enclosed, dusted where
# it faces up and near the ground. Exported to assets/fury/ramp.glb, one node per prop, origin on the ground.
# Frame: Blender +X towards the parked aircraft's nose (engine +x), +Z up, -Y to its right (engine +z).
#   node tools/blender.mjs fury_ramp [--only=cone,chocks_main] [--preview] [--fast]
import math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import bpy
import bmesh
import numpy as np
from mathutils import Vector
import dowlib as d

ARGS = d.args()
FAST = '--fast' in ARGS                      # small bakes for look-development
PREVIEW = '--preview' in ARGS
ONLY = next((a.split('=', 1)[1].split(',') for a in ARGS if a.startswith('--only=')), None)
PREV = os.environ.get('DOW_PREVIEW_DIR', os.path.join(d.CACHE, 'previews', 'fury_ramp'))
BAKE = d.bake_dir('fury_ramp')
# the aircraft these chocks are cut for (as FURY in src/fury_model.js): wheel radii and tyre widths (m)
MAIN_R, MAIN_W, NOSE_R, NOSE_W = 0.235, 0.155, 0.180, 0.115
DUST = (0.50, 0.42, 0.32, 1.0)               # Mojave dust (linear)


# ---------------------------------------------------------------- geometry helpers
def link(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def prism(name, pts, width):
    """A closed profile [(x, z), ...] in the XZ plane, extruded along Y over `width`, centred."""
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, -width / 2, z)) for x, z in pts])
    geo = bmesh.ops.extrude_face_region(bm, geom=[f])['geom']
    bmesh.ops.translate(bm, vec=(0, width, 0), verts=[v for v in geo if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm)


def lathe(name, prof, segs=48):
    """A profile [(r, z), ...] spun about Z; r = 0 at either end closes it."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in prof])
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % segs]
        for j in range(len(prof) - 1):
            bm.faces.new((A[j], B[j], B[j + 1], A[j + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm)


def cyl(name, p0, p1, r, segs=16, r1=None, caps=True):
    p0, p1 = Vector(p0), Vector(p1)
    v = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r, radius2=r if r1 is None else r1, depth=v.length)
    q = Vector((0, 0, 1)).rotation_difference(v.normalized())
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=(p0 + p1) / 2)
    return link(name, bm)


def box(name, size, center=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return link(name, bm)


def torus(name, R, r, center, rot=(0, 0, 0), segs=32, rsegs=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=segs, minor_segments=rsegs, location=center, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def catmull(pts, n=12):
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(P[-2])
    return out


def pipe(name, pts, r, res=3, smooth_pts=True, n=10):
    """A tube along a smooth curve through pts (rope, hose, bent rod)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    P = catmull(pts, n) if smooth_pts else [Vector(p) for p in pts]
    sp.points.add(len(P) - 1)
    for i, p in enumerate(P):
        sp.points[i].co = (p.x, p.y, p.z, 1.0)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    d.select([ob])
    bpy.ops.object.convert(target='MESH')
    return bpy.context.active_object


def boolean(ob, cutter, op='DIFFERENCE'):
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    d.apply_modifiers(ob)
    bpy.data.objects.remove(cutter)


def finish(ob, bevel=0.0, seg=3, angle=30, smooth=40):
    if bevel > 0:
        d.bevel(ob, bevel, segments=seg, angle_deg=angle)
    d.smooth(ob, smooth)
    return ob


def join(name, parts):
    d.select(parts, active=parts[0])
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    return ob


def put(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def apply(ob):
    d.select([ob])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


# ---------------------------------------------------------------- materials
_cache = {}


def acg(asset):
    if asset not in _cache:
        _cache[asset] = d.ambientcg_texture(asset, '2K')
    return _cache[asset]


def img(path, non_color):
    key = (path, non_color)
    if key not in _cache:
        _cache[key] = d.image(path, non_color)
    return _cache[key]


def lum_mean(path):
    """Mean linear luminance of a colour scan (to recolour it without changing its tonal detail)."""
    from PIL import Image
    a = np.asarray(Image.open(path).convert('L').resize((256, 256)), np.float32) / 255.0
    return float((((a + 0.055) / 1.055) ** 2.4).mean())


def node(nt, kind):
    return nt.nodes.new(kind)


def smoothstep(nt, x, a, b):
    m = nt.nodes.new('ShaderNodeMapRange')
    m.interpolation_type = 'SMOOTHSTEP'
    m.inputs['From Min'].default_value = a
    m.inputs['From Max'].default_value = b
    nt.links.new(x, m.inputs['Value'])
    return m.outputs['Result']


def noise(nt, scale, detail=6.0, rough=0.6, coords=None):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    if coords is not None:
        nt.links.new(coords, n.inputs['Vector'])
    return n.outputs['Fac']


def surface(name, scan, *, color=None, scale=1.0, metal=0.0, rough_add=0.0, rough_mul=1.0, nstr=1.0,
            wear=0.0, wear_color=(0.55, 0.55, 0.56, 1), wear_metal=None, wear_rough=0.35,
            grime=0.6, grime_color=(0.05, 0.045, 0.04, 1), dust=0.5, ground_dirt=0.5, ground_h=0.12, tone=0.4, masks=None):
    """A source material for baking: a tri-planar photoscan (optionally recoloured: the scan's tonal detail kept, its hue
    replaced), worn bare at convex edges, darkened where enclosed and dusted where it faces up or sits near the ground.
    masks: {'ao': image, 'edge': image} baked from the shape (UV mapped)."""
    mat, bsdf, nodes, links = d.new_material(name)
    nt = mat.node_tree
    tc = d.texcoord(nt)
    S = acg(scan)
    C = d.tex(nt, img(S['Color'], False), tc.outputs['Object'], 'BOX', 0.25, scale=scale)
    R = d.tex(nt, img(S['Roughness'], True), tc.outputs['Object'], 'BOX', 0.25, scale=scale)
    N = d.tex(nt, img(S['NormalGL'], True), tc.outputs['Object'], 'BOX', 0.25, scale=scale)
    base = C.outputs['Color']
    if color is not None:
        bw = node(nt, 'ShaderNodeRGBToBW')
        links.new(C.outputs['Color'], bw.inputs['Color'])
        k = d.math_node(nt, 'MULTIPLY', bw.outputs['Val'], 1.0 / max(1e-3, lum_mean(S['Color'])))
        k = d.math_node(nt, 'MAXIMUM', d.math_node(nt, 'MINIMUM', k, 1.6), 0.35)
        k = d.math_node(nt, 'ADD', d.math_node(nt, 'MULTIPLY', d.math_node(nt, 'SUBTRACT', k, 1.0), tone), 1.0)   # keep only some of the scan's tonal swing
        cc = node(nt, 'ShaderNodeCombineColor')
        for ch in ('Red', 'Green', 'Blue'):
            links.new(k, cc.inputs[ch])
        base = d.mix_rgb(nt, color, cc.outputs['Color'], 1.0, 'MULTIPLY')
    rough = d.math_node(nt, 'ADD', d.math_node(nt, 'MULTIPLY', R.outputs['Color'], rough_mul), rough_add, True)
    metal_s = metal
    geo = node(nt, 'ShaderNodeNewGeometry')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    osep = node(nt, 'ShaderNodeSeparateXYZ')
    links.new(tc.outputs['Object'], osep.inputs['Vector'])
    big = noise(nt, 3.0, 4.0, 0.55, tc.outputs['Object'])
    fine = noise(nt, 38.0, 8.0, 0.65, tc.outputs['Object'])
    if wear > 0 and masks and 'edge' in masks:                     # convex edges, broken up by noise
        E = d.tex(nt, masks['edge'])
        e = d.math_node(nt, 'MULTIPLY', E.outputs['Color'], wear * 2.4)
        e = d.math_node(nt, 'SUBTRACT', e, d.math_node(nt, 'MULTIPLY', fine, 0.9), True)
        e = smoothstep(nt, e, 0.18, 0.5)
        base = d.mix_rgb(nt, base, wear_color, e)
        rough = d.mix_rgb(nt, rough, (wear_rough,) * 3 + (1,), e)
        if wear_metal is not None and wear_metal != metal:
            metal_s = d.math_node(nt, 'ADD', d.math_node(nt, 'MULTIPLY', e, wear_metal - metal), metal, True)
    if grime > 0 and masks and 'ao' in masks:                      # grime where the shape is enclosed
        A = d.tex(nt, masks['ao'])
        g = d.math_node(nt, 'SUBTRACT', 1.0, A.outputs['Color'], True)
        g = d.math_node(nt, 'MULTIPLY', d.math_node(nt, 'POWER', g, 0.7), grime * 1.2)
        g = d.math_node(nt, 'MULTIPLY', g, d.math_node(nt, 'ADD', 0.5, big))
        base = d.mix_rgb(nt, base, grime_color, d.math_node(nt, 'MINIMUM', g, 0.85))
        rough = d.mix_rgb(nt, rough, (0.85,) * 3 + (1,), d.math_node(nt, 'MINIMUM', g, 0.6))
    if dust > 0 or ground_dirt > 0:                                 # dust facing up and near the ground
        up = smoothstep(nt, sep.outputs['Z'], 0.35, 0.95)
        dk = d.math_node(nt, 'MULTIPLY', up, dust)
        low = smoothstep(nt, osep.outputs['Z'], ground_h, 0.0)
        dk = d.math_node(nt, 'MAXIMUM', dk, d.math_node(nt, 'MULTIPLY', low, ground_dirt))
        dk = d.math_node(nt, 'MULTIPLY', dk, smoothstep(nt, d.math_node(nt, 'ADD', big, d.math_node(nt, 'MULTIPLY', fine, 0.35)), 0.35, 0.85))
        base = d.mix_rgb(nt, base, DUST, dk)
        rough = d.mix_rgb(nt, rough, (0.95,) * 3 + (1,), dk)
    links.new(base, bsdf.inputs['Base Color'])
    links.new(rough, bsdf.inputs['Roughness'])
    if isinstance(metal_s, (int, float)):
        bsdf.inputs['Metallic'].default_value = metal_s
    else:
        links.new(metal_s, bsdf.inputs['Metallic'])
    links.new(d.normal_map(nt, N.outputs['Color'], nstr), bsdf.inputs['Normal'])
    return mat


def edge_material(name, radius):
    """For an emission bake of the convex-edge factor (Bevel node)."""
    mat, bsdf, nodes, links = d.new_material(name)
    nt = mat.node_tree
    e = d.edge_mask(nt, radius, samples=8)
    cc = node(nt, 'ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        links.new(e, cc.inputs[ch])
    links.new(cc.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


# ---------------------------------------------------------------- baking one prop
def bake_prop(ob, name, size, edge_r, ao_dist, build_mats):
    """Bake the shape masks (occlusion, convex edges), then the full glTF set from source materials built on them.
    Materials on ob are placeholders whose names key build_mats' result."""
    size = max(256, size // (4 if FAST else 1))
    bm = bmesh.new()                              # triangles: the exported tangent frame is the one the normal map is baked in
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.to_mesh(ob.data)
    bm.free()
    d.smart_uv(ob, 66, 0.003)
    d.pack_uv([ob], margin=0.004)
    d.log(name, d.stats(ob), 'texel', round(d.texel_density(ob, size) * 1000, 2), 'mm')
    keys = [s.material.name for s in ob.material_slots]
    w = d.ensure_world((1, 1, 1))
    w.light_settings.distance = ao_dist
    ao = d.new_image(f'{name}_aomask', size // 2, non_color=True, color=(1, 1, 1, 1))
    d.bake([ob], 'AO', ao, samples=16 if FAST else 48)
    d.blur(ao, 1.3)
    ao = d.resize(ao, size, f'{name}_aofull')
    em = edge_material(f'{name}_edgemat', edge_r)
    for s in ob.material_slots:
        s.material = em
    edge = d.new_image(f'{name}_edge', size // 2, non_color=True)
    d.bake_socket([ob], 'Base Color', edge, samples=2 if FAST else 6)
    d.blur(edge, 1.0)
    edge = d.resize(edge, size, f'{name}_edgefull')
    mats = build_mats({'ao': ao, 'edge': edge})
    for i, s in enumerate(ob.material_slots):
        s.material = mats[keys[i]]
    base = d.new_image(f'{name}_base', size)
    d.bake_socket([ob], 'Base Color', base, samples=1)
    rough = d.new_image(f'{name}_rough', size, non_color=True)
    d.bake_socket([ob], 'Roughness', rough, samples=1)
    metal = d.new_image(f'{name}_metal', size, non_color=True)
    d.bake_socket([ob], 'Metallic', metal, samples=1)
    orm = d.pack_orm(ao, rough, metal, f'{name}_orm')
    nrm = d.new_image(f'{name}_normal', size, non_color=True, color=(0.5, 0.5, 1.0, 1.0))
    d.bake([ob], 'NORMAL', nrm, samples=1)
    for k, im in (('base', base), ('orm', orm), ('normal', nrm)):
        d.save_png(im, os.path.join(BAKE, f'{name}_{k}.png'))
    d.swap_to_baked([ob], name, {'base': base, 'orm': orm, 'normal': nrm})
    return ob


# ---------------------------------------------------------------- the props
def chock(name, r_tyre):
    """Moulded polyurethane chock: concave face to the tyre (local x = 0), sloped back, rope hole across the top."""
    L, H, W = 0.27, 0.13, 0.26
    pts = [(0.0, 0.0), (L, 0.0), (L, 0.018), (L * 0.62, H), (0.05, H)]
    cx, cz = -r_tyre * 0.62, r_tyre
    for k in range(1, 9):
        z = H * (1 - k / 9)
        x = max(0.0, cx + math.sqrt(max(r_tyre * r_tyre - (z - cz) ** 2, 0)) - 0.035)
        pts.append((min(x, 0.045), z))
    ob = prism(name, pts, W)
    boolean(ob, cyl('hole', (L * 0.55, -W, H * 0.62), (L * 0.55, W, H * 0.62), 0.014, 16))
    return finish(ob, 0.006, 3, 35, 40)


def build_chocks(tag, r, w, gap):
    """A pair either side of one wheel (tyre centre at the origin), roped together beside the tyre on the -Y side."""
    a = chock(f'{tag}_a', r)
    b = chock(f'{tag}_b', r)
    a.rotation_euler = (0, 0, math.pi)
    a.location = (-gap, 0, 0)
    b.location = (gap, 0, 0)
    apply(a)
    apply(b)
    xa, xb, za = -gap - 0.27 * 0.55, gap + 0.27 * 0.55, 0.13 * 0.62
    ys, yo = -0.13 - 0.005, -(w / 2 + 0.06)
    rope = pipe(f'{tag}_rope', [(xa, ys + 0.03, za), (xa, ys - 0.025, za - 0.012), (xa + 0.035, yo - 0.02, 0.012), (xa * 0.4, yo - 0.05, 0.0065),
                               (0.0, yo - 0.06, 0.0062), (xb * 0.45, yo - 0.04, 0.0065), (xb - 0.035, yo - 0.02, 0.012), (xb, ys - 0.025, za - 0.012),
                               (xb, ys + 0.03, za)], 0.0055, res=2)
    put(a, M['urethane'])
    put(b, M['urethane'])
    put(rope, M['rope'])
    return join(tag, [a, b, rope])


def build_cone():
    H = 0.71
    body = lathe('cone_body', [(0.0, 0.035), (0.150, 0.035), (0.148, 0.05), (0.033, H - 0.012), (0.026, H), (0.014, H - 0.004), (0.0, H - 0.01)], 48)
    finish(body, 0.0, smooth=50)
    base = finish(box('cone_base', (0.36, 0.36, 0.035), (0, 0, 0.0175)), 0.012, 3, 30)
    collar = finish(lathe('cone_collar', [(0.0, 0.03), (0.172, 0.03), (0.168, 0.048), (0.152, 0.058), (0.0, 0.058)], 48), 0.0, smooth=40)
    put(body, M['pvc'])
    put(base, M['rubber'])
    put(collar, M['rubber'])
    return join('cone', [body, base, collar])


def build_towbar():
    L = 3.1
    yel = [finish(cyl('tb_tube', (0.16, 0, 0.17), (L - 0.22, 0, 0.21), 0.042, 20), 0.006, 2, 30),
           finish(box('tb_head', (0.22, 0.16, 0.12), (0.08, 0, 0.16)), 0.01, 3, 30),
           finish(box('tb_plate', (0.16, 0.05, 0.08), (L - 0.12, 0, 0.21)), 0.008, 2, 30),
           pipe('tb_handle', [(L - 0.6, 0.0, 0.25), (L - 0.65, 0.0, 0.45), (L - 0.85, 0.0, 0.5), (L - 1.05, 0.0, 0.46), (L - 1.1, 0.0, 0.24)], 0.014, res=2)]
    for s in (-1, 1):
        yel.append(finish(box(f'tb_prong{s}', (0.16, 0.03, 0.09), (-0.08, s * 0.055, 0.15)), 0.006, 2, 30))
    steel = [finish(cyl('tb_pin', (-0.1, -0.09, 0.15), (-0.1, 0.09, 0.15), 0.012, 12), 0.002, 1, 30),
             finish(torus('tb_lunette', 0.07, 0.018, (L + 0.02, 0, 0.21), rot=(math.pi / 2, 0, 0)), 0.0, smooth=50)]
    ax = 2.05
    steel.append(finish(cyl('tb_axle', (ax, -0.2, 0.14), (ax, 0.2, 0.14), 0.016, 12), 0.003, 1))
    rub = []
    for s in (-1, 1):
        yel.append(finish(cyl(f'tb_arm{s}', (ax, s * 0.05, 0.2), (ax, s * 0.05, 0.14), 0.02, 10), 0.003, 1))
        rub.append(finish(torus(f'tb_tyre{s}', 0.105, 0.035, (ax, s * 0.215, 0.14), rot=(math.pi / 2, 0, 0), segs=36, rsegs=14), 0.0, smooth=60))
        steel.append(finish(cyl(f'tb_hub{s}', (ax, s * 0.19, 0.14), (ax, s * 0.24, 0.14), 0.075, 20), 0.006, 2, 30))
    for p in yel:
        put(p, M['yellow'])
    for p in steel:
        put(p, M['steel'])
    for p in rub:
        put(p, M['rubber'])
    return join('towbar', yel + steel + rub)


def build_extinguisher():
    R, z0, z1 = 0.165, 0.2, 1.08
    tank = finish(lathe('ext_tank', [(0.0, z0 - 0.04), (R * 0.7, z0 - 0.035), (R, z0 + 0.01), (R, z1 - 0.04), (R * 0.75, z1 + 0.035), (0.05, z1 + 0.06), (0.0, z1 + 0.06)], 40), 0.0, smooth=55)
    red = [tank]
    for s in (-1, 1):
        red.append(pipe(f'ext_up{s}', [(-0.2, s * 0.2, 0.22), (-0.2, s * 0.2, 0.9), (-0.17, s * 0.2, 1.15), (-0.08, s * 0.2, 1.22)], 0.016, res=2))
        red.append(finish(cyl(f'ext_strut{s}', (-0.2, s * 0.2, 0.5), (0.0, s * 0.15, 0.5), 0.012, 10), 0.0, smooth=50))
        zb = 0.35 if s < 0 else 0.85
        red.append(finish(cyl(f'ext_band{s}', (0, 0, zb), (0, 0, zb + 0.02), R + 0.008, 40), 0.002, 1))
    red += [finish(cyl('ext_bar', (-0.08, -0.2, 1.22), (-0.08, 0.2, 1.22), 0.016, 12), 0.0, smooth=50),
            finish(cyl('ext_axle', (-0.2, -0.3, 0.2), (-0.2, 0.3, 0.2), 0.018, 12), 0.0, smooth=50),
            finish(box('ext_foot', (0.38, 0.36, 0.02), (0.0, 0, 0.18)), 0.004, 2)]
    brass = [finish(cyl('ext_valve', (0, 0, z1 + 0.05), (0, 0, z1 + 0.14), 0.035, 16), 0.004, 2)]
    steel = [finish(cyl('ext_knob', (0, -0.06, z1 + 0.12), (0, 0.06, z1 + 0.12), 0.018, 12), 0.003, 1)]
    rub = [pipe('ext_hose', [(0.03, 0.0, z1 + 0.1), (0.12, 0.05, z1 + 0.05), (0.2, 0.1, 0.8), (0.19, 0.12, 0.55), (0.12, 0.16, 0.42), (0.02, 0.2, 0.5), (-0.05, 0.22, 0.7)], 0.016, res=2),
           finish(cyl('ext_nozzle', (-0.05, 0.22, 0.7), (-0.06, 0.24, 0.86), 0.022, 14, r1=0.03), 0.003, 1)]
    for s in (-1, 1):
        rub.append(finish(torus(f'ext_tyre{s}', 0.15, 0.05, (-0.2, s * 0.33, 0.2), rot=(math.pi / 2, 0, 0), segs=40, rsegs=14), 0.0, smooth=60))
        steel.append(finish(cyl(f'ext_hub{s}', (-0.2, s * 0.3, 0.2), (-0.2, s * 0.36, 0.2), 0.11, 24), 0.006, 2))
    for p in red:
        put(p, M['red'])
    for p in brass:
        put(p, M['brass'])
    for p in steel:
        put(p, M['steel'])
    for p in rub:
        put(p, M['rubber'])
    return join('extinguisher', red + brass + steel + rub)


def build_gpu():
    """Generic towed ground power cart: louvred body on a channel chassis, four wheels, folded tow bar, cable reel."""
    Lb, Wb, Hb, zb = 2.2, 1.15, 0.95, 0.42
    body = finish(box('gpu_body', (Lb, Wb, Hb), (0, 0, zb + Hb / 2)), 0.025, 3, 30)
    n0 = len(body.data.vertices)
    for s in (-1, 1):                    # door seams: shallow grooves
        for x in (-0.1, 0.62):
            boolean(body, box(f'gpu_groove{s}{x}', (0.008, 0.02, Hb * 0.86), (x, s * (Wb / 2), zb + Hb / 2)))
        boolean(body, box(f'gpu_grooveh{s}', (0.72, 0.02, 0.008), (0.26, s * (Wb / 2), zb + Hb * 0.93)))
    d.log('gpu body seams: vertices', n0, '->', len(body.data.vertices))
    d.smooth(body, 40)
    white = [body, finish(box('gpu_roof', (Lb + 0.04, Wb + 0.04, 0.035), (0, 0, zb + Hb + 0.0175)), 0.01, 2)]
    dark = []
    for s in (-1, 1):                    # louvred grille on each side: a frame and twelve angled blades, proud of the panel
        y = s * (Wb / 2 + 0.006)
        dark.append(finish(box(f'gpu_grill{s}', (0.66, 0.008, 0.46), (-0.55, y, zb + 0.5)), 0.002, 1))
        for k in range(12):
            bl = box(f'gpu_blade{s}_{k}', (0.62, 0.004, 0.04), (-0.55, y + s * 0.012, zb + 0.3 + k * 0.036))
            bl.rotation_euler = (s * 0.65, 0, 0)
            white.append(finish(apply(bl), 0.0015, 1))
        for x in (-0.88, -0.22):
            white.append(finish(box(f'gpu_gfr{s}{x}', (0.03, 0.03, 0.5), (x, y + s * 0.01, zb + 0.5)), 0.004, 2))
        for z in (zb + 0.26, zb + 0.74):
            white.append(finish(box(f'gpu_gfh{s}{z}', (0.69, 0.03, 0.03), (-0.55, y + s * 0.01, z)), 0.004, 2))
    dark += [finish(box(f'gpu_rail{s}', (Lb + 0.3, 0.08, 0.12), (0.0, s * 0.42, zb - 0.06)), 0.008, 2) for s in (-1, 1)]
    dark.append(finish(box('gpu_xmem', (0.08, 0.9, 0.1), (Lb / 2 + 0.1, 0, zb - 0.06)), 0.008, 2))
    rub, steel = [], []
    for x in (-0.72, 0.72):
        for s in (-1, 1):
            rub.append(finish(torus(f'gpu_tyre{x}{s}', 0.19, 0.075, (x, s * 0.55, 0.265), rot=(math.pi / 2, 0, 0), segs=40, rsegs=16), 0.0, smooth=60))
            steel.append(finish(cyl(f'gpu_hub{x}{s}', (x, s * 0.5, 0.265), (x, s * 0.6, 0.265), 0.15, 24), 0.006, 2))
    for s in (-1, 1):
        dark.append(finish(cyl(f'gpu_tb{s}', (Lb / 2 + 0.12, s * 0.38, zb - 0.06), (Lb / 2 + 0.2, s * 0.05, zb + 0.75), 0.022, 12), 0.0, smooth=50))
    dark.append(finish(torus('gpu_eye', 0.06, 0.016, (Lb / 2 + 0.21, 0, zb + 0.8), rot=(0, math.pi / 2, 0)), 0.0, smooth=50))
    dark.append(finish(cyl('gpu_reel', (-Lb / 2 - 0.02, 0, zb + 0.45), (-Lb / 2 - 0.18, 0, zb + 0.45), 0.25, 32), 0.008, 2))
    rub.append(finish(torus('gpu_coil', 0.2, 0.04, (-Lb / 2 - 0.1, 0, zb + 0.45), rot=(0, math.pi / 2, 0), segs=40, rsegs=10), 0.0, smooth=60))
    steel += [finish(torus('gpu_lift', 0.04, 0.01, (0.0, 0.0, zb + Hb + 0.06), rot=(math.pi / 2, 0, 0)), 0.0, smooth=50),
              finish(cyl('gpu_stack', (-0.7, 0.3, zb + Hb), (-0.7, 0.3, zb + Hb + 0.16), 0.045, 16), 0.003, 1)]
    for s in (-1, 1):
        for x in (-0.4, 0.3, 0.95):
            steel.append(finish(box(f'gpu_latch{s}{x}', (0.05, 0.02, 0.03), (x, s * (Wb / 2 + 0.01), zb + Hb * 0.55)), 0.003, 1))
    for p in white:
        put(p, M['white'])
    for p in dark:
        put(p, M['dark'])
    for p in rub:
        put(p, M['rubber'])
    for p in steel:
        put(p, M['steel'])
    return join('gpu', white + dark + rub + steel)


def build_stand():
    """Aluminium three-step platform stand with handrails and casters (as beside the aircraft in released photos)."""
    W, rise, run, sq = 0.62, 0.3, 0.26, 0.035
    alu = []
    tube = lambda n, a, b: cyl(n, a, b, sq / 2, 4)
    for s in (-1, 1):
        y = s * W / 2
        alu += [tube(f'st_str{s}', (-0.05, y, 0.02), (3 * run, y, 3 * rise)),
                tube(f'st_legb{s}', (3 * run + 0.3, y, 0.02), (3 * run + 0.3, y, 3 * rise)),
                tube(f'st_legf{s}', (3 * run, y, 0.02), (3 * run, y, 3 * rise)),
                tube(f'st_base{s}', (-0.08, y, 0.06), (3 * run + 0.33, y, 0.06)),
                tube(f'st_brace{s}', (3 * run, y, 0.08), (3 * run + 0.3, y, 3 * rise - 0.05)),
                cyl(f'st_post{s}', (0.02, y, 0.08), (0.02, y, 0.95), 0.016, 12),
                cyl(f'st_postt{s}', (3 * run + 0.3, y, 3 * rise), (3 * run + 0.3, y, 3 * rise + 0.95), 0.016, 12),
                pipe(f'st_rail{s}', [(0.02, y, 0.95), (0.4, y, 1.25), (3 * run, y, 3 * rise + 0.93), (3 * run + 0.3, y, 3 * rise + 0.95)], 0.016, res=2),
                pipe(f'st_mid{s}', [(0.02, y, 0.5), (3 * run + 0.3, y, 3 * rise + 0.5)], 0.012, res=1, smooth_pts=False)]
    for p in alu:
        finish(p, 0.003, 1, smooth=50)
    treads = [finish(box(f'st_tread{k}', (run - 0.02, W - 0.01, 0.03), (k * run + run * 0.5, 0, (k + 1) * rise - 0.015)), 0.004, 2) for k in range(3)]
    treads.append(finish(box('st_plat', (0.32, W - 0.01, 0.035), (3 * run + 0.15, 0, 3 * rise - 0.0175)), 0.004, 2))
    casters = [finish(cyl(f'st_cast{x}{s}', (x, s * W / 2 - 0.02, 0.035), (x, s * W / 2 + 0.02, 0.035), 0.035, 16), 0.004, 2) for x in (-0.06, 3 * run + 0.3) for s in (-1, 1)]
    for p in alu:
        put(p, M['alu'])
    for p in treads:
        put(p, M['tread'])
    for p in casters:
        put(p, M['rubber'])
    return join('stand', alu + treads + casters)


def build_tray():
    bm = bmesh.new()
    L, W, H, t = 0.7, 0.5, 0.05, 0.08
    outer = [(-L / 2, -W / 2), (L / 2, -W / 2), (L / 2, W / 2), (-L / 2, W / 2)]
    inner = [(x * (1 - 2 * t / L), y * (1 - 2 * t / W)) for x, y in outer]
    vo = [bm.verts.new((x, y, H)) for x, y in outer]
    vi = [bm.verts.new((x, y, 0.006)) for x, y in inner]
    vb = [bm.verts.new((x, y, 0.0)) for x, y in outer]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
        bm.faces.new((vb[j], vb[i], vo[i], vo[j]))
    bm.faces.new(vi[::-1])
    bm.faces.new(vb)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = finish(link('driptray', bm), 0.004, 2, 20)
    return put(ob, M['tray'])


def cone_mats(m):
    """PVC cone: orange with two retro-reflective white collars (by height), black rubber base."""
    pvc = surface('k_pvc', 'Plastic006', color=(0.80, 0.13, 0.015, 1), scale=2.5, rough_add=0.22, rough_mul=0.6, wear=0.35, wear_color=(0.9, 0.45, 0.25, 1), wear_rough=0.6, grime=0.6, dust=0.4, ground_dirt=0.6, ground_h=0.14, tone=0.22, masks=m)
    nt = pvc.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = d.texcoord(nt)
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    z = sep.outputs['Z']
    band = d.math_node(nt, 'MAXIMUM', d.math_node(nt, 'MULTIPLY', smoothstep(nt, z, 0.468, 0.472), smoothstep(nt, z, 0.622, 0.618)),
                       d.math_node(nt, 'MULTIPLY', smoothstep(nt, z, 0.318, 0.322), smoothstep(nt, z, 0.422, 0.418)))
    prev = bsdf.inputs['Base Color'].links[0].from_socket
    white = d.mix_rgb(nt, prev, (0.88, 0.88, 0.86, 1), 0.82)            # keeps a little of the grime and dust
    nt.links.new(d.mix_rgb(nt, prev, white, band), bsdf.inputs['Base Color'])
    rprev = bsdf.inputs['Roughness'].links[0].from_socket
    rr = d.math_node(nt, 'ADD', d.math_node(nt, 'MULTIPLY', rprev, d.math_node(nt, 'SUBTRACT', 1.0, band)), d.math_node(nt, 'MULTIPLY', band, 0.42))
    nt.links.new(rr, bsdf.inputs['Roughness'])
    rub = surface('k_rub', 'Rubber001', scale=4.0, rough_add=0.05, grime=0.5, dust=0.5, ground_dirt=0.4, ground_h=0.03, masks=m)
    return {'pvc': pvc, 'rubber': rub}


YEL = (0.78, 0.47, 0.04, 1)
URE = dict(color=YEL, scale=3.0, rough_add=0.18, rough_mul=0.8, wear=0.6, wear_color=(0.85, 0.7, 0.35, 1), wear_rough=0.75, grime=0.7, dust=0.2, ground_dirt=0.6, ground_h=0.025, tone=0.3)
BAKES = {   # prop: (builder, texture size, convex-edge radius (m), occlusion distance (m), source materials from the masks)
    'chocks_main': (lambda: build_chocks('chocks_main', MAIN_R, MAIN_W, MAIN_R * 0.72 + 0.02), 1024, 0.006, 0.2,
                    lambda m: {'urethane': surface('cm_ure', 'Plastic006', masks=m, **URE), 'rope': surface('cm_rope', 'Rope001', scale=14.0, rough_add=0.1, grime=0.5, dust=0.4, masks=m)}),
    'chocks_nose': (lambda: build_chocks('chocks_nose', NOSE_R, NOSE_W, NOSE_R * 0.72 + 0.02), 1024, 0.006, 0.2,
                    lambda m: {'urethane': surface('cn_ure', 'Plastic006', masks=m, **URE), 'rope': surface('cn_rope', 'Rope001', scale=14.0, rough_add=0.1, grime=0.5, dust=0.4, masks=m)}),
    'cone': (build_cone, 2048, 0.004, 0.3, cone_mats),
    'towbar': (build_towbar, 1024, 0.006, 0.25,
               lambda m: {'yellow': surface('t_yel', 'PaintedMetal001', scale=1.6, wear=1.0, wear_color=(0.32, 0.3, 0.28, 1), wear_metal=1.0, wear_rough=0.45, grime=0.8, dust=0.5, ground_dirt=0.6, ground_h=0.07, masks=m),
                          'rubber': surface('t_rub', 'Rubber004', scale=4.0, grime=0.4, dust=0.5, masks=m),
                          'steel': surface('t_steel', 'Metal032', scale=3.0, metal=1.0, grime=0.8, dust=0.4, masks=m)}),
    'extinguisher': (build_extinguisher, 1024, 0.005, 0.25,
                     lambda m: {'red': surface('e_red', 'PaintedMetal004', scale=1.4, wear=0.7, wear_color=(0.4, 0.38, 0.36, 1), wear_metal=1.0, wear_rough=0.4, grime=0.6, dust=0.4, ground_dirt=0.5, ground_h=0.3, masks=m),
                                'brass': surface('e_brass', 'Metal032', color=(0.75, 0.55, 0.25, 1), scale=3.0, metal=1.0, grime=0.6, dust=0.2, masks=m),
                                'steel': surface('e_steel', 'Metal032', scale=3.0, metal=1.0, grime=0.7, dust=0.3, masks=m),
                                'rubber': surface('e_rub', 'Rubber004', scale=4.0, grime=0.4, dust=0.5, masks=m)}),
    'gpu': (build_gpu, 2048, 0.008, 0.35,
            lambda m: {'white': surface('g_white', 'PaintedMetal001', color=(0.70, 0.70, 0.66, 1), scale=1.0, wear=0.55, wear_color=(0.3, 0.3, 0.3, 1), wear_metal=1.0, wear_rough=0.45, grime=0.9, dust=0.7, ground_dirt=0.8, ground_h=0.62, tone=0.5, masks=m),
                       'dark': surface('g_dark', 'PaintedMetal001', color=(0.07, 0.07, 0.07, 1), scale=1.6, wear=0.6, wear_color=(0.35, 0.33, 0.3, 1), wear_metal=1.0, grime=0.6, dust=0.6, ground_dirt=0.8, ground_h=0.5, masks=m),
                       'rubber': surface('g_rub', 'Rubber004', scale=3.0, grime=0.4, dust=0.6, masks=m),
                       'steel': surface('g_steel', 'Metal032', scale=3.0, metal=1.0, grime=0.7, dust=0.4, masks=m)}),
    'stand': (build_stand, 1024, 0.004, 0.2,
              lambda m: {'alu': surface('s_alu', 'Metal032', color=(0.78, 0.78, 0.78, 1), scale=2.0, metal=1.0, rough_add=0.08, grime=0.6, dust=0.35, ground_dirt=0.5, ground_h=0.1, tone=0.5, masks=m),
                         'tread': surface('s_tread', 'DiamondPlate008C', scale=3.2, metal=1.0, grime=0.5, dust=0.7, masks=m),
                         'rubber': surface('s_rub', 'Rubber004', scale=5.0, grime=0.4, dust=0.6, masks=m)}),
    'driptray': (build_tray, 512, 0.004, 0.15,
                 lambda m: {'tray': surface('d_steel', 'Metal032', color=(0.16, 0.155, 0.15, 1), scale=2.0, metal=1.0, rough_mul=0.6, grime=1.0, grime_color=(0.008, 0.008, 0.008, 1), dust=0.2, ground_h=0.0, masks=m)}),
}

# ---------------------------------------------------------------- run
d.reset(samples=16)
d.ensure_world()
M = {k: bpy.data.materials.new(k) for k in ('urethane', 'rope', 'pvc', 'rubber', 'yellow', 'steel', 'red', 'brass', 'white', 'dark', 'alu', 'tread', 'tray')}
out = []
for name, (builder, size, er, aod, mats) in BAKES.items():
    if ONLY and name not in ONLY:
        continue
    ob = builder()
    d.log('built', d.stats(ob))
    bake_prop(ob, name, size, er, aod, mats)
    if PREVIEW:
        os.makedirs(PREV, exist_ok=True)
        dims = ob.dimensions
        r = max(dims) * 1.6 + 0.4
        d.preview(os.path.join(PREV, f'{name}.png'), target=(0, 0, dims.z * 0.45), cam=(r * 0.75, -r * 0.9, dims.z * 0.6 + r * 0.35), lens=45, size=(640, 480), samples=16)
    ob.location.x += 50.0 * (len(out) + 1)     # out of the way of the next prop's occlusion bake
    ob.hide_render = True
    out.append(ob)
for o in out:
    o.location.x = 0.0
    o.hide_render = False
d.export_glb(d.out_path('fury', 'ramp.glb') if not ONLY else os.path.join(BAKE, 'ramp_partial.glb'), out)
