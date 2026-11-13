# Desert scrub as pre-lit impostors, from photoscanned CC0 plants (Poly Haven, Namaqualand / Karoo collection):
#   node tools/blender.mjs scrub [--sun=AZ,EL] [--elev=DEG] [--film=NAME] [--views=N] [--samples=N] [--only=a,b]
#
# Each plant is rendered in Cycles from N azimuths (orthographic, a few degrees above the horizon) under the film's
# own sun, in two light groups: the sun alone (with its bounce off the ground) and the sky alone (uniform, white).
# The film then relights every pixel with its own sun irradiance, cloud shadow and sky ambient, so self-shadowing,
# leaf translucency and bounce light come straight from the path tracer. A top-down render of each plant's shadow
# and sky occlusion on the ground gives its contact-shadow decal. Instances keep a fixed orientation (the lighting
# is baked for one sun direction); variety comes from many plants, mirroring about the sun plane and scale.
#
# Writes assets/<film>/tex/scrub_sun.webp   (RGB: sun radiance per unit irradiance x pi, straight colour; A: coverage)
#        assets/<film>/tex/scrub_sky.webp   (RGB: radiance under a uniform sky of radiance 1)
#        assets/<film>/tex/scrub_shadow.webp (R: sun shadow 0..1, G: sky occlusion 0..1, one cell per plant)
#        src/scrub_atlas_<film>.js          (layout and sizes, read by the film)
import os, sys, math, json, time, zlib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import bpy
import numpy as np
from mathutils import Vector, Matrix
from PIL import Image
import dowlib as d

A = {k: v for k, v in (a.lstrip('-').split('=', 1) for a in d.args() if '=' in a)}
SUN_AZ, SUN_EL = (float(x) for x in A.get('sun', '68,8').split(','))
ELEV = float(A.get('elev', '3'))
FILM = A.get('film', 'quarterhorse')
VIEWS = int(A.get('views', '16'))
SAMPLES = int(A.get('samples', '64'))
ONLY = set(A['only'].split(',')) if 'only' in A else None
REUSE = A.get('reuse', '0') == '1'     # with --only: plants not listed are read back from their cached renders
SOIL = (0.27, 0.2, 0.145)     # ground albedo under the plants (bounce light)

PROBE = A.get('probe')                  # write one contact sheet of every plant (view 0 and 4) here and stop
RNG = np.random.default_rng(20260526)

# Per film: name -> plant recipe. Every plant is built from photoscanned CC0 parts (Poly Haven's Namaqualand / Karoo
# collection and its dry grass), assembled into the growth form of the real species:
#   ('obj', model, object, scale)                          one scanned plant, scaled
#   ('cluster', model, objects, n, scale, lean, crown)     n copies of the scanned stems on one root crown (crown: m),
#                                                          each leaning outwards by lean (deg, lo..hi): a multi-stemmed shrub
#   ('bunch', blades, size, lean, dead)                    one bunchgrass: blades tufts of the scanned grass on one crown,
#                                                          dead: share of old grey blades among the straw ones
# and per plant: cell px, the film's slot ('creosote', 'mesquite', 'snakeweed', 'grass': the four species slots the film's
# field knows), the look (leaf colour, below) and ring = (tufts, radius m): dry grass at the shrub's base.
# Chihuahuan basin floor at Spaceport America (film 1): creosote under about 1.5 m, mesquite mounds, snakeweed half a
# metre, and bunchgrass that is straw-coloured and dormant in late May. Mojave at Edwards (film 2): creosote, grey
# saltbush mounds and burrobush, sparse dry grass. Creosote is many slender stems from the ground, vase-shaped and open
# (the rooibos stems, clustered); saltbush and mesquite are dense rounded mounds (Searsia burchellii scaled down);
# burrobush and snakeweed are low domes of fine stems (small rooibos, leaning outwards). Grass is single bunches only:
# the field gathers them into clumps, so no two neighbours are the same baked pair.
RB = 'wild_rooibos_bush'
SB = 'searsia_burchellii'
GRASS = {
    'grass_a': (('bunch', 22, 0.80, 28, 0.15), 256),
    'grass_b': (('bunch', 14, 0.62, 18, 0.35), 256),
    'grass_c': (('bunch', 30, 0.95, 34, 0.25), 256),
    'grass_d': (('bunch', 10, 0.55, 12, 0.50), 256),
    'grass_e': (('bunch', 26, 0.72, 42, 0.05), 256),
    'grass_f': (('bunch', 18, 1.05, 22, 0.30), 256),
    'grass_g': (('bunch', 12, 0.68, 30, 0.65), 256),
    'grass_h': (('bunch', 34, 0.60, 24, 0.20), 256),
}
def _p(recipe, cell, slot, look, ring=None):
    return {'recipe': recipe, 'cell': cell, 'slot': slot, 'look': look, 'ring': ring}
CREO = lambda look: {
    'creo_a': _p(('cluster', RB, ('wild_rooibos_bush_a', 'wild_rooibos_bush_b'), 11, 2.1, (6, 26), 0.10), 256, 'creosote', look, (4, 0.45)),
    'creo_b': _p(('cluster', RB, ('wild_rooibos_bush_a', 'wild_rooibos_bush_b', 'wild_rooibos_bush_c'), 10, 2.45, (8, 30), 0.12), 256, 'creosote', look, (3, 0.5)),
    'creo_c': _p(('cluster', RB, ('wild_rooibos_bush_b', 'wild_rooibos_bush_c'), 13, 1.75, (10, 34), 0.08), 256, 'creosote', look),
    'creo_d': _p(('cluster', RB, ('wild_rooibos_bush_a',), 8, 2.25, (12, 30), 0.14), 256, 'creosote', look, (5, 0.55)),
}
PRESETS = {
    'quarterhorse': {**CREO('creosote'),
        'mesq_a': _p(('obj', SB, 'searsia_burchellii_large_LOD0', 0.30), 256, 'mesquite', 'mesquite', (5, 0.75)),
        'mesq_b': _p(('cluster', RB, ('wild_rooibos_bush_a', 'wild_rooibos_bush_b'), 15, 1.8, (18, 50), 0.14), 256, 'mesquite', 'mesquite', (4, 0.6)),
        'snake_a': _p(('cluster', RB, ('wild_rooibos_bush_c', 'wild_rooibos_bush_d'), 11, 1.0, (18, 52), 0.06), 128, 'snakeweed', 'snakeweed'),
        'snake_b': _p(('cluster', RB, ('wild_rooibos_bush_d', 'wild_rooibos_bush_e'), 14, 1.25, (20, 58), 0.05), 128, 'snakeweed', 'snakeweed'),
        'snake_c': _p(('cluster', RB, ('wild_rooibos_bush_c', 'wild_rooibos_bush_e'), 9, 0.9, (14, 46), 0.05), 128, 'snakeweed', 'snakeweed'),
        **{k: _p(r, c, 'grass', 'grass') for k, (r, c) in GRASS.items()},
    },
    'fury': {**CREO('creosote'),
        'salt_a': _p(('cluster', RB, ('wild_rooibos_bush_a', 'wild_rooibos_bush_b'), 16, 1.5, (20, 55), 0.12), 256, 'mesquite', 'saltbush', (4, 0.5)),
        'salt_b': _p(('cluster', RB, ('wild_rooibos_bush_b', 'wild_rooibos_bush_c'), 18, 1.75, (25, 62), 0.15), 256, 'mesquite', 'saltbush', (5, 0.55)),
        'salt_c': _p(('obj', SB, 'searsia_burchellii_large_LOD0', 0.27), 256, 'mesquite', 'saltbush', (6, 0.7)),
        'burro_a': _p(('cluster', RB, ('wild_rooibos_bush_c', 'wild_rooibos_bush_d'), 12, 1.05, (20, 60), 0.06), 128, 'snakeweed', 'burrobush'),
        'burro_b': _p(('cluster', RB, ('wild_rooibos_bush_d', 'wild_rooibos_bush_e'), 15, 1.3, (22, 62), 0.05), 128, 'snakeweed', 'burrobush'),
        'burro_c': _p(('cluster', RB, ('wild_rooibos_bush_c', 'wild_rooibos_bush_e'), 10, 0.95, (16, 50), 0.05), 128, 'snakeweed', 'burrobush'),
        **{k: _p(r, c, 'grass', 'grass') for k, (r, c) in GRASS.items()},
    },
}
PLANTS = PRESETS[A.get('preset', FILM)]
# Leaf and stem colour per look and film: the scan's own variation kept, desaturated to sat and graded so its mean (over
# the plant's texture atlas) lands on target (linear albedo); trans: leaf translucency tint. Real canopy albedos: creosote
# a dark resinous olive (about 0.08 to 0.1), saltbush and burrobush pale grey-green and grey (scaly leaves, about 0.3),
# dormant bunchgrass straw (about 0.35), old blades grey.
LOOKS = {
    'quarterhorse': {
        'creosote': {'leaf': ((0.15, 0.16, 0.08), 0.7), 'bark': ((0.12, 0.10, 0.08), 0.5), 'trans': (0.5, 0.6, 0.16)},
        'mesquite': {'leaf': ((0.14, 0.16, 0.075), 0.8), 'bark': ((0.12, 0.10, 0.08), 0.5), 'trans': (0.45, 0.62, 0.14)},
        'snakeweed': {'leaf': ((0.16, 0.17, 0.07), 0.85), 'bark': ((0.15, 0.13, 0.08), 0.6), 'trans': (0.6, 0.6, 0.2)},
        'grass': {'leaf': ((0.37, 0.305, 0.20), 0.7), 'trans': (0.75, 0.62, 0.36)},
        'grass_dead': {'leaf': ((0.27, 0.25, 0.215), 0.3), 'trans': (0.6, 0.56, 0.48)},
    },
    'fury': {
        'creosote': {'leaf': ((0.17, 0.175, 0.095), 0.65), 'bark': ((0.13, 0.11, 0.09), 0.5), 'trans': (0.5, 0.6, 0.18)},
        'saltbush': {'leaf': ((0.31, 0.325, 0.275), 0.35), 'bark': ((0.24, 0.22, 0.19), 0.4), 'trans': (0.55, 0.6, 0.42)},
        'burrobush': {'leaf': ((0.27, 0.27, 0.235), 0.3), 'bark': ((0.22, 0.2, 0.17), 0.4), 'trans': (0.5, 0.52, 0.4)},
        'grass': {'leaf': ((0.42, 0.34, 0.21), 0.75), 'trans': (0.75, 0.62, 0.36)},
        'grass_dead': {'leaf': ((0.29, 0.27, 0.23), 0.3), 'trans': (0.6, 0.56, 0.48)},
    },
}
LOOK = LOOKS[A.get('preset', FILM)]
OUT_TEX = d.out_path(FILM, 'tex', 'x').rsplit(os.sep, 1)[0]
BAKE = d.bake_dir('scrub', FILM)
SLOTS = ('sun', 'sky', 'alpha')


def sun_dir():
    az, el = math.radians(SUN_AZ), math.radians(SUN_EL)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))   # Blender: +Y north


def setup_scene():
    sc = d.reset(samples=SAMPLES)
    c = sc.cycles
    c.use_adaptive_sampling = True; c.adaptive_threshold = 0.006
    c.max_bounces = 8; c.diffuse_bounces = 3; c.glossy_bounces = 2; c.transmission_bounces = 6; c.transparent_max_bounces = 48
    c.use_denoising = False; c.filter_width = 1.3
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.use_persistent_data = True
    w = d.ensure_world(color=(1.0, 1.0, 1.0)); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    vl = sc.view_layers[0]
    for n in ('sun', 'sky'):
        if n not in vl.lightgroups:
            vl.lightgroups.add(name=n)
    w.lightgroup = 'sky'
    ld = bpy.data.lights.new('sun', 'SUN'); ld.energy = 1.0; ld.angle = math.radians(0.53)
    lo = bpy.data.objects.new('sun', ld); sc.collection.objects.link(lo)
    lo.rotation_euler = (-sun_dir()).to_track_quat('-Z', 'Y').to_euler(); lo.lightgroup = 'sun'
    bpy.ops.mesh.primitive_plane_add(size=80)
    g = bpy.context.active_object; g.name = 'ground'
    m, b, _, _ = d.new_material('ground'); b.inputs['Base Color'].default_value = (*SOIL, 1); b.inputs['Roughness'].default_value = 1.0
    d.set_material(g, m); g.visible_camera = False
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co); sc.camera = co
    # compositor: write the two light groups and coverage as half-float EXRs
    sc.use_nodes = True
    nt = sc.node_tree; nt.nodes.clear()
    rl = nt.nodes.new('CompositorNodeRLayers')
    fo = nt.nodes.new('CompositorNodeOutputFile'); fo.base_path = BAKE
    fo.format.file_format = 'OPEN_EXR'; fo.format.color_depth = '16'; fo.format.color_mode = 'RGBA'
    fo.file_slots.clear()
    for slot in SLOTS:
        fo.file_slots.new(slot)
    outs = {s.name: s for s in rl.outputs if s.enabled}
    d.log('render layer outputs:', [s for s in outs])
    nt.links.new(outs['Combined_sun'], fo.inputs['sun'])
    nt.links.new(outs['Combined_sky'], fo.inputs['sky'])
    nt.links.new(outs['Alpha'], fo.inputs['alpha'])
    return sc, g, m, co, fo


def alpha_map(mat, model):
    """Poly Haven's glTF plants point at a JPEG diffuse atlas, which has no alpha channel: the cut-out is a separate
    Alpha map the glTF never references. Imported as they are, every leaf, needle and twig card renders as a solid
    quad showing the atlas's black background (the cause of the near-black plants). Returns the Alpha map's socket,
    sampled with the diffuse texture's own coordinates, or None for an opaque material (trunk bark)."""
    nm = mat.name.split('.')[0]
    if not (nm.endswith('_leaves') or nm.endswith('_twigs') or model.startswith('grass')):
        return None
    p = d.polyhaven_texture(model, '2k', maps=('Alpha',), fmt='png').get('Alpha')
    if not p:
        return None
    nt = mat.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = d.image(p, non_color=True)
    src = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n is not tn and n.image and 'diff' in n.image.name), None)
    if src is not None and src.inputs['Vector'].is_linked:
        nt.links.new(src.inputs['Vector'].links[0].from_socket, tn.inputs['Vector'])
    for l in list(bs.inputs['Alpha'].links):
        nt.links.remove(l)
    bs.inputs['Alpha'].default_value = 1.0
    return tn.outputs['Color']


def cutout(mat, shader, alpha):
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    if alpha is not None:
        tp = nt.nodes.new('ShaderNodeBsdfTransparent'); cut = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(alpha, cut.inputs['Fac']); nt.links.new(tp.outputs['BSDF'], cut.inputs[1]); nt.links.new(shader, cut.inputs[2])
        shader = cut.outputs['Shader']
    nt.links.new(shader, out.inputs['Surface'])


_tex_mean = {}


def tex_mean(model, dry=False):
    """Mean linear colour of a plant's diffuse atlas where its cut-out is solid (what the grade below is relative to)."""
    key = (model, dry)
    if key not in _tex_mean:
        mk = 'dry_diff' if dry else 'Diffuse'
        t = d.polyhaven_texture(model, '2k', maps=(mk,), fmt='jpg')
        img = np.asarray(Image.open(t[mk]).convert('RGB').reduce(4), np.float32) / 255.0
        lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
        ap = d.polyhaven_texture(model, '2k', maps=('Alpha',), fmt='png').get('Alpha')
        w = (np.asarray(Image.open(ap).convert('L').reduce(4), np.float32) / 255.0 > 0.5) if ap else np.ones(lin.shape[:2], bool)
        _tex_mean[key] = lin[w].mean(0) if w.any() else lin.reshape(-1, 3).mean(0)
    return _tex_mean[key]


def grade(nt, src, model, target, sat, dry=False):
    """The scan's colour, desaturated to sat and scaled per channel so its mean lands on target. Returns the socket."""
    m = tex_mean(model, dry)
    y = float(m @ np.array([0.2126, 0.7152, 0.0722]))
    md = y + sat * (m - y)
    k = [min(t / max(c, 1e-3), 8.0) for t, c in zip(target, md)]
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Hue'].default_value = 0.5; hsv.inputs['Saturation'].default_value = sat; hsv.inputs['Value'].default_value = 1.0
    nt.links.new(src, hsv.inputs['Color'])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
    nt.links.new(hsv.outputs['Color'], mul.inputs[6]); mul.inputs[7].default_value = (*k, 1.0)
    return mul.outputs[2]


def leaf_material(mat, look, model):
    """Recolour a leaf / blade material to its look, give it translucency and its real cut-out."""
    L = LOOK[look]; target, sat = L['leaf']; trans = L['trans']
    nt = mat.node_tree; nodes, links = nt.nodes, nt.links
    bs = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    alpha = alpha_map(mat, model)
    base = bs.inputs['Base Color']
    grass = look.startswith('grass')
    if grass:   # dormant bunchgrass: the scan's dry variant
        dry = d.polyhaven_texture(model, '2k', maps=('dry_diff',), fmt='jpg').get('dry_diff')
        if dry and base.is_linked and base.links[0].from_node.type == 'TEX_IMAGE':
            base.links[0].from_node.image = d.image(dry)
    col = None
    if base.is_linked:
        col = grade(nt, base.links[0].from_socket, model, target, sat, dry=grass)
        links.new(col, base)
    bs.inputs['Roughness'].default_value = 0.62
    for l in list(bs.inputs['Roughness'].links):
        links.remove(l)
    tr = nodes.new('ShaderNodeBsdfTranslucent')
    if col is not None:
        mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
        links.new(col, mul.inputs[6]); mul.inputs[7].default_value = (*[min(1.0, c * 1.6) for c in trans], 1.0)
        links.new(mul.outputs[2], tr.inputs['Color'])
    else:
        tr.inputs['Color'].default_value = (*trans, 1.0)
    mix = nodes.new('ShaderNodeMixShader'); mix.inputs['Fac'].default_value = 0.3 if grass else 0.36
    links.new(bs.outputs['BSDF'], mix.inputs[1]); links.new(tr.outputs['BSDF'], mix.inputs[2])
    cutout(mat, mix.outputs['Shader'], alpha)


def bark_material(mat, look, model):
    L = LOOK[look]
    nt = mat.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    alpha = alpha_map(mat, model)
    if bs.inputs['Base Color'].is_linked and 'bark' in L:
        target, sat = L['bark']
        col = grade(nt, bs.inputs['Base Color'].links[0].from_socket, model, target, sat)
        nt.links.new(col, bs.inputs['Base Color'])
    cutout(mat, bs.outputs['BSDF'], alpha)


_imported = {}
_mats = {}


def library(model):
    if model not in _imported:
        objs = d.import_gltf(d.polyhaven_model(model, '2k'))
        for o in objs:
            o.hide_render = True
        _imported[model] = {o.name: o for o in objs if o.type == 'MESH'}
    return _imported[model]


def processed(m, look, model):
    """The material m recoloured for a look (one copy per original material and look)."""
    base = m.name.split('.')[0]
    key = (base, look)
    if key not in _mats:
        c = m.copy()
        (leaf_material if (base.endswith('_leaves') or look.startswith('grass')) else bark_material)(c, look, model)
        _mats[key] = c
    return _mats[key]


def part(model, objname, look, mw, rng=None):
    """A copy of one scanned object with its look's materials, at world matrix mw (its base at the mesh origin)."""
    src = library(model)[objname]
    o = src.copy(); o.data = src.data.copy(); bpy.context.scene.collection.objects.link(o)
    for i, m in enumerate(o.data.materials):
        o.data.materials[i] = processed(m, look, model)
    o.matrix_world = mw
    o.hide_render = False
    return o


def grass_bunch(rng, blades, size, lean_max, dead):
    """One bunchgrass: `blades` of the scan's larger tufts on one crown, leaning outwards, a share of them old grey
    blades. Single bunches only: clumps are made in the film's field, each bunch with its own size and mirroring."""
    names = sorted(library('grass_medium_02'))
    parts = []
    for k in range(blades):
        src = names[int(rng.integers(1, len(names)))]          # the larger tufts
        a = rng.uniform(0, 2 * math.pi); r = 0.085 * size * math.sqrt(rng.uniform(0, 1))
        lean = math.radians(rng.uniform(3, lean_max)) * (0.3 + 0.7 * r / (0.085 * size))
        sc = size * rng.uniform(0.85, 1.6)
        rot = Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(lean, 4, 'Y') @ Matrix.Rotation(rng.uniform(0, 2 * math.pi), 4, 'Z')
        mw = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0)) @ rot @ Matrix.Diagonal((sc, sc, sc * rng.uniform(0.9, 1.35), 1))
        parts.append(part('grass_medium_02', src, 'grass_dead' if rng.uniform() < dead else 'grass', mw))
    return parts


def shrub_cluster(rng, model, objs, n, scale, lean, crown, look):
    """A multi-stemmed shrub: n scanned stems on one root crown, the outer ones leaning further out."""
    parts = []
    for k in range(n):
        a = rng.uniform(0, 2 * math.pi) if k else 0.0
        r = crown * math.sqrt(rng.uniform(0.05, 1.0)) if k else 0.0
        lean_k = math.radians(rng.uniform(*lean)) * (0.35 + 0.65 * (r / crown if crown > 0 else 1.0)) if k else math.radians(lean[0]) * 0.3
        sc = scale * rng.uniform(0.72, 1.12)
        rot = Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(lean_k, 4, 'Y') @ Matrix.Rotation(rng.uniform(0, 2 * math.pi), 4, 'Z')
        mw = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0)) @ rot @ Matrix.Diagonal((sc, sc, sc * rng.uniform(0.9, 1.1), 1))
        parts.append(part(model, objs[int(rng.integers(len(objs)))], look, mw))
    return parts


def crown_of(o):
    """Root crown (x, y) of an object in world space: the centre of its lowest vertices."""
    vs = np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices])
    z0 = vs[:, 2].min()
    low = vs[vs[:, 2] < z0 + 0.08 * (vs[:, 2].max() - z0)]
    return low[:, 0].mean(), low[:, 1].mean(), z0


def build_plant(name, spec):
    """Assemble one plant (joined into a single object at the origin) from its recipe."""
    rng = np.random.default_rng(zlib.crc32(name.encode()) + 20260526)
    rc = spec['recipe']
    if rc[0] == 'bunch':
        parts = grass_bunch(rng, *rc[1:])
    elif rc[0] == 'cluster':
        parts = shrub_cluster(rng, *rc[1:], spec['look'])
    else:
        _, model, objname, scale = rc
        o = part(model, objname, spec['look'], Matrix.Diagonal((scale, scale, scale, 1)))
        bpy.context.view_layer.update()
        cx, cy, z0 = crown_of(o)
        o.matrix_world = Matrix.Translation((-cx, -cy, -z0)) @ o.matrix_world
        parts = [o]
    if spec.get('ring'):   # dry grass at the shrub's base, where its litter and shade hold moisture
        cnt, rad = spec['ring']
        names = sorted(library('grass_medium_02'))
        for k in range(cnt):
            a = (k + rng.uniform(0.15, 0.85)) / cnt * 2 * math.pi; r = rad * rng.uniform(0.7, 1.1)
            sc = rng.uniform(0.55, 0.95)
            rot = Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(math.radians(rng.uniform(5, 25)), 4, 'Y') @ Matrix.Rotation(rng.uniform(0, 6.3), 4, 'Z')
            mw = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0)) @ rot @ Matrix.Diagonal((sc, sc, sc, 1))
            parts.append(part('grass_medium_02', names[int(rng.integers(1, len(names)))], 'grass_dead' if rng.uniform() < 0.3 else 'grass', mw))
    bpy.context.view_layer.update()
    d.select(parts, parts[0])
    bpy.ops.object.join()
    ob = bpy.context.active_object; ob.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.hide_render = True
    return ob


def place(ob, scale):
    """Base of the plant at the origin, uniform scale; returns (radius, height) in metres."""
    ob.hide_render = False
    ob.rotation_euler = (0, 0, 0); ob.scale = (scale, scale, scale); ob.location = (0, 0, 0)
    bpy.context.view_layer.update()
    vs = np.array([(ob.matrix_world @ v.co)[:] for v in ob.data.vertices])
    z0 = vs[:, 2].min()
    low = vs[vs[:, 2] < z0 + 0.08 * (vs[:, 2].max() - z0)]
    cx, cy = low[:, 0].mean(), low[:, 1].mean()          # the root crown, not the bounding-box centre
    ob.location = (-cx, -cy, -z0)
    bpy.context.view_layer.update()
    vs = vs - np.array([cx, cy, z0])
    r = float(np.sqrt((vs[:, 0] ** 2 + vs[:, 1] ** 2)).max())
    return r, float(vs[:, 2].max())


def render_to(tag, cached=False):
    """Render, letting the compositor write each light group to its own EXR; returns {slot: float array (h, w, 4)}.
    cached: read the EXRs of an earlier run instead of rendering."""
    sc = bpy.context.scene
    fo = sc.node_tree.nodes['File Output']
    for slot, nm in zip(fo.file_slots, SLOTS):
        slot.path = f'{tag}_{nm}_'
    if not cached:
        bpy.ops.render.render(write_still=False)
    out = {}
    for nm in SLOTS:
        p = os.path.join(BAKE, f'{tag}_{nm}_{sc.frame_current:04d}.exr')
        img = bpy.data.images.load(p); out[nm] = d.pixels(img).copy(); bpy.data.images.remove(img)
    return out


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def dilate(rgb, a, iters=24):
    """Bleed colour into transparent pixels so filtering and mipmaps never pull in black."""
    rgb = rgb.copy(); w = (a > 0.004).astype(np.float32)
    acc = rgb * w[..., None]
    for _ in range(iters):
        if w.min() > 0:
            break
        k = lambda x: (np.roll(x, 1, 0) + np.roll(x, -1, 0) + np.roll(x, 1, 1) + np.roll(x, -1, 1))
        ws, cs = k(w), k(acc)
        fill = (w == 0) & (ws > 0)
        acc[fill] = cs[fill] / ws[fill][..., None]; w[fill] = 1.0
    out = np.where((a > 0.004)[..., None], rgb, acc)
    return out


sc, ground, gmat, cam, fo = setup_scene()
plants = [k for k in PLANTS if ONLY is None or k in ONLY or REUSE]
views = {}
meta = []
t0 = time.time()
sd = sun_dir(); anti = Vector((-sd.x, -sd.y, 0)).normalized()
for name in plants:
    spec = PLANTS[name]; cell, species = spec['cell'], spec['slot']
    ob = build_plant(name, spec)
    r, hgt = place(ob, 1.0)
    cached = REUSE and ONLY is not None and name not in ONLY
    S = max(2.0 * r, hgt / 0.93) * 1.06          # cell side (m); ground line 4 % above the bottom edge
    base = 0.04 * S
    sc.render.resolution_x = sc.render.resolution_y = cell
    cam.data.ortho_scale = S
    ground.visible_camera = False; ob.visible_camera = True
    cells = []
    if PROBE:   # look-dev: two views of each plant, relit with a low sun and sky, side by side on the soil colour
        row = []
        for k in (0, VIEWS // 4):
            az = math.radians(k * 360.0 / VIEWS); el = math.radians(ELEV)
            dvec = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
            cam.location = Vector((0, 0, S / 2 - base)) + dvec * 30.0
            cam.rotation_euler = (-dvec).to_track_quat('-Z', 'Y').to_euler()
            cam.data.clip_start = 1.0; cam.data.clip_end = 80.0
            sc.render.resolution_x = sc.render.resolution_y = 256
            res = render_to(f'probe_{name}_v{k:02d}')
            a = res['alpha'][..., :1]
            lit = res['sun'][..., :3] * 9.0 + res['sky'][..., :3] * 0.5        # sun irradiance 9, sky radiance 0.5 (about el 8)
            soil = np.array(SOIL) * (9.0 * math.sin(math.radians(SUN_EL)) / math.pi + 0.5)
            row.append((lit + soil * (1 - a))[::-1] * 0.8)
            m = a[..., 0] > 0.5
            d.log(f'PROBE {name} v{k}: mean sun {(res["sun"][..., :3][m] * math.pi).mean(0).round(3)} sky {res["sky"][..., :3][m].mean(0).round(3)} cover {m.mean():.3f}')
        views[name] = np.hstack(row); ob.hide_render = True
        meta.append({'name': name, 'r': r, 'h': hgt, 'S': S})
        d.log(f'PROBE {name}: r {r:.2f} h {hgt:.2f} cell {S:.2f} m, {time.time() - t0:.0f} s')
        continue
    for k in range(VIEWS):
        az = math.radians(k * 360.0 / VIEWS); el = math.radians(ELEV)
        dvec = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
        target = Vector((0, 0, S / 2 - base))
        cam.location = target + dvec * 30.0
        cam.rotation_euler = (-dvec).to_track_quat('-Z', 'Y').to_euler()
        cam.data.clip_start = 1.0; cam.data.clip_end = 80.0
        res = render_to(f'{name}_v{k:02d}', cached)
        cells.append(res)
    # shadow decal: the ground seen from above, the plant hidden from the camera but casting shadow and occlusion
    back, front, half = 0.7 * r + 0.1, hgt / math.tan(math.radians(SUN_EL)) + r + 0.2, 1.2 * r + 0.15
    L = max(back + front, 8.0 * half)            # the decal image is 4:1: it spans L along the shadow, L / 4 across
    u0 = (front - back) / 2 - L / 2
    sc.render.resolution_x, sc.render.resolution_y = 512, 128
    cam.data.ortho_scale = L
    cen = anti * ((front - back) / 2)
    cam.location = Vector((cen.x, cen.y, 30.0))
    cam.rotation_euler = Matrix(((anti.x, -anti.y, 0), (anti.y, anti.x, 0), (0, 0, 1))).to_euler()
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
    ground.visible_camera = True; ob.visible_camera = False
    dec = render_to(f'{name}_shadow', cached)
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*SOIL, 1)
    ground.visible_camera = False; ob.visible_camera = True
    ob.hide_render = True
    sun_ground = math.sin(math.radians(SUN_EL)) / math.pi
    shadow = np.clip(1.0 - dec['sun'][..., :3].mean(2) / sun_ground, 0, 1)
    occl = np.clip(1.0 - dec['sky'][..., :3].mean(2), 0, 1)
    views[name] = (cells, shadow, occl)
    meta.append({'name': name, 'species': species, 'size': round(S, 4), 'base': round(base, 4), 'radius': round(r, 4), 'height': round(hgt, 4),
                 'cell': cell, 'decal': [round(u0, 4), round(u0 + L, 4), round(L / 8, 4)]})   # along from, along to, half across (m)
    d.log(f'{name}: r {r:.2f} m, h {hgt:.2f} m, cell {S:.2f} m, {VIEWS} views + shadow, {time.time() - t0:.0f} s')

if PROBE:
    rows = [np.hstack([views[m['name']] for m in meta[i:i + 4]] + [np.zeros((256, 512 * (4 - len(meta[i:i + 4])), 3), np.float32)] * (len(meta[i:i + 4]) < 4)) for i in range(0, len(meta), 4)]
    Image.fromarray((lin_to_srgb(np.vstack(rows)) * 255 + 0.5).astype(np.uint8), 'RGB').save(PROBE)
    d.log('probe sheet', PROBE)
    sys.exit(0)

# ---------------------------------------------------------------- atlases
big = [m for m in meta if m['cell'] == 256]; small = [m for m in meta if m['cell'] == 128]
W = 256 * VIEWS
rows_small = (len(small) + 1) // 2
H = 256 * len(big) + 128 * rows_small
sun_a = np.zeros((H, W, 4), np.float32); sky_a = np.zeros((H, W, 3), np.float32)
y = 0
place_at = {}
for m in big:
    place_at[m['name']] = (0, y); y += 256
for i, m in enumerate(small):
    place_at[m['name']] = ((i % 2) * 128 * VIEWS, y + (i // 2) * 128)
avg = {}
for m in meta:
    cells, shadow, occl = views[m['name']]
    x0, y0 = place_at[m['name']]; c = m['cell']
    m['atlas'] = [x0, y0]                       # pixel origin (top-left) of view 0; view k at x0 + k * cell
    acc_s = np.zeros(3); acc_k = np.zeros(3); acc_a = 0.0
    for k, res in enumerate(cells):
        a = res['alpha'][..., 0]
        s = res['sun'][..., :3] * math.pi; k3 = res['sky'][..., :3]
        acc_s += s.reshape(-1, 3).sum(0); acc_k += k3.reshape(-1, 3).sum(0); acc_a += a.sum()
        inv = 1.0 / np.maximum(a, 1e-4)
        s_st = dilate(np.clip(s * inv[..., None], 0, 4), a); k_st = dilate(np.clip(k3 * inv[..., None], 0, 4), a)
        # Blender rows run bottom-up; atlas rows top-down
        sun_a[y0:y0 + c, x0 + k * c:x0 + (k + 1) * c, :3] = s_st[::-1]
        sun_a[y0:y0 + c, x0 + k * c:x0 + (k + 1) * c, 3] = a[::-1]
        sky_a[y0:y0 + c, x0 + k * c:x0 + (k + 1) * c] = k_st[::-1]
    m['avg'] = {'sun': [round(float(v), 4) for v in acc_s / max(acc_a, 1)], 'sky': [round(float(v), 4) for v in acc_k / max(acc_a, 1)],
                'cover': round(float(acc_a / (VIEWS * c * c)), 4)}
q8 = lambda x: (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(np.dstack([q8(lin_to_srgb(sun_a[..., :3])), q8(sun_a[..., 3])]), 'RGBA').save(
    os.path.join(OUT_TEX, 'scrub_sun.webp'), 'WEBP', quality=90, alpha_quality=100, method=6)
Image.fromarray(q8(lin_to_srgb(sky_a)), 'RGB').save(os.path.join(OUT_TEX, 'scrub_sky.webp'), 'WEBP', quality=88, method=6)
# shadow decals: 512 x 128 each, eight to a row (the texture stays within 4096 px on every GPU)
DCOL = min(8, len(meta)); DROWS = (len(meta) + DCOL - 1) // DCOL
dec = np.zeros((128 * DROWS, 512 * DCOL, 3), np.float32)
for i, m in enumerate(meta):
    _, shadow, occl = views[m['name']]
    x0, y0 = (i % DCOL) * 512, (i // DCOL) * 128
    dec[y0:y0 + 128, x0:x0 + 512, 0] = shadow[::-1]; dec[y0:y0 + 128, x0:x0 + 512, 1] = occl[::-1]
    m['decalAt'] = [x0, y0]                     # pixel origin (top-left) of its decal
Image.fromarray(q8(dec), 'RGB').save(os.path.join(OUT_TEX, 'scrub_shadow.webp'), 'WEBP', quality=90, method=6)
atlas = {'film': FILM, 'sun': [SUN_AZ, SUN_EL], 'elev': ELEV, 'views': VIEWS, 'size': [W, H], 'decalSize': [512 * DCOL, 128 * DROWS],
         'files': {k: f'{FILM}/tex/scrub_{k}.webp' for k in ('sun', 'sky', 'shadow')}, 'plants': meta}
js = os.path.join(d.FILMS, 'src', f'scrub_atlas_{FILM}.js')
with open(js, 'w') as f:
    f.write(f'// Generated by blender/scrub.py ({FILM}: sun az {SUN_AZ:g} el {SUN_EL:g}, views {VIEWS} at {ELEV:g} deg). Do not edit.\n')
    f.write(f'export const SCRUB_ATLAS = {json.dumps(atlas, indent=1)};\n')
for k in ('sun', 'sky', 'shadow'):
    p = os.path.join(OUT_TEX, f'scrub_{k}.webp'); d.log(p, os.path.getsize(p) // 1024, 'KB')
d.log(f'scrub: {len(meta)} plants in {time.time() - t0:.0f} s -> {js}')
