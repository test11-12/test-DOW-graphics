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
import os, sys, math, json, time
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

# Per film: name -> (Poly Haven model, object or grass-clump recipe, scale, cell px, species).
# Chihuahuan basin floor at Spaceport America (film 1): creosote 1 to 2 m, a low mesquite, snakeweed, and bunchgrass
# that is straw-coloured and dormant in late May. Mojave at Edwards (film 2): creosote, grey saltbush / burrobush,
# sparse dry grass. Stand-ins: Searsia lucida and wild rooibos scaled up (open, many slender stems, small leaves at
# the tips) for creosote, Searsia burchellii for the denser shrub, small rooibos for the sub-shrubs, and tufts built
# from the dry variant of Poly Haven's grass for the bunchgrass (a tuft: dozens of blades from one crown).
CREOSOTE = {
    'creo_a': ('searsia_lucida', 'searsia_lucida_b_LOD0', 0.92, 256, 'creosote'),
    'creo_b': ('searsia_lucida', 'searsia_lucida_c_LOD0', 0.95, 256, 'creosote'),
    'creo_c': ('searsia_lucida', 'searsia_lucida_d_LOD0', 0.95, 256, 'creosote'),
    'creo_e': ('wild_rooibos_bush', 'wild_rooibos_bush_a', 2.3, 256, 'creosote'),
    'creo_f': ('wild_rooibos_bush', 'wild_rooibos_bush_b', 2.5, 256, 'creosote'),
}
PRESETS = {
    'quarterhorse': {**CREOSOTE,
        'mesq_s': ('searsia_burchellii', 'searsia_burchellii_small_LOD0', 0.55, 256, 'mesquite'),
        'snake_a': ('wild_rooibos_bush', 'wild_rooibos_bush_c', 1.0, 128, 'snakeweed'),
        'snake_b': ('wild_rooibos_bush', 'wild_rooibos_bush_d', 1.15, 128, 'snakeweed'),
        'snake_c': ('wild_rooibos_bush', 'wild_rooibos_bush_e', 1.4, 128, 'snakeweed'),
        'grass_a': ('grass_medium_02', ('clump', 3, 0.42, 0.7), 1.0, 256, 'grass'),
        'grass_b': ('grass_medium_02', ('clump', 2, 0.3, 0.8), 1.0, 256, 'grass'),
        'grass_c': ('grass_medium_02', ('clump', 5, 0.55, 0.62), 1.0, 256, 'grass'),
        'grass_d': ('grass_medium_02', ('clump', 1, 0.0, 0.85), 1.0, 256, 'grass'),
    },
    'fury': {**CREOSOTE,
        'mesq_s': ('searsia_burchellii', 'searsia_burchellii_small_LOD0', 0.42, 256, 'mesquite'),
        'snake_a': ('wild_rooibos_bush', 'wild_rooibos_bush_c', 1.2, 128, 'snakeweed'),
        'snake_b': ('wild_rooibos_bush', 'wild_rooibos_bush_d', 1.4, 128, 'snakeweed'),
        'snake_c': ('wild_rooibos_bush', 'wild_rooibos_bush_e', 1.6, 128, 'snakeweed'),
        'grass_a': ('grass_medium_02', ('clump', 2, 0.35, 0.6), 1.0, 256, 'grass'),
        'grass_b': ('grass_medium_02', ('clump', 1, 0.0, 0.65), 1.0, 256, 'grass'),
    },
}
PLANTS = PRESETS[A.get('preset', FILM)]
# leaf colour by species and film: hue shift (towards yellow < 0), saturation, value, translucency tint (linear)
LEAVES = {
    'quarterhorse': {
        'creosote': (-0.02, 0.62, 0.42, (0.5, 0.6, 0.16)),      # dark olive, resinous
        'mesquite': (0.0, 0.7, 0.55, (0.45, 0.62, 0.14)),
        'snakeweed': (-0.035, 0.75, 0.8, (0.6, 0.6, 0.2)),      # yellow-green
        'grass': (0.0, 0.8, 1.0, (0.75, 0.62, 0.36)),           # straw (the scan's own dry variant)
    },
    'fury': {
        'creosote': (-0.02, 0.6, 0.42, (0.5, 0.6, 0.16)),
        'mesquite': (0.02, 0.25, 0.9, (0.5, 0.55, 0.4)),        # saltbush: pale grey-green
        'snakeweed': (-0.01, 0.3, 0.75, (0.55, 0.55, 0.35)),    # burrobush: grey
        'grass': (0.0, 0.7, 0.95, (0.75, 0.62, 0.36)),
    },
}
LEAF = LEAVES[A.get('preset', FILM)]
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


def leaf_material(mat, species, model):
    """Recolour a leaf / blade material, give it translucency and its real cut-out."""
    hue, sat, val, trans = LEAF[species]
    nt = mat.node_tree; nodes, links = nt.nodes, nt.links
    bs = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    alpha = alpha_map(mat, model)
    base = bs.inputs['Base Color']
    if species == 'grass':   # dormant bunchgrass: the scan's dry variant
        dry = d.polyhaven_texture(model, '2k', maps=('dry_diff',), fmt='jpg').get('dry_diff')
        if dry and base.is_linked and base.links[0].from_node.type == 'TEX_IMAGE':
            base.links[0].from_node.image = d.image(dry)
    col = None
    if base.is_linked:
        src = base.links[0].from_socket
        hsv = nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Hue'].default_value = 0.5 + hue; hsv.inputs['Saturation'].default_value = sat; hsv.inputs['Value'].default_value = val
        links.new(src, hsv.inputs['Color']); links.new(hsv.outputs['Color'], base)
        col = hsv.outputs['Color']
    bs.inputs['Roughness'].default_value = 0.6
    for l in list(bs.inputs['Roughness'].links):
        links.remove(l)
    tr = nodes.new('ShaderNodeBsdfTranslucent')
    if col is not None:
        mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
        links.new(col, mul.inputs[6]); mul.inputs[7].default_value = (*[min(1.0, c * 1.6) for c in trans], 1.0)
        links.new(mul.outputs[2], tr.inputs['Color'])
    else:
        tr.inputs['Color'].default_value = (*trans, 1.0)
    mix = nodes.new('ShaderNodeMixShader'); mix.inputs['Fac'].default_value = 0.38 if species != 'grass' else 0.3
    links.new(bs.outputs['BSDF'], mix.inputs[1]); links.new(tr.outputs['BSDF'], mix.inputs[2])
    cutout(mat, mix.outputs['Shader'], alpha)


def bark_material(mat, species, model):
    nt = mat.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    alpha = alpha_map(mat, model)
    if bs.inputs['Base Color'].is_linked:
        src = bs.inputs['Base Color'].links[0].from_socket
        hsv = nt.nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Saturation'].default_value = 0.7; hsv.inputs['Value'].default_value = 0.9
        nt.links.new(src, hsv.inputs['Color']); nt.links.new(hsv.outputs['Color'], bs.inputs['Base Color'])
    cutout(mat, bs.outputs['BSDF'], alpha)


_imported = {}
_plants = {}
_mats = {}


def get_plant(model, objname, species):
    """The scanned plant (or a grass clump built from the scan's tufts), with materials processed for its species."""
    if model not in _imported:
        objs = d.import_gltf(d.polyhaven_model(model, '2k'))
        for o in objs:
            o.hide_render = True
        _imported[model] = {o.name: o for o in objs if o.type == 'MESH'}
    lib = _imported[model]
    key = (model, objname, species)
    if key in _plants:
        return _plants[key]
    if isinstance(objname, tuple):
        ob = grass_clump(lib, *objname[1:])
    else:
        ob = lib[objname].copy(); ob.data = lib[objname].data.copy(); bpy.context.scene.collection.objects.link(ob)
    for i, m in enumerate(ob.data.materials):
        mk = (m.name, species)
        if mk not in _mats:
            c = m.copy()
            (leaf_material if (c.name.split('.')[0].endswith('_leaves') or species == 'grass') else bark_material)(c, species, model)
            _mats[mk] = c
        ob.data.materials[i] = _mats[mk]
    ob.hide_render = True
    _plants[key] = ob
    return ob


def grass_clump(lib, bunches, spread, size):
    """Bunchgrass: each bunch is a few dozen of the scan's small tufts set on one crown, leaning outwards; a clump
    is one to five bunches within `spread` metres (drawn as one impostor, so a slot can hold a patch of grass)."""
    names = sorted(lib)
    parts = []
    for b in range(bunches):
        ang = RNG.uniform(0, 2 * math.pi); rad = spread * math.sqrt(RNG.uniform(0.05, 1.0)) if bunches > 1 else 0.0
        cx, cy = math.cos(ang) * rad, math.sin(ang) * rad
        bs = size * RNG.uniform(0.7, 1.15)
        for k in range(int(RNG.integers(16, 26))):
            src = lib[names[int(RNG.integers(1, len(names)))]]          # the larger tufts
            o = src.copy(); o.data = src.data.copy(); bpy.context.scene.collection.objects.link(o)
            a = RNG.uniform(0, 2 * math.pi); r = 0.085 * bs * math.sqrt(RNG.uniform(0, 1))
            lean = math.radians(RNG.uniform(4, 30)) * (0.3 + 0.7 * r / (0.085 * bs))
            sc = bs * RNG.uniform(0.95, 1.7)
            rot = Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(lean, 4, 'Y') @ Matrix.Rotation(RNG.uniform(0, 2 * math.pi), 4, 'Z')
            o.matrix_world = Matrix.Translation((cx + math.cos(a) * r, cy + math.sin(a) * r, 0)) @ rot @ Matrix.Diagonal((sc, sc, sc * RNG.uniform(0.9, 1.35), 1))
            o.hide_render = False
            parts.append(o)
    bpy.context.view_layer.update()
    d.select(parts, parts[0])
    bpy.ops.object.join()
    ob = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
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
    model, objname, scale, cell, species = PLANTS[name]
    ob = get_plant(model, objname, species)
    r, hgt = place(ob, scale)
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
dec = np.zeros((128, 512 * len(meta), 3), np.float32)
for i, m in enumerate(meta):
    _, shadow, occl = views[m['name']]
    dec[:, i * 512:(i + 1) * 512, 0] = shadow[::-1]; dec[:, i * 512:(i + 1) * 512, 1] = occl[::-1]
Image.fromarray(q8(dec), 'RGB').save(os.path.join(OUT_TEX, 'scrub_shadow.webp'), 'WEBP', quality=90, method=6)
atlas = {'film': FILM, 'sun': [SUN_AZ, SUN_EL], 'elev': ELEV, 'views': VIEWS, 'size': [W, H], 'decalSize': [512 * len(meta), 128],
         'files': {k: f'{FILM}/tex/scrub_{k}.webp' for k in ('sun', 'sky', 'shadow')}, 'plants': meta}
js = os.path.join(d.FILMS, 'src', f'scrub_atlas_{FILM}.js')
with open(js, 'w') as f:
    f.write(f'// Generated by blender/scrub.py ({FILM}: sun az {SUN_AZ:g} el {SUN_EL:g}, views {VIEWS} at {ELEV:g} deg). Do not edit.\n')
    f.write(f'export const SCRUB_ATLAS = {json.dumps(atlas, indent=1)};\n')
for k in ('sun', 'sky', 'shadow'):
    p = os.path.join(OUT_TEX, f'scrub_{k}.webp'); d.log(p, os.path.getsize(p) // 1024, 'KB')
d.log(f'scrub: {len(meta)} plants in {time.time() - t0:.0f} s -> {js}')
