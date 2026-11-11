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
# el 16) is baked into each object's light: R = occlusion, G = sun visibility (static shadows), used by
# src/corsair_port.js. Sources are cached in /opt/dow-cache; only the exported .glb files are committed.
import os, sys, math, json, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler
import dowlib as d

CACHE = d.bake_dir('harbour')
SUN_AZ, SUN_EL = 80.0, 16.0
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
            na['POSITION'] = acc(view(q4.tobytes(), 8, 34962), 5122, 3, len(q), True, q.min(0) / 32767.0, q.max(0) / 32767.0)
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
            if '_AO' in at and '_SUN' in at:
                l4 = np.zeros((len(q), 4), np.uint8)
                l4[:, 0] = np.round(np.clip(read(at['_AO'])[:, 0], 0, 1) * 255); l4[:, 1] = np.round(np.clip(read(at['_SUN'])[:, 0], 0, 1) * 255)
                vi = view(l4.tobytes(), 4, 34962)
                na['_AO'] = acc(vi, 5121, 1, len(q), True); na['_SUN'] = acc(vi, 5121, 1, len(q), True, off=1)
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
            d.smooth(ob, 70)
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
    for o in objs_A + objs_B: d.set_material(o, rmat)
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
        for zz in (z0, z1): p.box(x - off - 0.03, x - off + 0.03, y0, y1, zz - 0.008, zz + 0.008)
        y = y0 + 0.25
        while y < y1 - 0.1: p.cyl((x - off, y, z0), (x - off, y, z1), 0.016, seg=6); y += 0.3
    else:
        for xx in (z0, z1): p.box(xx - 0.008, xx + 0.008, y0, y1, x - off - 0.03, x - off + 0.03)
        y = y0 + 0.25
        while y < y1 - 0.1: p.cyl((z0, y, x - off), (z1, y, x - off), 0.016, seg=6); y += 0.3
    return p


def railing(p, pts, y0, h=1.05, step=1.9, r=0.024):
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


def mat_surface(name, kind, masks, **o):
    """Source material for baking. kind: concrete | steel | galv | rubber | timber | rope | hull | glass.
    o: tone (rgb multiplier), paint (rgb), tile (m), rust (0..1), growth (bool), wetline (m), streaks"""
    mat, bsdf, nodes, links = d.new_material(name)
    nt = mat.node_tree
    tc = d.texcoord(nt); P = tc.outputs['Object']
    ao, edge = masks.sockets(nt)
    cvx = M(nt, 'MULTIPLY', edge, M(nt, 'POWER', ao, 2.0), True)               # convex edges: bevelled and open
    occ = M(nt, 'SUBTRACT', 1.0, ao, True)
    z = zcoord(nt, P)
    n1 = noise(nt, P, 0.16, 3); n2 = noise(nt, P, 1.4, 6); n3 = noise(nt, P, 5.5, 4)
    streak = mr(nt, noise(nt, P, 1.0, 5, 0.6, stretch=(2.2, 2.2, 0.09)), 0.55, 0.75)    # gravity streaks
    S = o['scan']; tile = o.get('tile', 2.0)
    col = d.tex(nt, S['Diffuse'], P, 'BOX', 0.3, scale=1.0 / tile).outputs['Color']
    rough = gray(nt, d.tex(nt, S['Rough'], P, 'BOX', 0.3, scale=1.0 / tile).outputs['Color']) if 'Rough' in S else V(nt, 0.7)
    disp = gray(nt, d.tex(nt, S['Displacement'], P, 'BOX', 0.3, scale=1.0 / tile).outputs['Color']) if 'Displacement' in S else V(nt, 0.5)
    bump_h = disp; bump_k = o.get('bump', 0.6); metal = V(nt, 0.0)
    tone = o.get('tone', (1, 1, 1))
    base = d.mix_rgb(nt, col, tuple(tone), 1.0, 'MULTIPLY')
    base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.8, 0.8, 0.8), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', n1, 0.6))       # large-scale tone drift
    if kind in ('steel', 'galv', 'hull'):
        R = o['rustscan']
        rcol = d.tex(nt, R['Diffuse'], P, 'BOX', 0.3, scale=1.0 / 1.6).outputs['Color']
        rrough = gray(nt, d.tex(nt, R['Rough'], P, 'BOX', 0.3, scale=1.0 / 1.6).outputs['Color']) if 'Rough' in R else V(nt, 0.85)
        lum = gray(nt, col)
        if kind == 'galv':
            paint = d.mix_rgb(nt, (0.48, 0.49, 0.5), (0.66, 0.67, 0.68), M(nt, 'MULTIPLY', lum, 1.4, True))
            metal = mr(nt, n2, 0.2, 0.8, 0.55, 0.85)
        else:
            paint = d.mix_rgb(nt, tuple(o['paint']), (0, 0, 0), M(nt, 'SUBTRACT', 1.0, M(nt, 'MULTIPLY', lum, o.get('lumk', 1.8), True), True), 'MIX')
            paint = d.mix_rgb(nt, tuple(o['paint']), paint, o.get('scanmix', 0.45))
        # rust: in occluded joints, at convex edges, in streaks below fixings, low near the water
        rk = o.get('rust', 0.4)
        rm = M(nt, 'ADD', M(nt, 'MULTIPLY', occ, 1.3), M(nt, 'MULTIPLY', cvx, 0.9))
        rm = M(nt, 'ADD', rm, M(nt, 'MULTIPLY', streak, 0.45))
        rm = M(nt, 'ADD', rm, mr(nt, z, 2.2, 0.6, 0.0, 0.5))
        rm = mr(nt, M(nt, 'ADD', M(nt, 'MULTIPLY', rm, rk), M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n2, 0.5), 0.6)), 0.35, 0.6)
        base = d.mix_rgb(nt, paint, rcol, rm)
        # worn edges show steel / primer
        wear = mr(nt, M(nt, 'MULTIPLY', cvx, M(nt, 'ADD', n3, 0.4)), 0.35, 0.7)
        base = d.mix_rgb(nt, base, o.get('primer', (0.18, 0.09, 0.06)), M(nt, 'MULTIPLY', wear, o.get('wear', 0.6)))
        rough = d.mix_rgb(nt, M(nt, 'ADD', M(nt, 'MULTIPLY', rough, 0.35), o.get('paintrough', 0.48)), rrough, rm)
        rough = gray(nt, rough)
        if kind == 'galv':
            metal = M(nt, 'MULTIPLY', metal, M(nt, 'SUBTRACT', 1.0, rm, True))
        bump_h = M(nt, 'ADD', M(nt, 'MULTIPLY', disp, 0.3), M(nt, 'MULTIPLY', rm, 0.6)); bump_k = 0.35
    elif kind == 'concrete':
        # grime in the joints and undersides, bright chipped arrises, gravity streaks of rust and dirt
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.42, 0.38, 0.33), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', M(nt, 'POWER', occ, 0.7), 0.9))
        base = d.mix_rgb(nt, base, (0.62, 0.6, 0.56), M(nt, 'MULTIPLY', mr(nt, M(nt, 'MULTIPLY', cvx, n3), 0.25, 0.55), 0.7))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.55, 0.42, 0.3), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', streak, o.get('streaks', 0.5)))
    elif kind == 'rubber':
        base = d.mix_rgb(nt, (0.018, 0.018, 0.019), (0.05, 0.048, 0.045), mr(nt, n2, 0.3, 0.8))
        base = d.mix_rgb(nt, base, (0.2, 0.19, 0.17), M(nt, 'MULTIPLY', mr(nt, z, 1.6, 3.2), mr(nt, n3, 0.45, 0.8)))   # dust and salt on top
        rough = mr(nt, n2, 0.0, 1.0, 0.72, 0.9); bump_h = n3; bump_k = 0.3
    elif kind == 'rope':
        base = d.mix_rgb(nt, (0.035, 0.034, 0.032), (0.11, 0.1, 0.085), n2); metal = V(nt, 0.5); rough = mr(nt, n2, 0, 1, 0.35, 0.6)
    elif kind == 'glass':
        base = d.mix_rgb(nt, (0.012, 0.014, 0.016), (0.05, 0.05, 0.048), M(nt, 'MULTIPLY', streak, 0.6)); rough = mr(nt, streak, 0, 1, 0.08, 0.35)
    # height above the sea: damp band, tide line, weed and barnacles below it
    if o.get('growth', False):
        tide = M(nt, 'ADD', o.get('tide', 0.95), M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n1, 0.5), 0.35))
        damp = M(nt, 'SUBTRACT', 1.0, mr(nt, M(nt, 'SUBTRACT', z, tide), -0.3, 0.05), True)
        line = M(nt, 'MULTIPLY', mr(nt, M(nt, 'SUBTRACT', z, tide), -0.05, 0.0), M(nt, 'SUBTRACT', 1.0, mr(nt, M(nt, 'SUBTRACT', z, tide), 0.0, 0.12), True))
        weedz = M(nt, 'SUBTRACT', 1.0, mr(nt, M(nt, 'ADD', z, M(nt, 'MULTIPLY', M(nt, 'SUBTRACT', n2, 0.5), 0.5)), 0.05, 0.6), True)
        weed = M(nt, 'MULTIPLY', weedz, mr(nt, M(nt, 'ADD', n2, M(nt, 'MULTIPLY', n3, 0.4)), 0.45, 0.75))
        barn = M(nt, 'MULTIPLY', mr(nt, voronoi(nt, P, 38.0), 0.18, 0.05), M(nt, 'MULTIPLY', mr(nt, z, -0.6, 0.2), M(nt, 'SUBTRACT', 1.0, mr(nt, z, 0.4, 0.9), True)))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, base, (0.45, 0.44, 0.42), 1.0, 'MULTIPLY'), M(nt, 'MULTIPLY', damp, 0.85))
        base = d.mix_rgb(nt, base, (0.06, 0.055, 0.04), M(nt, 'MULTIPLY', line, 0.6))
        base = d.mix_rgb(nt, base, d.mix_rgb(nt, (0.025, 0.03, 0.012), (0.07, 0.065, 0.03), n3), M(nt, 'MULTIPLY', weed, 0.95))
        base = d.mix_rgb(nt, base, (0.42, 0.41, 0.38), M(nt, 'MULTIPLY', barn, 0.8))
        rough = M(nt, 'ADD', M(nt, 'MULTIPLY', rough, M(nt, 'SUBTRACT', 1.0, M(nt, 'MULTIPLY', damp, 0.6))), M(nt, 'MULTIPLY', damp, 0.2))
        bump_h = M(nt, 'ADD', bump_h, M(nt, 'ADD', M(nt, 'MULTIPLY', barn, 0.8), M(nt, 'MULTIPLY', weed, 0.25)))
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


def bake_group(name, parts, size, materials, lm_div=2, uvscale=None, ao_dist=2.5, sun_samples=24, ao_samples=48, color_samples=2):
    """parts: [(object, material builder(masks) -> material)], all baked into one atlas (UV0).
    Returns images {base, orm, lm, normal} (saved in the cache) and the objects."""
    objs = [o for o, _ in parts]
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
    em = en.new('ShaderNodeEmission'); el.new(d.edge_mask(emat.node_tree, 0.035, 8), em.inputs['Color'])
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
            rope.cyl((xw - side * 0.0, Y + 1.06, z), (xe, Y + 0.79, z), 0.022, seg=6)
            rope.cyl((xe + side * 0.24, Y + 0.55, z), (xb, LI['y'] - 0.35, z), 0.024, seg=6)
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


def build_gantry():
    out = {}
    g = Part('gantry_steel'); y0 = GY
    ytop = y0 + GH
    for x in (GX0, GX1):
        for z in (GZ0, GZ1):
            g.box(x - 0.85, x + 0.85, y0 + 0.18, y0 + 1.0, z - 1.3, z + 1.3)                  # end carriage
            g.box(x - 0.7, x + 0.7, y0 + 1.0, ytop - 0.6, z - 0.7, z + 0.7)                   # leg
            for k in range(4):                                                               # stiffener rings
                yy = y0 + 2.5 + k * 3.5; g.box(x - 0.74, x + 0.74, yy, yy + 0.06, z - 0.74, z + 0.74)
            inward = 1 if x == GX0 else -1
            g.prism([(x + inward * 0.7, ytop - 3.4), (x + inward * 0.7, ytop - 0.6), (x + inward * 3.4, ytop - 0.6)], z - 0.45, z + 0.45)   # knee
    for z in (GZ0, GZ1):
        g.box(GX0 - 1.2, GX1 + 1.2, ytop - 0.6, ytop + 1.3, z - 0.65, z + 0.65)                # portal girder
        for x in np.linspace(GX0 - 0.6, GX1 + 0.6, 9): g.box(x - 0.02, x + 0.02, ytop - 0.6, ytop + 1.3, z - 0.68, z + 0.68)   # web stiffeners
    for x in (GX0, GX1):
        g.box(x - 0.5, x + 0.5, ytop - 1.4, ytop - 0.6, GZ0 + 0.7, GZ1 - 0.7)                  # side beam
        g.cyl((x, y0 + 2.4, GZ0 + 0.7), (x, ytop - 1.6, GZ1 - 0.7), 0.3, seg=4, rot=math.pi / 4)
        g.cyl((x, y0 + 2.4, GZ1 - 0.7), (x, ytop - 1.6, GZ0 + 0.7), 0.3, seg=4, rot=math.pi / 4)
        g.box(x - 0.3, x + 0.3, y0 + 8.2, y0 + 8.7, GZ0 + 0.7, GZ1 - 0.7)                     # mid strut
    g.box(GX0, GX1, ytop - 0.5, ytop + 0.25, (GZ0 + GZ1) / 2 - 0.45, (GZ0 + GZ1) / 2 + 0.45)  # trolley beam
    # machinery house and the driver's cab on top
    mx, mz = (GX0 + GX1) / 2 - 1, (GZ0 + GZ1) / 2
    g.box(mx - 2.6, mx + 2.6, ytop + 1.3, ytop + 3.9, mz - 3.25, mz + 3.25)
    g.box(mx - 2.75, mx + 2.75, ytop + 3.9, ytop + 4.05, mz - 3.4, mz + 3.4)
    g.box(GX1 - 2.9, GX1 + 0.5, ytop + 1.3, ytop + 3.5, GZ0 - 0.6, GZ0 + 2.4)
    # hook blocks under the trolley beam
    for x in (mx - 2.5, mx + 2.5):
        for z in (GZ0 + 3, GZ1 - 3): g.box(x - 0.28, x + 0.28, SU['y'] + 4.6, SU['y'] + 5.5, z - 0.16, z + 0.16)
    out['gantry'] = g.obj(bevel=0.03, seg=2, angle=30)
    # rails under the end carriages, handrails on the girders, the access ladder, hoist ropes, festoon cable
    s = Part('gantry_dark')
    for x in (GX0, GX1):
        s.box(x - 0.045, x + 0.045, y0, y0 + 0.13, 8.0, 48.0)
        for z in (GZ0, GZ1):
            for dz in (-0.75, 0.75): s.cyl((x - 0.5, y0 + 0.34, z + dz), (x + 0.5, y0 + 0.34, z + dz), 0.3, seg=18)
    for x in (mx - 2.5, mx + 2.5):
        for z in (GZ0 + 3, GZ1 - 3):
            for dx in (-0.12, 0.12): s.cyl((x + dx, ytop - 0.5, z), (x + dx, SU['y'] + 5.5, z), 0.022, seg=6)
    out['dark'] = s.obj(bevel=0.0)
    hr = Part('gantry_rail')
    for z in (GZ0, GZ1):
        for dz in (-0.6, 0.6): railing(hr, [(GX0 - 1.1, z + dz), (GX1 + 1.1, z + dz)], ytop + 1.3, h=1.0, step=1.8, r=0.025)
    ladder(hr, GX1 + 0.7, GZ1 - 0.25, GZ1 + 0.25, y0 + 1.0, ytop + 1.3, off=-0.15)
    for yy in np.arange(y0 + 3.0, ytop + 1.2, 0.9): hr.torus((GX1 + 1.15, yy, GZ1), Vector((0, 1, 0)), 0.36, 0.015, 16, 4)
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
    mats = dict(
        deck=C('c_deck', scan=conc, tile=3.0, tone=(0.95, 0.94, 0.92), growth=False, streaks=0.3),
        beams=C('c_beams', scan=conc2, tile=2.4, tone=(1.05, 1.03, 1.0), growth=True, tide=0.95, streaks=0.7),
        kerb=St('s_kerb', scan=paint, paint=(0.62, 0.48, 0.07), rust=0.45, lumk=1.2, wear=0.7),
        piles=C('c_piles', scan=conc2, tile=2.0, tone=(1.0, 0.98, 0.95), growth=True, tide=1.0, streaks=0.6),
        fenders=lambda m: mat_surface('r_fender', 'rubber', m, scan=grain, growth=True, tide=0.9),
        galv=lambda m: mat_surface('s_galv', 'galv', m, scan=plate, rustscan=rust, rust=0.25, tile=1.2, growth=True, tide=0.8),
        black=St('s_bollard', scan=plate, paint=(0.03, 0.03, 0.03), rust=0.6, lumk=0.6, scanmix=0.3),
        winch=St('s_winch', scan=paint, paint=(0.11, 0.17, 0.22), rust=0.4, lumk=1.4),
        rope=lambda m: mat_surface('s_rope', 'rope', m, scan=grain),
        platform=St('s_platform', scan=plate, paint=(0.06, 0.065, 0.07), rust=0.75, growth=True, tide=1.2, lumk=0.8),
        blocks=St('s_blocks', scan=plate, paint=(0.09, 0.09, 0.09), rust=0.7, growth=False),
        timber=lambda m: mat_surface('t_blocks', 'timber', m, scan=wood, tile=1.6, tone=(0.75, 0.68, 0.6)),
        gantry=St('s_gantry', scan=paint, paint=(0.72, 0.5, 0.06), rust=0.35, lumk=1.1, wear=0.55, primer=(0.25, 0.1, 0.06)),
        dark=St('s_gdark', scan=plate, paint=(0.05, 0.05, 0.05), rust=0.6),
        rail=St('s_grail', scan=paint, paint=(0.68, 0.46, 0.05), rust=0.3, lumk=1.0),
        hull=lambda m: mat_surface('h_hull', 'hull', m, scan=plate, rustscan=rust, paint=(0.028, 0.03, 0.032), rust=0.22, lumk=0.5, scanmix=0.25, paintrough=0.62, wear=0.25, primer=(0.12, 0.12, 0.12), growth=True, tide=2.35),
        sail=lambda m: mat_surface('h_sail', 'hull', m, scan=plate, rustscan=rust, paint=(0.03, 0.032, 0.034), rust=0.18, lumk=0.5, scanmix=0.25, paintrough=0.6, wear=0.3, primer=(0.12, 0.12, 0.12)),
        stern=lambda m: mat_surface('h_stern', 'hull', m, scan=plate, rustscan=rust, paint=(0.04, 0.04, 0.042), rust=0.3, lumk=0.5, wear=0.4, primer=(0.35, 0.22, 0.12), growth=True, tide=2.35),
    )
    groups = [
        ('pier_conc', 4096, [(pier['deck'], mats['deck']), (pier['beams'], mats['beams']), (pier['piles'], mats['piles']), (pier['kerb'], mats['kerb']), (pier['fenders'], mats['fenders'])],
         {'pier_deck': 0.55}),
        ('pier_steel', 2048, [(steel['galv'], mats['galv']), (steel['black'], mats['black']), (steel['winch'], mats['winch']), (steel['rope'], mats['rope']),
                              (steel['platform'], mats['platform']), (steel['blocks'], mats['blocks']), (steel['timber'], mats['timber'])], None),
        ('gantry', 2048, [(gan['gantry'], mats['gantry']), (gan['dark'], mats['dark']), (gan['rail'], mats['rail'])], None),
        ('sub', 2048, [(sub['hull'], mats['hull']), (sub['sail'], mats['sail']), (sub['stern'], mats['stern'])], None),
    ]
    only = set(d.args()[1:])
    if 'dry' in only:        # geometry check: flat colours, no bakes
        cols = {'pier_conc': (0.5, 0.49, 0.47, 1), 'pier_steel': (0.25, 0.27, 0.3, 1), 'gantry': (0.75, 0.55, 0.05, 1), 'sub': (0.04, 0.04, 0.045, 1)}
        objs = []
        for name, size, parts, uvs in groups:
            m = d.gltf_material(name, base_color=cols[name], roughness=0.7)
            for o, _ in parts: d.set_material(o, m)
            objs.append(join([o for o, _ in parts], name))
            d.log(name, tris(objs[-1]), 'tris')
        export(d.out_path('corsair', 'port_pier.glb'), objs[:2]); export(d.out_path('corsair', 'port_gantry.glb'), objs[2:])
        return
    finals = {}
    for name, size, parts, uvs in groups:
        if only and name not in only: continue
        maps = bake_group(name, parts, size, None, uvscale=uvs)
        finals[name] = (maps, [o for o, _ in parts])
    for o in (sea, quay): o.hide_render = True
    exports = {'port_pier': ['pier_conc', 'pier_steel'], 'port_gantry': ['gantry', 'sub']}
    for fname, gnames in exports.items():
        objs = []
        for gn in gnames:
            if gn not in finals: continue
            maps, parts = finals[gn]
            mat = final_material(gn, maps, cast=True)
            for o in parts: d.set_material(o, mat)
            objs.append(join(parts, gn))
        if objs: export(d.out_path('corsair', f'{fname}.glb'), objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE, 'hero.blend'))


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


def build_shed(i, x, z, w, dd, h, damaged):
    """walls (plinth, cladding), gable roof with overhangs, gutters, downpipes, doors; returns parts by material"""
    p = {k: Part(f'shed{i}_{k}') for k in ('plinth', 'wall', 'roof', 'band', 'door', 'trim', 'void')}
    cut = 0.42 if damaged else 1.0
    wl = w * cut; xa, xb = x - w / 2, x - w / 2 + wl; za, zb = z - dd / 2, z + dd / 2
    rise = dd * 0.11; Yb = QY
    p['plinth'].box(xa - 0.05, xb + (0.05 if not damaged else 0), Yb, Yb + 1.1, za - 0.05, zb + 0.05)
    nd = 3 if i == 3 else 2
    dw = min(15, wl / nd * 0.62) if not damaged else min(15, w / 2 * 0.62); dh = h * 0.72
    doors = []
    for k in range(nd):
        dx = x - w / 2 + wl * (k + 0.5) / nd if not damaged else x - w / 2 + (w / 2) * (k + 0.5) / 2
        if dx + dw / 2 > xb - 1: continue
        doors.append(dx)
    # front wall (door side) split around the openings; the other three walls whole
    t = 0.12
    edges = [xa] + sum(([dx - dw / 2, dx + dw / 2] for dx in doors), []) + [xb]
    for k in range(0, len(edges), 2):
        if edges[k + 1] - edges[k] > 0.05: p['wall'].box(edges[k], edges[k + 1], Yb + 1.1, Yb + h, zb - t, zb)
    for dx in doors:
        p['wall'].box(dx - dw / 2, dx + dw / 2, Yb + dh + 0.6, Yb + h, zb - t, zb)
        p['door'].box(dx - dw / 2 + 0.05, dx + dw / 2 - 0.05, Yb, Yb + dh, zb - 0.45, zb - 0.35)          # shutter, recessed
        p['trim'].box(dx - dw / 2 - 0.25, dx + dw / 2 + 0.25, Yb + dh, Yb + dh + 0.6, zb - 0.1, zb + 0.35) # shutter box
        for sx in (dx - dw / 2 - 0.12, dx + dw / 2 + 0.12): p['trim'].box(sx - 0.12, sx + 0.12, Yb, Yb + dh, zb - 0.4, zb + 0.08)
        p['void'].box(dx - dw / 2, dx + dw / 2, Yb, Yb + dh + 0.6, zb - 0.36, zb - 0.1)                    # the dark reveal
    p['door'].box(xb - 3.4, xb - 2.4, Yb, Yb + 2.2, zb - 0.02, zb + 0.06)                                     # personnel door
    p['wall'].box(xa, xb, Yb + 1.1, Yb + h, za, za + t)
    p['wall'].box(xa, xa + t, Yb + 1.1, Yb + h, za, zb)
    if not damaged: p['wall'].box(xb - t, xb, Yb + 1.1, Yb + h, za, zb)
    # gable infills
    for gx in ([xa] if damaged else [xa, xb]):
        vs = [p['wall'].bm.verts.new(E(gx + s, Yb + h, za)) for s in (-t / 2, t / 2)] + [p['wall'].bm.verts.new(E(gx + s, Yb + h, zb)) for s in (t / 2, -t / 2)] + \
             [p['wall'].bm.verts.new(E(gx + s, Yb + h + rise, z)) for s in (-t / 2, t / 2)]
        bm = p['wall'].bm
        bm.faces.new((vs[0], vs[3], vs[4])); bm.faces.new((vs[1], vs[5], vs[2])); bm.faces.new((vs[0], vs[4], vs[5], vs[1])); bm.faces.new((vs[3], vs[2], vs[5], vs[4]))
    # roof: two slabs with overhang, ridge cap, gutters and downpipes
    ov = 0.7; rx0, rx1 = xa - ov, xb + (0 if damaged else ov)
    for sgn in (-1, 1):
        zr0, zr1 = z + sgn * (dd / 2 + ov), z
        y0, y1 = Yb + h - ov * rise / (dd / 2), Yb + h + rise
        bm = p['roof'].bm
        a = [bm.verts.new(E(xx, yy, zz)) for xx, yy, zz in ((rx0, y0, zr0), (rx1, y0, zr0), (rx1, y1, zr1), (rx0, y1, zr1))]
        b = [bm.verts.new(E(xx, yy + 0.16, zz)) for xx, yy, zz in ((rx0, y0, zr0), (rx1, y0, zr0), (rx1, y1, zr1), (rx0, y1, zr1))]
        bm.faces.new(a[::-1] if sgn > 0 else a); bm.faces.new(b if sgn > 0 else b[::-1])
        for k in range(4):
            j = (k + 1) % 4; bm.faces.new((a[k], a[j], b[j], b[k]))
        p['trim'].cyl((rx0, y0 - 0.05, zr0 + sgn * 0.05), (rx1, y0 - 0.05, zr0 + sgn * 0.05), 0.12, seg=10)
        for dxp in np.linspace(xa + 0.6, xb - 0.6, max(2, int(wl / 15) + 1)):
            p['trim'].cyl((dxp, y0 - 0.1, zr0 + sgn * 0.05), (dxp, Yb + 0.15, z + sgn * (dd / 2 + 0.12)), 0.055, seg=8)
    p['trim'].box(rx0, rx1, Yb + h + rise + 0.1, Yb + h + rise + 0.32, z - 0.3, z + 0.3)
    if i in (0, 1):
        p['band'].box(xa - 0.05, xb + (0 if damaged else 0.05), Yb + h * 0.8, Yb + h, za - 0.06, zb + 0.06)
    out = {k: v for k, v in p.items()}
    if damaged:
        hx = xb
        fr = Part(f'shed{i}_frame'); deb = Part(f'shed{i}_debris'); sheet = Part(f'shed{i}_sheet')
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
        out['frame'] = fr; out['debris'] = deb; out['sheet'] = sheet
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
    for fn in ('port_pier', 'port_gantry'):
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
        (yard['quay_top'].obj(bevel=0.03), C('q_top', scan=S_conc, tile=4.0, tone=(1.0, 0.98, 0.95), streaks=0.2)),
        (yard['quay_wall'].obj(bevel=0.04), C('q_wall', scan=S_wall, tile=2.6, growth=True, tide=1.0, streaks=0.8)),
        (yard['quay_fenders'].obj(bevel=0.05, seg=2), lambda m: mat_surface('q_fender', 'rubber', m, scan=S_grain, growth=True, tide=0.9)),
        (yard['quay_bollards'].obj(bevel=0.01), St('q_bollard', scan=S_plate, paint=(0.03, 0.03, 0.03), rust=0.6, lumk=0.6, scanmix=0.3)),
        (yard['quay_ladders'].obj(), G('q_ladder', rust=0.4, growth=True, tide=0.8)),
        (yard['lamps'].obj(smooth=50), G('q_lamps', rust=0.2)),
        (yard['beacon'].obj(bevel=0.01), C('b_plinth', scan=S_wall, tile=2.0)),
        (yard['lanterns'][0].obj(), St('b_red', scan=S_paint, paint=(0.42, 0.05, 0.03), rust=0.4)),
        (yard['lanterns'][1].obj(), St('b_green', scan=S_paint, paint=(0.05, 0.25, 0.1), rust=0.4)),
    ], {'quay_top': 0.35, 'quay_wall': 1.6}))
    # sheds
    sp = []
    for i, (x, z, w, dd, h, wc, rc, bc, nd, dmg) in enumerate(SHEDS):
        s = sheds[i]
        sp += [(s['plinth'].obj(bevel=0.02), C(f'sh{i}_plinth', scan=S_wall, tile=2.5, streaks=0.6)),
               (s['wall'].obj(bevel=0.0), St(f'sh{i}_wall', scan=S_clad, tile=2.0, paint=wc, rust=0.22, lumk=0.9, scanmix=0.55, wear=0.2, bump=0.9, bumpdist=0.04)),
               (s['roof'].obj(bevel=0.0), St(f'sh{i}_roof', scan=S_clad, tile=2.0, paint=rc, rust=0.32, lumk=0.9, scanmix=0.55, wear=0.2, bump=0.9, bumpdist=0.04)),
               (s['door'].obj(bevel=0.01), St(f'sh{i}_door', scan=S_shut, tile=2.0, paint=tuple(c * 0.85 for c in rc), rust=0.3, lumk=1.0, scanmix=0.6)),
               (s['trim'].obj(bevel=0.01), G(f'sh{i}_trim', rust=0.35)),
               (s['void'].obj(), lambda m: mat_surface('void', 'glass', m, scan=S_grain))]
        if bc: sp.append((s['band'].obj(), St(f'sh{i}_band', scan=S_clad, tile=2.0, paint=bc, rust=0.25, lumk=0.8, scanmix=0.5, bump=0.9, bumpdist=0.04)))
        if dmg:
            sp += [(s['frame'].obj(), St(f'sh{i}_frame', scan=S_plate, paint=(0.08, 0.07, 0.065), rust=0.8)),
                   (s['debris'].obj(smooth=30), C(f'sh{i}_debris', scan=S_debris, tile=3.0, tone=(0.8, 0.78, 0.75))),
                   (s['sheet'].obj(), St(f'sh{i}_sheet', scan=S_clad, tile=2.0, paint=rc, rust=0.6, lumk=0.9, scanmix=0.5))]
    groups.append(('sheds', 4096, sp, None))
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
    groups.append(('town', 2048, [(yard['town_walls'].obj(), C('town_wall', scan=S_plast, tile=4.0, tone=(1.0, 0.93, 0.82), streaks=0.6)),
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
    groups.append(('ground', 4096, [(near, ground)], None))
    only = set(d.args()[1:])
    if 'dry' in only:
        objs = []
        for name, size, parts, uvs in groups:
            m = d.gltf_material(name, base_color=(0.5, 0.48, 0.45, 1), roughness=0.8)
            for o, _ in parts: d.set_material(o, m)
            sep = {}
            for o, _ in parts:
                if o.get('export'): sep.setdefault(o['export'], []).append(o)
            for en, lst in sep.items(): objs.append(join(lst, en))
            objs.append(join([o for o, _ in parts if not o.get('export')], name)); d.log(name, tris(objs[-1]), 'tris')
        export(d.out_path('corsair', 'port_yard.glb'), objs)
        return
    finals = []
    for name, size, parts, uvs in groups:
        if only and name not in only: continue
        maps = bake_group(name, parts, size, None, uvscale=uvs)
        mat = final_material(name, maps)
        objs = [o for o, _ in parts]
        for o in objs: d.set_material(o, mat)
        # objects that move in the film (craft, buoys riding the swell) stay separate, the rest is one mesh
        sep = {}
        for o in objs:
            if o.get('export'): sep.setdefault(o['export'], []).append(o)
        for en, lst in sep.items(): finals.append(join(lst, en))
        rest = [o for o in objs if not o.get('export')]
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
    finals += far
    export(d.out_path('corsair', 'port_yard.glb'), finals)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE, 'yard.blend'))


STAGES = {'rocklib': stage_rocklib, 'rocks': stage_rocks, 'hero': stage_hero, 'yard': stage_yard, 'pack': stage_pack}

if __name__ == '__main__':
    todo = d.args() or ['rocklib']
    for s in todo:
        if s not in STAGES: continue      # options for a stage (e.g. 'dry', a group name)
        t0 = time.time()
        STAGES[s]()
        d.log(f'stage {s} done in {time.time() - t0:.0f}s')
