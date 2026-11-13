"""boatkit: mesh-building and texture-weathering helpers shared by corsair.py and ship.py.

Everything here builds meshes straight from coordinates (grids, sweeps, lathes) with metric UVs laid out by
arc length, so a later `average + pack` gives one uniform texel density per atlas, and then finishes baked
maps with numpy (wet bands, salt, streaks under fittings) from baked position / normal / occlusion maps.
Blender axes: +X bow, +Y port, +Z up, metres.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import dowlib as d


# ---------------------------------------------------------------- small maths
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def pchip(xs, ys):
    """Monotone cubic through (xs, ys); returns f(x)."""
    xs, ys = list(xs), list(ys)
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    dl = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if dl[i - 1] * dl[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
    m[0], m[-1] = dl[0], dl[-1]

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while x > xs[i + 1]:
            i += 1
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1]
                + (t3 - t2) * h[i] * m[i + 1])
    return f


# ---------------------------------------------------------------- mesh objects
def new_obj(name, verts, faces, uvs=None, kind=None, atlas=None):
    """Mesh object from vertices and faces. uvs: per-vertex (u, v) in metres (copied to every loop)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    uvl = me.uv_layers.new(name='UVMap')
    if uvs is not None:
        idx = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', idx)
        uvl.data.foreach_set('uv', np.asarray(uvs, np.float32)[idx].ravel())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if kind:
        ob['kind'] = kind
    if atlas:
        ob['atlas'] = atlas
    ob['has_uv'] = uvs is not None
    return ob


def grid(name, P, closed=False, flip=False, caps=False, kind=None, atlas=None, uv_scale=1.0, cuts=None):
    """Quad grid from P[i][j] (rows i along the sweep, columns j across). closed: last column joins the first.
    caps: close both ends with n-gons (for swept closed profiles). UVs: u = length along rows, v = across.
    cuts: row indices at which the UV island is cut (long strips pack badly: cut them where a seam hides)."""
    P = np.asarray(P, np.float64)
    n, m = P.shape[:2]
    verts = P.reshape(-1, 3)
    du = np.zeros((n, m))
    du[1:] = np.linalg.norm(P[1:] - P[:-1], axis=2)
    u = np.cumsum(du, axis=0)
    dv = np.zeros((n, m))
    dv[:, 1:] = np.linalg.norm(P[:, 1:] - P[:, :-1], axis=2)
    v = np.cumsum(dv, axis=1)
    faces = []
    mm = m if closed else m - 1
    for i in range(n - 1):
        for j in range(mm):
            a, b = i * m + j, i * m + (j + 1) % m
            c, e = (i + 1) * m + (j + 1) % m, (i + 1) * m + j
            faces.append((a, e, c, b) if flip else (a, b, c, e))
    if caps:
        r0, r1 = list(range(m)), [(n - 1) * m + j for j in range(m)]
        faces.append(tuple(r0 if flip else reversed(r0)))
        faces.append(tuple(reversed(r1) if flip else r1))
    uvs = np.stack([u.ravel(), v.ravel()], axis=1) * uv_scale
    ob = new_obj(name, verts, faces, uvs, kind, atlas)
    me = ob.data
    uvl = me.uv_layers.active.data
    if closed:   # the seam column needs its own v: rewrite loops of the wrap-around faces
        girth = v[:, -1] + np.linalg.norm(P[:, 0] - P[:, -1], axis=1)
        for poly in me.polygons:
            vs = list(poly.vertices)
            if len(vs) != 4:
                continue
            cols = [vi % m for vi in vs]
            if 0 in cols and (m - 1) in cols and m > 2:
                for li, vi in zip(poly.loop_indices, vs):
                    if vi % m == 0:
                        uvl[li].uv = (u[vi // m, 0] * uv_scale, girth[vi // m] * uv_scale)
    if cuts:     # move each stretch of rows to its own island
        uv = np.empty(len(me.loops) * 2, np.float32)
        uvl.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        nq = (n - 1) * mm
        seg = np.searchsorted(np.asarray(sorted(cuts)), np.arange(nq) // mm, side='right')
        uv[:nq * 4, 0] += np.repeat(seg, 4) * 200.0
        uvl.foreach_set('uv', uv.ravel())
    if caps:     # end caps: planar UVs of their own (off to the side; packing separates the islands)
        for k, poly in enumerate(list(me.polygons)[-2:]):
            ring = P[0] if k == 0 else P[-1]
            c = ring.mean(axis=0)
            e1 = ring[0] - c
            e1 /= max(np.linalg.norm(e1), 1e-12)
            nrm = np.cross(ring[1] - c, e1)
            e2 = np.cross(nrm / max(np.linalg.norm(nrm), 1e-12), e1)
            for li, vi in zip(poly.loop_indices, poly.vertices):
                q = verts[vi] - c
                uvl[li].uv = ((float(np.dot(q, e1)) + 1000.0 + k) * uv_scale, float(np.dot(q, e2)) * uv_scale)
    return ob


def mirrored(ob, name=None):
    """A copy of ob mirrored across the centre plane (y -> -y), faces flipped, UVs kept (a separate island)."""
    me = ob.data.copy()
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    co[:, 1] *= -1
    me.vertices.foreach_set('co', co.ravel())
    me.flip_normals()
    if me.uv_layers:   # its own islands, wound the same way as the original's
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        uv[:, 0] += 5000.0
        uv[:, 1] *= -1
        me.uv_layers.active.data.foreach_set('uv', uv.ravel())
    me.update()
    o2 = bpy.data.objects.new(name or ob.name + '_s', me)
    bpy.context.scene.collection.objects.link(o2)
    for k in ('kind', 'atlas', 'has_uv'):
        if k in ob:
            o2[k] = ob[k]
    return o2


def join(objs, name):
    objs = [o for o in objs if o is not None]
    d.select(objs, objs[0])
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def weld(ob, dist=0.0004, recalc=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist * 0.5)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def finish(ob, sharp_deg=60.0, weighted=True):
    """Smooth shading, hard edges above sharp_deg, face-area weighted normals (so chamfer strips read as rounds)."""
    d.smooth(ob, sharp_deg)
    if weighted:
        d.weighted_normals(ob)
    return ob


def xform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Bake a transform into the mesh (rot = XYZ Euler radians)."""
    from mathutils import Euler
    M = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1.0))
    ob.data.transform(M)
    ob.data.update()
    return ob


def aim(ob, a, b, axis='Z'):
    """Rotate/translate a mesh built along +Z (from the origin) so its axis runs from a towards b."""
    a, b = Vector(a), Vector(b)
    q = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    ob.data.transform(Matrix.Translation(a) @ q.to_matrix().to_4x4())
    ob.data.update()
    return ob


# ---------------------------------------------------------------- sweeps
def _frames(path):
    """Parallel-transport frames along a polyline: tangents, normals, binormals."""
    path = np.asarray(path, np.float64)
    n = len(path)
    T = np.zeros((n, 3))
    T[1:-1] = path[2:] - path[:-2]
    T[0], T[-1] = path[1] - path[0], path[-1] - path[-2]
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    up = np.array([0, 0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0, 0])
    N = np.zeros((n, 3))
    v = np.cross(T[0], np.cross(up, T[0]))
    N[0] = v / np.linalg.norm(v)
    for i in range(1, n):
        v = N[i - 1] - T[i] * np.dot(N[i - 1], T[i])
        N[i] = v / max(np.linalg.norm(v), 1e-12)
    B = np.cross(T, N)
    return T, N, B


def fillet_path(pts, r, seg=5):
    """Round the corners of a polyline with arcs of radius r."""
    pts = [np.asarray(p, np.float64) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        u, v = a - b, c - b
        lu, lv = np.linalg.norm(u), np.linalg.norm(v)
        u, v = u / lu, v / lv
        ang = math.acos(clamp(float(np.dot(u, v)), -1, 1))
        if ang > math.pi - 1e-3 or r <= 0:
            out.append(b)
            continue
        t = min(r / math.tan(ang / 2), lu * 0.48, lv * 0.48)
        p0, p1 = b + u * t, b + v * t
        for k in range(seg + 1):       # quadratic Bezier through the corner: close enough to an arc
            s = k / seg
            out.append((1 - s) ** 2 * p0 + 2 * s * (1 - s) * b + s * s * p1)
    out.append(pts[-1])
    return np.array(out)


def tube(name, pts, r, n=12, fillet=0.0, caps=True, kind=None, atlas=None, taper=None):
    """Round tube along a polyline (optionally with filleted corners). taper: end radius (linear)."""
    path = fillet_path(pts, fillet) if fillet > 0 and len(pts) > 2 else np.asarray(pts, np.float64)
    T, N, B = _frames(path)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(path[1:] - path[:-1], axis=1))])
    P = np.zeros((len(path), n, 3))
    for i in range(len(path)):
        rr = r if taper is None else lerp(r, taper, L[i] / max(L[-1], 1e-9))
        for j in range(n):
            a = 2 * math.pi * j / n
            P[i, j] = path[i] + rr * (math.cos(a) * N[i] + math.sin(a) * B[i])
    return grid(name, P, closed=True, caps=caps, kind=kind, atlas=atlas)


def sweep(name, path, out, up, profile, closed=True, caps=True, flip=False, kind=None, atlas=None, cuts=None):
    """Sweep a 2D profile [(o, u)] along path with explicit per-point frame vectors `out` and `up`."""
    path, out, up = (np.asarray(a, np.float64) for a in (path, out, up))
    prof = np.asarray(profile, np.float64)
    P = path[:, None, :] + out[:, None, :] * prof[None, :, 0:1] + up[:, None, :] * prof[None, :, 1:2]
    return grid(name, P, closed=closed, caps=caps and closed, flip=flip, kind=kind, atlas=atlas, cuts=cuts)


def lathe(name, profile, n=32, kind=None, atlas=None, cap_top=True, cap_bottom=True):
    """Surface of revolution about +Z from profile [(r, z)] running bottom to top."""
    prof = np.asarray(profile, np.float64)
    P = np.zeros((len(prof), n, 3))
    for i, (r, z) in enumerate(prof):
        for j in range(n):
            a = 2 * math.pi * j / n
            P[i, j] = (r * math.cos(a), r * math.sin(a), z)
    ob = grid(name, P, closed=True, caps=False, kind=kind, atlas=atlas)
    me = ob.data
    extra = []
    if cap_bottom and prof[0][0] > 1e-6:
        extra.append(list(reversed(range(n))))
    if cap_top and prof[-1][0] > 1e-6:
        extra.append([(len(prof) - 1) * n + j for j in range(n)])
    if extra:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        uv = bm.loops.layers.uv.active
        for f in extra:
            face = bm.faces.new([bm.verts[i] for i in f])
            for lp in face.loops:
                lp[uv].uv = (lp.vert.co.x + 100.0, lp.vert.co.y)
        bm.to_mesh(me)
        bm.free()
    return ob


def box(name, size, loc=(0, 0, 0), bevel=0.0, seg=2, kind=None, atlas=None, rot=(0, 0, 0)):
    """Box (optionally bevelled) centred at loc. UVs come later from a smart projection."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=seg, profile=0.5, affect='EDGES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if kind:
        ob['kind'] = kind
    if atlas:
        ob['atlas'] = atlas
    ob['has_uv'] = False
    xform(ob, loc, rot)
    return ob


def rrect(x0, x1, y0, y1, r, seg=5):
    """Rounded rectangle outline (counter-clockwise from above) as [(x, y)]."""
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def inset2d(pts, dist):
    """Inset a convex-ish closed 2D outline by dist (towards its centroid side)."""
    p = np.asarray(pts, np.float64)
    nxt, prv = np.roll(p, -1, axis=0), np.roll(p, 1, axis=0)
    t = nxt - prv
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)       # left of travel = inside for counter-clockwise outlines
    return p + nrm * dist


def slab(name, outline, zfun, thick, chamfer=0.003, inset=0.0, kinds=('deck', 'deck'), atlas=None):
    """A lid lying on a surface: outline [(x, y)] counter-clockwise, bottom on z = zfun(x, y), `thick` proud, with a
    chamfered top edge. inset > 0 adds an inner top panel (second kind, e.g. non-skid). Returns [objects]."""
    o0 = np.asarray(outline, np.float64)
    o1 = inset2d(o0, chamfer)
    rings = [(o0, -0.004), (o0, thick - chamfer), (o1, thick)]
    if inset > 0:
        rings.append((inset2d(o0, inset), thick))
    P = np.array([[(x, y, zfun(x, y) + dz) for x, y in ring] for ring, dz in rings])
    P = np.transpose(P, (1, 0, 2))                      # rows around the outline, columns up the rings
    P = np.concatenate([P, P[:1]], axis=0)
    side = grid(name, P, kind=kinds[0], atlas=atlas, flip=True)
    last = rings[-1][0]
    top_pts = [(x, y, zfun(x, y) + thick) for x, y in last]
    top = new_obj(name + '_top', top_pts, [list(range(len(top_pts)))], [(x, y) for x, y, _ in top_pts], kinds[1], atlas)
    return [side, top]


def bolt(name, pos, normal=(0, 0, 1), r=0.006, h=0.0035, n=10, kind='steel', atlas=None):
    """Pan-head fastener sitting on a surface at pos."""
    ob = lathe(name, [(r, -0.001), (r, h * 0.55), (r * 0.72, h), (r * 0.3, h * 1.04)], n=n, kind=kind, atlas=atlas)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    top = [v for v in bm.verts if v.co.z > h]
    uv = bm.loops.layers.uv.active
    f = bm.faces.new(sorted(top, key=lambda v: -math.atan2(v.co.y, v.co.x)))
    for lp in f.loops:
        lp[uv].uv = (lp.vert.co.x + 50.0, lp.vert.co.y)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return aim(ob, pos, Vector(pos) + Vector(normal))


# ---------------------------------------------------------------- UV atlases
def smart_uv_missing(objs):
    """Smart-project the objects that were not given metric UVs at creation."""
    for o in objs:
        if not o.get('has_uv', False):
            if not o.data.uv_layers:
                o.data.uv_layers.new(name='UVMap')
            d.smart_uv(o, 66, 0.01)
            o['has_uv'] = True


def atlas_pack(ob, margin=0.004, weights=None):
    """Give every island of ob the same texel density (optionally weighted per material-slot name), then pack.
    Returns metres per UV unit."""
    d.select([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    if weights:
        me = ob.data
        uvl = me.uv_layers.active.data
        names = [s.material.name if s.material else '' for s in ob.material_slots]
        for poly in me.polygons:
            w = weights.get(names[poly.material_index] if names else '', 1.0)
            if w != 1.0:
                for li in poly.loop_indices:
                    uvl[li].uv = uvl[li].uv * w
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    return d.texel_density(ob, 1.0)


# ---------------------------------------------------------------- extra bakes (float maps for the numpy pass)
def float_image(name, size):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def bake_emit(objs, img, build, samples=1, margin=8):
    """Bake an emission built per material by build(nt) -> colour socket (temporarily replaces the surface)."""
    saved = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or any(m is s[0] for s in saved):
                continue
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
            before = set(nt.nodes)
            em = nt.nodes.new('ShaderNodeEmission')
            sock = build(nt, m)
            if isinstance(sock, (tuple, list)):
                em.inputs['Color'].default_value = tuple(sock)
            else:
                nt.links.new(sock, em.inputs['Color'])
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            saved.append((m, nt, out, old, [n for n in nt.nodes if n not in before]))
    try:
        d.bake(objs, 'EMIT', img, samples=samples, margin=margin)
    finally:
        for m, nt, out, old, added in saved:
            for n in added:
                nt.nodes.remove(n)
            if old is not None:
                nt.links.new(old, out.inputs['Surface'])
    return img


def bake_position(objs, img):
    def build(nt, m):
        g = nt.nodes.new('ShaderNodeNewGeometry')
        return g.outputs['Position']
    return bake_emit(objs, img, build)


def bake_gnormal(objs, img):
    def build(nt, m):
        g = nt.nodes.new('ShaderNodeNewGeometry')
        return g.outputs['Normal']
    return bake_emit(objs, img, build)


def bake_id(objs, img, colors):
    """Per-material constant colour (colors: {material name: (r, g, b)}) for masks in the numpy pass."""
    return bake_emit(objs, img, lambda nt, m: (*colors.get(m.name, (0, 0, 0)), 1.0))


# ---------------------------------------------------------------- numpy noise and image helpers
def _hash3(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + iz.astype(np.int64) * 2147483647
         + seed * 1274126177) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float32) / np.float32(0xFFFFFF)


def vnoise(P, scale, seed=0):
    """Value noise in 0..1 at points P (..., 3), feature size 1/scale metres. scale may be a 3-vector."""
    q = P * np.asarray(scale, np.float32)
    i = np.floor(q)
    f = (q - i).astype(np.float32)
    f = f * f * (3 - 2 * f)
    ix, iy, iz = (i[..., k].astype(np.int64) for k in range(3))
    out = np.zeros(P.shape[:-1], np.float32)
    for dx in (0, 1):
        wx = f[..., 0] if dx else 1 - f[..., 0]
        for dy in (0, 1):
            wy = f[..., 1] if dy else 1 - f[..., 1]
            for dz in (0, 1):
                wz = f[..., 2] if dz else 1 - f[..., 2]
                out += wx * wy * wz * _hash3(ix + dx, iy + dy, iz + dz, seed)
    return out


def fbm(P, scale, octaves=4, seed=0, gain=0.5, lac=2.03):
    """Fractal value noise, roughly 0..1."""
    out = np.zeros(P.shape[:-1], np.float32)
    amp, tot = 1.0, 0.0
    sc = np.asarray(scale, np.float32) * np.ones(3, np.float32)
    for o in range(octaves):
        out += amp * vnoise(P, sc, seed + o * 17)
        tot += amp
        amp *= gain
        sc = sc * lac
    return out / tot


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb_to_lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(np.asarray(c, np.float32), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def save_webp(arr, path, quality=90, lossless=False):
    """Save an (h, w, 3|4) float array (rows bottom-up, as Blender stores them) as WebP."""
    from PIL import Image
    a = (np.clip(arr[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(a).save(path, 'WEBP', quality=quality, lossless=lossless, method=6)
    return path
