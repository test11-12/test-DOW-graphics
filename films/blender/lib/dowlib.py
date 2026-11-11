"""dowlib: shared helpers for the asset generators in films/blender/ (Blender 4.5 LTS, run headless).

Run a generator:   node tools/blender.mjs <generator> [args...]
                   (Blender from $BLENDER, else /opt/blender/blender)

Conventions
- Units are metres. Blender is Z-up; the glTF exporter converts to Y-up.
- Vehicles are modelled nose / bow along +X, up +Z, starboard (right) along -Y. After export that is the
  engine's body frame (+x forward, +y up, +z right).
- A hero asset is baked down, per material, to glTF-ready maps: base colour (sRGB), ORM (R occlusion,
  G roughness, B metal), tangent-space normal (OpenGL, +Y up) and, when needed, emissive.
- Photoscanned CC0 sources (Poly Haven, ambientCG) are downloaded into DOW_CACHE (default /opt/dow-cache)
  and never committed; only the baked results go into films/assets/.
"""
import bpy
import bmesh
import json
import math
import os
import shutil
import sys
import time
import urllib.request
import zipfile

import numpy as np
from mathutils import Vector

FILMS = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(FILMS, 'assets')
CACHE = os.environ.get('DOW_CACHE', '/opt/dow-cache')
UA = {'User-Agent': 'dow-films-asset-builder/1.0'}


def log(*a):
    print('[dow]', *a, flush=True)


def args():
    """Arguments after '--' on the Blender command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def bake_dir(*parts):
    """Folder for bake intermediates (outside the repo: only the exported .glb is committed)."""
    p = os.path.join(CACHE, 'bakes', *parts)
    os.makedirs(p, exist_ok=True)
    return p


def out_path(*parts):
    """Path inside films/assets/, creating the directory."""
    p = os.path.join(ASSETS, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# ---------------------------------------------------------------- scene
def reset(samples=64):
    """Empty scene, metric units, Cycles on the CPU, sensible bake defaults."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 16
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.threads_mode = 'AUTO'
    sc.view_settings.view_transform = 'Standard'
    return sc


def select(objs, active=None):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def apply_modifiers(obj):
    select([obj])
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def smooth(obj, angle_deg=35.0):
    """Smooth shading with hard edges above angle_deg (Blender 4.1+ mesh API)."""
    me = obj.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle_deg))


def bevel(obj, width, segments=3, angle_deg=30.0, profile=0.5, harden=True, apply=True):
    """Rounded edges that catch highlights. Width in metres."""
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle_deg)
    m.profile = profile
    m.harden_normals = harden
    m.miter_outer = 'MITER_ARC'
    if apply:
        apply_modifiers(obj)
    return m


def weighted_normals(obj, apply=True):
    m = obj.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.keep_sharp = True
    m.weight = 50
    if apply:
        apply_modifiers(obj)


def stats(obj):
    me = obj.data
    return f'{obj.name}: {len(me.vertices)} verts, {len(me.polygons)} faces'


# ---------------------------------------------------------------- downloads (CC0 libraries)
def _fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.part'
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r, open(tmp, 'wb') as f:
                shutil.copyfileobj(r, f)
            os.replace(tmp, dest)
            return dest
        except Exception as e:  # network hiccup: back off and retry
            log('download retry', attempt + 1, url, e)
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError('download failed: ' + url)


def _json(url, dest):
    return json.load(open(_fetch(url, dest)))


def polyhaven_texture(asset, res='2k', maps=('Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement'), fmt='jpg'):
    """Download a Poly Haven texture set (CC0). Returns {map: path}. Map keys as in the Poly Haven API:
    Diffuse, nor_gl, Rough, AO, arm (AO/rough/metal packed), Displacement, Metal, ..."""
    info = _json(f'https://api.polyhaven.com/files/{asset}', os.path.join(CACHE, 'polyhaven', asset, 'files.json'))
    out = {}
    for m in maps:
        if m not in info or res not in info[m]:
            continue
        e = info[m][res]
        f = e.get(fmt) or e.get('png') or e.get('jpg')
        out[m] = _fetch(f['url'], os.path.join(CACHE, 'polyhaven', asset, res, os.path.basename(f['url'])))
    return out


def polyhaven_model(asset, res='2k'):
    """Download a Poly Haven model (CC0) as glTF with its textures. Returns the .gltf path."""
    info = _json(f'https://api.polyhaven.com/files/{asset}', os.path.join(CACHE, 'polyhaven', asset, 'files.json'))
    g = info['gltf'][res]['gltf']
    base = os.path.join(CACHE, 'polyhaven', asset, res)
    main = _fetch(g['url'], os.path.join(base, os.path.basename(g['url'])))
    for rel, e in g.get('include', {}).items():
        _fetch(e['url'], os.path.join(base, rel))
    return main


def polyhaven_list(kind='textures', categories=None):
    """{asset_id: info} from the Poly Haven catalogue (kind: textures | models | hdris)."""
    q = f'https://api.polyhaven.com/assets?t={kind}' + (f'&categories={categories}' if categories else '')
    req = urllib.request.Request(q, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def ambientcg_texture(asset, res='2K', fmt='JPG'):
    """Download an ambientCG material (CC0). Returns {Color, NormalGL, Roughness, AmbientOcclusion,
    Displacement, Metalness, Opacity: path} for the maps it has."""
    d = os.path.join(CACHE, 'ambientcg', asset, f'{res}-{fmt}')
    z = _fetch(f'https://ambientcg.com/get?file={asset}_{res}-{fmt}.zip', d + '.zip')
    if not os.path.isdir(d):
        with zipfile.ZipFile(z) as zf:
            zf.extractall(d)
    out = {}
    for fn in os.listdir(d):
        for key in ('Color', 'NormalGL', 'Roughness', 'AmbientOcclusion', 'Displacement', 'Metalness', 'Opacity'):
            if f'_{key}.' in fn:
                out[key] = os.path.join(d, fn)
    return out


def import_gltf(path):
    """Import a glTF / GLB; returns the new objects."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# ---------------------------------------------------------------- images
def image(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def new_image(name, size, non_color=False, alpha=False, color=(0.0, 0.0, 0.0, 1.0)):
    w, h = (size, size) if isinstance(size, int) else size
    img = bpy.data.images.new(name, w, h, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    img.generated_color = color
    return img


def pixels(img):
    """Image pixels as a float32 array (h, w, 4), values as stored (sRGB-encoded for sRGB byte images)."""
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def set_pixels(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.update()


def save_png(img, path, depth16=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def pack_orm(ao, rough, metal, name, size=None):
    """ORM image (R occlusion, G roughness, B metal) from three single-channel images (or floats)."""
    ref = next(x for x in (ao, rough, metal) if not isinstance(x, (int, float)))
    w, h = ref.size if size is None else ((size, size) if isinstance(size, int) else size)
    ch = lambda x: (np.full((h, w), float(x), np.float32) if isinstance(x, (int, float)) else pixels(x)[..., 0])
    out = new_image(name, (w, h), non_color=True)
    arr = np.ones((h, w, 4), np.float32)
    arr[..., 0], arr[..., 1], arr[..., 2] = ch(ao), ch(rough), ch(metal)
    set_pixels(out, arr)
    return out


def pil_to_image(pil, name, non_color=False):
    """A Pillow RGBA image as a Blender image (for decals, stencils, masks drawn with Pillow)."""
    pil = pil.convert('RGBA').transpose(1)  # Blender rows run bottom-up
    w, h = pil.size
    img = new_image(name, (w, h), non_color=non_color, alpha=True)
    set_pixels(img, np.asarray(pil, dtype=np.float32) / 255.0)
    return img


# ---------------------------------------------------------------- materials
def new_material(name):
    """Material with a Principled BSDF; returns (mat, bsdf, nodes, links)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    return mat, nt.nodes['Principled BSDF'], nt.nodes, nt.links


def tex(nt, img, coords=None, projection='FLAT', blend=0.25, interp='Linear', scale=None):
    """Image texture node. coords: an output socket (UV, Object, ...) or None for the default UV map.
    projection='BOX' with Object coordinates gives tri-planar mapping for scanned materials."""
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    n.interpolation = interp
    n.projection = projection
    n.projection_blend = blend
    src = coords
    if scale is not None:
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
        if coords is not None:
            nt.links.new(coords, mp.inputs['Vector'])
        else:
            tc = nt.nodes.new('ShaderNodeTexCoord')
            nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
        src = mp.outputs['Vector']
    if src is not None:
        nt.links.new(src, n.inputs['Vector'])
    return n


def texcoord(nt):
    return nt.nodes.new('ShaderNodeTexCoord')


def normal_map(nt, color_socket, strength=1.0):
    n = nt.nodes.new('ShaderNodeNormalMap')
    n.inputs['Strength'].default_value = strength
    nt.links.new(color_socket, n.inputs['Color'])
    return n.outputs['Normal']


def mix_rgb(nt, a, b, fac, blend='MIX'):
    """Mix two colours (sockets or tuples) by fac (socket or float)."""
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    for sock, v in ((n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(v, (tuple, list)):
            sock.default_value = tuple(v) + ((1.0,) if len(v) == 3 else ())
        else:
            nt.links.new(v, sock)
    if isinstance(fac, (int, float)):
        n.inputs[0].default_value = fac
    else:
        nt.links.new(fac, n.inputs[0])
    return n.outputs[2]


def math_node(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def ramp(nt, fac, stops):
    """Colour ramp: stops = [(pos, (r, g, b, a)), ...]; returns the Color output."""
    n = nt.nodes.new('ShaderNodeValToRGB')
    el = n.color_ramp.elements
    while len(el) > len(stops):
        el.remove(el[-1])
    while len(el) < len(stops):
        el.new(0.5)
    for e, (p, c) in zip(el, stops):
        e.position = p
        e.color = c if len(c) == 4 else tuple(c) + (1.0,)
    nt.links.new(fac, n.inputs['Fac'])
    return n.outputs['Color']


def ao_mask(nt, distance=0.2, only_local=True, samples=16):
    """Cycles ambient occlusion as a 0..1 factor (1 = open). Usable inside materials before baking:
    drive grime, dust and wear by how enclosed a spot is."""
    n = nt.nodes.new('ShaderNodeAmbientOcclusion')
    n.inputs['Distance'].default_value = distance
    n.only_local = only_local
    n.samples = samples
    return n.outputs['AO']


def edge_mask(nt, radius=0.004, samples=8):
    """Convex-edge factor (0 flat .. 1 on an edge), from the Bevel node: for edge wear and highlights."""
    bv = nt.nodes.new('ShaderNodeBevel')
    bv.samples = samples
    bv.inputs['Radius'].default_value = radius
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    nt.links.new(bv.outputs['Normal'], dot.inputs[0])
    nt.links.new(geo.outputs['Normal'], dot.inputs[1])
    return math_node(nt, 'SUBTRACT', 1.0, dot.outputs['Value'], clamp=True)


def gltf_output_group():
    """The 'glTF Material Output' node group the glTF exporter reads ambient occlusion from."""
    g = bpy.data.node_groups.get('glTF Material Output')
    if g:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket(name='Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def gltf_material(name, base=None, orm=None, normal=None, emissive=None, emissive_strength=1.0, base_color=(1, 1, 1, 1),
                  roughness=0.5, metallic=0.0, normal_strength=1.0, alpha_blend=False, double_sided=False):
    """A material wired the way the glTF exporter expects: image textures straight into the Principled BSDF,
    ORM split into roughness (G) and metal (B), occlusion (R) through the glTF Material Output group."""
    mat, bsdf, nodes, links = new_material(name)
    nt = mat.node_tree
    bsdf.inputs['Base Color'].default_value = base_color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if base is not None:
        t = tex(nt, base)
        links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_blend:
            links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
            mat.blend_method = 'BLEND' if hasattr(mat, 'blend_method') else None
    if orm is not None:
        t = tex(nt, orm)
        sep = nodes.new('ShaderNodeSeparateColor')
        links.new(t.outputs['Color'], sep.inputs['Color'])
        links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        grp = nodes.new('ShaderNodeGroup')
        grp.node_tree = gltf_output_group()
        links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    if normal is not None:
        t = tex(nt, normal)
        links.new(normal_map(nt, t.outputs['Color'], normal_strength), bsdf.inputs['Normal'])
    if emissive is not None:
        t = tex(nt, emissive)
        links.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    mat.use_backface_culling = not double_sided
    return mat


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ---------------------------------------------------------------- UVs
def smart_uv(obj, angle_deg=60.0, margin=0.002):
    select([obj])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def pack_uv(objs, margin=0.003, rotate=True):
    """Pack the UV islands of several objects into one shared 0..1 layout (they must use one material)."""
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=margin, rotate=rotate, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')


def texel_density(obj, size):
    """Average metres per texel of obj's active UV map at a texture size of `size` pixels."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    a3 = a2 = 0.0
    for f in bm.faces:
        a3 += f.calc_area()
        ls = f.loops
        for i in range(1, len(ls) - 1):
            p0, p1, p2 = ls[0][uv].uv, ls[i][uv].uv, ls[i + 1][uv].uv
            a2 += abs((p1 - p0).cross(p2 - p0)) * 0.5
    bm.free()
    return math.sqrt(a3 / max(a2, 1e-12)) / size


# ---------------------------------------------------------------- baking
def _target_nodes(objs, img):
    added = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            n = m.node_tree.nodes.new('ShaderNodeTexImage')
            n.image = img
            n.name = '__bake_target__'
            m.node_tree.nodes.active = n
            added.append((m, n))
    return added


def bake(objs, kind, img, samples=None, pass_filter=None, normal_space='TANGENT', sources=None, cage_extrusion=0.03,
         max_ray_distance=0.0, margin=16):
    """Bake `kind` of objs into img. kind: DIFFUSE (use pass_filter={'COLOR'} for plain albedo), ROUGHNESS, AO,
    NORMAL, EMIT, GLOSSY, COMBINED, ... sources: high-poly objects for selected-to-active baking (then objs must
    be a single low-poly target)."""
    sc = bpy.context.scene
    old = sc.cycles.samples
    if samples:
        sc.cycles.samples = samples
    added = _target_nodes(objs, img)
    try:
        if sources:
            select(list(sources) + list(objs), active=objs[0])
        else:
            select(objs)
        kw = dict(type=kind, margin=margin, use_clear=True, target='IMAGE_TEXTURES')
        if pass_filter:
            kw['pass_filter'] = set(pass_filter)
        if kind == 'NORMAL':
            kw.update(normal_space=normal_space, normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
        if sources:
            kw.update(use_selected_to_active=True, cage_extrusion=cage_extrusion, max_ray_distance=max_ray_distance)
        t0 = time.time()
        bpy.ops.object.bake(**kw)
        log(f'bake {kind} {img.size[0]}x{img.size[1]} in {time.time() - t0:.1f}s')
    finally:
        for m, n in added:
            m.node_tree.nodes.remove(n)
        sc.cycles.samples = old
    return img


def bake_socket(objs, socket, img, samples=1, margin=16, sources=None):
    """Bake whatever drives a Principled BSDF input (e.g. 'Base Color', 'Roughness', 'Metallic', 'Alpha') by
    routing it into an Emission shader for one EMIT bake. Unlinked inputs bake their default value. This is the
    reliable way to get glTF base colour: a DIFFUSE bake returns black for metals. With `sources`
    (selected-to-active), the source materials are the ones rewired."""
    saved = []
    for o in (sources or objs):
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes or any(m is s[0] for s in saved):
                continue
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
            if not bsdf or not out:
                continue
            em = nt.nodes.new('ShaderNodeEmission')
            inp = bsdf.inputs[socket]
            if inp.is_linked:
                nt.links.new(inp.links[0].from_socket, em.inputs['Color'])
            else:
                v = inp.default_value
                em.inputs['Color'].default_value = tuple(v) if hasattr(v, '__len__') else (v, v, v, 1.0)
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            saved.append((m, nt, em, out, old))
    try:
        bake(objs, 'EMIT', img, samples=samples, margin=margin, sources=sources)
    finally:
        for m, nt, em, out, old in saved:
            nt.nodes.remove(em)
            if old is not None:
                nt.links.new(old, out.inputs['Surface'])
    return img


def blur(img, radius=1.5):
    """Small separable Gaussian blur in place (for denoising AO bakes)."""
    a = pixels(img)
    r = max(1, int(math.ceil(radius * 3)))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / radius) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((r, r), (r, r), (0, 0)), mode='edge')
    tmp = sum(k[i] * pad[i:i + a.shape[0], r:r + a.shape[1]] for i in range(2 * r + 1))
    pad = np.pad(tmp, ((0, 0), (r, r), (0, 0)), mode='edge')
    out = sum(k[i] * pad[:, i:i + a.shape[1]] for i in range(2 * r + 1))
    set_pixels(img, out)
    return img


def resize(img, size, name=None):
    """A resized copy of img (Blender's scaler)."""
    c = img.copy()
    c.name = name or img.name + '_r'
    w, h = (size, size) if isinstance(size, int) else size
    c.scale(w, h)
    return c


def bake_pbr(objs, size, name, out_dir, ao=True, ao_samples=32, ao_size=None, ao_distance=None, normal=True,
             sources=None, emissive=False):
    """Bake a full glTF set for objs (which share one UV layout) from their detailed source materials (or from
    `sources` for high-to-low baking): <name>_base.png (sRGB), <name>_orm.png (R occlusion, G roughness,
    B metal), <name>_normal.png (+ _emissive.png). AO is baked at ao_size (default size/2), denoised and scaled
    up, since it carries no fine detail. Returns {kind: image}."""
    t0 = time.time()
    res = {}
    base = new_image(f'{name}_base', size)
    bake_socket(objs, 'Base Color', base, sources=sources)
    res['base'] = base
    rough = new_image(f'{name}_rough', size, non_color=True)
    bake_socket(objs, 'Roughness', rough, sources=sources)
    metal = new_image(f'{name}_metal', size, non_color=True)
    bake_socket(objs, 'Metallic', metal, sources=sources)
    aoi = 1.0
    if ao:
        s = ao_size or max(256, (size if isinstance(size, int) else size[0]) // 2)
        aoi = new_image(f'{name}_ao', s, non_color=True, color=(1, 1, 1, 1))
        w = ensure_world()
        if ao_distance is not None:
            w.light_settings.distance = ao_distance
        bake(objs, 'AO', aoi, samples=ao_samples, sources=sources)
        blur(aoi, 1.2)
        if aoi.size[0] != base.size[0]:
            aoi = resize(aoi, tuple(base.size), f'{name}_ao_full')
        res['ao'] = aoi
    res['orm'] = pack_orm(aoi, rough, metal, f'{name}_orm')
    if normal:
        nrm = new_image(f'{name}_normal', size, non_color=True, color=(0.5, 0.5, 1.0, 1.0))
        bake(objs, 'NORMAL', nrm, samples=1, sources=sources)
        res['normal'] = nrm
    if emissive:
        em = new_image(f'{name}_emissive', size)
        bake_socket(objs, 'Emission Color', em, sources=sources)
        res['emissive'] = em
    for k in ('base', 'orm', 'normal', 'emissive'):
        if k in res:
            save_png(res[k], os.path.join(out_dir, f'{name}_{k}.png'))
    log(f'bake_pbr {name} {size}px in {time.time() - t0:.0f}s')
    return res


def ensure_world(color=(0.05, 0.05, 0.05)):
    """A plain world, so AO and baking have something to work against."""
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('world')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (*color, 1.0)
    return sc.world


def swap_to_baked(objs, name, maps, **kw):
    """Replace objs' materials with one glTF material built from baked maps (from bake_pbr)."""
    mat = gltf_material(name, base=maps.get('base'), orm=maps.get('orm'), normal=maps.get('normal'),
                        emissive=maps.get('emissive'), **kw)
    for o in objs:
        set_material(o, mat)
    return mat


# ---------------------------------------------------------------- export
def export_glb(path, objs=None, image_format='WEBP', quality=90, tangents=True):
    """Export objs (or everything) as a GLB with textures re-encoded as WebP / JPEG."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if objs is not None:
        select(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=objs is not None, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=tangents, export_materials='EXPORT',
        export_image_format=image_format, export_image_quality=quality, export_cameras=False, export_lights=False,
        export_extras=True, export_draco_mesh_compression_enable=False)
    log(f'exported {os.path.relpath(path, FILMS)} {os.path.getsize(path) / 1e6:.1f} MB')
    return path


# ---------------------------------------------------------------- quick look-development render
def preview(path, target=(0, 0, 0), cam=(6, -8, 3), lens=50, size=(960, 540), samples=24, sun_el=12.0, sun_az=70.0):
    """A quick Cycles still (physically based sky, low sun) to check a bake before exporting."""
    sc = bpy.context.scene
    w = ensure_world()
    nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(sun_el)
    sky.sun_rotation = math.radians(sun_az)
    nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    nt.nodes['Background'].inputs['Strength'].default_value = 0.35
    cd = bpy.data.cameras.new('preview_cam')
    cd.lens = lens
    co = bpy.data.objects.new('preview_cam', cd)
    sc.collection.objects.link(co)
    co.location = cam
    d = Vector(target) - Vector(cam)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = size
    old = sc.cycles.samples
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.cycles.samples = old
    sc.cycles.use_denoising = False
    sc.view_settings.view_transform = 'Standard'
    bpy.data.objects.remove(co)
    nt.nodes.remove(sky)
    log('preview', path)
