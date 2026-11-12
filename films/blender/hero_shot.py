# Path-traced heroes: renders a film's hero objects in Cycles with the film's own cameras, sun and sky, for the engine to
# composite into its own frame (engine/hero.js). Input: a folder written by tools/export_shots.mjs.
#   node tools/blender.mjs hero_shot --export heroes/fury [--out heroes/fury/cycles] [--frames 510 | 509-511,520]
#        [--samples 256] [--noise 0.01] [--res 100] [--device auto|OPTIX|CUDA|HIP|ONEAPI|CPU] [--sky env|nishita]
#        [--set-radius 25] [--catch-height 60] [--no-catcher] [--ground-albedo r,g,b] [--mblur] [--dof]
#        [--bounces 8] [--min-samples 0] [--no-exr] [--blend]
# Per frame, in --out:
#   hero_<frame>.exr  multilayer, linear, premultiplied: Combined RGBA, Depth (planar view Z, m), Shadow Catcher (RGB
#                     ratio to multiply the background by: < 1 in the heroes' shadows, > 1 where they bounce light)
#   hero_<frame>.bin  what the engine loads (engine/hero.js HeroLayer.load): the crop holding the heroes and their
#                     shadows; colour + alpha as half floats, shadow ratio + view Z (filled out to the soft edges) as floats
#   hero_<frame>.png  preview: the heroes alone through the engine's tone curve and the shot's exposure (straight alpha)
#   timing.json       seconds per frame (wall and CPU), device, samples, size
#   layer.json        film, fps, size and the hero selection (export_shots.mjs --heroes) the layers were rendered for;
#                     tools/composite.mjs and render.mjs --hero read it, and every .bin carries a hash of the selection
# A hero node that cannot be instanced (its .glb missing under films/assets, or its glTF node not found in the Blender
# import) stops the run: the engine hides every hero mesh in the plate, so a skipped one would vanish from the film.
# Scene: every visible glTF node the film drew from a .glb (the engine tags them, see engine/assets.js) is instanced
# from the same .glb at its exported world matrix; heroes render, set pieces within --set-radius of a hero (ramp props)
# and a plane at the ground or sea level are shadow catchers. Sun lamp: 0.53 deg disc, the engine's colour and
# irradiance (the same units as Blender's W/m2: both renderers use radiance = albedo/pi * E * cos). World: the engine's
# own reflection environment (export env_<key>.hdr), or --sky nishita, scaled to the same sky irradiance. Film is
# transparent: the background comes from the engine. Motion blur and depth of field are left to the engine (it blurs
# the composited hero with the plate, from its own motion vectors); --mblur / --dof render them in Cycles instead,
# for use outside the engine.
import os, sys, json, math, time, struct, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import bpy
import numpy as np
from mathutils import Matrix, Vector, Quaternion
import OpenImageIO as oiio
import dowlib as d

ap = argparse.ArgumentParser(prog='hero_shot')
ap.add_argument('--export', required=True); ap.add_argument('--out'); ap.add_argument('--frames')
ap.add_argument('--samples', type=int, default=256); ap.add_argument('--noise', type=float, default=0.01)
ap.add_argument('--res', type=float, default=100); ap.add_argument('--device', default='auto')
ap.add_argument('--sky', default='env', choices=['env', 'nishita']); ap.add_argument('--set-radius', type=float, default=25)
ap.add_argument('--catch-height', type=float, default=60); ap.add_argument('--no-catcher', action='store_true')
ap.add_argument('--ground-albedo'); ap.add_argument('--mblur', action='store_true'); ap.add_argument('--dof', action='store_true')
ap.add_argument('--bounces', type=int, default=8); ap.add_argument('--no-exr', action='store_true'); ap.add_argument('--blend', action='store_true')
ap.add_argument('--no-lights', action='store_true'); ap.add_argument('--min-samples', type=int, default=0)
A = ap.parse_args(d.args())
EXP = os.path.abspath(A.export); OUT = os.path.abspath(A.out or os.path.join(EXP, 'cycles')); os.makedirs(OUT, exist_ok=True)
INDEX = json.load(open(os.path.join(EXP, 'shots.json')))
FR = {f['frame']: f for f in INDEX['frames']}

def canon_select(s):
    """The hero selection in canonical form (the same as engine/hero.js canonSelect): '1', 'all' or a sorted list."""
    s = str(s or '1')
    return s if s in ('1', 'all') else ','.join(sorted(set(x for x in s.split(',') if x)))
def select_hash(s):
    """FNV-1a of the canonical selection, 31 bits (engine/hero.js selectHash): the .bin header's flags field."""
    h = 0x811c9dc5
    for b in canon_select(s).encode('utf-8'): h = ((h ^ b) * 0x01000193) & 0xffffffff
    return h & 0x7fffffff
SELECT = canon_select(INDEX.get('select'))

def read_exr(path):
    """All channels of an EXR's first part as float32 (rows top to bottom) and the channel names. Opened and closed
    explicitly, not through OIIO's shared image cache, which keeps the file open (Windows then cannot delete or
    rewrite it) and can hand back stale pixels for a file rewritten under the same name."""
    inp = oiio.ImageInput.open(path)
    if inp is None: raise RuntimeError(f'cannot read {path}: {oiio.geterror()}')
    try:
        spec = inp.spec()
        px = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, oiio.FLOAT), np.float32).reshape(spec.height, spec.width, spec.nchannels)
        return px, list(spec.channelnames)
    finally: inp.close()

def parse_frames(s):
    if not s: return [f['frame'] for f in INDEX['frames'] if not f['pad']]
    out = []
    for part in s.split(','):
        a, _, b = part.partition('-'); out += list(range(int(a), int(b or a) + 1))
    return out
FRAMES = parse_frames(A.frames)
_cache = {}
def state(i):
    if i not in FR: return None
    if i not in _cache: _cache[i] = json.load(open(os.path.join(EXP, FR[i]['file'])))
    return _cache[i]

# ------------------------------------------------------------------ axes
# engine (three.js): +x east, +y up, +z south. Blender: +z up. A point p maps to C p; an object's matrix to C M C^-1
# (the glTF importer already converted its meshes the same way); a camera's to C M (both look down their local -z).
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))); CI = C.transposed()
def m3(e): return Matrix([[e[c * 4 + r] for c in range(4)] for r in range(4)])   # three.js column-major -> mathutils
def shifted(e, O):
    M = m3(e); M[0][3] -= O[0]; M[1][3] -= O[1]; M[2][3] -= O[2]; return M
def bvec(v): return Vector((v[0], -v[2], v[1]))

# ------------------------------------------------------------------ scene and render settings
sc = d.reset(A.samples)
def pick_device(want):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for t in (['OPTIX', 'CUDA', 'HIP', 'ONEAPI'] if want == 'auto' else ([] if want == 'CPU' else [want])):
        try: prefs.compute_device_type = t
        except TypeError: continue
        prefs.get_devices()
        devs = [x for x in prefs.devices if x.type == t]
        if devs:
            for x in prefs.devices: x.use = x.type == t          # the GPU alone: a CPU in the mix slows OptiX down
            sc.cycles.device = 'GPU'; return t, [x.name for x in devs]
    prefs.compute_device_type = 'NONE'; sc.cycles.device = 'CPU'; return 'CPU', [f'{os.cpu_count()} threads']
DEVICE, DEVNAMES = pick_device(A.device.upper() if A.device != 'auto' else 'auto')
d.log('device', DEVICE, DEVNAMES)
W0, H0 = INDEX['size']
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W0, H0, int(A.res)
RW, RH = round(W0 * A.res / 100), round(H0 * A.res / 100)
json.dump({'film': INDEX['film'], 'fps': INDEX['fps'], 'size': [RW, RH], 'select': SELECT, 'export': EXP},
          open(os.path.join(OUT, 'layer.json'), 'w'), indent=1)
cy = sc.cycles
cy.samples = A.samples; cy.use_adaptive_sampling = True; cy.adaptive_threshold = A.noise; cy.adaptive_min_samples = A.min_samples   # 0: Cycles' own
cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'; cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'
if hasattr(cy, 'denoising_quality'): cy.denoising_quality = 'HIGH'
if hasattr(cy, 'denoising_use_gpu'): cy.denoising_use_gpu = DEVICE != 'CPU'
cy.max_bounces = A.bounces; cy.diffuse_bounces = min(4, A.bounces); cy.glossy_bounces = min(4, A.bounces); cy.transmission_bounces = A.bounces
cy.transparent_max_bounces = 16; cy.volume_bounces = 0; cy.caustics_reflective = False; cy.caustics_refractive = False
cy.blur_glossy = 1.0; cy.sample_clamp_indirect = 10.0; cy.use_animated_seed = True
sc.render.film_transparent = True; sc.render.use_persistent_data = True
sc.view_settings.view_transform = 'Standard'
vl = sc.view_layers[0]; vl.use_pass_z = True; vl.cycles.use_pass_shadow_catcher = True
im = sc.render.image_settings; im.file_format = 'OPEN_EXR_MULTILAYER'; im.color_depth = '32'; im.exr_codec = 'ZIP'
sc.render.use_motion_blur = A.mblur; sc.render.motion_blur_position = 'CENTER'

cam = bpy.data.objects.new('hero_cam', bpy.data.cameras.new('hero_cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24.0; cam.rotation_mode = 'QUATERNION'
sun = bpy.data.objects.new('hero_sun', bpy.data.lights.new('hero_sun', 'SUN')); sc.collection.objects.link(sun); sun.rotation_mode = 'QUATERNION'

# shadow-catching ground: a plane at the ground or sea level under the heroes
catcher = None
if not A.no_catcher:
    me = bpy.data.meshes.new('hero_ground'); me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [(0, 1, 2, 3)])
    catcher = bpy.data.objects.new('hero_ground', me); sc.collection.objects.link(catcher); catcher.is_shadow_catcher = True
    gm, bsdf, _, _ = d.new_material('hero_ground'); bsdf.inputs['Roughness'].default_value = 0.85; me.materials.append(gm)
    GROUND_BSDF = bsdf

# ------------------------------------------------------------------ world: the engine's environment, or Nishita
world = bpy.data.worlds.new('hero_world'); sc.world = world; world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
for n in list(wn): wn.remove(n)
wout = wn.new('ShaderNodeOutputWorld'); bg = wn.new('ShaderNodeBackground'); wl.new(bg.outputs['Background'], wout.inputs['Surface'])
if A.sky == 'env':
    # u = 0.5 + atan2(y, x)/2pi, v = 0.5 + asin(z)/pi: the mapping engine/hero.js writes (EQUI_FRAG)
    tc = wn.new('ShaderNodeTexCoord'); nv = wn.new('ShaderNodeVectorMath'); nv.operation = 'NORMALIZE'; wl.new(tc.outputs['Generated'], nv.inputs[0])
    sx = wn.new('ShaderNodeSeparateXYZ'); wl.new(nv.outputs['Vector'], sx.inputs[0])
    def mth(op, a, b=None):
        n = wn.new('ShaderNodeMath'); n.operation = op
        for k, v in enumerate([a, b]):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[k].default_value = v
            else: wl.new(v, n.inputs[k])
        return n.outputs[0]
    u = mth('ADD', mth('MULTIPLY', mth('ARCTAN2', sx.outputs['Y'], sx.outputs['X']), 1 / (2 * math.pi)), 0.5)
    v = mth('ADD', mth('MULTIPLY', mth('ARCSINE', sx.outputs['Z']), 1 / math.pi), 0.5)
    cxyz = wn.new('ShaderNodeCombineXYZ'); wl.new(u, cxyz.inputs['X']); wl.new(v, cxyz.inputs['Y'])
    envtex = wn.new('ShaderNodeTexImage'); envtex.interpolation = 'Linear'; envtex.extension = 'REPEAT'
    wl.new(cxyz.outputs['Vector'], envtex.inputs['Vector']); wl.new(envtex.outputs['Color'], bg.inputs['Color'])
else:
    sky = wn.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_disc = False; wl.new(sky.outputs['Color'], bg.inputs['Color'])

def hemi_irradiance(img_arr):
    """Upper-hemisphere irradiance (cosine-weighted, luminance) of an equirect RGB array in this script's mapping."""
    h, w = img_arr.shape[:2]; lat = ((np.arange(h) + 0.5) / h - 0.5) * math.pi
    wgt = np.maximum(np.sin(lat), 0) * np.cos(lat) * (math.pi / h) * (2 * math.pi / w)
    lum = img_arr[..., 0] * 0.2126 + img_arr[..., 1] * 0.7152 + img_arr[..., 2] * 0.0722
    return float((lum * wgt[:, None]).sum())

_env = {}
def set_world(st):
    key = st['env'] + ('' if A.sky == 'env' else f":{st['sun']['dir']}")
    if _env.get('key') == key: return
    path = os.path.join(EXP, st['env'])
    img = bpy.data.images.load(path, check_existing=True); img.colorspace_settings.name = 'Linear Rec.709'
    if A.sky == 'env': envtex.image = img
    else:
        # Nishita for the sun's position and the camera's altitude, scaled to the engine sky's irradiance
        s = bvec(st['sun']['dir']); sky.sun_elevation = math.asin(max(-1, min(1, s.z)))
        sky.sun_rotation = math.atan2(s.x, s.y) % (2 * math.pi); sky.altitude = max(0, min(59999, st['sky']['camAlt']))
        sky.dust_density = max(0.0, st['sky']['haze']); bg.inputs['Strength'].default_value = 1.0
        px = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(px)
        target = hemi_irradiance(px.reshape(img.size[1], img.size[0], 4))
        got = hemi_irradiance(render_world_probe())
        bg.inputs['Strength'].default_value = target / max(got, 1e-9)
        d.log(f'nishita: strength {bg.inputs["Strength"].default_value:.4g} (engine sky {target:.4g}, nishita {got:.4g})')
    _env['key'] = key

def render_world_probe():
    """The world alone through a 64 x 32 equirectangular camera, in this script's mapping, rows bottom to top."""
    ps = bpy.data.scenes.get('probe') or bpy.data.scenes.new('probe'); ps.world = world; ps.render.engine = 'CYCLES'
    ps.cycles.samples = 16; ps.cycles.use_denoising = False; ps.render.resolution_x, ps.render.resolution_y = 64, 32
    ps.render.resolution_percentage = 100; ps.render.image_settings.file_format = 'OPEN_EXR'; ps.render.image_settings.color_depth = '32'
    pc = bpy.data.objects.get('probe_cam')
    if not pc:
        pc = bpy.data.objects.new('probe_cam', bpy.data.cameras.new('probe_cam')); ps.collection.objects.link(pc); ps.camera = pc
        pc.data.type = 'PANO'
        if hasattr(pc.data, 'panorama_type'): pc.data.panorama_type = 'EQUIRECTANGULAR'
        else: pc.data.cycles.panorama_type = 'EQUIRECTANGULAR'
        pc.rotation_euler = (math.pi / 2, 0, -math.pi / 2)   # Blender's equirect camera looks along its -z; this puts u = 0.5 at +x
    ps.render.filepath = os.path.join(OUT, '_probe.exr'); bpy.ops.render.render(write_still=True, scene=ps.name)
    px, _ = read_exr(ps.render.filepath)   # rewritten once per shot: read it fresh each time
    return px[::-1, :, :3]

# ------------------------------------------------------------------ glTF library: one import per asset
def glb_json(path):
    with open(path, 'rb') as f:
        f.read(12); clen, _ = struct.unpack('<I4s', f.read(8)); return json.loads(f.read(clen))
LIB, LIBCOLL = {}, None
def library(asset):
    global LIBCOLL
    if asset in LIB: return LIB[asset]
    path = os.path.join(d.ASSETS, asset)
    if not os.path.exists(path): d.log('missing asset', path); LIB[asset] = {}; return LIB[asset]
    if LIBCOLL is None:
        LIBCOLL = bpy.data.collections.new('hero_lib'); sc.collection.children.link(LIBCOLL)
    lc = bpy.context.view_layer.layer_collection.children[LIBCOLL.name]; lc.exclude = False
    bpy.context.view_layer.active_layer_collection = lc
    js = glb_json(path); new = d.import_gltf(path)
    by_name = {o.name: o for o in new}
    strip = lambda s: s.rsplit('.', 1)[0] if s and len(s) > 4 and s[-4] == '.' and s[-3:].isdigit() else s
    by_mesh = {}
    for o in new:
        if o.type == 'MESH': by_mesh.setdefault(strip(o.data.name), o)
    nodes = {}
    for i, nd in enumerate(js.get('nodes', [])):
        if 'mesh' not in nd: continue
        o = by_name.get(nd.get('name', '')) or by_name.get((nd.get('name') or '')[:63])
        if o is None or o.type != 'MESH': o = by_mesh.get(js['meshes'][nd['mesh']].get('name', ''))
        if o is not None: nodes[i] = o
    k = len(LIB)
    for o in new:
        o.name = f'{k}|{o.name}'
        for c in list(o.users_collection):
            if c != LIBCOLL: c.objects.unlink(o)
        if o.name not in LIBCOLL.objects: LIBCOLL.objects.link(o)
    lc.exclude = True
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection
    d.log(f'library {asset}: {len(nodes)} mesh nodes of {len(js.get("nodes", []))}')
    LIB[asset] = nodes
    return nodes

# ------------------------------------------------------------------ per-frame scene
INST = {}
def instance(n, catch):
    o = INST.get(n['id'])
    src = library(n['asset']).get(n['node'])
    if src is None:
        if catch: return None   # a set piece only catches shadows: without it the ground plane still does
        why = ('the asset is missing under ' + d.ASSETS) if not os.path.exists(os.path.join(d.ASSETS, n['asset'])) else 'its glTF node was not matched in the Blender import'
        raise RuntimeError(f"hero node {n['asset']}#{n['node']} ({n['name']}) cannot be instanced: {why}. The engine hides "
                           "every hero mesh in the plate, so it would vanish from the composite.")
    if o is None:
        o = bpy.data.objects.new(('H:' if not catch else 'S:') + n['name'], src.data)
        sc.collection.objects.link(o); o.rotation_mode = 'QUATERNION'; INST[n['id']] = o
    o.is_shadow_catcher = catch
    return o

def set_emissive(o, n):
    """The engine's emissive state (colour x intensity, e.g. a motor lighting up) on this instance's own materials.
    Instances persist across frames: a slot whose material is not emissive in this frame goes back to the mesh's own
    material, so a motor that switches off (or a frame rendered out of order) keeps no stale glow."""
    em = {e[0]: e for e in n.get('emissive', [])}
    strip = lambda s: s.rsplit('.', 1)[0] if len(s) > 4 and s[-4] == '.' and s[-3:].isdigit() else s
    for i, slot in enumerate(o.material_slots):
        base = o.data.materials[i] if i < len(o.data.materials) else None
        if base is None: continue
        if strip(base.name) not in em:
            if slot.link == 'OBJECT': slot.link = 'DATA'
            continue
        _, col, k = em[strip(base.name)]
        if slot.link != 'OBJECT': slot.link = 'OBJECT'
        if slot.material is None or slot.material == base: slot.material = base.copy()   # reuses this instance's copy
        b = next((x for x in slot.material.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None) if slot.material.use_nodes else None
        if b is None: continue
        m = max(col)
        if not b.inputs['Emission Color'].is_linked and m > 0: b.inputs['Emission Color'].default_value = (col[0] / m, col[1] / m, col[2] / m, 1)
        b.inputs['Emission Strength'].default_value = k * (m if not b.inputs['Emission Color'].is_linked or m > 0 else 0)

LAMPS = []
def lamps(st, O, hp):
    """The engine's point and spot lights near the heroes (power = 4 pi x intensity: the same irradiance at a distance)."""
    used = []
    for L in ([] if A.no_lights else st.get('lights', [])):
        p = Vector(L['pos'])
        if L.get('distance') and all((p - h).length > L['distance'] for h in hp): continue
        k = len(used)
        if k == len(LAMPS):
            o = bpy.data.objects.new(f'hero_lamp{k}', bpy.data.lights.new(f'hero_lamp{k}', 'POINT')); sc.collection.objects.link(o); o.rotation_mode = 'QUATERNION'; LAMPS.append(o)
        o = LAMPS[k]
        if o.data.type != L['type'].upper(): o.data.type = L['type'].upper()
        c = L['color']; m = max(c + [1e-9])
        o.data.color = (c[0] / m, c[1] / m, c[2] / m); o.data.energy = 4 * math.pi * L['intensity'] * m; o.data.shadow_soft_size = 0.05
        o.matrix_world = Matrix.Translation(bvec([L['pos'][0] - O[0], L['pos'][1] - O[1], L['pos'][2] - O[2]]))
        if L['type'] == 'spot':
            o.rotation_quaternion = bvec(L['dir']).to_track_quat('-Z', 'Y'); o.data.spot_size = 2 * L['angle']; o.data.spot_blend = L.get('penumbra', 0)
        used.append(o)
    return used

REFQ = {}   # --mblur: each object's rotation at the frame being rendered; neighbour keys are made sign-compatible with it
def key_all(objs, frame):
    for o in objs:
        r = REFQ.get(o.name)
        if r is not None:   # q and -q are the same rotation, but interpolating across a sign flip spins the object
            q = o.rotation_quaternion.copy(); q.make_compatible(r); o.rotation_quaternion = q
        o.keyframe_insert('location', frame=frame); o.keyframe_insert('rotation_quaternion', frame=frame); o.keyframe_insert('scale', frame=frame)

def pose(st, O, frame, key):
    """Camera, sun and instances from one exported state, around origin O (engine axes); keyed at `frame` if `key`."""
    c = st['camera']
    R = Quaternion((c['quat'][3], c['quat'][0], c['quat'][1], c['quat'][2])).to_matrix().to_4x4()
    R.translation = Vector((c['pos'][0] - O[0], c['pos'][1] - O[1], c['pos'][2] - O[2]))
    cam.matrix_world = C @ R
    cam.data.lens = 12.0 / math.tan(math.radians(c['fov']) / 2)
    cam.data.clip_start = max(0.01, c['near']); cam.data.clip_end = min(c['far'], 1.0e6)
    s = st['sun']; e = s['irradiance']; m = max(e + [1e-9])
    sun.data.energy = m; sun.data.color = (e[0] / m, e[1] / m, e[2] / m); sun.data.angle = math.radians(s.get('angleDeg', 0.53))
    sun.rotation_quaternion = bvec(s['dir']).to_track_quat('Z', 'Y')
    hero_pts, shown = [], []
    heroes = [n for n in st['nodes'] if n['role'] == 'hero']
    hp = [Vector((n['matrix'][12], n['matrix'][13], n['matrix'][14])) for n in heroes]
    for n in st['nodes']:
        catch = n['role'] != 'hero'
        if catch and not any((Vector((n['matrix'][12], n['matrix'][13], n['matrix'][14])) - p).length < A.set_radius for p in hp): continue
        o = instance(n, catch)
        if o is None: continue
        o.matrix_world = C @ shifted(n['matrix'], O) @ CI
        if not catch: set_emissive(o, n); hero_pts.append(o.matrix_world.translation.copy())
        shown.append(o)
    lit = lamps(st, O, hp)
    if key: key_all(shown + lit + [cam], frame); cam.data.keyframe_insert('lens', frame=frame)
    return shown + lit, hero_pts

def setup_frame(i):
    st = state(i); c = st['camera']; O = c['pos']
    for o in list(INST.values()) + LAMPS: o.animation_data_clear(); o.hide_render = True
    cam.animation_data_clear()
    if cam.data.animation_data: cam.data.animation_data_clear()
    if A.mblur:
        # neighbours first, frame i last: what is not keyed (sun, lamp power and colour, emission) is left at frame i
        sc.render.motion_blur_shutter = st['post'].get('shutter', 0.5) or 0.5
        shown, _ = pose(st, O, i, False)
        REFQ.clear(); REFQ.update({o.name: o.rotation_quaternion.copy() for o in shown + [cam]})
        for j in (i - 1, i + 1):
            nb = state(j)
            pose(nb if nb and nb['shot'] == st['shot'] else st, O, j, True)
    shown, hero_pts = pose(st, O, i, A.mblur)
    for o in shown: o.hide_render = False
    dof = st['post'].get('dof')
    cam.data.dof.use_dof = bool(A.dof and dof and dof.get('focus'))
    if cam.data.dof.use_dof: cam.data.dof.focus_distance = dof['focus']; cam.data.dof.aperture_fstop = dof.get('fstop', 4)
    set_world(st)
    g = st['ground']
    if catcher is not None:
        lvl = g.get('level')
        low = min([p.z for p in hero_pts], default=None)
        on = lvl is not None and low is not None and (low - (lvl - O[1])) < A.catch_height
        catcher.hide_render = not on
        # A shadow catcher the camera sees holds out everything behind it. On the sea a flat plane at y = 0 would cut
        # every hull flat at 0, and in a wave trough (the engine's water below 0) the strip of hull between the trough
        # and 0 would be missing from both the layer and the plate: a gap at the waterline. So on the sea the plane
        # only lights the hull from below (bounce, reflections) and the engine's depth test clips the whole Cycles
        # hull at its own moving water surface; the hull's shadow on the water is given up.
        catcher.visible_camera = g['kind'] != 'sea'
        if on:
            cx = sum(p.x for p in hero_pts) / len(hero_pts); cyy = sum(p.y for p in hero_pts) / len(hero_pts)
            size = max(2000.0, 8 * math.hypot(cx, cyy))
            catcher.matrix_world = Matrix.Translation((cx, cyy, lvl - O[1])) @ Matrix.Diagonal((size, size, 1, 1))
            alb = [float(x) for x in A.ground_albedo.split(',')] if A.ground_albedo else (st['sky']['groundAlbedo'] if g['kind'] != 'sea' else [0.03, 0.04, 0.045])
            if len(alb) == 1: alb = alb * 3
            GROUND_BSDF.inputs['Base Color'].default_value = (*alb[:3], 1)
            GROUND_BSDF.inputs['Roughness'].default_value = 0.85 if g['kind'] != 'sea' else 0.12
    sc.frame_set(i)
    # planar view depth of the nearest hero origin: hero_depth()'s last-resort fallback
    vm = cam.matrix_world.inverted(); hz = min([-(vm @ p).z for p in hero_pts], default=1e9)
    return st, len([o for o in shown if o.type == 'MESH' and not o.is_shadow_catcher]), max(hz, cam.data.clip_start)

# ------------------------------------------------------------------ outputs
def agx_display(rgb, post):
    """The engine's tone curve and grade (engine/pipeline.js FINAL_FRAG, without lens effects): display RGB 0..1."""
    x = np.maximum(rgb, 0) * post.get('exposure', 0.25) * np.array(post.get('wb') or [1, 1, 1], np.float32)
    M = np.array([[0.842479062253094, 0.0423282422610123, 0.0423756549057051], [0.0784335999999992, 0.878468636469772, 0.0784336], [0.0792237451477643, 0.0791661274605434, 0.879142973793104]], np.float32)
    MI = np.array([[1.19687900512017, -0.0528968517574562, -0.0529716355144438], [-0.0980208811401368, 1.15190312990417, -0.0980434501171241], [-0.0990297440797205, -0.0989611768448433, 1.15107367264116]], np.float32)
    v = x @ M; v = (np.clip(np.log2(np.maximum(v, 1e-10)), -12.47393, 4.026069) + 12.47393) / 16.5
    v2 = v * v; v4 = v2 * v2
    o = 15.5 * v4 * v2 - 40.14 * v4 * v + 31.96 * v4 - 6.868 * v2 * v + 0.4298 * v2 + 0.1191 * v - 0.00232
    o = np.power(np.maximum(o, 0), post.get('contrast', 1.12)); lum = o @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    o = lum[..., None] + post.get('sat', 1.12) * (o - lum[..., None])
    return np.clip(o @ MI, 0, 1)

def min3(a):
    """3 x 3 minimum filter (edges padded with 'no hero')."""
    P = np.pad(a, 1, constant_values=1e9); o = a.copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2): o = np.minimum(o, P[dy:dy + a.shape[0], dx:dx + a.shape[1]])
    return o

def hero_depth(Al, Z, hero_z):
    """View depth for every pixel the heroes cover at all (alpha > 1/1024); 1e9 elsewhere. Cycles' depth comes from
    the first sample, so a covered pixel can lack one: a soft or thin edge (fin, antenna, strut, a distant hero) whose
    first sample missed, or a mostly-covered pixel whose first sample did. Such pixels take the nearest solid hero depth
    within 3 px (7 x 7), then within 19 px, and last the median hero depth (the nearest hero origin's planar depth if
    no pixel is solid). Without a depth the engine's test would drop them wherever the plate behind is not sky."""
    valid = (Al > 0.5) & (Z < 1e9)
    Zv = np.where(valid, Z, 1e9).astype(np.float32)
    cov = Al > 1 / 1024
    Zn = Zv
    for _ in range(3): Zn = min3(Zn)
    Zg = Zn
    for _ in range(16):   # only pixels still without a depth reach further; the others keep their 3 px answer
        if not (cov & ~valid & (Zn >= 1e9)).any(): break
        Zg = min3(Zg); Zn = np.where(Zn < 1e9, Zn, Zg)
    fallback = float(np.median(Z[valid])) if valid.any() else float(hero_z)
    Zh = np.where(valid, Z, np.where(cov, np.where(Zn < 1e9, Zn, fallback), 1e9)).astype(np.float32)
    return Zh, int((cov & ~valid).sum()), int((cov & ~valid & (Zn >= 1e9)).sum())

def pack(exr, st, hero_z):
    px, names = read_exr(exr); px = px[::-1]      # rows bottom to top
    ch = lambda suf: px[..., names.index(next(n for n in names if n.endswith(suf)))]
    Cc = np.stack([ch('Combined.R'), ch('Combined.G'), ch('Combined.B')], -1); Al = ch('Combined.A'); Z = ch('Depth.Z')
    try: S = np.stack([ch('Shadow Catcher.R'), ch('Shadow Catcher.G'), ch('Shadow Catcher.B')], -1)
    except StopIteration: S = np.ones_like(Cc)
    S = np.where(np.isfinite(S), np.clip(S, 0, 8), 1).astype(np.float32)
    Zh, n_edge, n_fallback = hero_depth(Al, Z, hero_z)
    if n_fallback: d.log(f'  depth: {n_fallback} of {n_edge} edge pixel(s) had no solid hero pixel within 19 px and took the fallback depth')
    m = (Al > 1 / 1024) | (np.abs(S - 1).max(-1) > 1 / 1024)
    h, w = Al.shape
    ys, xs = np.nonzero(m)
    if len(ys): x0, x1, y0, y1 = max(0, xs.min() - 1), min(w, xs.max() + 2), max(0, ys.min() - 1), min(h, ys.max() + 2)
    else: x0 = x1 = y0 = y1 = 0
    x0, x1, y0, y1 = int(x0), int(x1), int(y0), int(y1); cw, chh = x1 - x0, y1 - y0
    col = np.concatenate([Cc, Al[..., None]], -1)[y0:y1, x0:x1].astype(np.float16)
    aux = np.concatenate([S, Zh[..., None]], -1)[y0:y1, x0:x1].astype(np.float32)
    binf = exr[:-4] + '.bin'
    with open(binf, 'wb') as f:
        f.write(struct.pack('<4s7i', b'HRO1', w, h, x0, y0, cw, chh, select_hash(SELECT))); f.write(col.tobytes()); f.write(aux.tobytes())
    # preview
    straight = np.where(Al[..., None] > 1e-4, Cc / np.maximum(Al[..., None], 1e-4), 0)
    rgba = np.concatenate([agx_display(straight, st['post']), np.clip(Al, 0, 1)[..., None]], -1)[::-1]
    ps = oiio.ImageSpec(w, h, 4, oiio.UINT8); ps.attribute('oiio:UnassociatedAlpha', 1)    # straight alpha: no un-premultiply on write
    out = oiio.ImageBuf(ps); out.set_pixels(oiio.ROI(), np.ascontiguousarray((rgba * 255 + 0.5).astype(np.uint8)))
    out.write(exr[:-4] + '.png')
    return binf, (x0, y0, cw, chh), n_edge

def write_empty(i):
    with open(os.path.join(OUT, f'hero_{i:06d}.bin'), 'wb') as f: f.write(struct.pack('<4s7i', b'HRO1', RW, RH, 0, 0, 0, 0, select_hash(SELECT)))

timing = {'device': DEVICE, 'devices': DEVNAMES, 'threads': os.cpu_count(), 'samples': A.samples, 'noise': A.noise, 'size': [RW, RH], 'frames': {}}
tf = os.path.join(OUT, 'timing.json')
if os.path.exists(tf):
    try: timing['frames'] = json.load(open(tf)).get('frames', {})
    except Exception: pass
for i in FRAMES:
    if state(i) is None: d.log(f'frame {i}: not exported, skipped'); continue
    t0 = time.time()
    st, nh, hero_z = setup_frame(i)
    if nh == 0:
        exported = [n['name'] for n in st['nodes'] if n['role'] == 'hero']
        if exported: raise RuntimeError(f'frame {i}: {len(exported)} hero node(s) exported ({", ".join(exported[:5])}) but none instanced')
        write_empty(i); d.log(f'frame {i}: no hero exported in this frame, empty layer'); continue
    exr = os.path.join(OUT, f'hero_{i:06d}.exr'); sc.render.filepath = exr
    t1 = time.time(); c1 = time.process_time(); bpy.ops.render.render(write_still=True); t2 = time.time(); c2 = time.process_time()
    binf, crop, n_edge = pack(exr, st, hero_z)
    if A.no_exr: os.remove(exr)
    if A.blend and i == FRAMES[0]: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'hero_shot.blend'), copy=True)
    # render_cpu: CPU seconds the render used on all threads (on a shared CPU, wall time / render_cpu x threads shows the
    # share it got); edge_px: covered pixels whose depth hero_depth() filled in
    timing['frames'][str(i)] = {'setup': round(t1 - t0, 2), 'render': round(t2 - t1, 2), 'render_cpu': round(c2 - c1, 1), 'pack': round(time.time() - t2, 2), 'crop': list(crop), 'edge_px': n_edge}
    d.log(f'frame {i} (t={st["t"]:.3f}, {st["shot"]}): {nh} hero node(s), setup {t1 - t0:.1f} s, render {t2 - t1:.1f} s ({c2 - c1:.0f} CPU s) on {DEVICE}, crop {crop}')
    with open(tf + '.tmp', 'w') as f: json.dump(timing, f, indent=1)
    os.replace(tf + '.tmp', tf)   # a run stopped mid-write keeps the earlier frames' record
d.log('done:', OUT)
