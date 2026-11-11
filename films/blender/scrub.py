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
SAMPLES = int(A.get('samples', '128'))
ONLY = set(A['only'].split(',')) if 'only' in A else None
REUSE = A.get('reuse', '0') == '1'     # with --only: plants not listed are read back from their cached renders
SOIL = (0.27, 0.2, 0.145)     # ground albedo under the plants (bounce light)

# Chihuahuan stand-ins. name: (Poly Haven model, object, scale, cell px, species)
#   creosote  <- Searsia lucida: open, many slender pale stems from the base, small leaves at the tips
#   mesquite  <- Searsia burchellii (small): a denser, darker rounded shrub
#   snakeweed <- wild rooibos: small rounded yellow-green subshrubs
#   grass     <- dry grass tufts (dormant in late May: straw and grey)
PLANTS = {
    'creo_b': ('searsia_lucida', 'searsia_lucida_b_LOD0', 0.62, 256, 'creosote'),
    'creo_c': ('searsia_lucida', 'searsia_lucida_c_LOD0', 0.66, 256, 'creosote'),
    'creo_d': ('searsia_lucida', 'searsia_lucida_d_LOD0', 0.70, 256, 'creosote'),
    'creo_e': ('searsia_lucida', 'searsia_lucida_e_LOD0', 0.74, 256, 'creosote'),
    'creo_f': ('searsia_lucida', 'searsia_lucida_f_LOD0', 0.85, 256, 'creosote'),
    'mesq_s': ('searsia_burchellii', 'searsia_burchellii_small_LOD0', 0.48, 256, 'mesquite'),
    'snake_a': ('wild_rooibos_bush', 'wild_rooibos_bush_a', 1.0, 256, 'snakeweed'),
    'snake_b': ('wild_rooibos_bush', 'wild_rooibos_bush_b', 1.1, 256, 'snakeweed'),
    'snake_c': ('wild_rooibos_bush', 'wild_rooibos_bush_c', 1.15, 128, 'snakeweed'),
    'snake_d': ('wild_rooibos_bush', 'wild_rooibos_bush_d', 1.2, 128, 'snakeweed'),
    'grass_b': ('grass_medium_02', 'grass_medium_02_b', 1.5, 128, 'grass'),
    'grass_d': ('grass_medium_02', 'grass_medium_02_d', 1.25, 128, 'grass'),
    'grass_e': ('grass_medium_02', 'grass_medium_02_e', 1.15, 128, 'grass'),
}
# leaf colour by species: hue shift (towards yellow < 0), saturation, value, translucency tint (linear).
# The source scans are dark (wild rooibos and Searsia burchellii leaves sit near 0.02 linear albedo); broom snakeweed
# and honey mesquite in late May are much lighter yellow-greens, so their value is lifted a long way.
LEAF = {
    'creosote': (-0.035, 0.8, 1.0, (0.55, 0.62, 0.16)),
    'mesquite': (-0.02, 0.85, 2.1, (0.45, 0.62, 0.14)),
    'snakeweed': (-0.03, 0.8, 2.6, (0.6, 0.6, 0.2)),
    'grass': (-0.03, 0.34, 1.2, (0.7, 0.6, 0.35)),
}
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


def leaf_material(mat, species):
    """Recolour a leaf / blade material and give it translucency, keeping its alpha cut-out."""
    hue, sat, val, trans = LEAF[species]
    nt = mat.node_tree; nodes, links = nt.nodes, nt.links
    bs = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    base = bs.inputs['Base Color']
    if base.is_linked:
        src = base.links[0].from_socket
        hsv = nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Hue'].default_value = 0.5 + hue; hsv.inputs['Saturation'].default_value = sat; hsv.inputs['Value'].default_value = val
        links.new(src, hsv.inputs['Color']); links.new(hsv.outputs['Color'], base)
        col = hsv.outputs['Color']
    else:
        col = None
    alpha = bs.inputs['Alpha'].links[0].from_socket if bs.inputs['Alpha'].is_linked else None
    if alpha is not None:
        for l in list(bs.inputs['Alpha'].links):
            links.remove(l)
        bs.inputs['Alpha'].default_value = 1.0
    tr = nodes.new('ShaderNodeBsdfTranslucent')
    if col is not None:
        mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
        links.new(col, mul.inputs[6]); mul.inputs[7].default_value = (*[min(1.0, c * 1.6) for c in trans], 1.0)
        links.new(mul.outputs[2], tr.inputs['Color'])
    else:
        tr.inputs['Color'].default_value = (*trans, 1.0)
    mix = nodes.new('ShaderNodeMixShader'); mix.inputs['Fac'].default_value = 0.38 if species != 'grass' else 0.25
    links.new(bs.outputs['BSDF'], mix.inputs[1]); links.new(tr.outputs['BSDF'], mix.inputs[2])
    shader = mix.outputs['Shader']
    if alpha is not None:
        tp = nodes.new('ShaderNodeBsdfTransparent'); cut = nodes.new('ShaderNodeMixShader')
        links.new(alpha, cut.inputs['Fac']); links.new(tp.outputs['BSDF'], cut.inputs[1]); links.new(shader, cut.inputs[2])
        shader = cut.outputs['Shader']
    links.new(shader, out.inputs['Surface'])


def bark_material(mat, species):
    nt = mat.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    if bs.inputs['Base Color'].is_linked:
        src = bs.inputs['Base Color'].links[0].from_socket
        hsv = nt.nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Saturation'].default_value = 0.7; hsv.inputs['Value'].default_value = 0.95 if species != 'creosote' else 0.8
        nt.links.new(src, hsv.inputs['Color']); nt.links.new(hsv.outputs['Color'], bs.inputs['Base Color'])


_imported = {}


def get_plant(model, objname):
    if model not in _imported:
        objs = d.import_gltf(d.polyhaven_model(model, '2k'))
        for o in objs:
            o.hide_render = True
        _imported[model] = {o.name: o for o in objs}
    return _imported[model][objname]


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
    ob = get_plant(model, objname)
    for m in ob.data.materials:
        if m.get('_dow_done'):
            continue
        (leaf_material if ('leaves' in m.name or species == 'grass') else bark_material)(m, species)
        m['_dow_done'] = 1
    r, hgt = place(ob, scale)
    cached = REUSE and ONLY is not None and name not in ONLY
    S = max(2.0 * r, hgt / 0.93) * 1.06          # cell side (m); ground line 4 % above the bottom edge
    base = 0.04 * S
    sc.render.resolution_x = sc.render.resolution_y = cell
    cam.data.ortho_scale = S
    ground.visible_camera = False; ob.visible_camera = True
    cells = []
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
