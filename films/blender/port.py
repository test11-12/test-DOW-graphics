# The harbour for "Three Corsairs": a generic naval maintenance waterfront standing in for the facility at
# Bandar Abbas (not a survey of it). Same layout and coordinates as src/corsair_model.js buildPort / PORT.
#
#   node tools/blender.mjs port <stage> [<stage> ...]
#     rocklib   CC0 rock scans (Poly Haven) -> welded, closed, decimated armour stones baked into one atlas
#     rocks     breakwaters and rubble banks: stones packed along the old paths, gravel core, baked light
#     pier      pier, finger pier, ship-lift platform, piles, fenders, bollards, ladders, rails, winches
#     gantry    yellow ship-lift gantry, the small submarine on its keel blocks
#     yard      quay, apron, land, sheds, containers, crane, tanks, lamps, base buildings, harbour craft, buoys
#
# World frame: engine +x east, +y up, +z south == Blender +X, +Z, -Y. Sea level is 0. The film's sun (az 80,
# el 11) is baked into each object's light: R = occlusion, G = sun visibility (static shadows), used by
# src/corsair_port.js. Sources are cached in /opt/dow-cache; only the exported .glb files are committed.
import os, sys, math, json, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler
import dowlib as d

CACHE = d.bake_dir('harbour')
DRAFT = 'draft' in d.args()          # quarter-size atlases and fewer samples, for judging materials quickly
HALF = 'half' in d.args()            # half-size atlases, for judging weathering at film distance
SUN_AZ, SUN_EL = 80.0, 11.0
PORT = dict(quayY=2.4, quayZ=-22, pier=dict(x0=-19, x1=-11, z1=52, y=2.6), lift=dict(x0=-8, x1=4, z0=2, z1=40, y=1.5),
            sub=dict(x=-2, z0=5.5, z1=34.5, y=3.32), finger=dict(x0=4.6, x1=7.2, z1=44),
            entrance=[[30, 176], [176, 108]], hits=[[-2.2, 41.2], [8.4, 22.5], [-20.2, 26]])


def W(x, y, z):
    """engine world (x east, y up, z south) -> Blender (X east, Y north, Z up)"""
    return Vector((x, -z, y))


def sun_dir():
    az, el = math.radians(SUN_AZ), math.radians(SUN_EL)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))   # Blender axes


def rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------------ mesh helpers
def mesh_from_arrays(name, V, F, uv=None, link=True):
    """Triangle / quad mesh from numpy arrays (V: n x 3, F: m x k)."""
    V = np.asarray(V, np.float32); F = np.asarray(F, np.int32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
    k = F.shape[1]
    me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.ravel())
    me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', np.arange(0, F.size, k, dtype=np.int32)); me.polygons.foreach_set('loop_total', np.full(len(F), k, np.int32))
    me.update(); me.validate()
    if uv is not None:
        l = me.uv_layers.new(name='UVMap'); l.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    if link:
        bpy.context.collection.objects.link(ob)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def weld_and_close(ob, dist):
    """Merge seam-split vertices, drop specks, fill the open bottom of a scan so it is watertight."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    # keep components above 3% of the largest by face count
    bm.faces.ensure_lookup_table()
    comp, seen = [], set()
    for f in bm.faces:
        if f.index in seen: continue
        stack, cur = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop(); cur.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: seen.add(h.index); stack.append(h)
        comp.append(cur)
    comp.sort(key=len, reverse=True)
    big = len(comp[0])
    drop = [f for c in comp if len(c) < 0.03 * big for f in c]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bnd = [e for e in bm.edges if e.is_boundary]
    if bnd:
        bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return [len(c) for c in comp if len(c) >= 0.03 * big]


def split_parts(ob, min_frac=0.12):
    """Separate loose parts; returns the parts above min_frac of the largest (by bounding volume)."""
    d.select([ob])
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.selected_objects]
    vol = lambda o: o.dimensions.x * o.dimensions.y * o.dimensions.z
    parts.sort(key=vol, reverse=True)
    keep = [o for o in parts if vol(o) >= min_frac * vol(parts[0])]
    for o in parts:
        if o not in keep: bpy.data.objects.remove(o)
    return keep


def decimate(ob, target_tris):
    n = tris(ob)
    if n <= target_tris: return ob
    m = ob.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = target_tris / n; m.use_collapse_triangulate = True
    d.apply_modifiers(ob)
    return ob


def origin_to_center(ob):
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    c = sum(bb, Vector()) / 8
    ob.data.transform(Matrix.Translation(-c)); ob.location = (0, 0, 0)
    return c


# ------------------------------------------------------------------ baking helpers
def bake_expr(low, high, build, img, samples=4, cage=0.03, ray=0.08):
    """Bake an arbitrary shader expression of the high-poly material(s) into img through an Emission shader.
    build(nt, bsdf) -> output socket (colour or float)."""
    saved = []
    for slot in high.material_slots:
        m = slot.material
        if not m or any(m is s[0] for s in saved): continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(build(nt, bsdf), em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        saved.append((m, nt, em, out, old))
    try:
        d.bake([low], 'EMIT', img, samples=samples, sources=[high], cage_extrusion=cage, max_ray_distance=ray)
    finally:
        for m, nt, em, out, old in saved:
            nt.nodes.remove(em)
            if old is not None: nt.links.new(old, out.inputs['Surface'])
    return img


def linked_socket(sock):
    return sock.links[0].from_socket if sock.is_linked else None


def push_pull(arr, mask):
    """Fill texels outside `mask` (h, w bool) from their neighbourhood at every scale, so mip levels of a baked
    atlas do not bleed the empty background into the islands."""
    levels, a, m = [], arr * mask[..., None], mask.astype(np.float32)
    while min(a.shape[:2]) > 1:
        levels.append((a, m))
        h, w = a.shape[0] // 2, a.shape[1] // 2
        a2 = a[:h * 2, :w * 2].reshape(h, 2, w, 2, -1).sum((1, 3)); m2 = m[:h * 2, :w * 2].reshape(h, 2, w, 2).sum((1, 3))
        a = a2 / np.maximum(m2, 1e-6)[..., None] * (m2 > 0)[..., None]; m = (m2 > 0).astype(np.float32)
        a = a * m[..., None]
    fill = a
    for a, m in reversed(levels):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)[:a.shape[0], :a.shape[1]]
        if up.shape[:2] != a.shape[:2]:
            up = np.pad(up, ((0, a.shape[0] - up.shape[0]), (0, a.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        fill = np.where(m[..., None] > 0, a, up)
    return fill


def downsample(img, size, name):
    a = d.pixels(img)
    h, w = a.shape[:2]
    f = w // size
    b = a.reshape(size, f, size, f, 4).mean(axis=(1, 3))
    out = d.new_image(name, size, non_color=img.colorspace_settings.name == 'Non-Color')
    d.set_pixels(out, b)
    return out


# ------------------------------------------------------------------ stage: rock library
# (asset, piece count, hue shift, saturation, value) -- the warm Namaqualand granites are pulled towards the
# grey-beige of quarried limestone armour; the dark basalt-like stones stay a minority.
ROCKS = [
    ('namaqualand_boulder_03', 1, 0.0, 0.55, 1.32),
    ('namaqualand_boulder_04', 1, 0.0, 0.42, 1.38),
    ('boulder_01', 1, 0.0, 0.70, 1.25),
    ('namaqualand_boulder_02', 3, 0.0, 0.5, 1.3),
    ('namaqualand_boulder_05', 1, 0.0, 0.5, 1.05),
    ('namaqualand_boulder_06', 1, 0.0, 0.5, 1.3),
    ('rock_09', 1, 0.0, 0.6, 1.35),
    ('rock_07', 1, 0.0, 0.6, 1.3),
    ('stone_01', 1, 0.0, 0.25, 1.1),
    ('moon_rock_02', 1, 0.0, 1.0, 0.9),
]
CELL, ACOLS = 512, 4            # atlas: 4 x 4 cells of 512 px in 2048 x 2048
LOD_A, LOD_B = 300, 80          # triangles per stone: near (within ~150 m), far


def stage_rocklib():
    d.reset(samples=8)
    d.ensure_world((0.0, 0.0, 0.0))
    lib = []
    for asset, pieces, hue, sat, val in ROCKS:
        path = d.polyhaven_model(asset, '2k')
        objs = [o for o in d.import_gltf(path) if o.type == 'MESH']
        d.select(objs, objs[0])
        if len(objs) > 1: bpy.ops.object.join()
        hi = bpy.context.view_layer.objects.active
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        size = max(hi.dimensions)
        parts = [hi]
        if pieces > 1:
            bm = bmesh.new(); bm.from_mesh(hi.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 2e-4); bm.to_mesh(hi.data); bm.free()
            parts = split_parts(hi)[:pieces]
        for k, p in enumerate(parts):
            comps = weld_and_close(p, max(p.dimensions) * 2e-4)
            origin_to_center(p)
            p.name = f'hi_{asset}_{k}'
            lib.append(dict(asset=asset, piece=k, hi=p, hue=hue, sat=sat, val=val))
            d.log('rock', asset, k, 'dims', tuple(round(x, 3) for x in p.dimensions), 'tris', tris(p), 'components', comps[:4])
    # low-poly stones, unwrapped, baked from the scans
    atlas = {k: np.zeros((ACOLS * CELL, ACOLS * CELL, 4), np.float32) for k in ('base', 'orm', 'normal')}
    atlas['normal'][..., :] = (0.5, 0.5, 1.0, 1.0); atlas['orm'][..., :] = (1.0, 0.8, 0.0, 1.0); atlas['base'][..., 3] = 1
    meta = []
    for i, r in enumerate(lib):
        hi = r['hi']
        lo = hi.copy(); lo.data = hi.data.copy(); bpy.context.collection.objects.link(lo); lo.name = f'rockA_{i}'
        for m in list(lo.modifiers): lo.modifiers.remove(m)
        decimate(lo, LOD_A)
        lo.data.materials.clear()
        d.smooth(lo, 70)
        while lo.data.uv_layers: lo.data.uv_layers.remove(lo.data.uv_layers[0])
        lo.data.uv_layers.new(name='UVMap')
        d.smart_uv(lo, 72, 0.025)
        # bake at 2x the cell and box-filter down
        sz = CELL * 2; s = max(hi.dimensions)
        cage, ray = 0.04 * s, 0.12 * s
        mat = bpy.data.materials.new(f'bake_{i}'); mat.use_nodes = True; lo.data.materials.append(mat)
        base = d.new_image(f'rb_{i}', sz, alpha=True, color=(0, 0, 0, 0))
        def build_base(nt, bsdf, r=r):
            src = linked_socket(bsdf.inputs['Base Color'])
            hsv = nt.nodes.new('ShaderNodeHueSaturation')
            hsv.inputs['Hue'].default_value = 0.5 + r['hue']; hsv.inputs['Saturation'].default_value = r['sat']; hsv.inputs['Value'].default_value = r['val']
            if src is not None: nt.links.new(src, hsv.inputs['Color'])
            else: hsv.inputs['Color'].default_value = bsdf.inputs['Base Color'].default_value
            return hsv.outputs['Color']
        bake_expr(lo, hi, build_base, base, samples=4, cage=cage, ray=ray)
        rough = d.new_image(f'rr_{i}', sz, non_color=True)
        def build_rough(nt, bsdf):
            src = linked_socket(bsdf.inputs['Roughness'])
            if src is not None: return src
            v = nt.nodes.new('ShaderNodeValue'); v.outputs[0].default_value = bsdf.inputs['Roughness'].default_value; return v.outputs[0]
        bake_expr(lo, hi, build_rough, rough, samples=2, cage=cage, ray=ray)
        nrm = d.new_image(f'rn_{i}', sz, non_color=True, color=(0.5, 0.5, 1.0, 1.0))
        d.bake([lo], 'NORMAL', nrm, samples=4, sources=[hi], cage_extrusion=cage, max_ray_distance=ray)
        ao = d.new_image(f'ra_{i}', sz // 2, non_color=True, color=(1, 1, 1, 1))
        bpy.context.scene.world.light_settings.distance = 0.25 * s
        d.bake([lo], 'AO', ao, samples=32)
        d.blur(ao, 1.0); ao = d.resize(ao, sz, f'ra_{i}_f')
        # into the atlas cell
        col, row = i % ACOLS, i // ACOLS
        ys, xs = row * CELL, col * CELL
        b = downsample(base, CELL, f'rb_{i}_s'); n = downsample(nrm, CELL, f'rn_{i}_s')
        ro = downsample(rough, CELL, f'rr_{i}_s'); a = downsample(ao, CELL, f'ra_{i}_s')
        bp = d.pixels(b); mask = bp[..., 3] > 0.5
        cb = bp.copy(); cb[..., 3] = 1
        atlas['base'][ys:ys + CELL, xs:xs + CELL] = push_pull(cb, mask)
        nn = d.pixels(n)[..., :3] * 2 - 1; nn /= np.linalg.norm(nn, axis=-1, keepdims=True) + 1e-6
        nn = push_pull(nn * 0.5 + 0.5, mask)
        atlas['normal'][ys:ys + CELL, xs:xs + CELL, :3] = nn
        orm = np.ones((CELL, CELL, 4), np.float32)
        orm[..., 0] = 0.35 + 0.65 * d.pixels(a)[..., 0]; orm[..., 1] = np.clip(d.pixels(ro)[..., 0], 0.45, 1.0); orm[..., 2] = 0.0
        atlas['orm'][ys:ys + CELL, xs:xs + CELL] = push_pull(orm, mask)
        # UVs into the cell (inset by 3 px against mip bleeding)
        inset = 3.0 / CELL
        uv = np.empty(len(lo.data.loops) * 2, np.float32); lo.data.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        uv = inset + uv * (1 - 2 * inset)
        uv[:, 0] = (uv[:, 0] + col) / ACOLS; uv[:, 1] = (uv[:, 1] + row) / ACOLS   # array rows (and v) run bottom-up
        lo.data.uv_layers[0].data.foreach_set('uv', uv.ravel())
        lo.data.materials.clear()
        # far LOD
        lb = lo.copy(); lb.data = lo.data.copy(); bpy.context.collection.objects.link(lb); lb.name = f'rockB_{i}'
        decimate(lb, LOD_B); d.smooth(lb, 70)
        avg = d.pixels(b)[..., :3].reshape(-1, 3).mean(0)
        meta.append(dict(i=i, asset=r['asset'], piece=r['piece'], dims=list(lo.dimensions), trisA=tris(lo), trisB=tris(lb), avg=[float(x) for x in avg]))
        d.log('baked', i, r['asset'], r['piece'], 'A', tris(lo), 'B', tris(lb), 'avg', np.round(avg, 3))
        for im in (base, rough, nrm, ao, b, n, ro, a): bpy.data.images.remove(im)
    for k, arr in atlas.items():
        img = d.new_image(f'rock_{k}', ACOLS * CELL, non_color=k != 'base')
        d.set_pixels(img, arr)
        d.save_png(img, os.path.join(CACHE, f'rock_{k}.png'))
    # keep only the stones
    for r in lib: bpy.data.objects.remove(r['hi'])
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im.users == 0: bpy.data.images.remove(im)
    json.dump(meta, open(os.path.join(CACHE, 'rocklib.json'), 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE, 'rocklib.blend'))
    d.log('rock library:', len(meta), 'stones')


# ------------------------------------------------------------------ GLB packing (KHR_mesh_quantization)
def quantize_glb(path):
    """Rewrite a GLB with quantized vertex data: positions as normalized int16 (the node's translation and scale
    dequantize them), normals int8, texcoords uint16 when inside 0..1, the baked _AO/_SUN light as two bytes,
    indices uint16 where they fit. Images and everything else pass through. three.js reads it natively."""
    import struct
    raw = open(path, 'rb').read()
    L = struct.unpack('<I', raw[12:16])[0]; J = json.loads(raw[20:20 + L]); B = raw[20 + L + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    def read(ai):
        a = J['accessors'][ai]; bv = J['bufferViews'][a['bufferView']]; dt = CT[a['componentType']]; n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', 0) or n * np.dtype(dt).itemsize
        arr = np.frombuffer(B, dtype=np.uint8, count=st * (a['count'] - 1) + n * np.dtype(dt).itemsize, offset=off)
        out = np.lib.stride_tricks.as_strided(arr.view(np.uint8), shape=(a['count'], n * np.dtype(dt).itemsize), strides=(st, 1)).copy().view(dt).reshape(a['count'], n)
        if a.get('normalized'):
            out = out.astype(np.float32) / {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}[dt]
        return out
    newB = bytearray(); views = []; accs = []
    def view(data, stride=None, target=None):
        while len(newB) % 4: newB.append(0)
        v = {'buffer': 0, 'byteOffset': len(newB), 'byteLength': len(data)}
        if stride: v['byteStride'] = stride
        if target: v['target'] = target
        newB.extend(data); views.append(v); return len(views) - 1
    def acc(vi, ct, n, count, normalized=False, mn=None, mx=None, off=0):
        a = {'bufferView': vi, 'componentType': ct, 'count': int(count), 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[n]}
        if off: a['byteOffset'] = off
        if normalized: a['normalized'] = True
        if mn is not None: a['min'] = [float(x) for x in mn]; a['max'] = [float(x) for x in mx]
        accs.append(a); return len(accs) - 1
    # images and other non-vertex views: copy through
    keep = {}
    for im in J.get('images', []):
        if 'bufferView' in im:
            bv = J['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
            im['bufferView'] = keep.setdefault(im['bufferView'], view(B[o:o + bv['byteLength']]))
    mesh_nodes = {}
    for ni, n in enumerate(J.get('nodes', [])):
        if 'mesh' in n: mesh_nodes.setdefault(n['mesh'], []).append(ni)
    for mi, m in enumerate(J.get('meshes', [])):
        P = [read(p['attributes']['POSITION']) for p in m['primitives']]
        allp = np.concatenate(P); lo, hi = allp.min(0), allp.max(0)
        T = (lo + hi) / 2; S = np.maximum((hi - lo) / 2, 1e-3)
        for p, pos in zip(m['primitives'], P):
            at = p['attributes']; na = {}
            q = np.clip(np.round((pos - T) / S * 32767), -32767, 32767).astype(np.int16)
            q4 = np.zeros((len(q), 4), np.int16); q4[:, :3] = q
            light = '_AO' in at and '_SUN' in at
            if light:      # the baked light rides in the two padding bytes of each position (one 8-byte stride view)
                l2 = np.zeros((len(q), 2), np.uint8)
                l2[:, 0] = np.round(np.clip(read(at['_AO'])[:, 0], 0, 1) * 255); l2[:, 1] = np.round(np.clip(read(at['_SUN'])[:, 0], 0, 1) * 255)
                q4[:, 3] = l2.view(np.int16)[:, 0]
            pv = view(q4.tobytes(), 8, 34962)
            na['POSITION'] = acc(pv, 5122, 3, len(q), True, q.min(0) / 32767.0, q.max(0) / 32767.0)
            if light:
                na['_AO'] = acc(pv, 5121, 1, len(q), True, off=6); na['_SUN'] = acc(pv, 5121, 1, len(q), True, off=7)
            if 'NORMAL' in at:
                nn = read(at['NORMAL']) * S; nn /= np.linalg.norm(nn, axis=1, keepdims=True) + 1e-12
                n4 = np.zeros((len(nn), 4), np.int8); n4[:, :3] = np.round(nn * 127).astype(np.int8)
                na['NORMAL'] = acc(view(n4.tobytes(), 4, 34962), 5120, 3, len(nn), True)
            for k in [k for k in at if k.startswith('TEXCOORD_')]:
                uv = read(at[k])
                if uv.min() >= 0 and uv.max() <= 1:
                    na[k] = acc(view(np.round(uv * 65535).astype(np.uint16).tobytes(), 4, 34962), 5123, 2, len(uv), True)
                else:
                    na[k] = acc(view(uv.astype(np.float32).tobytes(), 8, 34962), 5126, 2, len(uv))
            for k in at:
                if k not in na and k not in ('_AO', '_SUN'):
                    a = read(at[k]); na[k] = acc(view(a.astype(np.float32).tobytes(), None, 34962), 5126, a.shape[1], len(a))
            p['attributes'] = na
            if 'indices' in p:
                ix = read(p['indices'])[:, 0]
                if ix.max() < 65535: p['indices'] = acc(view(ix.astype(np.uint16).tobytes(), None, 34963), 5123, 1, len(ix))
                else: p['indices'] = acc(view(ix.astype(np.uint32).tobytes(), None, 34963), 5125, 1, len(ix))
        for ni in mesh_nodes.get(mi, []):
            n = J['nodes'][ni]
            assert not any(k in n for k in ('matrix', 'rotation')) and n.get('scale', [1, 1, 1]) == [1, 1, 1], 'node already transformed'
            t0 = n.get('translation', [0, 0, 0])
            n['translation'] = [float(T[i] + t0[i]) for i in range(3)]; n['scale'] = [float(x) for x in S]
    J['accessors'] = accs; J['bufferViews'] = views; J['buffers'] = [{'byteLength': len(newB)}]
    for k in ('extensionsUsed', 'extensionsRequired'):
        J[k] = sorted(set(J.get(k, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(J, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(newB) % 4: newB.append(0)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(newB)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(newB), 0x004E4942) + bytes(newB)
    old = len(raw); open(path, 'wb').write(out)
    d.log(f'quantized {os.path.basename(path)}: {old / 1e6:.1f} -> {len(out) / 1e6:.1f} MB')


def stage_pack():
    for f in d.args()[1:] or sorted(os.listdir(os.path.join(d.ASSETS, 'corsair'))):
        if f.startswith('port') and f.endswith('.glb'):
            p = os.path.join(d.ASSETS, 'corsair', f)
            J = json.loads(open(p, 'rb').read()[20:20 + __import__('struct').unpack('<I', open(p, 'rb').read()[12:16])[0]])
            if 'KHR_mesh_quantization' in J.get('extensionsUsed', []): d.log('already packed', f); continue
            quantize_glb(p)


# ------------------------------------------------------------------ export, lighting bakes shared by the stages
def export(path, objs, attributes=False):
    """GLB with WebP textures (q90), no tangents (three.js derives them), custom '_' attributes when asked."""
    d.select(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='WEBP', export_image_quality=90, export_cameras=False, export_lights=False,
        export_extras=True, export_attributes=attributes, export_draco_mesh_compression_enable=False)
    d.log(f'exported {os.path.relpath(path, d.FILMS)} {os.path.getsize(path) / 1e6:.1f} MB, {sum(tris(o) for o in objs)} tris')
    quantize_glb(path)


def add_sun(strength=3.0, angle_deg=0.7):
    ld = bpy.data.lights.new('sun', 'SUN'); ld.energy = strength; ld.angle = math.radians(angle_deg)
    lo = bpy.data.objects.new('sun', ld); bpy.context.collection.objects.link(lo)
    lo.rotation_euler = sun_dir().to_track_quat('Z', 'Y').to_euler()
    return lo


def bake_vertex_light(targets, ao_dist=1.2, ao_samples=64, sun_samples=24):
    """Per-vertex occlusion and sun visibility (static shadows) into float attributes _AO and _SUN."""
    sc = bpy.context.scene
    w = d.ensure_world((0.0, 0.0, 0.0)); w.light_settings.distance = ao_dist
    for o in targets:
        me = o.data
        for n in ('bake_col',):
            if n in me.color_attributes: me.color_attributes.remove(me.color_attributes[n])
        ca = me.color_attributes.new('bake_col', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ca
        if not me.materials:
            me.materials.append(bpy.data.materials.get('bake_dummy') or bpy.data.materials.new('bake_dummy'))
    res = {}
    for kind, samples, attr in (('AO', ao_samples, '_AO'), ('SHADOW', sun_samples, '_SUN')):
        d.select(targets)
        old = sc.cycles.samples; sc.cycles.samples = samples
        t0 = time.time()
        bpy.ops.object.bake(type=kind, target='VERTEX_COLORS', use_clear=True)
        sc.cycles.samples = old
        d.log(f'vertex bake {kind} on {sum(len(o.data.vertices) for o in targets)} verts in {time.time() - t0:.0f}s')
        for o in targets:
            me = o.data
            col = np.empty(len(me.vertices) * 4, np.float32); me.color_attributes['bake_col'].data.foreach_get('color', col)
            v = col.reshape(-1, 4)[:, 0].copy()
            if attr in me.attributes: me.attributes.remove(me.attributes[attr])
            a = me.attributes.new(attr, 'FLOAT', 'POINT'); a.data.foreach_set('value', v)
            res.setdefault(o.name, {})[attr] = float(v.mean())
    for o in targets:
        me = o.data
        if 'bake_col' in me.color_attributes: me.color_attributes.remove(me.color_attributes['bake_col'])
    return res


# ------------------------------------------------------------------ stage: breakwaters and rubble banks
# Mound = the old rubble() profile swept round each centreline as a distance field (round heads at the free ends).
BW = [
    dict(name='west', pts=[[-190, -34], [-190, 150], [-176, 172], [-150, 178], [28, 178]], crest=3.0, top=3.5, base=17.0, toe=-2.2, sea='R'),
    dict(name='east', pts=[[196, -34], [196, 70], [188, 96], [174, 110]], crest=3.0, top=3.5, base=17.0, toe=-2.2, sea='L'),
    dict(name='bankE', pts=[[26, -17], [150, -17], [206, -17]], crest=2.3, top=2.0, base=15.0, toe=-1.6, sea='R', cut=-22.3),
    dict(name='bankW', pts=[[-150, -17], [-202, -17]], crest=2.3, top=2.0, base=15.0, toe=-1.6, sea='L', cut=-22.3),
]
# cameras of the shots that come near the stones (the run through the entrance, the bow camera, the long lens
# beyond the west breakwater), for choosing where the detailed stones are needed
CAM_PTS = [(122 + (34 - 122) * k, 172 + (88 - 172) * k) for k in np.linspace(0, 1, 16)] + \
          [(34 + (-2 - 34) * k, 88 + (41 - 88) * k) for k in np.linspace(0, 1, 12)] + [(-120, 214)]
NEAR_CHUNK = 110      # m from a camera point to a chunk centre
STONE_A, STONE_B = 150, 48
ANGULAR = {'boulder_01': 1.6, 'namaqualand_boulder_03': 1.5, 'namaqualand_boulder_02': 1.3, 'rock_09': 0.45, 'rock_07': 0.35, 'stone_01': 1.1,
           'namaqualand_boulder_04': 0.7, 'namaqualand_boulder_05': 0.5, 'namaqualand_boulder_06': 0.6, 'moon_rock_02': 0.4}


def smooth_path(pts, step=0.5):
    """Centripetal Catmull-Rom through the control points, sampled every `step` m: (N,2) points."""
    P = [np.array(p, float) for p in pts]
    P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0; t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5; t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5; t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        n = max(2, int(np.linalg.norm(p2 - p1) / step))
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(P[-2])
    return np.array(out)


class Mound:
    def __init__(self, spec):
        self.s = spec
        self.c = smooth_path(spec['pts'])
        seg = np.diff(self.c, axis=0); self.len = np.linalg.norm(seg, axis=1); self.arc = np.concatenate([[0], np.cumsum(self.len)])
        self.L = self.arc[-1]
        self.hw = spec['base'] / 2; self.ct = spec['top'] / 2

    def dist(self, xz, batch=2048):
        """distance to the centreline, arc position, signed side (+ left of travel), for (N,2) points"""
        D, S, SD = [], [], []
        a = self.c[:-1][None]; b = self.c[1:][None]; ab = b - a; ab2 = np.maximum((ab * ab).sum(-1), 1e-9)
        for k0 in range(0, len(xz), batch):
            P = xz[k0:k0 + batch]; p = P[:, None]
            t = np.clip(((p - a) * ab).sum(-1) / ab2, 0, 1)
            q = a + ab * t[..., None]; dd = np.linalg.norm(p - q, axis=-1)
            k = dd.argmin(1); i = np.arange(len(P))
            s = self.arc[k] + t[i, k] * self.len[k]
            tan = ab[0, k] / np.maximum(self.len[k][:, None], 1e-9)
            rel = P - q[i, k]
            D.append(dd[i, k]); S.append(s); SD.append(np.sign(tan[:, 1] * rel[:, 0] - tan[:, 0] * rel[:, 1]))   # + = left (x east, z south)
        return np.concatenate(D), np.concatenate(S), np.concatenate(SD)

    def height(self, dist):
        sp = self.s; k = np.clip((self.hw - dist) / (self.hw - self.ct), 0, 1)
        return sp['toe'] + (sp['crest'] - sp['toe']) * k ** 0.85

    def slope(self, dist):
        e = 0.05
        return (self.height(dist + e) - self.height(dist - e)) / (2 * e)


def stage_rocks():
    lib_meta = json.load(open(os.path.join(CACHE, 'rocklib.json')))
    bpy.ops.wm.open_mainfile(filepath=os.path.join(CACHE, 'rocklib.blend'))
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    R = rng(2026)
    nlib = len(lib_meta)
    # library geometry as arrays: verts, triangles, per-corner UVs (atlas space)
    def arrays(ob):
        me = ob.data; me.calc_loop_triangles()
        V = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', V); V = V.reshape(-1, 3)
        T = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('vertices', T); T = T.reshape(-1, 3)
        LT = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('loops', LT)
        UV = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', UV); UV = UV.reshape(-1, 2)[LT]
        return V, T, UV
    for i in range(nlib):                      # stone budgets for the whole harbour (frame time, file size)
        decimate(bpy.data.objects[f'rockA_{i}'], STONE_A); decimate(bpy.data.objects[f'rockB_{i}'], STONE_B)
    LIB = {L: [arrays(bpy.data.objects[f'rock{L}_{i}']) for i in range(nlib)] for L in 'AB'}
    dims = np.array([m['dims'] for m in lib_meta])
    # darker basalt-like stones (rock_07, rock_09) as a minority
    wts = np.array([ANGULAR.get(m['asset'], 1.0) for m in lib_meta]); wts /= wts.sum()
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)

    stones = []   # (struct, center xyz world, D, quat(Blender), model, s)
    for si, spec in enumerate(BW):
        M = Mound(spec)
        xs = M.c[:, 0]; zs = M.c[:, 1]
        lo = np.array([xs.min() - M.hw - 1, zs.min() - M.hw - 1]); hi = np.array([xs.max() + M.hw + 1, zs.max() + M.hw + 1])
        area = (hi - lo).prod()
        placed = []   # (cx, cy, cz, r)
        grid = {}
        def near(p, r):
            gx, gy = int(p[0] // 4), int(p[1] // 4)
            for i in range(gx - 1, gx + 2):
                for j in range(gy - 1, gy + 2):
                    for q in grid.get((i, j), ()):
                        if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < (r + q[3]) ** 2: return True
            return False
        for pas, (scale, spacing, tries) in enumerate(((1.12, 0.64, 2.4), (0.85, 0.6, 0.5))):
            n = int(area * tries)
            xz = lo + R.random((n, 2)) * (hi - lo)
            dist, s, side = M.dist(xz)
            h = M.height(dist)
            keep = (dist < M.hw - 0.3) & (h > (-0.75 if pas == 0 else 0.2))
            if 'cut' in spec: keep &= xz[:, 1] > spec['cut']
            xz, dist, s, side, h = xz[keep], dist[keep], s[keep], side[keep], h[keep]
            g = M.slope(dist)
            acc = R.random(len(xz)) < np.sqrt(1 + g * g) / np.sqrt(1 + 2.0)
            for (x, z), dd, ss, sd, hh, gg in zip(xz[acc], dist[acc], s[acc], side[acc], h[acc], g[acc]):
                # zone: crest, seaward face, harbour face, toe; free ends are the roundheads (armour is heaviest there)
                sea = (sd > 0) == (spec['sea'] == 'L')
                head = ss > M.L - 1.0 and not spec.get('cut')
                if dd < M.ct + 0.5: D = R.uniform(1.3, 2.2)
                elif hh < -0.6: D = R.uniform(1.4, 2.4)
                elif head: D = R.uniform(2.0, 3.0)
                elif sea: D = R.uniform(1.6, 2.8)
                else: D = R.uniform(1.0, 2.0)
                if spec.get('cut'): D = R.uniform(1.0, 2.0)
                D *= scale
                # surface normal of the envelope (Blender axes): -grad h in xz, up
                dxz = np.array([x, z]) - M.c[np.argmin(np.linalg.norm(M.c - [x, z], axis=1))]
                dl = np.linalg.norm(dxz); dirx, dirz = (dxz / dl) if dl > 1e-6 else (0.0, 0.0)
                nrm = Vector((-gg * dirx, gg * dirz, 1.0)).normalized()    # engine z south == Blender -Y
                mi = R.choice(nlib, p=wts)
                dm = dims[mi]; sfac = D / max(dm[0], dm[1]); thick = dm[2] * sfac
                c = Vector((x, -z, hh)) - nrm * ((0.32 if pas == 0 else 0.05) * thick) + Vector(R.normal(0, 0.06, 3))
                r = 0.5 * D * spacing
                p = (c.x, c.y, c.z)
                if near(p, r): continue
                q_align = Vector((0, 0, 1)).rotation_difference(nrm)
                tilt = Quaternion(Vector(R.normal(0, 1, 3)).normalized(), math.radians(R.uniform(0, 24 if pas == 0 else 45)))
                yaw = Quaternion((0, 0, 1), R.uniform(0, 2 * math.pi))
                q = q_align @ tilt @ yaw
                placed.append(p + (r,)); grid.setdefault((int(p[0] // 4), int(p[1] // 4)), []).append(p + (r,))
                stones.append(dict(st=si, c=c, s=sfac, q=q, m=int(mi), arc=float(ss)))
        d.log(f'{spec["name"]}: {len(placed)} stones over {M.L:.0f} m')

    # chunks of 40 m along each structure; near LOD only where a camera of the film comes within 170 m
    def chunk_of(st): return (st['st'], int(st['arc'] // 40))
    chunks = {}
    for st in stones: chunks.setdefault(chunk_of(st), []).append(st)
    cams = np.array(CAM_PTS)
    objs_A, objs_B = [], []
    for key, lst in sorted(chunks.items()):
        cen = np.mean([[st['c'].x, -st['c'].y] for st in lst], axis=0)
        near_cam = np.min(np.linalg.norm(cams - cen, axis=1)) < NEAR_CHUNK
        for L in ('A', 'B') if near_cam else ('B',):
            Vs, Ts, UVs, off = [], [], [], 0
            for st in lst:
                V, T, UV = LIB[L][st['m']]
                Mx = Matrix.Translation(st['c']) @ st['q'].to_matrix().to_4x4() @ Matrix.Scale(st['s'], 4)
                Vw = (np.c_[V, np.ones(len(V))] @ np.array(Mx).T)[:, :3]
                Vs.append(Vw); Ts.append(T + off); UVs.append(UV); off += len(V)
            ob = mesh_from_arrays(f'rk_{BW[key[0]]["name"]}_{key[1]:02d}_{L}', np.concatenate(Vs), np.concatenate(Ts), np.concatenate(UVs).reshape(-1, 2))
            d.smooth(ob, 70 if L == 'A' else 180)      # far stones: no split normals (half the vertices)
            (objs_A if L == 'A' else objs_B).append(ob)
    d.log('stones', len(stones), 'chunks', len(chunks), 'near-LOD chunks', len(objs_A),
          'tris A', sum(tris(o) for o in objs_A), 'tris B', sum(tris(o) for o in objs_B))

    # gravel / small-stone core under the armour (seen in the voids)
    cores = []
    for spec in BW:
        M = Mound(spec)
        xs = M.c[:, 0]; zs = M.c[:, 1]
        gx = np.arange(xs.min() - M.hw - 1, xs.max() + M.hw + 1.01, 1.0); gz = np.arange(zs.min() - M.hw - 1, zs.max() + M.hw + 1.01, 1.0)
        X, Z = np.meshgrid(gx, gz); P = np.c_[X.ravel(), Z.ravel()]
        dist, s, side = M.dist(P)
        H = M.height(dist) - 1.15
        inside = (dist < M.hw + 0.8).reshape(X.shape)
        if 'cut' in spec: inside &= (Z > spec['cut'] - 1.2)
        nx, nz = len(gx), len(gz)
        idx = np.arange(nx * nz).reshape(nz, nx)
        q = inside[:-1, :-1] & inside[1:, :-1] & inside[:-1, 1:] & inside[1:, 1:]
        F = np.stack([idx[:-1, :-1][q], idx[:-1, 1:][q], idx[1:, 1:][q], idx[1:, :-1][q]], 1)[:, ::-1]
        V = np.c_[P[:, 0], -P[:, 1], H]
        used = np.unique(F); remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
        F = remap[F]; V = V[used]
        uv = (V[:, :2] / 4.5)[F.ravel()]
        ob = mesh_from_arrays(f'core_{spec["name"]}', V, F, uv)
        d.smooth(ob, 80)
        cores.append(ob)
    d.log('core tris', sum(tris(o) for o in cores))

    # materials: the stone atlas, and the tiling rubble scan for the core (both get the shoreline treatment in the film)
    rmat = d.gltf_material('rock', base=d.image(os.path.join(CACHE, 'rock_base.png')), orm=d.image(os.path.join(CACHE, 'rock_orm.png'), True),
                           normal=d.image(os.path.join(CACHE, 'rock_normal.png'), True))
    rmat['dow'] = 'rock'
    g = d.polyhaven_texture('gray_rocks', '1k', maps=('Diffuse', 'nor_gl', 'Rough', 'AO'))
    gb = d.image(g['Diffuse']); ga = d.image(g['AO'], True); gr = d.image(g['Rough'], True)
    gorm = d.pack_orm(ga, gr, 0.0, 'core_orm'); d.save_png(gorm, os.path.join(CACHE, 'core_orm.png'))
    cmat = d.gltf_material('rock_core', base=gb, orm=gorm, normal=d.image(g['nor_gl'], True), base_color=(0.42, 0.4, 0.38, 1))
    cmat['dow'] = 'rock'
    far_maps = {}
    for k in ('base', 'orm', 'normal'):               # the far breakwater reads its stones from a 1k atlas
        im = d.image(os.path.join(CACHE, f'rock_{k}.png'), k != 'base')
        sm = downsample(im, ACOLS * CELL // 2, f'rock_{k}_1k'); d.save_png(sm, os.path.join(CACHE, f'rock_{k}_1k.png'))
        far_maps[k] = d.image(os.path.join(CACHE, f'rock_{k}_1k.png'), k != 'base')
    fmat = d.gltf_material('rock_far', base=far_maps['base'], orm=far_maps['orm'], normal=far_maps['normal'])
    fmat['dow'] = 'rock'
    for o in objs_A: d.set_material(o, rmat)
    for o in objs_B: d.set_material(o, fmat)
    for o in cores: d.set_material(o, cmat)

    # light: occlusion and sun visibility per vertex; near LOD baked against near stones, far against far
    add_sun()
    for o in objs_A: o.hide_render = True
    bake_vertex_light(objs_B + cores)
    for o in objs_A: o.hide_render = False
    for o in objs_B: o.hide_render = True
    if objs_A: bake_vertex_light(objs_A)
    for o in objs_B: o.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE, 'rocks.blend'))
    export(d.out_path('corsair', 'port_rocks.glb'), objs_B + cores, attributes=True)
    if objs_A: export(d.out_path('corsair', 'port_rocks_near.glb'), objs_A, attributes=True)


# ------------------------------------------------------------------ modelling kit (engine coordinates in)
def E(x, y, z):
    return Vector((x, -z, y))


class Part:
    """Geometry accumulated in one bmesh, given in engine coordinates (x east, y up, z south)."""
    def __init__(self, name):
        self.name = name; self.bm = bmesh.new()

    def box(self, x0, x1, y0, y1, z0, z1):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        bmesh.ops.scale(self.bm, vec=(abs(x1 - x0), abs(z1 - z0), abs(y1 - y0)), verts=r['verts'])
        bmesh.ops.translate(self.bm, vec=((x0 + x1) / 2, -(z0 + z1) / 2, (y0 + y1) / 2), verts=r['verts'])
        return self

    def cyl(self, p0, p1, r0, r1=None, seg=16, caps=True, rot=0.0):
        a, b = E(*p0), E(*p1); dv = b - a; L = dv.length
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0, radius2=r0 if r1 is None else r1, depth=L)
        q = Vector((0, 0, 1)).rotation_difference(dv.normalized())
        M = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Rotation(rot, 4, 'Z')
        bmesh.ops.transform(self.bm, matrix=M, verts=res['verts'])
        return self

    def tube(self, pts, r, seg=8):
        for p0, p1 in zip(pts[:-1], pts[1:]):
            self.cyl(p0, p1, r, seg=seg, caps=False)
        return self

    def prism(self, pts_xy, z0, z1):
        """extrude a convex polygon given in the engine x-y plane from z0 to z1"""
        n = len(pts_xy)
        v0 = [self.bm.verts.new(E(x, y, z0)) for x, y in pts_xy]; v1 = [self.bm.verts.new(E(x, y, z1)) for x, y in pts_xy]
        self.bm.faces.new(v0[::-1]); self.bm.faces.new(v1)
        for i in range(n):
            j = (i + 1) % n; self.bm.faces.new((v0[i], v0[j], v1[j], v1[i]))
        return self

    def prism_z(self, pts_xz, y0, y1):
        """extrude a polygon given in the engine x-z plane (plan) from y0 to y1"""
        n = len(pts_xz)
        v0 = [self.bm.verts.new(E(x, y0, z)) for x, z in pts_xz]; v1 = [self.bm.verts.new(E(x, y1, z)) for x, z in pts_xz]
        f0 = self.bm.faces.new(v0); f1 = self.bm.faces.new(v1[::-1])
        for i in range(n):
            j = (i + 1) % n; self.bm.faces.new((v0[j], v0[i], v1[i], v1[j]))
        return self

    def torus(self, c, axis, R, r, seg=24, rseg=10):
        u = np.linspace(0, 2 * np.pi, seg, endpoint=False); v = np.linspace(0, 2 * np.pi, rseg, endpoint=False)
        q = Vector((0, 0, 1)).rotation_difference(axis.normalized())
        M = Matrix.Translation(E(*c)) @ q.to_matrix().to_4x4()
        vs = [[self.bm.verts.new(M @ Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))) for b in v] for a in u]
        for i in range(seg):
            for j in range(rseg):
                self.bm.faces.new((vs[i][j], vs[(i + 1) % seg][j], vs[(i + 1) % seg][(j + 1) % rseg], vs[i][(j + 1) % rseg]))
        return self

    def lathe(self, prof, axis_p0, axis_dir, seg=32, x_ofs=None):
        """surface of revolution: prof = [(s, r), ...] along axis from axis_p0 (engine coords), radius r"""
        a0 = E(*axis_p0); ad = Vector(axis_dir).normalized()
        ref = Vector((0, 0, 1)) if abs(ad.z) < 0.9 else Vector((1, 0, 0))
        u1 = ad.cross(ref).normalized(); u2 = ad.cross(u1)
        rings = []
        for s, r in prof:
            c = a0 + ad * s
            rings.append([self.bm.verts.new(c + (u1 * math.cos(t) + u2 * math.sin(t)) * max(r, 1e-4)) for t in np.linspace(0, 2 * np.pi, seg, endpoint=False)])
        for i in range(len(rings) - 1):
            for j in range(seg):
                k = (j + 1) % seg
                self.bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
        return self

    def obj(self, bevel=0.0, seg=2, angle=35, smooth=40, weld=False):
        if weld: bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-4)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        ob = bpy.data.objects.new(self.name, me); bpy.context.collection.objects.link(ob)
        if bevel > 0:
            d.bevel(ob, bevel, segments=seg, angle_deg=angle)
        d.smooth(ob, smooth)
        return ob


def ladder(p, x, z0, z1, y0, y1, axis='z', off=0.14):
    """vertical steel ladder on a face: stringers at z0/z1 (or x0/x1), rungs every 0.3 m, standing off `off`"""
    if axis == 'z':
        for zz in (z0, z1): p.box(x - off - 0.03, x - off + 0.03, y0, y1, zz - 0.02, zz + 0.02)
        y = y0 + 0.25
        while y < y1 - 0.1: p.cyl((x - off, y, z0), (x - off, y, z1), 0.016, seg=6); y += 0.3
    else:
        for xx in (z0, z1): p.box(xx - 0.02, xx + 0.02, y0, y1, x - off - 0.03, x - off + 0.03)
        y = y0 + 0.25
        while y < y1 - 0.1: p.cyl((z0, y, x - off), (z1, y, x - off), 0.016, seg=6); y += 0.3
    return p


def railing(p, pts, y0, h=1.05, step=1.9, r=0.03):
    """posts every `step` m and two rails along a polyline of (x, z) at deck height y0"""
    for (xa, za), (xb, zb) in zip(pts[:-1], pts[1:]):
        L = math.hypot(xb - xa, zb - za); n = max(1, int(round(L / step)))
        for i in range(n + 1):
            u = i / n; p.cyl((xa + (xb - xa) * u, y0, za + (zb - za) * u), (xa + (xb - xa) * u, y0 + h, za + (zb - za) * u), r, seg=8)
        for yy in (y0 + h, y0 + h * 0.52):
            p.cyl((xa, yy, za), (xb, yy, zb), r * 0.9, seg=8)
    return p


# ------------------------------------------------------------------ photoscanned materials with shape-driven wear
def scan(asset, res='2k', maps=('Diffuse', 'Rough', 'Displacement')):
    m = d.polyhaven_texture(asset, res, maps=maps)
    return {k: d.image(v, k != 'Diffuse') for k, v in m.items()}


def V(nt, v):
    n = nt.nodes.new('ShaderNodeValue'); n.outputs[0].default_value = v; return n.outputs[0]


def mr(nt, x, a, b, c=0.0, e=1.0, smooth=True):
    n = nt.nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP' if smooth else 'LINEAR'; n.clamp = True
    for k, v in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', e)): n.inputs[k].default_value = v
    nt.links.new(x, n.inputs['Value']); return n.outputs['Result']


def noise(nt, coords, scale, detail=4.0, rough=0.55, stretch=None, dist=0.0):
    src = coords
    if stretch:
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch; nt.links.new(coords, mp.inputs['Vector']); src = mp.outputs['Vector']
    n = nt.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '3D'
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = dist
    nt.links.new(src, n.inputs['Vector']); return n.outputs['Fac']


def voronoi(nt, coords, scale, feature='F1'):
    n = nt.nodes.new('ShaderNodeTexVoronoi'); n.voronoi_dimensions = '3D'; n.feature = feature; n.inputs['Scale'].default_value = scale
    nt.links.new(coords, n.inputs['Vector']); return n.outputs['Distance']


def M(nt, op, a, b=None, clamp=False):
    return d.math_node(nt, op, a, b, clamp)


def zcoord(nt, coords):
    s = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(coords, s.inputs['Vector']); return s.outputs['Z']


def gray(nt, col):
    n = nt.nodes.new('ShaderNodeRGBToBW'); nt.links.new(col, n.inputs['Color']); return n.outputs['Val']


class Masks:
    """Baked masks of a group (same UV layout): occlusion, convex edges, sun visibility."""
    def __init__(self, ao=None, edge=None):
        self.ao, self.edge = ao, edge

    def sockets(self, nt):
        ao = gray(nt, d.tex(nt, self.ao).outputs['Color']) if self.ao else V(nt, 1.0)
        ed = gray(nt, d.tex(nt, self.edge).outputs['Color']) if self.edge else V(nt, 0.0)
        return ao, ed


def lines(nt, coord, period, offset=0.0, width=0.02):
    """1 on the lines coord = offset + k * period, falling to 0 over `width` metres either side"""
    f = M(nt, 'FRACT', M(nt, 'DIVIDE', M(nt, 'SUBTRACT', coord, offset - period / 2), period))
    dist = M(nt, 'MULTIPLY', M(nt, 'ABSOLUTE', M(nt, 'SUBTRACT', f, 0.5)), period)
    return mr(nt, dist, width, 0.0)


def below(nt, z, period, offset=0.0, reach=1.0):
    """1 just under each line z = offset + k * period, fading to 0 `reach` metres further down (what runs off a joint)"""
    f = M(nt, 'FRACT', M(nt, 'DIVIDE', M(nt, 'SUBTRACT', z, offset), period))
    return mr(nt, M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', 1.0, f), period), reach, 0.0)


def mat_surface(name, kind, masks, **o):
    """Source material for baking. kind: concrete | steel | galv | rubber | timber | rope | hull | glass.
    Options: scan, rustscan, tile (m), tone (rgb multiplier), paint (rgb), fade (0..1 chalking), rust (0..1),
    wear, streaks, growth (bool) and tide (m), seams: [(axis 'X'|'Y'|'Z', period, offset, zmin, zmax)] plate or
    formwork joints, fit: (axis, period, offset, ztop, reach) fittings whose rust runs down the face below them,
    eave: z of the roof edge (stains under it), tiles: (size, cx, cz, radius) hull tiles, scuff (rubber)."""
    mat, bsdf, nodes, links = d.new_material(name)
    nt = mat.node_tree
    tc = d.texcoord(nt); P = tc.outputs['Object']
    ao, edge = masks.sockets(nt)
    cvx = M(nt, 'MULTIPLY', edge, M(nt, 'POWER', ao, 2.0), True)               # convex edges: bevelled and open
    occ = M(nt, 'SUBTRACT', 1.0, ao, True)
    sp = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(P, sp.inputs['Vector'])
    X, Y, z = sp.outputs['X'], sp.outputs['Y'], sp.outputs['Z']
    geo = nt.nodes.new('ShaderNodeNewGeometry'); sn = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sn.inputs['Vector'])
    up = mr(nt, sn.outputs['Z'], 0.55, 0.9)                                     # faces that hold water and dust
    wall = M(nt, 'SUBTRACT', 1.0, mr(nt, M(nt, 'ABSOLUTE', sn.outputs['Z']), 0.3, 0.7), True)
    n1 = noise(nt, P, 0.16, 3); n2 = noise(nt, P, 1.4, 6); n3 = noise(nt, P, 5.5, 4)
    streak = mr(nt, noise(nt, P, 1.0, 5, 0.6, stretch=(2.6, 2.6, 0.07)), 0.5, 0.78)     # what gravity draws down a face
    streak = M(nt, 'MULTIPLY', streak, wall)
    S = o['scan']; tile = o.get('tile', 2.0)
    col = d.tex(nt, S['Diffuse'], P, 'BOX', 0.3, scale=1.0 / tile).outputs['Color']
    rough = gray(nt, d.tex(nt, S['Rough'], P, 'BOX', 0.3, scale=1.0 / tile).outputs['Color']) if 'Rough' in S else V(nt, 0.7)
    disp = gray(nt, d.tex(nt, S['Displacement'], P, 'BOX', 0.3, scale=1.0 / tile).outputs['Color']) if 'Displacement' in S else V(nt, 0.5)
    bump_h = disp; bump_k = o.get('bump', 0.6); metal = V(nt, 0.0)
    tone = o.get('tone', (1, 1, 1))
    base = d.mix_rgb(nt, col, tuple(tone), 1.0, 'MULTIPLY')
    base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.84, 0.83, 0.82), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', n1, 0.6))    # large-scale tone drift
    # joints: plate seams in steel, formwork and pour joints in concrete
    seam = None
    for axis, period, offset, zmin, zmax in o.get('seams', ()):
        c = {'X': X, 'Y': Y, 'Z': z}[axis]
        k = lines(nt, c, period, offset, o.get('seamw', 0.02))
        nrm = {'X': sn.outputs['X'], 'Y': sn.outputs['Y'], 'Z': sn.outputs['Z']}[axis]
        k = M(nt, 'MULTIPLY', k, M(nt, 'SUBTRACT', 1.0, mr(nt, M(nt, 'ABSOLUTE', nrm), 0.5, 0.9), True))     # not on faces square to the axis
        k = M(nt, 'MULTIPLY', k, M(nt, 'MULTIPLY', mr(nt, z, zmin - 0.01, zmin), mr(nt, z, zmax + 0.01, zmax)))
        seam = k if seam is None else M(nt, 'MAXIMUM', seam, k)
    run = None      # run-off under horizontal joints and under fittings
    for axis, period, offset, zmin, zmax in o.get('seams', ()):
        if axis != 'Z': continue
        k = M(nt, 'MULTIPLY', below(nt, z, period, offset, o.get('runreach', 1.3)), M(nt, 'MULTIPLY', mr(nt, z, zmin - 0.01, zmin), mr(nt, z, zmax + 0.01, zmax)))
        run = k if run is None else M(nt, 'MAXIMUM', run, k)
    if 'fit' in o:
        axis, period, offset, ztop, reach = o['fit']
        k = M(nt, 'MULTIPLY', lines(nt, {'X': X, 'Y': Y}[axis], period, offset, 0.16), M(nt, 'MULTIPLY', mr(nt, z, ztop - reach, ztop), mr(nt, z, ztop + 0.05, ztop)))
        run = k if run is None else M(nt, 'MAXIMUM', run, k)
    if run is not None:
        run = M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', run, wall), mr(nt, noise(nt, P, 2.2, 4, 0.6, stretch=(3.0, 3.0, 0.1)), 0.35, 0.7))
    tile_r = tilt = None
    if kind in ('steel', 'galv', 'hull'):
        R = o['rustscan']
        rcol = d.tex(nt, R['Diffuse'], P, 'BOX', 0.3, scale=1.0 / 1.6).outputs['Color']
        rrough = gray(nt, d.tex(nt, R['Rough'], P, 'BOX', 0.3, scale=1.0 / 1.6).outputs['Color']) if 'Rough' in R else V(nt, 0.85)
        lum = gray(nt, col)
        if kind == 'galv':
            paint = d.mix_rgb(nt, (0.40, 0.41, 0.42), (0.58, 0.59, 0.60), M(nt, 'MULTIPLY', lum, 1.4, True))
            metal = mr(nt, n2, 0.2, 0.8, 0.35, 0.7)
        else:
            pc = tuple(o['paint'])
            paint = d.mix_rgb(nt, pc, (0, 0, 0), M(nt, 'SUBTRACT', 1.0, M(nt, 'MULTIPLY', lum, o.get('lumk', 1.8), True), True), 'MIX')
            paint = d.mix_rgb(nt, pc, paint, o.get('scanmix', 0.45))
            # chalking: sun and salt take the pigment out, most where the weather sits
            fade = o.get('fade', 0.0)
            if fade > 0:
                g = 0.3 * pc[0] + 0.55 * pc[1] + 0.15 * pc[2]
                chalk = tuple(min(1.0, 0.62 * c + 0.38 * g + 0.05) for c in pc)
                fk = M(nt, 'MULTIPLY', M(nt, 'ADD', M(nt, 'MULTIPLY', mr(nt, n1, 0.25, 0.8), 0.6), M(nt, 'ADD', M(nt, 'MULTIPLY', up, 0.4), M(nt, 'MULTIPLY', mr(nt, n2, 0.35, 0.75), 0.25))), fade, True)
                paint = d.mix_rgb(nt, paint, chalk, fk)
            if 'tiles' in o:          # hull tiles: a faint grid, each tile a slightly different black
                ts, cx, cz, rad = o['tiles']
                arc = M(nt, 'MULTIPLY', M(nt, 'ARCTAN2', M(nt, 'SUBTRACT', z, cz), M(nt, 'SUBTRACT', X, cx)), rad)
                gl = M(nt, 'MAXIMUM', lines(nt, Y, ts, 0.0, 0.012), lines(nt, arc, ts, 0.0, 0.012))
                cell = nt.nodes.new('ShaderNodeCombineXYZ')
                nt.links.new(M(nt, 'FLOOR', M(nt, 'DIVIDE', Y, ts)), cell.inputs['X']); nt.links.new(M(nt, 'FLOOR', M(nt, 'DIVIDE', arc, ts)), cell.inputs['Y'])
                wn = nt.nodes.new('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '3D'; nt.links.new(cell.outputs['Vector'], wn.inputs['Vector'])
                paint = d.mix_rgb(nt, paint, d.mix_rgb(nt, paint, (1.35, 1.35, 1.35), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', wn.outputs['Value'], 0.5))
                wn2 = nt.nodes.new('ShaderNodeTexWhiteNoise'); wn2.noise_dimensions = '3D'
                off = nt.nodes.new('ShaderNodeVectorMath'); off.operation = 'ADD'; off.inputs[1].default_value = (17.3, 5.1, 9.7)
                nt.links.new(cell.outputs['Vector'], off.inputs[0]); nt.links.new(off.outputs['Vector'], wn2.inputs['Vector'])
                tile_r = wn.outputs['Value']
                tilt = M(nt, 'ADD', M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', M(nt, 'FRACT', M(nt, 'DIVIDE', Y, ts)), 0.5), M(nt, 'SUBTRACT', wn2.outputs['Value'], 0.5)),
                         M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', M(nt, 'FRACT', M(nt, 'DIVIDE', arc, ts)), 0.5), M(nt, 'SUBTRACT', wn2.outputs['Color'], 0.5)))
                paint = d.mix_rgb(nt, paint, o.get('gapcol', (0.075, 0.073, 0.07)), M(nt, 'MULTIPLY', gl, 0.55))     # salt and dust lodged in the gaps
                seam = gl if seam is None else M(nt, 'MAXIMUM', seam, gl)
        # grime: in the joints, along the seams, where water stands
        dirt = M(nt, 'ADD', M(nt, 'MULTIPLY', M(nt, 'POWER', occ, 1.3), 0.7), M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', up, mr(nt, n2, 0.3, 0.75)), 0.5))
        if seam is not None: dirt = M(nt, 'ADD', dirt, M(nt, 'MULTIPLY', seam, 0.6))
        dirt = M(nt, 'ADD', dirt, M(nt, 'MULTIPLY', streak, o.get('streaks', 0.25)))
        paint = d.mix_rgb(nt, paint, d.mix_rgb(nt, paint, o.get('dirtcol', (0.5, 0.45, 0.38)), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', dirt, o.get('dirt', 0.6), True))
        # rust: in occluded joints, at convex edges, in the run-off below joints and fittings, low near the water
        rk = o.get('rust', 0.4)
        rm = M(nt, 'ADD', M(nt, 'MULTIPLY', occ, 1.2), M(nt, 'MULTIPLY', cvx, o.get('edgerust', 0.1 if kind == 'galv' else 0.9)))
        rm = M(nt, 'ADD', rm, M(nt, 'MULTIPLY', streak, 0.3))
        if run is not None: rm = M(nt, 'ADD', rm, M(nt, 'MULTIPLY', run, o.get('runrust', 1.3)))
        if seam is not None: rm = M(nt, 'ADD', rm, M(nt, 'MULTIPLY', seam, 0.5))
        rm = M(nt, 'ADD', rm, mr(nt, z, 2.2, 0.6, 0.0, 0.5))
        rm = mr(nt, M(nt, 'ADD', M(nt, 'MULTIPLY', rm, rk), M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n2, 0.5), 0.45)), 0.3, 0.62)
        # thin rust wash round the solid rust (stained paint), then the rust itself
        wash = mr(nt, M(nt, 'ADD', M(nt, 'MULTIPLY', M(nt, 'ADD', M(nt, 'ADD', M(nt, 'MULTIPLY', occ, 1.6), M(nt, 'MULTIPLY', cvx, 0.5)), M(nt, 'MULTIPLY', run if run is not None else streak, 1.8)), rk), M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n2, 0.5), 0.25)), 0.15, 0.55)
        paint = d.mix_rgb(nt, paint, d.mix_rgb(nt, paint, (0.7, 0.45, 0.28), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', wash, o.get('wash', 0.5)))
        base = d.mix_rgb(nt, paint, rcol, rm)
        # worn edges show primer
        wear = mr(nt, M(nt, 'MULTIPLY', cvx, M(nt, 'ADD', n3, 0.4)), 0.35, 0.7)
        base = d.mix_rgb(nt, base, o.get('primer', (0.18, 0.09, 0.06)), M(nt, 'MULTIPLY', wear, o.get('wear', 0.6)))
        rough = d.mix_rgb(nt, M(nt, 'ADD', M(nt, 'MULTIPLY', rough, 0.3), o.get('paintrough', 0.5)), rrough, rm)
        rough = gray(nt, rough)
        if kind == 'galv':
            metal = M(nt, 'MULTIPLY', metal, M(nt, 'SUBTRACT', 1.0, rm, True))
        bump_h = M(nt, 'ADD', M(nt, 'MULTIPLY', disp, o.get('scanbump', 0.3)), M(nt, 'MULTIPLY', rm, 0.6)); bump_k = o.get('bump', 0.35)
        if seam is not None: bump_h = M(nt, 'SUBTRACT', bump_h, M(nt, 'MULTIPLY', seam, o.get('seamdepth', 1.2)))
        if tile_r is not None:     # tiles: sheen varies tile to tile; each sits at its own slight angle (the bump distance is 5x, so the rest is scaled down)
            rough = M(nt, 'ADD', rough, M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', tile_r, 0.5), o.get('tilerough', 0.14)), True)
            bump_h = M(nt, 'ADD', M(nt, 'MULTIPLY', bump_h, 0.2), M(nt, 'MULTIPLY', tilt, o.get('tilt', 0.9)))
    elif kind == 'concrete':
        # grime in the joints and undersides, weather on top, bright chipped arrises, gravity streaks of rust and dirt
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.5, 0.48, 0.45), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', M(nt, 'POWER', occ, 1.0), 0.8))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.6, 0.57, 0.52), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', up, mr(nt, n2, 0.3, 0.7)), o.get('weather', 0.6)))
        base = d.mix_rgb(nt, base, (0.62, 0.6, 0.56), M(nt, 'MULTIPLY', mr(nt, M(nt, 'MULTIPLY', cvx, n3), 0.25, 0.55), 0.6))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.55, 0.51, 0.46), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', streak, o.get('streaks', 0.5)))
        if seam is not None:
            base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.6, 0.58, 0.55), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', seam, 0.8))
            bump_h = M(nt, 'SUBTRACT', bump_h, M(nt, 'MULTIPLY', seam, o.get('seamdepth', 0.8)))
        if run is not None:
            base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.55, 0.33, 0.18), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', run, o.get('runk', 0.85)))
    elif kind == 'rubber':
        base = d.mix_rgb(nt, (0.018, 0.018, 0.019), (0.05, 0.048, 0.045), mr(nt, n2, 0.3, 0.8))
        base = d.mix_rgb(nt, base, (0.2, 0.19, 0.17), M(nt, 'MULTIPLY', mr(nt, z, 1.6, 3.2), mr(nt, n3, 0.45, 0.8)))   # dust and salt on top
        # scuffs: pale horizontal rubs where hulls bear, heaviest on the proud edges
        scuff = mr(nt, noise(nt, P, 3.0, 4, 0.6, stretch=(0.25, 0.25, 4.0)), 0.5, 0.72)
        base = d.mix_rgb(nt, base, (0.16, 0.155, 0.15), M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', scuff, M(nt, 'ADD', 0.35, cvx, True)), o.get('scuff', 0.8)))
        rough = mr(nt, n2, 0.0, 1.0, 0.72, 0.9); bump_h = n3; bump_k = 0.3
    elif kind == 'rope':
        base = d.mix_rgb(nt, (0.035, 0.034, 0.032), (0.11, 0.1, 0.085), n2); metal = V(nt, 0.5); rough = mr(nt, n2, 0, 1, 0.35, 0.6)
    elif kind == 'glass':
        base = d.mix_rgb(nt, (0.012, 0.014, 0.016), (0.05, 0.05, 0.048), M(nt, 'MULTIPLY', streak, 0.6)); rough = mr(nt, streak, 0, 1, 0.08, 0.35)
    if 'eave' in o:       # the wall under the roof edge: dust washed down it in streaks
        reach = o.get('eavereach', 3.5)
        es = mr(nt, noise(nt, P, 0.7, 4, 0.6, stretch=(3.2, 3.2, 0.05)), 0.42, 0.72)           # long drip streaks off the gutter line
        ek = M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', mr(nt, z, o['eave'] - reach, o['eave'] - 0.2), wall), M(nt, 'ADD', 0.2, M(nt, 'MULTIPLY', M(nt, 'MAXIMUM', streak, es), 0.8)))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, o.get('eavecol', (0.5, 0.46, 0.4)), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', ek, o.get('eavek', 0.7)))
    if 'splash' in o:     # sand and dirt thrown up the foot of a wall by rain and wind
        z0, reach, kk = o['splash']
        sk = M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', mr(nt, z, z0 + reach, z0), wall), M(nt, 'ADD', 0.45, M(nt, 'MULTIPLY', mr(nt, n2, 0.3, 0.8), 0.55)))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.66, 0.58, 0.47), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', sk, kk))
    # height above the sea: weed and mussels at the water, a barnacle band, wet stone up to the tide mark, salt above it
    if o.get('growth', False):
        zn = M(nt, 'ADD', z, M(nt, 'ADD', M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n2, 0.5), 0.3), M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n1, 0.5), 0.25)))
        tide = o.get('tide', 1.05)
        wet = M(nt, 'SUBTRACT', 1.0, mr(nt, zn, tide - 0.2, tide + 0.05), True)
        salt = M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', mr(nt, zn, tide - 0.02, tide + 0.06), M(nt, 'SUBTRACT', 1.0, mr(nt, zn, tide + 0.1, tide + 0.5), True)), mr(nt, n3, 0.3, 0.7))
        algae = M(nt, 'SUBTRACT', 1.0, mr(nt, zn, 0.12, 0.42), True)
        barn = M(nt, 'MULTIPLY', M(nt, 'MULTIPLY', mr(nt, zn, 0.05, 0.3), M(nt, 'SUBTRACT', 1.0, mr(nt, zn, 0.55, 0.85), True)), mr(nt, voronoi(nt, P, 16.0), 0.42, 0.12))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.42, 0.41, 0.4), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', wet, 0.9))
        base = d.mix_rgb(nt, base, (0.66, 0.65, 0.62), M(nt, 'MULTIPLY', salt, 0.3))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, (0.012, 0.015, 0.009), (0.035, 0.034, 0.02), n3), M(nt, 'MULTIPLY', algae, 0.94))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, (0.2, 0.19, 0.16), (0.4, 0.38, 0.33), n3), M(nt, 'MULTIPLY', barn, 0.8))
        rough = M(nt, 'ADD', M(nt, 'MULTIPLY', rough, M(nt, 'SUBTRACT', 1.0, M(nt, 'MULTIPLY', wet, 0.65))), M(nt, 'MULTIPLY', wet, 0.2))
        rough = M(nt, 'ADD', rough, M(nt, 'MULTIPLY', barn, 0.4), True)
        bump_h = M(nt, 'ADD', bump_h, M(nt, 'ADD', M(nt, 'MULTIPLY', barn, 0.9), M(nt, 'MULTIPLY', algae, 0.2)))
        if kind in ('steel', 'galv'): metal = M(nt, 'MULTIPLY', metal, M(nt, 'SUBTRACT', 1.0, wet, True))
    links.new(base, bsdf.inputs['Base Color'])
    links.new(rough, bsdf.inputs['Roughness'])
    links.new(metal, bsdf.inputs['Metallic'])
    bmp = nt.nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = bump_k; bmp.inputs['Distance'].default_value = o.get('bumpdist', 0.01)
    links.new(bump_h, bmp.inputs['Height']); links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


# ------------------------------------------------------------------ group bake: masks first, then the scanned materials
def add_sea_plane():
    ob = mesh_from_arrays('bake_sea', [(-4000, -4000, -0.05), (4000, -4000, -0.05), (4000, 4000, -0.05), (-4000, 4000, -0.05)], [[0, 1, 2, 3]])
    return ob


def bake_group(name, parts, size, materials, lm_div=2, uvscale=None, ao_dist=2.5, sun_samples=24, ao_samples=48, color_samples=2, edge_radius=0.035):
    """parts: [(object, material builder(masks) -> material)], all baked into one atlas (UV0).
    Returns images {base, orm, lm, normal} (saved in the cache) and the objects."""
    objs = [o for o, _ in parts]
    if DRAFT: size //= 4; ao_samples = 12; sun_samples = 8; color_samples = 1
    if HALF: size //= 2; ao_samples = 24; sun_samples = 12
    for o in objs:
        while o.data.uv_layers: o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')
        d.smart_uv(o, 62, 0.004)
    # one texel density across the group (islands scaled to their 3D area), then the deliberate weights, then pack
    d.select(objs); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    for o in objs:
        k = (uvscale or {}).get(o.name)
        if k:
            bm = bmesh.from_edit_mesh(o.data); ul = bm.loops.layers.uv.active
            for f in bm.faces:
                for l in f.loops: l[ul].uv *= k
            bmesh.update_edit_mesh(o.data)
    bpy.ops.uv.pack_islands(margin=0.0022, rotate=True, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    tex_m = [d.texel_density(o, size) * 1000 for o in objs]
    d.log(f'{name}: {len(objs)} parts, {sum(tris(o) for o in objs)} tris, texel {min(tex_m):.1f}-{max(tex_m):.1f} mm at {size}')
    # masks: occlusion (against everything, with the sea as a floor), sun visibility, edges
    ms = size // lm_div
    tmp = d.new_material(f'{name}_maskmat')[0]
    for o in objs: d.set_material(o, tmp)
    w = d.ensure_world((0.0, 0.0, 0.0)); w.light_settings.distance = ao_dist
    ao = d.new_image(f'{name}_ao', ms, non_color=True, color=(1, 1, 1, 1))
    d.bake(objs, 'AO', ao, samples=ao_samples); d.blur(ao, 1.0)
    sun = d.new_image(f'{name}_sun', ms, non_color=True, color=(1, 1, 1, 1))
    d.bake(objs, 'SHADOW', sun, samples=sun_samples); d.blur(sun, 0.6)
    emat, ebsdf, en, el = d.new_material(f'{name}_edgemat')
    em = en.new('ShaderNodeEmission'); el.new(d.edge_mask(emat.node_tree, edge_radius, 8), em.inputs['Color'])
    el.new(em.outputs['Emission'], en['Material Output'].inputs['Surface'])
    for o in objs: d.set_material(o, emat)
    edge = d.new_image(f'{name}_edge', ms, non_color=True)
    d.bake(objs, 'EMIT', edge, samples=4)
    masks = Masks(ao, edge)
    built = {}
    for o, fn in parts:
        key = fn.__name__ if hasattr(fn, '__name__') else str(id(fn))
        m = built.get(id(fn)) or fn(masks); built[id(fn)] = m
        d.set_material(o, m)
    base = d.new_image(f'{name}_base', size); d.bake_socket(objs, 'Base Color', base, samples=color_samples)
    rough = d.new_image(f'{name}_rough', size, non_color=True); d.bake_socket(objs, 'Roughness', rough, samples=1)
    metal = d.new_image(f'{name}_metal', ms, non_color=True); d.bake_socket(objs, 'Metallic', metal, samples=1)
    nrm = d.new_image(f'{name}_normal', size, non_color=True, color=(0.5, 0.5, 1.0, 1.0)); d.bake(objs, 'NORMAL', nrm, samples=1)
    metal_f = d.resize(metal, size, f'{name}_metal_f')
    orm = d.pack_orm(1.0, rough, metal_f, f'{name}_orm')
    lm = d.pack_orm(ao, sun, 0.0, f'{name}_lm')
    out = {'base': base, 'orm': orm, 'lm': lm, 'normal': nrm}
    for k, im in out.items(): d.save_png(im, os.path.join(CACHE, f'{name}_{k}.png'))
    d.save_png(edge, os.path.join(CACHE, f'{name}_edge.png'))
    return out


def final_material(name, maps, cast=False, extra=None):
    """glTF material: base, metallic-roughness (ORM: G rough, B metal), occlusion = light map (R occlusion, G sun)."""
    mat, bsdf, nodes, links = d.new_material(name)
    nt = mat.node_tree
    t = d.tex(nt, maps['base']); links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    t = d.tex(nt, maps['orm']); sep = nodes.new('ShaderNodeSeparateColor'); links.new(t.outputs['Color'], sep.inputs['Color'])
    links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    t = d.tex(nt, maps['lm']); sep2 = nodes.new('ShaderNodeSeparateColor'); links.new(t.outputs['Color'], sep2.inputs['Color'])
    grp = nodes.new('ShaderNodeGroup'); grp.node_tree = d.gltf_output_group(); links.new(sep2.outputs['Red'], grp.inputs['Occlusion'])
    t = d.tex(nt, maps['normal']); links.new(d.normal_map(nt, t.outputs['Color'], 1.0), bsdf.inputs['Normal'])
    mat['dowlm'] = 1
    mat.use_backface_culling = True
    if cast: mat['cast'] = 1
    for k, v in (extra or {}).items(): mat[k] = v
    return mat


def join(objs, name):
    d.select(objs, objs[0]); bpy.ops.object.join(); ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name
    return ob


# ------------------------------------------------------------------ stage: pier, finger pier, ship lift, gantry, submarine
QZ, QY = PORT['quayZ'], PORT['quayY']
PI, FI, LI, SU = PORT['pier'], PORT['finger'], PORT['lift'], PORT['sub']
BENTS = [QZ + 3 + 5.2 * k for k in range(14) if QZ + 3 + 5.2 * k <= PI['z1'] - 1]
LIFT_BEAMS = [LI['z0'] + 3 + 5.6 * k for k in range(7)]            # 5, 10.6, ... 38.6
HOISTS = [z for z in LIFT_BEAMS if abs(z - 21) > 1.6]               # the gantry's south legs stand at z = 21
GX0, GX1, GZ0, GZ1, GH, GY = PI['x1'] - 1.2, FI['x0'] + 1.3, 21.0, 35.0, 15.5, PI['y']
KEEL = [SU['z1'] - 3.5 - i * (SU['z1'] - SU['z0'] - 7) / 6 for i in range(7)]


def build_pier():
    P, F, Y = PI, FI, PI['y']
    out = {}
    # deck slabs (one per bay, joints between), kerbs, edge beams, headstocks
    slab = Part('pier_deck'); n = 14; L = (P['z1'] - QZ) / n
    for i in range(n): slab.box(P['x0'], P['x1'], Y - 0.45, Y, QZ + i * L + 0.012, QZ + (i + 1) * L - 0.012)
    nf = 13; Lf = (F['z1'] - QZ) / nf
    for i in range(nf): slab.box(F['x0'], F['x1'], Y - 0.4, Y, QZ + i * Lf + 0.012, QZ + (i + 1) * Lf - 0.012)
    out['deck'] = slab.obj(bevel=0.02, seg=2)
    beams = Part('pier_beams')
    for x0, x1 in ((P['x0'], P['x0'] + 0.45), (P['x1'] - 0.45, P['x1'])): beams.box(x0, x1, Y - 1.05, Y - 0.45, QZ, P['z1'])
    beams.box(P['x0'], P['x1'], Y - 1.15, Y - 0.45, P['z1'] - 0.5, P['z1'])                     # end beam
    for x0, x1 in ((F['x0'], F['x0'] + 0.35), (F['x1'] - 0.35, F['x1'])): beams.box(x0, x1, Y - 0.85, Y - 0.4, QZ, F['z1'])
    for z in BENTS:
        beams.box(P['x0'] - 0.25, P['x1'] + 0.25, Y - 1.35, Y - 0.45, z - 0.5, z + 0.5)
        if z <= F['z1'] - 1: beams.box(F['x0'] - 0.2, F['x1'] + 0.2, Y - 1.2, Y - 0.4, z - 0.4, z + 0.4)
    kerb = Part('pier_kerb')
    for x0, x1 in ((P['x0'], P['x0'] + 0.3), (P['x1'] - 0.3, P['x1']), (F['x1'] - 0.25, F['x1'])):
        kerb.box(x0, x1, Y, Y + 0.22, QZ, P['z1'] if x1 <= P['x1'] + 0.01 else F['z1'])
    out['beams'] = beams.obj(bevel=0.025, seg=2)
    out['kerb'] = kerb.obj(bevel=0.03, seg=2)
    piles = Part('pier_piles')
    for z in BENTS:
        for x in (P['x0'] + 0.9, (P['x0'] + P['x1']) / 2, P['x1'] - 0.9): piles.cyl((x, -2.6, z), (x, Y - 1.35, z), 0.42, seg=20)
        if z <= F['z1'] - 1:
            for x in (F['x0'] + 0.5, F['x1'] - 0.5): piles.cyl((x, -2.6, z), (x, Y - 1.2, z), 0.34, seg=18)
    out['piles'] = piles.obj(bevel=0.02, seg=2, angle=40)
    # fenders on the west face of the pier and the east face of the finger pier, tyres on chains between
    rub = Part('pier_fenders')
    for z in BENTS:
        rub.box(P['x0'] - 0.62, P['x0'] - 0.25, 0.25, Y - 0.15, z - 0.22, z + 0.22)
        if z <= F['z1'] - 1: rub.box(F['x1'] + 0.2, F['x1'] + 0.52, 0.35, Y - 0.15, z - 0.2, z + 0.2)
    for z in BENTS[:-1]:
        rub.torus((P['x0'] - 0.42, 1.35, z + 2.6), Vector((1, 0, 0)), 0.5, 0.19, 20, 8)
    out['fenders'] = rub.obj(bevel=0.06, seg=3, angle=30)
    return out


def build_pier_steel():
    P, F, Y = PI, FI, PI['y']
    out = {}
    galv = Part('pier_galv')
    gap = [(z - 1.0, z + 1.0) for z in HOISTS]
    def segs(z0, z1):
        cur = z0; res = []
        for a, b in sorted(gap):
            if b < z0 or a > z1: continue
            if a > cur: res.append((cur, a))
            cur = max(cur, b)
        if cur < z1: res.append((cur, z1))
        return res
    railing(galv, [(P['x0'] + 0.14, QZ + 0.5), (P['x0'] + 0.14, P['z1'] - 0.3), (P['x1'] - 0.14, P['z1'] - 0.3)], Y + 0.22)
    for a, b in segs(QZ + 0.5, P['z1'] - 0.5): railing(galv, [(P['x1'] - 0.14, a), (P['x1'] - 0.14, b)], Y + 0.22)
    railing(galv, [(F['x1'] - 0.12, QZ + 0.5), (F['x1'] - 0.12, F['z1'] - 0.3), (F['x0'] + 0.12, F['z1'] - 0.3)], Y + 0.22)
    for z in (-2.0, 23.6, 46.0): ladder(galv, P['x0'], z - 0.22, z + 0.22, -1.2, Y + 0.2, off=0.12)
    for z in (-6.0, 30.0): ladder(galv, F['x1'] + 0.24, z - 0.22, z + 0.22, -1.2, Y + 0.2, off=0.0)
    # pipes and their clamps under the east edge
    for x, r in ((P['x1'] - 0.75, 0.1), (P['x1'] - 1.05, 0.075)): galv.cyl((x, Y - 0.8, QZ), (x, Y - 0.8, P['z1'] - 0.6), r, seg=12)
    # lamp posts on the pier (west edge)
    for z in (-14, 4, 22, 40):
        x = P['x0'] + 0.5
        galv.box(x - 0.2, x + 0.2, Y + 0.22, Y + 0.26, z - 0.2, z + 0.2)
        galv.cyl((x, Y + 0.26, z), (x, Y + 9.6, z), 0.11, 0.065, seg=12)
        galv.cyl((x, Y + 9.4, z), (x + 1.6, Y + 9.6, z), 0.045, seg=8)
        galv.box(x + 1.15, x + 1.85, Y + 9.48, Y + 9.66, z - 0.15, z + 0.15)
    out['galv'] = galv.obj(bevel=0.0, smooth=50)
    blk = Part('pier_black')
    for z in [QZ + 6 + 9 * k for k in range(8) if QZ + 6 + 9 * k < P['z1']]:
        x = P['x0'] + 0.62
        blk.box(x - 0.32, x + 0.32, Y, Y + 0.06, z - 0.32, z + 0.32)
        blk.cyl((x, Y + 0.06, z), (x, Y + 0.5, z), 0.15, seg=16)
        blk.cyl((x, Y + 0.5, z), (x, Y + 0.58, z), 0.23, seg=16)
        blk.cyl((x, Y + 0.42, z - 0.3), (x, Y + 0.42, z + 0.3), 0.06, seg=8)
    out['black'] = blk.obj(bevel=0.012, seg=2)
    # synchrolift hoists: winch on each pier at every platform beam, sheave at the edge, wire down to the beam end
    win = Part('lift_winch'); rope = Part('lift_rope')
    for z in HOISTS:
        for side in (-1, 1):
            if side < 0: xw, xe, xb = P['x1'] - 2.6, P['x1'] - 0.15, LI['x0'] - 0.55
            else: xw, xe, xb = (F['x0'] + F['x1']) / 2, F['x0'] + 0.15, LI['x1'] + 0.55
            win.box(xw - 0.8, xw + 0.8, Y, Y + 0.22, z - 0.65, z + 0.65)
            win.cyl((xw, Y + 0.7, z - 0.5), (xw, Y + 0.7, z + 0.5), 0.36, seg=20)
            for dz in (-0.5, 0.5): win.cyl((xw, Y + 0.7, z + dz - 0.03), (xw, Y + 0.7, z + dz + 0.03), 0.46, seg=20)
            win.box(xw - 0.32, xw + 0.32, Y + 0.22, Y + 1.0, z + 0.55, z + 1.15)
            win.cyl((xw, Y + 0.62, z + 1.15), (xw, Y + 0.62, z + 1.75), 0.2, seg=14)
            win.box(xe - 0.18 * side, xe + 0.1 * side, Y, Y + 0.65, z - 0.2, z + 0.2)
            win.cyl((xe, Y + 0.55, z - 0.06), (xe, Y + 0.55, z + 0.06), 0.24, seg=16)
            rope.cyl((xw - side * 0.0, Y + 1.06, z), (xe, Y + 0.79, z), 0.026, seg=6)
            rope.cyl((xe + side * 0.24, Y + 0.55, z), (xb, LI['y'] - 0.35, z), 0.028, seg=6)
    out['winch'] = win.obj(bevel=0.015, seg=2)
    out['rope'] = rope.obj()
    # the ship-lift platform: deck plates on longitudinal girders and transverse beams, transfer rails, end buffers
    lp = Part('lift_platform')
    lp.box(LI['x0'], LI['x1'], LI['y'] - 0.12, LI['y'], LI['z0'], LI['z1'])
    for x in np.linspace(LI['x0'] + 0.6, LI['x1'] - 0.6, 5):
        lp.box(x - 0.012, x + 0.012, LI['y'] - 0.62, LI['y'] - 0.12, LI['z0'], LI['z1'])
        lp.box(x - 0.16, x + 0.16, LI['y'] - 0.66, LI['y'] - 0.62, LI['z0'], LI['z1'])
    for z in LIFT_BEAMS + [LI['z0'] + 0.25, LI['z1'] - 0.25]:
        ext = 0.7 if z in LIFT_BEAMS else 0.0
        lp.box(LI['x0'] - ext, LI['x1'] + ext, LI['y'] - 0.66, LI['y'] - 0.12, z - 0.012, z + 0.012)
        lp.box(LI['x0'] - ext, LI['x1'] + ext, LI['y'] - 0.7, LI['y'] - 0.66, z - 0.16, z + 0.16)
        lp.box(LI['x0'] - ext, LI['x1'] + ext, LI['y'] - 0.16, LI['y'] - 0.12, z - 0.16, z + 0.16)
        if ext:
            for xe in (LI['x0'] - ext + 0.15, LI['x1'] + ext - 0.15): lp.box(xe - 0.12, xe + 0.12, LI['y'] - 0.4, LI['y'] - 0.08, z - 0.12, z + 0.12)
    for x in (SU['x'] - 0.8, SU['x'] + 0.8): lp.box(x - 0.04, x + 0.04, LI['y'], LI['y'] + 0.12, LI['z0'] + 0.3, LI['z1'] - 0.3)
    out['platform'] = lp.obj(bevel=0.006, seg=1)
    # keel blocks (steel base, timber stack) and bilge shores
    kb = Part('lift_blocksteel'); tim = Part('lift_timber')
    yb = SU['y'] - 1.38
    for z in KEEL:
        kb.box(SU['x'] - 0.8, SU['x'] + 0.8, LI['y'], LI['y'] + 0.14, z - 0.5, z + 0.5)
        for k, (y0, y1) in enumerate(((LI['y'] + 0.14, LI['y'] + 0.29), (LI['y'] + 0.29, yb))):
            w = 0.62 - 0.06 * k
            tim.box(SU['x'] - w, SU['x'] + w, y0, y1, z - 0.42 + 0.03 * k, z + 0.42 - 0.03 * k)
        for sgn in (-1, 1):
            xa, xb = SU['x'] + sgn * 3.0, SU['x'] + sgn * 1.18
            kb.box(xa - 0.25, xa + 0.25, LI['y'], LI['y'] + 0.1, z - 0.25, z + 0.25)
            kb.cyl((xa, LI['y'] + 0.1, z), (xb + sgn * 0.12, SU['y'] - 0.7, z), 0.075, seg=10)
            tim.box(xb - 0.12 + sgn * 0.12, xb + 0.12 + sgn * 0.12, SU['y'] - 0.85, SU['y'] - 0.55, z - 0.18, z + 0.18)
    out['blocks'] = kb.obj(bevel=0.01, seg=1)
    out['timber'] = tim.obj(bevel=0.012, seg=2)
    return out


GSPLICE = [GY + 4.0, GY + 7.4, GY + 10.8]          # bolted splices of the legs (engine y)
HOOK_Y = SU['y'] + 6.2                              # centre of the lower blocks


def build_gantry():
    out = {}
    g = Part('gantry_steel'); y0 = GY
    ytop = y0 + GH
    bolts = Part('gantry_bolts')
    for x in (GX0, GX1):
        for z in (GZ0, GZ1):
            g.box(x - 0.85, x + 0.85, y0 + 0.18, y0 + 1.0, z - 1.3, z + 1.3)                  # end carriage
            g.box(x - 0.7, x + 0.7, y0 + 1.0, ytop - 0.6, z - 0.7, z + 0.7)                   # leg
            for yy in GSPLICE:                                                               # bolted flange splice
                for ya, yb in ((yy - 0.075, yy - 0.012), (yy + 0.012, yy + 0.075)): g.box(x - 0.82, x + 0.82, ya, yb, z - 0.82, z + 0.82)
                for t in np.linspace(-0.66, 0.66, 6):
                    for bx, bz in ((x + t, z - 0.76), (x + t, z + 0.76), (x - 0.76, z + t), (x + 0.76, z + t)):
                        bolts.cyl((bx, yy - 0.115, bz), (bx, yy + 0.115, bz), 0.024, seg=6)
            g.box(x - 0.86, x + 0.86, y0 + 1.0, y0 + 1.06, z - 0.86, z + 0.86)                # base plate on the carriage
    # Portal frames as in the released bow-camera frame: deep girders running into the legs through big curved
    # haunches (each side an arch), no bracing; a long hoist housing with a railing along the top of each portal.
    GD = 1.1                                                                                   # girder depth below ytop
    def fillet_xy(cx, cy, sx, sy, R, z0, z1, n=10):
        """concave haunch in a corner at (cx, cy) opening towards (sx, sy) (signs), extruded z0..z1 (a fan of wedges)"""
        pts = [(cx + sx * (R - R * math.cos(a)), cy + sy * (R - R * math.sin(a))) for a in np.linspace(0, math.pi / 2, n)]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            g.prism([(cx, cy), p0, p1] if sx * sy < 0 else [(cx, cy), p1, p0], z0, z1)
    def fillet_zy(cz, cy, sz, sy, R, x0, x1, n=10):
        """the same in the z-y plane, extruded x0..x1"""
        pts = [(cz + sz * (R - R * math.cos(a)), cy + sy * (R - R * math.sin(a))) for a in np.linspace(0, math.pi / 2, n)]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            vs = [g.bm.verts.new(E(xx, yy, zz)) for xx in (x0, x1) for zz, yy in ((cz, cy), p0, p1)]
            for f in ((0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)): g.bm.faces.new([vs[k] for k in f])
    for x in (GX0, GX1):
        inward = 1 if x == GX0 else -1
        for z in (GZ0, GZ1):
            fillet_xy(x + inward * 0.7, ytop - GD, inward, -1, 3.2, z - 0.62, z + 0.62)             # portal haunch
            ztow = 1 if z == GZ0 else -1
            fillet_zy(z + ztow * 0.7, ytop - GD - 0.5, ztow, -1, 2.6, x - 0.55, x + 0.55)           # side haunch
    for z in (GZ0, GZ1):
        g.box(GX0 - 1.2, GX1 + 1.2, ytop - GD, ytop + 1.3, z - 0.7, z + 0.7)                     # portal girder
        for ya, yb in ((ytop - GD - 0.06, ytop - GD), (ytop + 1.3, ytop + 1.36)): g.box(GX0 - 1.2, GX1 + 1.2, ya, yb, z - 0.79, z + 0.79)   # its flanges
        for x in np.linspace(GX0 - 0.6, GX1 + 0.6, 9): g.box(x - 0.02, x + 0.02, ytop - GD, ytop + 1.3, z - 0.75, z + 0.75)   # web stiffeners
        g.box(GX0 - 0.95, GX1 + 0.95, ytop + 1.36, ytop + 2.85, z - 0.82, z + 0.82)              # hoist housing
        g.box(GX0 - 1.0, GX1 + 1.0, ytop + 2.85, ytop + 2.95, z - 0.88, z + 0.88)                # its roof
        for x in np.linspace(GX0 + 0.5, GX1 - 0.5, 5): g.box(x - 0.6, x + 0.6, ytop + 1.7, ytop + 2.5, z - 0.86, z - 0.82) if z == GZ0 else g.box(x - 0.6, x + 0.6, ytop + 1.7, ytop + 2.5, z + 0.82, z + 0.86)   # access panels
    for x in (GX0, GX1):
        g.box(x - 0.55, x + 0.55, ytop - GD - 0.5, ytop + 1.3, GZ0 + 0.7, GZ1 - 0.7)              # side girder
        for ya, yb in ((ytop - GD - 0.56, ytop - GD - 0.5),): g.box(x - 0.62, x + 0.62, ya, yb, GZ0 + 0.7, GZ1 - 0.7)
        for zz in np.linspace(GZ0 + 2.0, GZ1 - 2.0, 5): g.box(x - 0.58, x + 0.58, ytop - GD - 0.5, ytop + 1.3, zz - 0.02, zz + 0.02)
    # trolley girders along the lift between the portals, the cross beam between them
    TZ = (GZ0 + 3.0, GZ1 - 3.0)
    for z in TZ:
        g.box(GX0 + 0.5, GX1 - 0.5, ytop - 0.6, ytop + 0.1, z - 0.3, z + 0.3)
        for ya, yb in ((ytop - 0.64, ytop - 0.6), (ytop + 0.1, ytop + 0.14)): g.box(GX0 + 0.5, GX1 - 0.5, ya, yb, z - 0.38, z + 0.38)
    g.box(GX0, GX1, ytop - 0.5, ytop + 0.25, (GZ0 + GZ1) / 2 - 0.45, (GZ0 + GZ1) / 2 + 0.45)  # cross beam
    mx, mz = (GX0 + GX1) / 2 - 1, (GZ0 + GZ1) / 2
    # hoists: a trolley on each girder, four falls of wire down to a sheave block with its hook
    s = Part('gantry_dark'); rope = Part('gantry_rope')
    HX = (mx - 2.5, mx + 2.5)
    for x in HX:
        for z in TZ:
            g.box(x - 0.55, x + 0.55, ytop + 0.14, ytop + 0.6, z - 0.5, z + 0.5)             # trolley frame
            s.cyl((x - 0.45, ytop + 0.42, z), (x + 0.45, ytop + 0.42, z), 0.2, seg=14)       # rope drum
            for sx in (-0.46, 0.46):
                for sz in (-0.42, 0.42): s.cyl((x + sx, ytop + 0.22, z + sz - 0.04), (x + sx, ytop + 0.22, z + sz + 0.04), 0.1, seg=10)   # wheels
            yb = HOOK_Y
            plate = [(-0.3, 0.36), (0.3, 0.36), (0.35, -0.04), (0.17, -0.42), (-0.17, -0.42), (-0.35, -0.04)]
            for za, zb in ((-0.17, -0.13), (0.13, 0.17)): g.prism([(x + px, yb + py) for px, py in plate], z + za, z + zb)
            s.cyl((x, yb + 0.06, z - 0.12), (x, yb + 0.06, z + 0.12), 0.25, seg=18)          # sheaves
            s.cyl((x, yb + 0.06, z - 0.2), (x, yb + 0.06, z + 0.2), 0.06, seg=10)            # pin
            s.cyl((x, yb - 0.3, z), (x, yb - 0.72, z), 0.055, seg=10)                         # shank
            s.torus((x, yb - 0.9, z), Vector((0, 1, 0)), 0.19, 0.05, 16, 8)                  # hook eye
            for dx in (-0.25, 0.25):
                for dz in (-0.06, 0.06): rope.cyl((x + dx, ytop - 0.62, z + dz), (x + dx, yb + 0.06, z + dz), 0.02, seg=6)
    # rails under the end carriages and their wheels
    for x in (GX0, GX1):
        s.box(x - 0.045, x + 0.045, y0, y0 + 0.13, 8.0, 48.0)
        for z in (GZ0, GZ1):
            for dz in (-0.75, 0.75): s.cyl((x - 0.5, y0 + 0.34, z + dz), (x + 0.5, y0 + 0.34, z + dz), 0.3, seg=18)
    # festoon: the trolley's power cable hanging in loops from carriers on a track under the south girder
    fz = GZ0 + 0.95; fy = ytop - 0.75
    s.box(GX0 + 0.8, GX1 - 0.8, fy, fy + 0.06, fz - 0.03, fz + 0.03)
    xs = np.linspace(GX0 + 1.2, GX1 - 1.2, 13)
    for xa, xb in zip(xs[:-1], xs[1:]):
        s.box(xa - 0.05, xa + 0.05, fy - 0.14, fy, fz - 0.04, fz + 0.04)
        sag = 0.55 + 0.25 * math.sin(xa * 1.7)
        pts = [(xa + (xb - xa) * u, fy - 0.14 - sag * 4 * u * (1 - u), fz) for u in np.linspace(0, 1, 9)]
        rope.tube(pts, 0.022, seg=6)
    out['gantry'] = g.obj(bevel=0.03, seg=2, angle=30)
    out['bolts'] = bolts.obj(bevel=0.0, smooth=30)
    out['dark'] = s.obj(bevel=0.0)
    out['rope'] = rope.obj()
    hr = Part('gantry_rail')
    for z in (GZ0, GZ1):
        for dz in (-0.8, 0.8): railing(hr, [(GX0 - 0.95, z + dz), (GX1 + 0.95, z + dz)], ytop + 2.95, h=1.0, step=1.8, r=0.03)   # along the housing roof
    ladder(hr, GX1 + 0.7, GZ1 - 0.25, GZ1 + 0.25, y0 + 1.0, ytop + 1.3, off=-0.15)
    for yy in np.arange(y0 + 3.0, ytop + 1.2, 0.9): hr.torus((GX1 + 1.15, yy, GZ1), Vector((0, 1, 0)), 0.36, 0.018, 16, 4)
    out['rail'] = hr.obj()
    return out


def build_sub():
    out = {}
    SL = SU['z1'] - SU['z0']
    def r_at(s):          # hull radius at s metres aft of the bow
        if s < 3.6: return 1.38 * (1 - (1 - s / 3.6) ** 2.1) ** (1 / 2.1)
        if s < SL * 0.62: return 1.38
        u = (s - SL * 0.62) / (SL * 0.985 - SL * 0.62); return max(1.38 * (1 - u ** 1.7) ** 0.85, 0.14)
    prof = [(s, r_at(s)) for s in np.concatenate([np.linspace(0, 3.6, 18), np.linspace(4.2, SL * 0.6, 8), np.linspace(SL * 0.63, SL * 0.985, 22)])]
    h = Part('sub_hull')
    h.lathe(prof, (SU['x'], SU['y'], SU['z1']), Vector((0, 1, 0)), seg=40)        # Blender +Y = engine -z: bow to stern
    # deck casing: a flat-topped casing from near the bow to behind the sail
    for s0, s1 in ((1.6, 20.5),):
        n = 30; pts = np.linspace(s0, s1, n)
        top = SU['y'] + 1.38 + 0.2
        for a, b in zip(pts[:-1], pts[1:]):
            ra, rb = r_at(a), r_at(b)
            ya, yb2 = SU['y'] + ra * 0.92 + 0.18, SU['y'] + rb * 0.92 + 0.18
            h.box(SU['x'] - 0.55, SU['x'] + 0.55, SU['y'] + min(ra, rb) * 0.75, min(ya, yb2, top), SU['z1'] - b, SU['z1'] - a)
    out['hull'] = h.obj(smooth=60, weld=False)
    sail = Part('sub_sail')
    sc = SU['z1'] - 11.6; yb = SU['y'] + 1.3; yt = SU['y'] + 1.38 + 1.75
    pts = []
    for t in np.linspace(0, 1, 18):                     # stadium-like plan: round leading edge (south), tapering aft
        a = math.pi * t; pts.append((SU['x'] + 0.5 * math.sin(a) * (1 - 0.25 * t), sc + 1.9 - 1.9 * (1 - math.cos(a)) * 0.5 - 1.9 * t))
    pts = pts + [(2 * SU['x'] - x, z) for x, z in reversed(pts)]
    sail.prism_z(pts[:-1], yb, yt)
    sail.box(SU['x'] - 0.42, SU['x'] + 0.42, yt, yt + 0.08, sc - 1.2, sc + 1.3)
    for sgn in (-1, 1): sail.prism([(SU['x'] + sgn * 0.45, yt - 0.75), (SU['x'] + sgn * 1.25, yt - 0.72), (SU['x'] + sgn * 1.25, yt - 0.66), (SU['x'] + sgn * 0.45, yt - 0.6)], sc + 0.9, sc + 1.55)
    for dz, rr, hh in ((0.6, 0.07, 1.6), (-0.1, 0.09, 1.1), (-0.8, 0.06, 0.9)): sail.cyl((SU['x'], yt, sc + dz), (SU['x'], yt + hh, sc + dz), rr, seg=10)
    out['sail'] = sail.obj(bevel=0.015, seg=2, smooth=50)
    st = Part('sub_stern')
    s_root = SL * 0.93 - 1.0                      # leading edge of the cruciform surfaces (s from the bow)
    def slab(outline, frame):
        """a thin plate: outline [(u, v)] mapped by frame(u, v, side) -> engine xyz"""
        v0 = [st.bm.verts.new(E(*frame(u, v, -1))) for u, v in outline]; v1 = [st.bm.verts.new(E(*frame(u, v, 1))) for u, v in outline]
        st.bm.faces.new(v0); st.bm.faces.new(v1[::-1])
        for i in range(len(outline)):
            j = (i + 1) % len(outline); st.bm.faces.new((v0[j], v0[i], v1[i], v1[j]))
    for ang in (0, math.pi / 2, math.pi, 1.5 * math.pi):
        dx, dy = math.cos(ang), math.sin(ang)
        def fin(span, along, side, dx=dx, dy=dy):
            s = s_root + along; rr = r_at(s) * 0.96 + span; th = 0.045 * side * (1 - 0.5 * span / 1.3)
            return (SU['x'] + dx * rr - dy * th, SU['y'] + dy * rr + dx * th, SU['z1'] - s)
        slab([(0, 0), (1.25, 0.3), (1.25, 1.45), (0, 1.9)], fin)
    zp = SU['z1'] - SL * 0.995
    st.cyl((SU['x'], SU['y'], zp + 0.45), (SU['x'], SU['y'], zp - 0.3), 0.2, 0.06, seg=16)
    for k in range(5):
        a = k * 2 * math.pi / 5; pitch = math.radians(38)
        ur = (math.cos(a), math.sin(a)); ut = (-math.sin(a), math.cos(a))
        def blade(r, c, side, ur=ur, ut=ut):
            # chord direction between the tangent and the shaft axis (engine -z is aft); thickness along their normal
            cx, cy, cz = ut[0] * math.cos(pitch), ut[1] * math.cos(pitch), math.sin(pitch)
            nx, ny, nz = -ut[0] * math.sin(pitch), -ut[1] * math.sin(pitch), math.cos(pitch)
            t = 0.022 * side * (1 - 0.6 * r)
            return (SU['x'] + ur[0] * r + cx * c + nx * t, SU['y'] + ur[1] * r + cy * c + ny * t, zp + cz * c + nz * t)
        slab([(0.15, -0.17), (0.7, -0.24), (0.98, -0.08), (0.95, 0.12), (0.6, 0.22), (0.15, 0.16)], blade)
    out['stern'] = st.obj(bevel=0.0, smooth=40)
    return out


def stage_hero():
    d.reset(samples=8)
    sc = bpy.context.scene
    add_sun()
    sea = add_sea_plane()
    quay = Part('bake_quay').box(-160, 170, -3.6, QY, -118, QZ).obj()
    pier = build_pier(); steel = build_pier_steel(); gan = build_gantry(); sub = build_sub()
    # scans
    conc = scan('dirty_concrete'); conc2 = scan('concrete_wall_006'); paint = scan('rusty_metal_sheet'); rust = scan('rust_coarse_01')
    plate = scan('metal_plate_02'); wood = scan('old_planks_02'); grain = scan('asphalt_02', '1k')
    C = lambda name, **k: (lambda m: mat_surface(name, 'concrete', m, **k))
    St = lambda name, **k: (lambda m: mat_surface(name, 'steel', m, rustscan=rust, **k))
    Yd = PI['y']
    posts = ('Y', 73.2 / 39, 21.5, Yd, 1.5)                 # railing posts along the pier edges: rust runs down the beam below each
    form = [('Y', 2.44, 0.0, -3.0, Yd - 0.4), ('X', 2.44, 0.0, -3.0, Yd - 0.4)]      # formwork panel joints
    yellow = (0.62, 0.40, 0.055)                            # safety yellow, some years in the sun
    mats = dict(
        deck=C('c_deck', scan=conc, tile=3.0, tone=(0.74, 0.72, 0.69), growth=False, streaks=0.15, weather=0.75),
        beams=C('c_beams', scan=conc2, tile=2.4, tone=(0.82, 0.8, 0.77), growth=True, tide=1.05, streaks=0.45, seams=form, fit=posts, seamdepth=0.6),
        kerb=St('s_kerb', scan=paint, paint=(0.58, 0.42, 0.07), rust=0.5, lumk=1.2, wear=0.8, fade=0.45, dirt=0.8),
        piles=C('c_piles', scan=conc2, tile=2.0, tone=(0.8, 0.78, 0.75), growth=True, tide=1.1, streaks=0.5, seams=[('Z', 1.5, 0.95, -3.0, 2.0)], seamdepth=0.5),
        fenders=lambda m: mat_surface('r_fender', 'rubber', m, scan=grain, growth=True, tide=0.9),
        galv=lambda m: mat_surface('s_galv', 'galv', m, scan=plate, rustscan=rust, rust=0.3, tile=1.2, growth=True, tide=0.8),
        black=St('s_bollard', scan=plate, paint=(0.03, 0.03, 0.03), rust=0.6, lumk=0.6, scanmix=0.3),
        winch=St('s_winch', scan=paint, paint=(0.11, 0.17, 0.22), rust=0.4, lumk=1.4, fade=0.4),
        rope=lambda m: mat_surface('s_rope', 'rope', m, scan=grain),
        platform=St('s_platform', scan=plate, paint=(0.06, 0.065, 0.07), rust=0.75, growth=True, tide=1.2, lumk=0.8),
        blocks=St('s_blocks', scan=plate, paint=(0.09, 0.09, 0.09), rust=0.7, growth=False),
        timber=lambda m: mat_surface('t_blocks', 'timber', m, scan=wood, tile=1.6, tone=(0.75, 0.68, 0.6)),
        gantry=St('s_gantry', scan=paint, paint=yellow, rust=0.42, lumk=1.1, scanmix=0.3, wear=0.3, primer=(0.25, 0.1, 0.06), fade=0.5, dirt=0.75, streaks=0.6, wash=0.75,
                  seams=[('Z', 3.4, GSPLICE[0], GY + 1.1, GY + GH - 1.2), ('X', 2.41, GX0 - 0.6 + 1.205, GY + GH - 1.1, GY + GH + 1.3)], seamw=0.014, seamdepth=0.9, runreach=1.8),
        bolts=St('s_gbolts', scan=paint, paint=yellow, rust=0.55, lumk=1.0, scanmix=0.3, dirt=0.5),
        dark=St('s_gdark', scan=plate, paint=(0.05, 0.05, 0.05), rust=0.6),
        grope=lambda m: mat_surface('s_grope', 'rope', m, scan=grain),
        rail=St('s_grail', scan=paint, paint=yellow, rust=0.32, lumk=1.0, fade=0.4),
        # matt black: anechoic tiles in a faint grid, each a slightly different sheen and angle; no markings
        hull=lambda m: mat_surface('h_hull', 'hull', m, scan=plate, rustscan=rust, paint=(0.014, 0.0145, 0.016), rust=0.06, lumk=0.5, scanmix=0.15, paintrough=0.6, wear=0.08, primer=(0.06, 0.06, 0.06),
                                   dirt=0.22, dirtcol=(0.62, 0.6, 0.56), streaks=0.3, wash=0.12, scanbump=0.12, tiles=(0.62, SU['x'], SU['y'], 1.38), seamdepth=0.5, bumpdist=0.05, bump=1.0, tilt=1.5, tilerough=0.2),
        sail=lambda m: mat_surface('h_sail', 'hull', m, scan=plate, rustscan=rust, paint=(0.015, 0.0155, 0.017), rust=0.06, lumk=0.5, scanmix=0.15, paintrough=0.6, wear=0.12, primer=(0.06, 0.06, 0.06),
                                   dirt=0.22, dirtcol=(0.62, 0.6, 0.56), streaks=0.3, wash=0.12, scanbump=0.12, tiles=(0.62, SU['x'], SU['y'], 1.38), seamdepth=0.5, bumpdist=0.05, bump=1.0, tilt=1.5, tilerough=0.2),
        stern=lambda m: mat_surface('h_stern', 'hull', m, scan=plate, rustscan=rust, paint=(0.022, 0.022, 0.024), rust=0.2, lumk=0.5, wear=0.3, primer=(0.3, 0.2, 0.12), dirt=0.4, wash=0.3, scanbump=0.12),
    )
    groups = [
        ('pier_conc', 4096, [(pier['deck'], mats['deck']), (pier['beams'], mats['beams']), (pier['piles'], mats['piles']), (pier['kerb'], mats['kerb']), (pier['fenders'], mats['fenders'])],
         {'pier_deck': 0.55}),
        ('pier_steel', 2048, [(steel['galv'], mats['galv']), (steel['black'], mats['black']), (steel['winch'], mats['winch']), (steel['rope'], mats['rope']),
                              (steel['platform'], mats['platform']), (steel['blocks'], mats['blocks']), (steel['timber'], mats['timber'])], None),
        ('gantry', 4096, [(gan['gantry'], mats['gantry']), (gan['bolts'], mats['bolts']), (gan['dark'], mats['dark']), (gan['rope'], mats['grope']), (gan['rail'], mats['rail'])],
         {'gantry_rail': 0.6, 'gantry_rope': 0.6, 'gantry_dark': 0.7}),
        ('sub', 2048, [(sub['hull'], mats['hull']), (sub['sail'], mats['sail']), (sub['stern'], mats['stern'])], None),
    ]
    only = set(d.args()[1:]) - {'draft', 'half'} - set(STAGES)
    if 'dry' in only:        # geometry check: flat colours, no bakes
        cols = {'pier_conc': (0.5, 0.49, 0.47, 1), 'pier_steel': (0.25, 0.27, 0.3, 1), 'gantry': (0.75, 0.55, 0.05, 1), 'sub': (0.04, 0.04, 0.045, 1)}
        objs = []
        for name, size, parts, uvs in groups:
            m = d.gltf_material(name, base_color=cols[name], roughness=0.7)
            for o, _ in parts: d.set_material(o, m)
            objs.append(join([o for o, _ in parts], name))
            d.log(name, tris(objs[-1]), 'tris')
        export(d.out_path('corsair', 'port_pier.glb'), objs[:2]); export(d.out_path('corsair', 'port_gantry.glb'), objs[2:3]); export(d.out_path('corsair', 'port_sub.glb'), objs[3:])
        return
    finals = {}
    for name, size, parts, uvs in groups:
        if only and name not in only: continue
        maps = bake_group(name, parts, size, None, uvscale=uvs, edge_radius={'gantry': 0.1, 'pier_steel': 0.05}.get(name, 0.035))
        finals[name] = (maps, [o for o, _ in parts])
    for o in (sea, quay): o.hide_render = True
    exports = {'port_pier': ['pier_conc', 'pier_steel'], 'port_gantry': ['gantry'], 'port_sub': ['sub']}
    for fname, gnames in exports.items():
        objs = []
        for gn in gnames:
            if gn not in finals: continue
            maps, parts = finals[gn]
            mat = final_material(gn, maps, cast=True)
            for o in parts: d.set_material(o, mat)
            objs.append(join(parts, gn))
        if objs: export(d.out_path('corsair', f'{fname}.glb'), objs)


# ------------------------------------------------------------------ stage: quay, yard, sheds, base, craft
def mulberry32(seed):
    """engine/geo.js rng(): the same sequence, so the old layout's random placements are reproduced"""
    s = [seed & 0xffffffff]
    def r():
        s[0] = (s[0] + 0x6D2B79F5) & 0xffffffff
        t = ((s[0] ^ (s[0] >> 15)) * (1 | s[0])) & 0xffffffff
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xffffffff)) & 0xffffffff) ^ t
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296
    return r


SHEDS = [  # x, z, w, d, h, wall, roof, band, doors, damaged   (old buildPort sheds; doors face the water, +z)
    (74, -72, 62, 40, 15, (0.55, 0.57, 0.58), (0.42, 0.44, 0.45), (0.08, 0.2, 0.42), 2, False),
    (158, -70, 60, 38, 14, (0.5, 0.52, 0.55), (0.3, 0.33, 0.37), (0.07, 0.17, 0.36), 2, True),
    (-92, -78, 54, 36, 13, (0.47, 0.45, 0.4), (0.36, 0.35, 0.33), None, 2, False),
    (-10, -96, 40, 26, 9, (0.5, 0.48, 0.44), (0.4, 0.39, 0.37), None, 3, False),
]


def pbox(part, o, eu, ev, en):
    """parallelepiped from corner o along the edge vectors eu, ev, en (all engine xyz)"""
    o, eu, ev, en = (np.array(a, float) for a in (o, eu, ev, en))
    vs = [part.bm.verts.new(E(*(o + a * eu + b * ev + c * en))) for c in (0, 1) for b in (0, 1) for a in (0, 1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        part.bm.faces.new([vs[k] for k in f])
    return part


def spans(a, b, holes, pad=0.0):
    """the pieces of [a, b] left between the (x0, x1) holes"""
    out, cur = [], a
    for h0, h1 in sorted(holes):
        if h0 - pad > cur + 0.05: out.append((cur, h0 - pad))
        cur = max(cur, h1 + pad)
    if b > cur + 0.05: out.append((cur, b))
    return out


def build_shed(i, x, z, w, dd, h, damaged):
    """A portal-frame industrial shed: concrete plinth (open at the doors) with a drip flashing, box-profile cladding
    (its ribs are drawn by the engine), corner and verge flashings, a gable roof with overhang, box gutters and
    swan-neck downpipes, roller shutters in painted frames with guide tracks, hoods, bottom rails and concrete aprons,
    a personnel door, window rows, wall lights, louvres, ridge cowls and roof extractors, translucent roof lights.
    Doors face the water (+z). Returns parts by material."""
    p = {k: Part(f'shed{i}_{k}') for k in ('plinth', 'wall', 'roof', 'band', 'door', 'trim', 'void', 'frame', 'glass', 'apron', 'sky')}
    cut = 0.42 if damaged else 1.0
    wl = w * cut; xa, xb = x - w / 2, x - w / 2 + wl; za, zb = z - dd / 2, z + dd / 2
    rise = dd * 0.11; Yb = QY; PH = 1.1; t = 0.12
    nd = 3 if i == 3 else 2
    dw = min(15, wl / nd * 0.62) if not damaged else min(15, w / 2 * 0.62); dh = h * 0.72
    doors = []
    for k in range(nd):
        dx = x - w / 2 + wl * (k + 0.5) / nd if not damaged else x - w / 2 + (w / 2) * (k + 0.5) / 2
        if dx + dw / 2 > xb - 1: continue
        doors.append(dx)
    pdoor = (xb - 3.4, xb - 2.4)                                   # personnel door, east end of the front
    holes = [(dx - dw / 2, dx + dw / 2) for dx in doors]
    # plinth: a ring wall 0.38 thick standing 0.08 proud of the cladding, open at the doors
    for a, b in spans(xa - 0.08, xb + 0.08, holes + [pdoor]): p['plinth'].box(a, b, Yb, Yb + PH, zb - 0.3, zb + 0.08)
    p['plinth'].box(xa - 0.08, xb + 0.08, Yb, Yb + PH, za - 0.08, za + 0.3)
    p['plinth'].box(xa - 0.08, xa + 0.3, Yb, Yb + PH, za + 0.3, zb - 0.3)
    if not damaged: p['plinth'].box(xb - 0.3, xb + 0.08, Yb, Yb + PH, za + 0.3, zb - 0.3)
    # drip flashing on the plinth, corner flashings up the arrises
    for a, b in spans(xa - 0.1, xb + 0.1, holes + [pdoor]): p['frame'].box(a, b, Yb + PH - 0.02, Yb + PH + 0.05, zb - 0.02, zb + 0.13)
    p['frame'].box(xa - 0.1, xb + 0.1, Yb + PH - 0.02, Yb + PH + 0.05, za - 0.13, za + 0.02)
    for gx, sg in ([(xa, -1)] if damaged else [(xa, -1), (xb, 1)]):
        p['frame'].box(min(gx, gx + sg * 0.13), max(gx, gx + sg * 0.13), Yb + PH - 0.02, Yb + PH + 0.05, za, zb)
    for cx, cz, sx, sz in ((xa, zb, -1, 1), (xa, za, -1, -1)) + (() if damaged else ((xb, zb, 1, 1), (xb, za, 1, -1))):
        p['frame'].box(min(cx, cx + sx * 0.03), max(cx, cx + sx * 0.03), Yb + PH, Yb + h, min(cz - sz * 0.22, cz + sz * 0.03), max(cz - sz * 0.22, cz + sz * 0.03))
        p['frame'].box(min(cx - sx * 0.22, cx + sx * 0.03), max(cx - sx * 0.22, cx + sx * 0.03), Yb + PH, Yb + h, min(cz, cz + sz * 0.03), max(cz, cz + sz * 0.03))
    # cladding: the front split round the openings, the other walls whole
    for a, b in spans(xa, xb, holes): p['wall'].box(a, b, Yb + PH, Yb + h, zb - t, zb)
    p['wall'].box(xa, xb, Yb + PH, Yb + h, za, za + t)
    p['wall'].box(xa, xa + t, Yb + PH, Yb + h, za, zb)
    if not damaged: p['wall'].box(xb - t, xb, Yb + PH, Yb + h, za, zb)
    # roller-shutter doors: header panel, hood, painted frame, guide tracks, curtain with bottom rail, apron, guard posts
    for dx in doors:
        x0, x1 = dx - dw / 2, dx + dw / 2
        p['wall'].box(x0, x1, Yb + dh + 0.6, Yb + h, zb - t, zb)
        p['door'].box(x0 + 0.05, x1 - 0.05, Yb + 0.12, Yb + dh, zb - 0.45, zb - 0.35)                       # curtain
        p['frame'].box(x0 + 0.05, x1 - 0.05, Yb, Yb + 0.12, zb - 0.47, zb - 0.33)                            # bottom rail
        p['trim'].box(x0 - 0.25, x1 + 0.25, Yb + dh, Yb + dh + 0.6, zb - 0.1, zb + 0.4)                      # shutter hood
        p['trim'].box(x0 - 0.3, x1 + 0.3, Yb + dh + 0.6, Yb + dh + 0.66, zb - 0.1, zb + 0.46)                # its weather cap
        for sx in (x0, x1):                                                                                 # guide tracks
            p['trim'].box(sx - 0.12, sx + 0.12, Yb, Yb + dh, zb - 0.5, zb - 0.3)
            p['trim'].box(sx - 0.03, sx + 0.03, Yb, Yb + dh, zb - 0.3, zb - 0.02)
        for a, b in ((x0 - 0.32, x0), (x1, x1 + 0.32)): p['frame'].box(a, b, Yb, Yb + dh + 0.6, zb - 0.02, zb + 0.06)   # jambs
        p['frame'].box(x0 - 0.32, x1 + 0.32, Yb + dh + 0.66, Yb + dh + 0.96, zb - 0.02, zb + 0.06)                     # head
        p['void'].box(x0, x1, Yb, Yb + dh + 0.6, zb - 0.62, zb - 0.52)
        p['trim'].box(x0 - 0.3, x1 + 0.3, Yb, Yb + 0.035, zb - 0.5, zb + 0.25)                               # threshold plate
        p['apron'].box(x0 - 1.4, x1 + 1.4, Yb - 0.04, Yb + 0.045, zb + 0.08, zb + 7.5)
        for sx in (x0 - 0.62, x1 + 0.62): p['trim'].cyl((sx, Yb + 0.045, zb + 0.55), (sx, Yb + 1.15, zb + 0.55), 0.12, seg=12)   # guard posts
        for lx in (dx - dw * 0.3, dx + dw * 0.3):                                                           # floodlights over the door
            p['trim'].box(lx - 0.05, lx + 0.05, Yb + dh + 1.3, Yb + dh + 1.4, zb, zb + 0.55)
            pbox(p['trim'], (lx - 0.38, Yb + dh + 1.18, zb + 0.45), (0.76, 0, 0), (0, 0.06, 0.42), (0, 0.24, -0.04))
    # personnel door: leaf, frame, canopy, step
    p['door'].box(pdoor[0], pdoor[1], Yb, Yb + 2.2, zb - 0.06, zb + 0.02)
    p['frame'].box(pdoor[0] - 0.1, pdoor[1] + 0.1, Yb + 2.2, Yb + 2.3, zb - 0.02, zb + 0.06)
    for a in (pdoor[0] - 0.1, pdoor[1]): p['frame'].box(a, a + 0.1, Yb, Yb + 2.2, zb - 0.02, zb + 0.06)
    p['trim'].box(pdoor[0] - 0.4, pdoor[1] + 0.4, Yb + 2.45, Yb + 2.55, zb, zb + 0.9)
    p['apron'].box(pdoor[0] - 0.5, pdoor[1] + 0.5, Yb - 0.04, Yb + 0.15, zb + 0.06, zb + 1.2)
    # window rows: front between the openings, gables, back wall
    def window(cx, cy, cz, ww, hh, nrm):
        ax = abs(nrm[0]) > 0.5
        def bx(part, du, dv, d0, d1):
            if ax: part.box(cx + nrm[0] * d0, cx + nrm[0] * d1, cy - dv, cy + dv, cz - du, cz + du) if nrm[0] > 0 else part.box(cx + nrm[0] * d1, cx + nrm[0] * d0, cy - dv, cy + dv, cz - du, cz + du)
            else: part.box(cx - du, cx + du, cy - dv, cy + dv, cz + nrm[2] * d0, cz + nrm[2] * d1) if nrm[2] > 0 else part.box(cx - du, cx + du, cy - dv, cy + dv, cz + nrm[2] * d1, cz + nrm[2] * d0)
        bx(p['frame'], ww / 2 + 0.08, hh / 2 + 0.08, -0.02, 0.05)
        bx(p['glass'], ww / 2, hh / 2, 0.0, 0.06)
        sill_y = cy - hh / 2 - 0.1
        if ax: p['frame'].box(min(cx, cx + nrm[0] * 0.16), max(cx, cx + nrm[0] * 0.16), sill_y - 0.04, sill_y + 0.03, cz - ww / 2 - 0.12, cz + ww / 2 + 0.12)
        else: p['frame'].box(cx - ww / 2 - 0.12, cx + ww / 2 + 0.12, sill_y - 0.04, sill_y + 0.03, min(cz, cz + nrm[2] * 0.16), max(cz, cz + nrm[2] * 0.16))
    wy = Yb + min(4.2, dh * 0.42)
    for a, b in spans(xa + 0.6, xb - 0.6, holes + [pdoor], pad=0.9):
        n = int((b - a) // 4.2)
        for k in range(n): window(a + (b - a) * (k + 0.5) / n, wy, zb, 2.4, 1.2, (0, 0, 1))
    for gx, sg in ([(xa, -1)] if damaged else [(xa, -1), (xb, 1)]):
        n = int((dd - 4) // 5.0)
        for k in range(n): window(gx, wy, za + 2 + (dd - 4) * (k + 0.5) / n, 2.4, 1.2, (sg, 0, 0))
    n = int((wl - 6) // 7.5)
    for k in range(n): window(xa + 3 + (wl - 6) * (k + 0.5) / n, wy, za, 2.4, 1.2, (0, 0, -1))
    # wall lights: bulkhead fittings along the front and back walls under the eaves
    for zz, sg in ((zb, 1), (za, -1)):
        for lx in np.arange(xa + 6, xb - 4, 12.5):
            if any(a - 1 < lx < b + 1 for a, b in holes): continue
            ly = Yb + h - 1.6
            p['trim'].box(lx - 0.24, lx + 0.24, ly - 0.17, ly + 0.17, min(zz, zz + sg * 0.26), max(zz, zz + sg * 0.26))
            p['glass'].box(lx - 0.18, lx + 0.18, ly - 0.2, ly - 0.17, min(zz + sg * 0.03, zz + sg * 0.23), max(zz + sg * 0.03, zz + sg * 0.23))
    # louvred vents high on the gables, ridge cowls, roof extractors, a service duct and fan housings on the back wall
    for gx, sgn in ([(xa, -1)] if damaged else [(xa, -1), (xb, 1)]):
        for vz in (z - dd * 0.22, z + dd * 0.22):
            p['door'].box(min(gx + sgn * 0.01, gx + sgn * 0.07), max(gx + sgn * 0.01, gx + sgn * 0.07), Yb + h - 2.6, Yb + h - 0.9, vz - 1.3, vz + 1.3)
            for (a, b, c, e) in ((Yb + h - 2.7, Yb + h - 2.6, vz - 1.4, vz + 1.4), (Yb + h - 0.9, Yb + h - 0.8, vz - 1.4, vz + 1.4)):
                p['frame'].box(min(gx, gx + sgn * 0.12), max(gx, gx + sgn * 0.12), a, b, c, e)
            for vz2 in (vz - 1.4, vz + 1.3): p['frame'].box(min(gx, gx + sgn * 0.12), max(gx, gx + sgn * 0.12), Yb + h - 2.7, Yb + h - 0.8, vz2, vz2 + 0.1)
    for vx in np.linspace(xa + 5, xb - 5, max(2, int(wl / 11))):
        p['trim'].cyl((vx, Yb + h + rise + 0.2, z), (vx, Yb + h + rise + 0.95, z), 0.42, seg=14)
        p['trim'].cyl((vx, Yb + h + rise + 0.95, z), (vx, Yb + h + rise + 1.2, z), 0.6, 0.25, seg=14)
    for vx in np.linspace(xa + 6, xb - 6, max(2, int(wl / 16))):
        p['trim'].box(vx - 0.7, vx + 0.7, Yb + h * 0.55, Yb + h * 0.55 + 1.2, za - 0.75, za)
        p['door'].box(vx - 0.55, vx + 0.55, Yb + h * 0.55 + 0.15, Yb + h * 0.55 + 1.05, za - 0.79, za - 0.75)
    # gable infills
    for gx in ([xa] if damaged else [xa, xb]):
        vs = [p['wall'].bm.verts.new(E(gx + s, Yb + h, za)) for s in (-t / 2, t / 2)] + [p['wall'].bm.verts.new(E(gx + s, Yb + h, zb)) for s in (t / 2, -t / 2)] + \
             [p['wall'].bm.verts.new(E(gx + s, Yb + h + rise, z)) for s in (-t / 2, t / 2)]
        bm = p['wall'].bm
        bm.faces.new((vs[0], vs[3], vs[4])); bm.faces.new((vs[1], vs[5], vs[2])); bm.faces.new((vs[0], vs[4], vs[5], vs[1])); bm.faces.new((vs[3], vs[2], vs[5], vs[4]))
    # roof: two slabs with overhang, ridge cap, verge flashings, box gutters, swan-neck downpipes, roof lights, extractors
    ov = 0.7; rx0, rx1 = xa - ov, xb + (0 if damaged else ov)
    y1 = Yb + h + rise
    for sgn in (-1, 1):
        zr0 = z + sgn * (dd / 2 + ov); zw = z + sgn * dd / 2
        y0 = Yb + h - ov * rise / (dd / 2)
        bm = p['roof'].bm
        a = [bm.verts.new(E(xx, yy, zz)) for xx, yy, zz in ((rx0, y0, zr0), (rx1, y0, zr0), (rx1, y1, z), (rx0, y1, z))]
        b = [bm.verts.new(E(xx, yy + 0.16, zz)) for xx, yy, zz in ((rx0, y0, zr0), (rx1, y0, zr0), (rx1, y1, z), (rx0, y1, z))]
        bm.faces.new(a[::-1] if sgn > 0 else a); bm.faces.new(b if sgn > 0 else b[::-1])
        for k in range(4):
            j = (k + 1) % 4; bm.faces.new((a[k], a[j], b[j], b[k]))
        slope = np.array((0.0, y1 - y0, z - zr0)); nrm = np.array((0.0, abs(z - zr0), sgn * (y1 - y0))); nrm /= np.linalg.norm(nrm)
        for vx in (rx0, rx1) if not damaged else (rx0,):                                                    # verge flashings
            pbox(p['frame'], (vx - 0.07, y0 - 0.2, zr0), (0.14, 0, 0), slope, (0, 0.4, 0))
        gz = sorted((zr0 - sgn * 0.04, zr0 + sgn * 0.24))                                                   # box gutter
        p['frame'].box(rx0, rx1, y0 - 0.26, y0 + 0.02, gz[0], gz[1])
        for dxp in np.linspace(xa + 0.6, xb - 0.6, max(2, int(wl / 15) + 1)):                               # downpipes
            if sgn > 0 and any(a0 - 0.8 < dxp < b0 + 0.8 for a0, b0 in holes + [pdoor]): continue
            pw = zw + sgn * 0.16
            p['trim'].tube([(dxp, y0 - 0.26, zr0 + sgn * 0.1), (dxp, y0 - 0.55, zr0 + sgn * 0.1), (dxp, y0 - 1.1, pw), (dxp, Yb + 0.35, pw), (dxp, Yb + 0.12, pw + sgn * 0.3)], 0.075, seg=10)
            for by in np.arange(Yb + 1.6, y0 - 1.2, 2.6): p['trim'].box(dxp - 0.04, dxp + 0.04, by, by + 0.05, min(zw, pw), max(zw, pw))
        for sx in np.arange(xa + 4.5, xb - 3.5, 6.0):                                                         # translucent roof lights
            o = np.array((sx - 0.5, y0 + 0.165, zr0)) + 0.3 * slope + nrm * 0.004
            pbox(p['sky'], o, (1.0, 0, 0), 0.38 * slope, nrm * 0.02)
        for k, sx in enumerate(np.linspace(xa + wl * 0.3, xb - wl * 0.3, 2)):                               # roof extractors
            c = np.array((sx, y0 + 0.16, zr0)) + 0.72 * slope
            p['trim'].cyl(tuple(c), tuple(c + np.array((0, 0.75, 0))), 0.34, seg=14)
            p['trim'].cyl(tuple(c + np.array((0, 0.75, 0))), tuple(c + np.array((0, 1.0, 0))), 0.4, 0.12, seg=14)
    p['frame'].box(rx0, rx1, y1 + 0.1, y1 + 0.3, z - 0.32, z + 0.32)                                        # ridge cap
    if i in (0, 1):
        p['band'].box(xa - 0.05, xb + (0 if damaged else 0.05), Yb + h * 0.8, Yb + h, za - 0.06, zb + 0.06)
    out = {k: v for k, v in p.items()}
    if damaged:
        hx = xb
        fr = Part(f'shed{i}_portal'); deb = Part(f'shed{i}_debris'); sheet = Part(f'shed{i}_sheet')
        R = rng(21)
        for k in range(5):                     # portal frames still standing, bent and leaning
            fx = hx + 1.5 + k * w * 0.11; lean = 0.15 + k * 0.17; hh = h * (0.95 - k * 0.16)
            for zz in (za + 0.3, zb - 0.3):
                top = (fx + math.sin(lean) * hh * (1 if zz < z else 0.6), Yb + math.cos(lean) * hh, zz)
                fr.cyl((fx, Yb, zz), top, 0.2, seg=4, rot=math.pi / 4)
            if k < 3:
                fr.cyl((fx + math.sin(lean) * hh, Yb + math.cos(lean) * hh, za + 0.3), (fx + math.sin(lean) * hh * 0.6 + 1, Yb + math.cos(lean) * hh - 2.5 - k, z), 0.17, seg=4, rot=math.pi / 4)
        for k in range(26):                    # a spill of broken masonry and sheet along the fallen bays
            cx = hx + R.uniform(1, w * 0.55); cz = z + R.uniform(-dd * 0.45, dd * 0.45); s = R.uniform(1.0, 3.6)
            bm = deb.bm; res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
            for v in res['verts']:
                n = math.sin(v.co.x * 3.1 + k) * math.cos(v.co.y * 2.7 + k * 1.3) * 0.35
                v.co = Vector((v.co.x * s * (1 + n), v.co.y * s * (1 - n * 0.5), max(v.co.z, -0.2) * s * R.uniform(0.25, 0.6))) + E(cx, Yb, cz)
        for k in range(9):                     # torn roof and wall sheets, hanging or flat on the rubble
            cx = hx + 2 + k * w * 0.06; cz = z + (k - 4) * dd * 0.09
            M2 = Matrix.Translation(E(cx, Yb + 1.0 + (k % 3) * 1.6, cz)) @ Matrix.Rotation(0.4 + k * 0.5, 4, 'Z') @ Matrix.Rotation(-1.1 + k * 0.27, 4, 'X')
            res = bmesh.ops.create_grid(sheet.bm, x_segments=4, y_segments=3, size=1.0)
            bmesh.ops.scale(sheet.bm, vec=(3.0 + k % 4, 2.0, 1), verts=res['verts'])
            for v in res['verts']: v.co.z += math.sin(v.co.x * 1.7) * 0.25
            bmesh.ops.transform(sheet.bm, matrix=M2, verts=res['verts'])
        bmesh.ops.solidify(sheet.bm, geom=sheet.bm.faces[:], thickness=0.02)
        out['portal'] = fr; out['debris'] = deb; out['sheet'] = sheet
    return out


def build_yard():
    out = {}
    # quay: apron top, the wall to the water with its coping, end faces; fender panels, bollards, ladders along the edge
    q = Part('quay_top'); q.box(-160, 170, QY - 0.4, QY, -118, QZ)
    wall = Part('quay_wall'); wall.box(-160, 170, -3.0, QY - 0.4, QZ - 1.0, QZ)
    for x0 in (-160, 170): wall.box(x0 - 0.5, x0 + 0.5, -3.0, QY, -118, QZ)
    wall.box(-160, 170, QY - 0.42, QY + 0.06, QZ - 0.55, QZ + 0.08)                    # coping
    fend = Part('quay_fenders'); bol = Part('quay_bollards'); lad = Part('quay_ladders')
    for x in range(-150, 168, 12):
        if -21 < x < 9 or x > 24 or x < -148: continue
        fend.box(x - 0.5, x + 0.5, -0.3, QY - 0.3, QZ + 0.05, QZ + 0.42)
    r_old = mulberry32(77)
    for x in range(-130, 150, 14):
        bol.box(x - 0.3, x + 0.3, QY, QY + 0.05, QZ - 1.1, QZ - 0.5)
        bol.cyl((x, QY + 0.05, QZ - 0.8), (x, QY + 0.5, QZ - 0.8), 0.17, 0.2, seg=14); bol.cyl((x, QY + 0.5, QZ - 0.8), (x, QY + 0.58, QZ - 0.8), 0.25, seg=14)
    for x in (-136, -88, -36, 40, 96, 140):
        ladder(lad, 0, x - 0.22, x + 0.22, -1.2, QY, axis='x', off=-QZ - 0.12)
    out.update(quay_top=q, quay_wall=wall, quay_fenders=fend, quay_bollards=bol, quay_ladders=lad)
    # lamp posts along the quay (arm over the apron)
    lamps = Part('yard_lamps')
    for x in (-120, -80, -44, 34, 70, 106, 142):
        z = QZ - 3
        lamps.box(x - 0.25, x + 0.25, QY, QY + 0.04, z - 0.25, z + 0.25)
        lamps.cyl((x, QY + 0.04, z), (x, QY + 9.5, z), 0.11, 0.065, seg=12)
        lamps.cyl((x, QY + 9.3, z), (x, QY + 9.5, z - 1.6), 0.045, seg=8)
        lamps.box(x - 0.14, x + 0.14, QY + 9.38, QY + 9.56, z - 1.95, z - 1.25)
    out['lamps'] = lamps
    # containers (old layout: 22 boxes, every fifth stacked), with door ends and corner castings
    cont = Part('yard_containers')
    pal = [(0.3, 0.1, 0.07), (0.1, 0.18, 0.26), (0.35, 0.3, 0.2), (0.16, 0.2, 0.16), (0.34, 0.34, 0.33)]
    out['containers'] = []
    cparts = [Part(f'cont_{k}') for k in range(5)]
    for i in range(22):
        x = -62 + (i % 6) * 6.6 + (r_old() - 0.5); zz = -40 - (i // 6) * 3.1; st = 1 if i % 5 == 0 else 0; ry = r_old() * 0.04
        c = cparts[i % 5]; y0 = QY + st * 2.6
        bm = c.bm; res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(6.06, 2.44, 2.59), verts=res['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation(E(x, y0 + 1.295, zz)) @ Matrix.Rotation(ry, 4, 'Z'), verts=res['verts'])
    out['containers'] = cparts
    # mobile crane (old: body, cab, boom at 26 m)
    cr = Part('yard_crane'); crd = Part('yard_crane_dark')
    Mc = lambda px, py, pz: (30 + (px * math.cos(0.3) + pz * math.sin(0.3)), QY + py, -42 + (-px * math.sin(0.3) + pz * math.cos(0.3)))
    def obox(part, cx, cy, cz, sx, sy, sz, rz=0.0):
        bm = part.bm; res = bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=res['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation(E(*Mc(cx, cy, cz))) @ Matrix.Rotation(0.3, 4, 'Z') @ Matrix.Rotation(-rz, 4, 'Y'), verts=res['verts'])
    obox(cr, 0, 1.25, 0, 9.0, 1.1, 2.6); obox(cr, -2.5, 2.5, 0.2, 2.6, 1.6, 2.4); obox(cr, 3.4, 2.4, -0.9, 1.8, 1.5, 0.9)
    for k, (off, L, s) in enumerate(((0.0, 10.5, 0.95), (9.5, 10.0, 0.8), (18.5, 9.0, 0.66))):
        c = off + L / 2; obox(cr, 2.0 + c * math.cos(0.72), 3.3 + c * math.sin(0.72), 0, L, s, s, rz=0.72)
    for px in (-3.4, -1.6, 1.6, 3.4):
        for pz in (-1.2, 1.2): crd.cyl(Mc(px, 0.55, pz - 0.25), Mc(px, 0.55, pz + 0.25), 0.55, seg=16)
    out['crane'] = cr; out['crane_dark'] = crd
    # tanks (old: 4 x r7 h9) with roof cones, ladders and a low bund
    tk = Part('yard_tanks'); bund = Part('yard_bund')
    for i in range(4):
        tx, tz = 230 + (i % 2) * 19, -120 - (i // 2) * 19
        tk.cyl((tx, QY, tz), (tx, QY + 9, tz), 7.0, seg=40)
        tk.cyl((tx, QY + 9, tz), (tx, QY + 9.9, tz), 7.0, 0.6, seg=40)
        ladder(tk, tx + 7.05, tz - 0.25, tz + 0.25, QY, QY + 9.2, off=-0.12)
    for x0, x1, z0, z1 in ((216, 263, -106.5, -106), (216, 263, -153, -152.5), (216, 216.5, -153, -106), (262.5, 263, -153, -106)):
        bund.box(x0, x1, QY - 0.06, QY + 1.0, z0, z1)
    out['tanks'] = tk; out['bund'] = bund
    # entrance beacons on the breakwater heads: plinth, lattice tower, lantern (port red, starboard green)
    bcn = Part('yard_beacon'); lan = [Part('beacon_red'), Part('beacon_green')]
    for k, (x, z) in enumerate(PORT['entrance']):
        bcn.box(x - 1.1, x + 1.1, 2.8, 3.9, z - 1.1, z + 1.1)
        for dx, dz in ((-0.55, -0.55), (0.55, -0.55), (0.55, 0.55), (-0.55, 0.55)):
            bcn.cyl((x + dx, 3.9, z + dz), (x + dx * 0.3, 9.6, z + dz * 0.3), 0.05, seg=6)
        for y in (5.2, 6.8, 8.3): bcn.box(x - 0.5 * (1.1 - (y - 3.9) / 9), x + 0.5 * (1.1 - (y - 3.9) / 9), y, y + 0.05, z - 0.03, z + 0.03)
        bcn.box(x - 0.45, x + 0.45, 9.55, 9.65, z - 0.45, z + 0.45)
        lan[k].cyl((x, 9.65, z), (x, 10.3, z), 0.3, seg=14); lan[k].cyl((x, 10.3, z), (x, 10.45, z), 0.36, 0.12, seg=14)
    out['beacon'] = bcn; out['lanterns'] = lan
    # buildings of the base behind the yard (old layout), flat roofs with parapets and rooftop plant
    bl = Part('town_walls'); rf = Part('town_roofs')
    for i in range(120):
        x = (r_old() * 2 - 1) * 520; z = -150 - r_old() * 520
        if abs(x - 240) < 40 and z > -170: continue
        w = 12 + r_old() * 34; dd = 9 + r_old() * 22; h = 3.5 + r_old() * 6; ry = round(r_old() * 2) * math.pi / 2 + (r_old() - 0.5) * 0.08
        bm = bl.bm; res = bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(w, dd, h), verts=res['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation(E(x, QY + h / 2, z)) @ Matrix.Rotation(ry, 4, 'Z'), verts=res['verts'])
        bm = rf.bm; res = bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(w + 0.4, dd + 0.4, 0.5), verts=res['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation(E(x, QY + h + 0.1, z)) @ Matrix.Rotation(ry, 4, 'Z'), verts=res['verts'])
        for k in range(int(w * dd / 220) + 1):
            ux, uz = (hash((i, k)) % 1000 / 1000 - 0.5) * (w - 4), (hash((k, i)) % 1000 / 1000 - 0.5) * (dd - 4)
            res = bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(2.2, 1.4, 1.2), verts=res['verts'])
            bmesh.ops.transform(bm, matrix=Matrix.Translation(E(x, QY + h + 0.95, z)) @ Matrix.Rotation(ry, 4, 'Z') @ Matrix.Translation((ux, -uz, 0)), verts=res['verts'])
    out['town_walls'] = bl; out['town_roofs'] = rf
    # moored harbour craft alongside the quay west of the pier, mooring buoys in the basin (unmarked)
    out['craft'] = []
    for name, (cx, L, B, hh) in (('craft_tug', (-52.0, 16.0, 5.2, 2.2)), ('craft_launch', (-98.0, 10.5, 3.4, 1.6))):
        hull = Part(f'{name}_hull'); sup = Part(f'{name}_super'); crd2 = Part(f'{name}_dark')
        out['craft'].append((name, hull, sup, crd2))
        cz = QZ + 0.55 + B / 2 + 0.4
        stations = np.linspace(0, 1, 16)
        prof = []
        for u in stations:
            half = B / 2 * (math.sqrt(max(0.0, 1 - ((u - 0.35) / 0.65) ** 2)) if u > 0.35 else (0.82 + 0.18 * (u / 0.35)))
            prof.append((cx - L / 2 + u * L, max(half, 0.05)))
        bm = hull.bm; rings = []
        for xx, half in prof:
            ring = []
            for k, (yy, frac) in enumerate(((hh, 1.0), (hh * 0.55, 1.0), (0.2, 0.92), (-0.55, 0.62), (-0.9, 0.0))):
                ring.append(bm.verts.new(E(xx, yy, cz - half * frac)))
            for k, (yy, frac) in enumerate(((-0.9, 0.0), (-0.55, 0.62), (0.2, 0.92), (hh * 0.55, 1.0), (hh, 1.0))):
                if k == 0: continue
                ring.append(bm.verts.new(E(xx, yy, cz + half * frac)))
            rings.append(ring)
        for a, b in zip(rings[:-1], rings[1:]):
            for k in range(len(a) - 1): bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        for ring in (rings[0], rings[-1]):
            if len(set(ring)) > 2: bm.faces.new(ring)
        dx0 = cx - L * 0.1; sup.box(dx0 - L * 0.16, dx0 + L * 0.16, hh, hh + 2.2, cz - B * 0.3, cz + B * 0.3)
        sup.box(dx0 - L * 0.18, dx0 + L * 0.18, hh + 2.2, hh + 2.32, cz - B * 0.34, cz + B * 0.34)
        crd2.box(dx0 + L * 0.155, dx0 + L * 0.165, hh + 1.1, hh + 2.0, cz - B * 0.26, cz + B * 0.26)       # windscreen
        sup.cyl((dx0, hh + 2.32, cz), (dx0, hh + 5.2, cz), 0.06, seg=8)
        for k in range(int(L / 2.2)): crd2.torus((cx - L / 2 + 1.4 + k * 2.2, hh * 0.45, QZ + 0.65), Vector((0, 0, 1)), 0.38, 0.14, 16, 8)
    out['buoys'] = []
    for j, (bx, bz) in enumerate(((-100, 80), (-128, 118), (95, 25))):
        bu = Part(f'buoy_{j}')
        bu.cyl((bx, -1.0, bz), (bx, 0.85, bz), 1.1, seg=24); bu.cyl((bx, 0.85, bz), (bx, 1.0, bz), 1.1, 0.8, seg=24)
        bu.torus((bx, 1.12, bz), Vector((1, 0, 0)), 0.22, 0.04, 12, 6)
        out['buoys'].append(bu)
    return out


def stage_yard():
    d.reset(samples=8)
    add_sun(); sea = add_sea_plane()
    # occluders from the other groups (for shadows on the quay and the apron)
    for fn in ('port_pier', 'port_gantry', 'port_sub'):
        p = d.out_path('corsair', f'{fn}.glb')
        if os.path.exists(p):
            try:
                for o in d.import_gltf(p): o['occluder'] = 1
            except Exception as e:      # occluders only sharpen the shadows on the quay; carry on without them
                d.log('occluder import failed', fn, e)
    yard = build_yard()
    sheds = [build_shed(i, *s[:5], s[9]) for i, s in enumerate(SHEDS)]
    # land near the base: one plane carrying a baked ground atlas (roads, tracks, stains, shadows)
    near = Part('land_near').box(-640, 640, QY - 0.1, QY - 0.06, -760, QZ - 0.5).obj()
    S_conc = scan('concrete_floor_02'); S_wall = scan('concrete_wall_006'); S_clad = scan('box_profile_metal_sheet'); S_shut = scan('painted_metal_shutter')
    S_rust = scan('rust_coarse_01'); S_plate = scan('metal_plate_02'); S_cont = scan('container_side'); S_plast = scan('beige_wall_001'); S_ground = scan('dry_ground_01')
    S_asph = scan('asphalt_02'); S_debris = scan('concrete_debris'); S_paint = scan('rusty_metal_sheet'); S_grain = scan('asphalt_02', '1k')
    C = lambda name, **k: (lambda m: mat_surface(name, 'concrete', m, **k))
    St = lambda name, **k: (lambda m: mat_surface(name, 'steel', m, rustscan=S_rust, **k))
    G = lambda name, **k: (lambda m: mat_surface(name, 'galv', m, scan=S_plate, rustscan=S_rust, **k))
    def obj_of(p, **k): return p.obj(**k) if isinstance(p, Part) else p
    groups = []
    # quay
    groups.append(('quay', 4096, [
        (yard['quay_top'].obj(bevel=0.03), C('q_top', scan=S_conc, tile=4.0, tone=(0.8, 0.78, 0.75), streaks=0.2, weather=0.7, seams=[('X', 6.0, 0.0, QY - 0.5, QY + 0.1), ('Y', 6.0, 1.0, QY - 0.5, QY + 0.1)], seamw=0.03)),
        (yard['quay_wall'].obj(bevel=0.04), C('q_wall', scan=S_wall, tile=2.6, tone=(0.82, 0.8, 0.77), growth=True, tide=1.05, streaks=0.55, seams=[('X', 2.44, 0.0, -3.0, QY), ('Z', 1.22, 0.78, -3.0, QY - 0.45)], seamdepth=0.6,
                                               fit=('X', 14.0, -130.0, QY - 0.4, 1.6))),
        (yard['quay_fenders'].obj(bevel=0.05, seg=2), lambda m: mat_surface('q_fender', 'rubber', m, scan=S_grain, growth=True, tide=0.9)),
        (yard['quay_bollards'].obj(bevel=0.01), St('q_bollard', scan=S_plate, paint=(0.03, 0.03, 0.03), rust=0.6, lumk=0.6, scanmix=0.3)),
        (yard['quay_ladders'].obj(), G('q_ladder', rust=0.4, growth=True, tide=0.8)),
        (yard['lamps'].obj(smooth=50), G('q_lamps', rust=0.2)),
        (yard['beacon'].obj(bevel=0.01), C('b_plinth', scan=S_wall, tile=2.0)),
        (yard['lanterns'][0].obj(), St('b_red', scan=S_paint, paint=(0.42, 0.05, 0.03), rust=0.4)),
        (yard['lanterns'][1].obj(), St('b_green', scan=S_paint, paint=(0.05, 0.25, 0.1), rust=0.4)),
    ], {'quay_top': 0.35, 'quay_wall': 1.6}))
    # sheds: cladding, roof and shutters are their own meshes (the engine draws their ribs and slats); the atlas
    # spends its texels on the fittings, the broad faces carry stains and light at half the density
    sp = []; uvs = {}
    glass_fn = lambda m: mat_surface('sh_glass', 'glass', m, scan=S_grain)
    apron_fn = C('sh_apron', scan=S_conc, tile=3.0, tone=(0.8, 0.78, 0.74), streaks=0.0, weather=0.9)
    sky_fn = St('sh_sky', scan=S_plate, paint=(0.6, 0.6, 0.53), rust=0.02, lumk=0.35, scanmix=0.2, dirt=0.9, paintrough=0.42, wear=0.0)
    def tag(ob, en): ob['export'] = en; return ob
    for i, (x, z, w, dd, h, wc, rc, bc, nd, dmg) in enumerate(SHEDS):
        s = sheds[i]
        fc = tuple(c * 0.92 for c in bc) if bc else tuple(c * 0.55 for c in wc)
        clad = dict(scan=S_paint, tile=3.0, rust=0.2, lumk=0.45, scanmix=0.3, wear=0.12, bump=0.0, fade=0.4, dirt=0.5, streaks=0.45, runreach=0.9, runrust=0.9, paintrough=0.45)
        sp += [(s['plinth'].obj(bevel=0.02), C(f'sh{i}_plinth', scan=S_wall, tile=2.5, tone=(0.82, 0.79, 0.74), streaks=0.6, splash=(QY, 0.9, 0.8))),
               (tag(s['wall'].obj(bevel=0.0), 'sheds_clad'), St(f'sh{i}_wall', paint=wc, eave=QY + h * (0.8 if bc else 1.0), eavek=0.9, eavereach=h * 0.55, eavecol=(0.55, 0.5, 0.43), splash=(QY + 1.1, 0.9, 0.35),
                                                                 seams=[('Z', 1.6, QY + 1.4, QY + 1.3, QY + h - 0.3)], seamw=0.02, seamdepth=0.0, **clad)),
               (tag(s['roof'].obj(bevel=0.0), 'sheds_roof'), St(f'sh{i}_roof', paint=rc, **{**clad, 'rust': 0.3, 'fade': 0.55, 'streaks': 0.3})),
               (tag(s['door'].obj(bevel=0.01), 'sheds_shutter'), St(f'sh{i}_door', scan=S_paint, tile=2.0, paint=tuple(c * 0.85 for c in rc), rust=0.3, lumk=0.6, scanmix=0.3, bump=0.0, dirt=0.6, streaks=0.5, paintrough=0.55)),
               (s['trim'].obj(bevel=0.01), G(f'sh{i}_trim', rust=0.35)),
               (s['frame'].obj(bevel=0.008, seg=1), St(f'sh{i}_frame', scan=S_paint, tile=2.0, paint=fc, rust=0.3, lumk=1.0, scanmix=0.35, fade=0.35, dirt=0.6, wear=0.4)),
               (s['void'].obj(), glass_fn), (s['glass'].obj(), glass_fn), (s['apron'].obj(bevel=0.02), apron_fn), (s['sky'].obj(), sky_fn)]
        if bc: sp.append((tag(s['band'].obj(), 'sheds_clad'), St(f'sh{i}_band', paint=bc, **{**clad, 'fade': 0.5})))
        if dmg:
            sp += [(s['portal'].obj(), St(f'sh{i}_portal', scan=S_plate, paint=(0.08, 0.07, 0.065), rust=0.8)),
                   (s['debris'].obj(smooth=30), C(f'sh{i}_debris', scan=S_debris, tile=3.0, tone=(0.8, 0.78, 0.75))),
                   (s['sheet'].obj(), St(f'sh{i}_sheet', scan=S_paint, tile=2.0, paint=rc, rust=0.6, lumk=0.9, scanmix=0.5))]
        uvs.update({f'shed{i}_wall': 0.55, f'shed{i}_roof': 0.45, f'shed{i}_band': 0.55, f'shed{i}_apron': 0.5, f'shed{i}_plinth': 0.8})
    groups.append(('sheds', 3072, sp, uvs))
    # yard objects, craft, buoys
    cpal = [(0.3, 0.1, 0.07), (0.1, 0.18, 0.26), (0.35, 0.3, 0.2), (0.16, 0.2, 0.16), (0.34, 0.34, 0.33)]
    misc = [(c.obj(bevel=0.03, seg=1), St(f'cont{k}', scan=S_cont, tile=2.44, paint=cpal[k], rust=0.45, lumk=0.9, scanmix=0.5, bump=0.8, bumpdist=0.03)) for k, c in enumerate(yard['containers'])]
    misc += [(yard['crane'].obj(bevel=0.03), St('crane', scan=S_paint, paint=(0.62, 0.4, 0.05), rust=0.3, lumk=1.1)),
             (yard['crane_dark'].obj(bevel=0.02), lambda m: mat_surface('crane_tyre', 'rubber', m, scan=S_grain)),
             (yard['tanks'].obj(bevel=0.0, smooth=50), St('tanks', scan=S_paint, paint=(0.66, 0.66, 0.63), rust=0.28, lumk=0.9, scanmix=0.45)),
             (yard['bund'].obj(bevel=0.02), C('bund', scan=S_wall, tile=2.4)),
             ]
    f_hull = St('craft_hull', scan=S_paint, paint=(0.1, 0.12, 0.14), rust=0.35, growth=True, tide=0.25, lumk=1.0)
    f_sup = St('craft_super', scan=S_paint, paint=(0.6, 0.61, 0.6), rust=0.25, lumk=1.0)
    f_dark = St('craft_dark', scan=S_plate, paint=(0.05, 0.05, 0.05), rust=0.55, growth=True, tide=0.3)
    for name, hull, sup, crd2 in yard['craft']:
        for prt, fn, kw in ((hull, f_hull, dict(smooth=50)), (sup, f_sup, dict(bevel=0.02)), (crd2, f_dark, {})):
            ob = prt.obj(**kw); ob['export'] = name; misc.append((ob, fn))
    for bu in yard['buoys']:
        ob = bu.obj(); ob['export'] = bu.name; misc.append((ob, f_dark))
    groups.append(('yard', 2048, misc, None))
    # base buildings
    groups.append(('town', 1024, [(yard['town_walls'].obj(), C('town_wall', scan=S_plast, tile=4.0, tone=(1.0, 0.93, 0.82), streaks=0.6)),
                                  (yard['town_roofs'].obj(), C('town_roof', scan=S_conc, tile=5.0, tone=(0.95, 0.93, 0.9), streaks=0.2))], None))
    # ground: dry earth with gravel, the base's roads, tyre tracks, oil stains
    def ground(m):
        mat = mat_surface('ground', 'concrete', m, scan=S_ground, tile=6.0, tone=(1.05, 1.0, 0.92), streaks=0.0)
        nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']; P = d.texcoord(nt).outputs['Object']
        sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(P, sep.inputs['Vector'])
        X, Yn = sep.outputs['X'], sep.outputs['Y']           # Blender Y = -engine z
        road = None
        for zz in (128, 260, 400, 560):
            k = mr(nt, M(nt, 'ABSOLUTE', M(nt, 'SUBTRACT', Yn, zz)), 4.7, 4.3)
            road = k if road is None else M(nt, 'MAXIMUM', road, k)
        for xx in (-380, -190, 0, 190, 380):
            k = M(nt, 'MULTIPLY', mr(nt, M(nt, 'ABSOLUTE', M(nt, 'SUBTRACT', X, xx)), 4.7, 4.3), mr(nt, Yn, 125, 135))
            road = M(nt, 'MAXIMUM', road, k)
        asp = d.tex(nt, S_asph['Diffuse'], P, 'BOX', 0.2, scale=1 / 3.0).outputs['Color']
        base_in = bsdf.inputs['Base Color'].links[0].from_socket
        patches = mr(nt, noise(nt, P, 0.02, 4), 0.42, 0.62)
        b2 = d.mix_rgb(nt, base_in, d.mix_rgb(nt, base_in, (0.82, 0.78, 0.7), 1.0, 'MULTIPLY'), patches)
        b3 = d.mix_rgb(nt, b2, d.mix_rgb(nt, asp, (0.45, 0.45, 0.46), 1.0, 'MULTIPLY'), road)
        nt.links.new(b3, bsdf.inputs['Base Color'])
        return mat
    groups.append(('ground', 2048, [(near, ground)], None))
    only = set(d.args()[1:]) - {'draft', 'half'} - set(STAGES)
    if 'dry' in only:
        objs = []
        for name, size, parts, uvs in groups:
            m = d.gltf_material(name, base_color=(0.5, 0.48, 0.45, 1), roughness=0.8)
            for o, _ in parts: d.set_material(o, m)
            sep = {}; rest = []
            for o, _ in parts:
                if o.get('export'): sep.setdefault(o['export'], []).append(o)
                else: rest.append(o)
            for en, lst in sep.items(): objs.append(join(lst, en))
            objs.append(join(rest, name)); d.log(name, tris(objs[-1]), 'tris')
        export(d.out_path('corsair', 'port_yard.glb'), objs)
        return
    FILE = {'quay': 'port_yard', 'yard': 'port_yard', 'town': 'port_yard', 'sheds': 'port_sheds', 'ground': 'port_ground'}     # every .glb under 12 MB
    files = {}
    for name, size, parts, uvs in groups:
        finals = files.setdefault(FILE[name], [])
        if only and name not in only: continue
        maps = bake_group(name, parts, size, None, uvscale=uvs)
        mat = final_material(name, maps)
        objs = [o for o, _ in parts]
        for o in objs: d.set_material(o, mat)
        # objects that move in the film (craft, buoys riding the swell) stay separate, the rest is one mesh
        sep = {}; rest = []
        for o in objs:
            if o.get('export'): sep.setdefault(o['export'], []).append(o)
            else: rest.append(o)
        for en, lst in sep.items(): finals.append(join(lst, en))
        if rest: finals.append(join(rest, name))
    for o in bpy.data.objects:
        if o.get('occluder'): o.hide_render = True
    sea.hide_render = True
    # the far land: a frame of tiling ground round the baked block (no overlap, no z-fight)
    g = d.polyhaven_texture('dry_ground_01', '1k', maps=('Diffuse',))
    fm = d.gltf_material('land_far', base=d.image(g['Diffuse']), roughness=0.95, base_color=(0.82, 0.76, 0.66, 1))
    far = []
    for x0, x1, z0, z1 in ((-7000, -640, -7022, -22), (640, 7000, -7022, -22), (-640, 640, -7022, -760)):
        ob = mesh_from_arrays('land_far', [(x0, -z1, QY - 0.08), (x1, -z1, QY - 0.08), (x1, -z0, QY - 0.08), (x0, -z0, QY - 0.08)], [[0, 1, 2, 3]],
                              uv=[(x0 / 40, z1 / 40), (x1 / 40, z1 / 40), (x1 / 40, z0 / 40), (x0 / 40, z0 / 40)])
        d.set_material(ob, fm); far.append(ob)
    # beaches beyond the quay (old: sand slopes from the apron edge down below the water)
    s = d.polyhaven_texture('coast_sand_03', '1k', maps=('Diffuse',))
    smat = d.gltf_material('beach', base=d.image(s['Diffuse']), roughness=0.9, base_color=(0.9, 0.85, 0.75, 1)); smat['shore'] = 'sand'
    for x0, x1 in ((-7000, -205), (215, 7000)):
        xs = np.linspace(x0, x1, 80); V, F, UV = [], [], []
        for i, x in enumerate(xs):
            wv = math.sin(x * 0.011) * 3 + math.sin(x * 0.037) * 1.2
            for (yy, zz) in ((QY - 0.06, QZ - 0.5), (0.9, QZ + 7 + wv), (-0.9, QZ + 19 + wv * 1.4)): V.append((x, -zz, yy)); UV.append((x / 12, zz / 12))
        for i in range(len(xs) - 1):
            for j in range(2):
                a = i * 3 + j; F.append([a, a + 3, a + 4, a + 1] if x1 > x0 else [a, a + 1, a + 4, a + 3])
        ob = mesh_from_arrays('beach', V, F)
        uvl = ob.data.uv_layers.new(name='UVMap'); loops = np.array([l.vertex_index for l in ob.data.loops]); uvl.data.foreach_set('uv', np.array(UV, np.float32)[loops].ravel())
        d.smooth(ob, 80); d.set_material(ob, smat); far.append(ob)
    files.setdefault('port_ground', []).extend(far)
    for fname, objs in files.items():
        if objs and not (only and fname == 'port_ground' and 'ground' not in only): export(d.out_path('corsair', f'{fname}.glb'), objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE, 'yard.blend'))


STAGES = {'rocklib': stage_rocklib, 'rocks': stage_rocks, 'hero': stage_hero, 'yard': stage_yard, 'pack': stage_pack}

if __name__ == '__main__':
    todo = d.args() or ['rocklib']
    for s in todo:
        if s not in STAGES: continue      # options for a stage (e.g. 'dry', a group name)
        t0 = time.time()
        STAGES[s]()
        d.log(f'stage {s} done in {time.time() - t0:.0f}s')
