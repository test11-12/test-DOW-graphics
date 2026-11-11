"""acpaint: build and paint hard-surface vehicles (aircraft, missiles) for the films.

The approach, used by fury.py and amraam.py:
1. Geometry is generated in the engine's body frame (+x forward, +y up, +z starboard, metres) with the
   small kit below (lofts, wings, lathes, rods, plates) and converted to Blender's frame on the way in.
   Every part carries a part id (`pid`, a face attribute) that the painter keys on.
2. Blender unwraps and packs the parts, then bakes, per texture set, what the painter needs: the body-frame
   position and normal of every texel, its part id and ambient occlusion.
3. The livery is drawn with Pillow in orthographic views in metres (side elevation, plan), exactly where the
   reference photographs show it, and projected onto the texels by position. Panel breaks, fasteners and
   sealant are height / mask layers handled the same way; the tangent-space normal map is derived from the
   height layer in UV space.
4. Base colour, ORM and normal maps are written as images and wired into glTF materials (dowlib).
"""
import math
import os
import tarfile

import bmesh
import bpy
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import dowlib as d

Image.MAX_IMAGE_PIXELS = None


# ---------------------------------------------------------------- fonts (Saira, OFL, from the fontsource package)
def font(weight=700, italic=False, size=100):
    base = os.path.join(d.CACHE, 'fonts', 'saira')
    f = os.path.join(base, 'package', 'files', f"saira-latin-{weight}-{'italic' if italic else 'normal'}.woff")
    if not os.path.exists(f):
        tgz = d._fetch('https://registry.npmjs.org/@fontsource/saira/-/saira-5.3.0.tgz', os.path.join(d.CACHE, 'fonts', 'saira-5.3.0.tgz'))
        with tarfile.open(tgz) as t:
            t.extractall(base)
    return ImageFont.truetype(f, size)


# ---------------------------------------------------------------- small numeric helpers
def pchip(xs, ys):
    """Monotone cubic interpolant through (xs, ys); callable on floats or arrays."""
    xs = np.asarray(xs, float); ys = np.asarray(ys, float); n = len(xs)
    h = np.diff(xs); dl = np.diff(ys) / h; m = np.zeros(n)
    if n == 2:
        m[:] = dl[0]
    else:
        for i in range(1, n - 1):
            if dl[i - 1] * dl[i] > 0:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
        m[0], m[-1] = dl[0], dl[-1]

    def f(x):
        x = np.clip(np.asarray(x, float), xs[0], xs[-1])
        i = np.clip(np.searchsorted(xs, x, side='right') - 1, 0, n - 2)
        t = (x - xs[i]) / h[i]; t2 = t * t; t3 = t2 * t
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
    return f


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- geometry kit (engine body frame)
class Mesh:
    """Triangle / quad soup with per-corner UVs in metres."""

    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def grid(self, P, UV=None, flip=None):
        """Quad grid through P[nu, nv, 3]. UV[nu, nv, 2] in metres (or None: unwrapped later).
        flip None: orient the shell outwards from its own centroid."""
        P = np.asarray(P, float); nu, nv = P.shape[:2]; base = len(self.v)
        self.v.extend(map(tuple, P.reshape(-1, 3)))
        quads = []
        for i in range(nu - 1):
            for j in range(nv - 1):
                quads.append((i * nv + j, (i + 1) * nv + j, (i + 1) * nv + j + 1, i * nv + j + 1))
        if flip is None:
            c = P.reshape(-1, 3).mean(0); acc = 0.0
            for q in quads[::max(1, len(quads) // 400)]:
                a, b, cc, dd = (P.reshape(-1, 3)[k] for k in q)
                acc += np.dot(np.cross(cc - a, dd - b), (a + b + cc + dd) / 4 - c)
            flip = acc < 0
        uvf = None if UV is None else np.asarray(UV, float).reshape(-1, 2)
        for q in quads:
            q = q[::-1] if flip else q
            self.f.append(tuple(base + k for k in q))
            self.uv.append(None if uvf is None else [tuple(uvf[k]) for k in q])
        return self

    def poly(self, pts, uvs=None, out=None):
        """One n-gon through pts; `out` is a direction its normal should face."""
        pts = [tuple(map(float, p)) for p in pts]; base = len(self.v); idx = list(range(len(pts)))
        if out is not None:
            p = np.asarray(pts); n = np.zeros(3)
            for i in range(len(p)):
                a, b = p[i], p[(i + 1) % len(p)]
                n += np.cross(a, b)
            if np.dot(n, out) < 0:
                idx = idx[::-1]
        self.v.extend(pts)
        self.f.append(tuple(base + k for k in idx))
        self.uv.append(None if uvs is None else [tuple(uvs[k]) for k in idx])
        return self

    def add(self, o):
        base = len(self.v); self.v.extend(o.v)
        self.f.extend(tuple(base + k for k in f) for f in o.f); self.uv.extend(o.uv)
        return self

    def flipped(self):
        """Reverse every face (for the inside of ducts and bays)."""
        self.f = [f[::-1] for f in self.f]
        self.uv = [(u[::-1] if u is not None else u) for u in self.uv]
        return self

    def moved(self, dx=0.0, dy=0.0, dz=0.0, mirror_z=False):
        m = Mesh()
        m.v = [(x + dx, y + dy, (-z if mirror_z else z) + dz) for x, y, z in self.v]
        m.f = [f[::-1] for f in self.f] if mirror_z else list(self.f)
        m.uv = [(u[::-1] if (mirror_z and u is not None) else u) for u in self.uv]
        return m


def ring_loft(rings, closed=True, caps=(False, False)):
    """Faceted loft through rings of points (same count each)."""
    R = np.asarray(rings, float)
    if closed:
        R = np.concatenate([R, R[:, :1]], 1)
    m = Mesh().grid(R)
    c = R.reshape(-1, 3).mean(0)
    if caps[0]:
        m.poly(rings[0], out=np.mean(rings[0], 0) - c)
    if caps[1]:
        m.poly(rings[-1], out=np.mean(rings[-1], 0) - c)
    return m


def rod(a, b, r, seg=12, r2=None, caps=True):
    """Cylinder / cone frustum from a to b."""
    a = np.asarray(a, float); b = np.asarray(b, float); r2 = r if r2 is None else r2
    ax = b - a; L = np.linalg.norm(ax); ax = ax / L
    ref = np.array([0, 1, 0]) if abs(ax[1]) < 0.9 else np.array([1, 0, 0])
    u = np.cross(ax, ref); u /= np.linalg.norm(u); w = np.cross(ax, u)
    th = np.linspace(0, 2 * np.pi, seg + 1)[:-1]
    c = np.cos(th)[:, None] * u + np.sin(th)[:, None] * w
    return ring_loft([a + c * r, b + c * r2], caps=(caps, caps))


def lathe(profile, origin, axis, seg=32, ref=None):
    """Surface of revolution. profile: [(radius, distance along axis)]."""
    o = np.asarray(origin, float); ax = np.asarray(axis, float); ax = ax / np.linalg.norm(ax)
    if ref is None:
        ref = np.array([0, 1, 0]) if abs(ax[1]) < 0.9 else np.array([1, 0, 0])
    u = np.cross(ax, ref); u /= np.linalg.norm(u); w = np.cross(ax, u)
    th = np.linspace(0, 2 * np.pi, seg + 1)
    P = np.array([[o + ax * h + (np.cos(t) * u + np.sin(t) * w) * r for t in th] for r, h in profile])
    return Mesh().grid(P)


def box(c, size, rot=None):
    """Box centred at c; rot: 3x3 matrix applied about the centre."""
    c = np.asarray(c, float); hx, hy, hz = np.asarray(size, float) / 2
    P = np.array([[sx * hx, sy * hy, sz * hz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
    if rot is not None:
        P = P @ np.asarray(rot, float).T
    P = P + c; m = Mesh()
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        m.poly([P[k] for k in q], out=np.mean([P[k] for k in q], 0) - c)
    return m


def plate(outline, nrm, th):
    """Slab through a planar outline, thickness th along nrm (centred)."""
    o = np.asarray(outline, float); n = np.asarray(nrm, float); n = n / np.linalg.norm(n)
    a, b = o + n * th / 2, o - n * th / 2
    m = ring_loft([a, b])
    m.poly(a, out=n); m.poly(b, out=-n)
    return m


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def naca(c, t):
    return 5 * t * (0.2969 * np.sqrt(c) - 0.1260 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4)


def lens(c, t):
    return 2 * t * c * (1 - c) + 0.5 * t * 0.12 * np.sqrt(np.maximum(c * (1 - c), 0))


def wing(sections, nC=28, nSpan=10, profile='naca', x0=0.0, cap=True, uv=True, edge=0.0):
    """Wing / fin half spanning +z. sections: [{z, le, te, y, t}] root to tip; le / te are body-x (le > te),
    t = thickness / chord. UVs: arc length along the surface from the leading edge (u, offset by the
    leading edge's distance aft of x0) against span (v); upper and lower are separate islands.
    edge: half-thickness (m) of a blunt trailing edge."""
    prof = lens if profile == 'lens' else naca
    rows = []
    for k in range(len(sections) - 1):
        a, b = sections[k], sections[k + 1]
        for mm in range(0 if k == 0 else 1, nSpan + 1):
            f = mm / nSpan
            rows.append({q: a.get(q, 0.0) + (b.get(q, 0.0) - a.get(q, 0.0)) * f for q in ('z', 'le', 'te', 'y', 't')})
    c = 0.5 * (1 - np.cos(np.pi * np.arange(nC + 1) / nC))
    U = np.zeros((len(rows), nC + 1, 3)); Lo = np.zeros_like(U); UVu = np.zeros((len(rows), nC + 1, 2)); UVl = np.zeros_like(UVu)
    for i, r in enumerate(rows):
        ch = r['le'] - r['te']; yt = prof(c, r['t']) * ch + edge * c
        x = r['le'] - c * ch
        U[i, :, 0] = x; U[i, :, 1] = r['y'] + yt; U[i, :, 2] = r['z']
        Lo[i, :, 0] = x; Lo[i, :, 1] = r['y'] - yt; Lo[i, :, 2] = r['z']
        arc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(x), np.diff(yt)))])
        UVu[i, :, 0] = (x0 - r['le']) + arc; UVu[i, :, 1] = r['z']
        UVl[i, :, 0] = (x0 - r['le']) + arc; UVl[i, :, 1] = -r['z']
    m = Mesh()
    m.grid(U, UVu if uv else None, flip=True); m.grid(Lo, UVl if uv else None, flip=False)
    if cap:
        T = np.stack([U[-1], Lo[-1]], 0)
        tu = np.stack([np.stack([UVu[-1, :, 0], U[-1, :, 1] + 100.0], 1), np.stack([UVu[-1, :, 0], Lo[-1, :, 1] + 100.0], 1)], 0)
        m.grid(T, tu if uv else None, flip=True)
    if edge > 0:
        T = np.stack([U[:, -1], Lo[:, -1]], 1)
        tu = np.stack([np.stack([U[:, -1, 1] + 200.0, U[:, -1, 2]], 1), np.stack([Lo[:, -1, 1] + 200.0, U[:, -1, 2]], 1)], 1)
        m.grid(T, tu if uv else None, flip=True)
    m.rows = rows
    return m


def to_object(mesh, name, pid, smooth=35.0, bevel=None, weld=1e-5, swap=None):
    """Blender object from a Mesh (engine frame -> Blender: X = x, Y = -z, Z = y). bevel: (width, segments).
    Parts without UVs are smart-projected; all UVs end up in metres. swap: optional engine-frame transform."""
    V = np.asarray(mesh.v, float)
    if swap is not None:
        V = swap(V)
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, -z, y) for x, y, z in V], [], mesh.f)
    me.update()
    has_uv = all(u is not None for u in mesh.uv) and len(mesh.uv) > 0
    uvl = me.uv_layers.new(name='UVMap')
    if has_uv:
        flat = np.array([c for f in mesh.uv for c in f], np.float32).ravel()
        uvl.data.foreach_set('uv', flat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(me)
    if weld:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    bm.to_mesh(me); bm.free()
    if bevel:
        d.bevel(ob, bevel[0], segments=bevel[1], angle_deg=bevel[2] if len(bevel) > 2 else 30.0)
    if smooth is not None:
        d.smooth(ob, smooth)
    else:
        me.shade_flat()
    if not has_uv:
        d.smart_uv(ob, 62.0, 0.01)
        k = d.texel_density(ob, 1)      # metres per UV unit
        n = len(me.uv_layers.active.data); a = np.empty(n * 2, np.float32)
        me.uv_layers.active.data.foreach_get('uv', a); me.uv_layers.active.data.foreach_set('uv', a * k)
    at = me.attributes.new('pid', 'FLOAT', 'FACE')
    at.data.foreach_set('value', np.full(len(me.polygons), float(pid), np.float32))
    return ob


def scale_uv(ob, k):
    """Give a part k times the texel density of the rest (before packing)."""
    uv = ob.data.uv_layers.active.data; a = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get('uv', a); uv.foreach_set('uv', a * k)
    ob['uvk'] = ob.get('uvk', 1.0) * k


def join(objs, name):
    d.select(objs, objs[0])
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    bm = bmesh.new(); bm.from_mesh(ob.data)        # n-gons (caps, bevels) would leave the exporter without tangents
    ng = [f for f in bm.faces if len(f.verts) > 4]
    if ng:
        bmesh.ops.triangulate(bm, faces=ng)
    bm.to_mesh(ob.data); bm.free()
    return ob


def mirrored_copy(ob, name):
    """Copy of ob mirrored across the centre plane (engine z -> -z), UVs shared with the original."""
    me = ob.data.copy(); me.name = name
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        v.co.y = -v.co.y
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    c = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(c)
    return c


def pack(objs, margin=0.003):
    """Pack the UV islands of objs into one 0..1 square, quarter-turn rotations only, relative scale kept."""
    d.select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', scale=True, merge_overlap=False, margin_method='FRACTION',
                            margin=margin, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')


# ---------------------------------------------------------------- baking what the painter needs
def _bake_material():
    mat = bpy.data.materials.get('acpaint_bake')
    if mat:
        return mat
    mat, bsdf, nodes, links = d.new_material('acpaint_bake')
    nt = mat.node_tree
    geo = nodes.new('ShaderNodeNewGeometry')
    att = nodes.new('ShaderNodeAttribute'); att.attribute_name = 'pid'
    em = nodes.new('ShaderNodeEmission'); em.name = 'EM'
    mp = nodes.new('ShaderNodeVectorMath'); mp.operation = 'MULTIPLY_ADD'; mp.name = 'POS'
    mp.inputs[1].default_value = (1 / 32, 1 / 32, 1 / 32); mp.inputs[2].default_value = (0.5, 0.5, 0.5)
    links.new(geo.outputs['Position'], mp.inputs[0])
    mn = nodes.new('ShaderNodeVectorMath'); mn.operation = 'MULTIPLY_ADD'; mn.name = 'NRM'
    mn.inputs[1].default_value = (0.5, 0.5, 0.5); mn.inputs[2].default_value = (0.5, 0.5, 0.5)
    links.new(geo.outputs['Normal'], mn.inputs[0])
    mi = nodes.new('ShaderNodeMath'); mi.operation = 'DIVIDE'; mi.name = 'PID'; mi.inputs[1].default_value = 255.0
    links.new(att.outputs['Fac'], mi.inputs[0])
    out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def _float_image(name, size):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def bake_maps(objs, size, tag, out_dir, ao_size=None, ao_samples=32, ao_distance=1.2):
    """Bake body-frame position, normal, part id and ambient occlusion of objs (one shared UV layout) and save
    them as <tag>_maps.npz: P, N float16/32 (h, w, 3) in the engine frame, ID uint8, AO uint8. Rows bottom-up."""
    mat = _bake_material(); nt = mat.node_tree; em = nt.nodes['EM']
    for o in objs:
        d.set_material(o, mat)
    res = {}
    for key, node in (('P', 'POS'), ('N', 'NRM'), ('ID', 'PID')):
        for l in list(em.inputs['Color'].links):
            nt.links.remove(l)
        nt.links.new(nt.nodes[node].outputs[0], em.inputs['Color'])
        img = _float_image(f'{tag}_{key}', size)
        d.bake(objs, 'EMIT', img, samples=1, margin=8)
        a = d.pixels(img)[..., :3].copy()
        bpy.data.images.remove(img)
        if key == 'P':
            a = (a - 0.5) * 32.0
            a = np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)          # Blender -> engine frame
        elif key == 'N':
            a = a * 2.0 - 1.0
            a = np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)
            a /= np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-6)
        else:
            a = np.rint(a[..., 0] * 255.0).astype(np.uint8)
        res[key] = a
    w = d.ensure_world((1, 1, 1)); w.light_settings.distance = ao_distance
    s = ao_size or size // 2
    aoi = d.new_image(f'{tag}_ao', s, non_color=True, color=(1, 1, 1, 1))
    d.bake(objs, 'AO', aoi, samples=ao_samples, margin=8)
    d.blur(aoi, 1.0)
    ao = d.pixels(aoi)[..., 0]
    if s != size:
        ao = np.asarray(Image.fromarray((ao * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC), np.float32) / 255.0
    res['AO'] = (np.clip(ao, 0, 1) * 255).astype(np.uint8)
    bpy.data.images.remove(aoi)
    np.savez(os.path.join(out_dir, f'{tag}_maps.npz'), P=res['P'].astype(np.float32), N=res['N'].astype(np.float16), ID=res['ID'], AO=res['AO'])
    d.log('maps', tag, size)
    return res


def load_maps(tag, out_dir):
    z = np.load(os.path.join(out_dir, f'{tag}_maps.npz'))
    return {'P': z['P'], 'N': z['N'].astype(np.float32), 'ID': z['ID'], 'AO': z['AO'].astype(np.float32) / 255.0}


# ---------------------------------------------------------------- drawing in metres
class Canvas:
    """A greyscale layer over a rectangle of some orthographic view, drawn supersampled in metres.
    x runs right, y runs up. flip_x mirrors the view (for the side seen from the other flank); text then
    still reads left to right."""

    def __init__(self, x0, x1, y0, y1, ppm, ss=2, fill=0, flip_x=False):
        self.x0, self.x1, self.y0, self.y1, self.ppm, self.ss, self.flip = x0, x1, y0, y1, ppm, ss, flip_x
        self.w, self.h = int(round((x1 - x0) * ppm)), int(round((y1 - y0) * ppm))
        self.img = Image.new('L', (self.w * ss, self.h * ss), fill)
        self.d = ImageDraw.Draw(self.img)
        self.k = ppm * ss

    def X(self, x):
        return ((self.x1 - x) if self.flip else (x - self.x0)) * self.k

    def Y(self, y):
        return (self.y1 - y) * self.k

    def pts(self, pts):
        return [(self.X(x), self.Y(y)) for x, y in pts]

    def poly(self, pts, v=255):
        self.d.polygon(self.pts(pts), fill=v)

    def line(self, pts, width, v=255, closed=False):
        p = self.pts(pts)
        if closed:
            p = p + [p[0]]
        wpx = max(1, int(round(width * self.k)))
        self.d.line(p, fill=v, width=wpx, joint='curve')

    def dot(self, x, y, r, v=255):
        cx, cy, rr = self.X(x), self.Y(y), max(0.6, r * self.k)
        self.d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=v)

    def ring(self, x, y, r, width, v=255):
        cx, cy, rr = self.X(x), self.Y(y), r * self.k
        self.d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=v, width=max(1, int(round(width * self.k))))

    def dots(self, a, b, pitch, r, v=255, ends=True):
        """Fastener row from a to b at about `pitch` metres."""
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(round(L / pitch)))
        for i in range(0 if ends else 1, n + (1 if ends else 0)):
            t = i / n
            self.dot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r, v)

    def rect(self, x0, y0, x1, y1, v=255):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], v)

    def rrect(self, x0, y0, x1, y1, rad, width, v=255):
        """Rounded-rectangle outline (an access panel)."""
        xa, xb = sorted((self.X(x0), self.X(x1))); ya, yb = sorted((self.Y(y0), self.Y(y1)))
        self.d.rounded_rectangle([xa, ya, xb, yb], radius=rad * self.k, outline=v, width=max(1, int(round(width * self.k))))

    def text(self, s, x, y, cap, fnt, v=255, anchor='ls', stretch=1.0, tracking=0.0, slant=0.0):
        """Text with its anchor at (x, y) in view coordinates, cap height `cap` metres, drawn upright in the
        view whatever the flip. fnt: (weight, italic). Returns the advance width in metres."""
        px = cap * self.k / 0.70          # Saira cap height is about 0.70 em
        f = font(fnt[0], fnt[1], max(4, int(round(px))))
        if tracking:
            wtot = sum(f.getlength(ch) for ch in s) + tracking * px * (len(s) - 1)
        else:
            wtot = f.getlength(s)
        asc, desc = f.getmetrics(); pad = int(px * 0.4)
        tmp = Image.new('L', (int(wtot) + 2 * pad, asc + desc + 2 * pad), 0); td = ImageDraw.Draw(tmp)
        if tracking:
            cx = pad
            for ch in s:
                td.text((cx, pad), ch, font=f, fill=255); cx += f.getlength(ch) + tracking * px
        else:
            td.text((pad, pad), s, font=f, fill=255)
        if slant:
            tmp = tmp.transform(tmp.size, Image.AFFINE, (1, slant, -slant * (pad + asc), 0, 1, 0), Image.BICUBIC)
        if stretch != 1.0:
            tmp = tmp.resize((max(1, int(tmp.size[0] * stretch)), tmp.size[1]), Image.LANCZOS)
        wpx = wtot * stretch; padx = pad * stretch
        ax = {'l': 0.0, 'm': 0.5, 'r': 1.0}[anchor[0]] * wpx + padx
        ay = pad + (asc if anchor[1] == 's' else asc - px * 0.35)       # baseline or mid cap height
        ox, oy = int(round(self.X(x) - ax)), int(round(self.Y(y) - ay))
        self.img.paste(v, (ox, oy), tmp)
        self.d = ImageDraw.Draw(self.img)
        return wpx / self.k

    def blur(self, radius_m):
        from PIL import ImageFilter
        self.img = self.img.filter(ImageFilter.GaussianBlur(radius_m * self.k)); self.d = ImageDraw.Draw(self.img)

    def array(self):
        """The layer as float32 0..1, rows top-down, after box-filtering the supersampling away; flipped
        views are returned un-flipped so every layer of a view indexes the same way."""
        im = self.img.reduce(self.ss) if self.ss > 1 else self.img
        a = np.asarray(im, np.float32) / 255.0
        return a[:, ::-1] if self.flip else a

    def sampler(self):
        """The layer as a bilinear lookup; kept as bytes (large views in float would cost gigabytes)."""
        im = self.img.reduce(self.ss) if self.ss > 1 else self.img
        a = np.asarray(im, np.uint8)
        return Sampler(np.ascontiguousarray(a[:, ::-1] if self.flip else a), self.x0, self.y1, self.ppm)


class Sampler:
    """Bilinear lookup of a canvas layer at view coordinates (metres)."""

    def __init__(self, arr, x0, y1, ppm):
        self.a, self.x0, self.y1, self.ppm = arr, x0, y1, ppm

    def __call__(self, x, y):
        a = self.a; h, w = a.shape
        fx = np.clip((x - self.x0) * self.ppm - 0.5, 0, w - 1.001); fy = np.clip((self.y1 - y) * self.ppm - 0.5, 0, h - 1.001)
        ix = fx.astype(np.int32); iy = fy.astype(np.int32); tx = (fx - ix).astype(np.float32); ty = (fy - iy).astype(np.float32)
        k = np.float32(1 / 255.0) if a.dtype == np.uint8 else np.float32(1.0)
        top = a[iy, ix] * (1 - tx) + a[iy, ix + 1] * tx
        bot = a[iy + 1, ix] * (1 - tx) + a[iy + 1, ix + 1] * tx
        return ((top * (1 - ty) + bot * ty) * k).astype(np.float32)


# ---------------------------------------------------------------- procedural variation
def _hash3(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + iz.astype(np.int64) * 2147483647 + seed * 1274126177) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF).astype(np.float32) / 65535.0


def noise3(P, scale, seed=1, octaves=1, gain=0.5):
    """Value noise of body-frame positions P[..., 3], roughly -1..1; scale = feature size in metres."""
    out = np.zeros(P.shape[:-1], np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        q = P / (scale / (2 ** o)) + 37.0 * (o + 1)
        i = np.floor(q).astype(np.int32); f = (q - i).astype(np.float32); f = f * f * (3 - 2 * f)
        acc = 0.0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    wgt = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                    acc = acc + wgt * _hash3(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed + o)
        out += amp * (acc * 2 - 1); tot += amp; amp *= gain
    return out / tot


class Triplanar:
    """A tiling greyscale photoscan map sampled by body-frame position, blended over the three axis
    projections by the surface normal. tile: metres per repeat."""

    def __init__(self, path, tile=1.0, size=1024):
        im = Image.open(path).convert('L')
        if im.size[0] != size:
            im = im.resize((size, size), Image.LANCZOS)
        self.a = np.asarray(im, np.float32) / 255.0
        self.mean = float(self.a.mean()); self.tile = tile

    def _at(self, u, v):
        n = self.a.shape[0]
        fx = (u / self.tile) % 1.0 * n; fy = (v / self.tile) % 1.0 * n
        ix = fx.astype(np.int32) % n; iy = fy.astype(np.int32) % n; tx = fx - np.floor(fx); ty = fy - np.floor(fy)
        ix1 = (ix + 1) % n; iy1 = (iy + 1) % n; a = self.a
        return (a[iy, ix] * (1 - tx) + a[iy, ix1] * tx) * (1 - ty) + (a[iy1, ix] * (1 - tx) + a[iy1, ix1] * tx) * ty

    def __call__(self, P, N):
        """Deviation from the map's mean, about -0.5..0.5."""
        w = np.abs(N) ** 4; w = w / np.maximum(w.sum(-1, keepdims=True), 1e-6)
        x, y, z = P[..., 0], P[..., 1], P[..., 2]
        return (w[..., 0] * self._at(z, y) + w[..., 1] * self._at(x, z) + w[..., 2] * self._at(x, y) - self.mean).astype(np.float32)


def cell_tint(coords, edges, seed):
    """A random value (-1..1) per cell of a rectilinear partition: coords = [array, ...], edges = [sorted
    breaks, ...]. Gives each panel its own slight tone."""
    idx = np.zeros(coords[0].shape, np.int64)
    for c, e in zip(coords, edges):
        idx = idx * 131 + np.searchsorted(np.asarray(e, np.float32), c)
    h = (idx * 2654435761 + seed * 40503) & 0xFFFFFFFF
    h = ((h ^ (h >> 15)) * 2246822519) & 0xFFFFFFFF
    return ((h ^ (h >> 13)) & 0xFFFF).astype(np.float32) / 32767.5 - 1.0


def groove(dist, half_width):
    """0..1 profile of a groove from the distance to its centre line."""
    return np.clip(1.0 - dist / half_width, 0.0, 1.0)


# ---------------------------------------------------------------- maps out
def normal_from_height(H, texel_m, ID=None):
    """Tangent-space normal map (OpenGL, +Y up) from a height field in UV space. H: metres, rows bottom-up;
    texel_m: metres per texel. Differences are not taken across part boundaries."""
    dx = np.zeros_like(H); dy = np.zeros_like(H)
    dx[:, 1:-1] = (H[:, 2:] - H[:, :-2]) * 0.5; dy[1:-1, :] = (H[2:, :] - H[:-2, :]) * 0.5
    if ID is not None:
        mx = np.zeros(H.shape, bool); my = np.zeros(H.shape, bool)
        mx[:, 1:-1] = (ID[:, 2:] != ID[:, :-2]); my[1:-1, :] = (ID[2:, :] != ID[:-2, :])
        dx[mx] = 0; dy[my] = 0
    n = np.stack([-dx / texel_m, -dy / texel_m, np.ones_like(H)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def srgb(c):
    """sRGB 0..255 triple -> linear float array."""
    c = np.asarray(c, np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def save_maps(name, out_dir, base_lin, rough, metal, ao, normal, emissive=None, orm_size=None):
    """Write <name>_base.png (sRGB), _orm.png, _normal.png (and _emissive.png) from bottom-up float arrays and
    return them as Blender images."""
    def put(arr, suffix, non_color, size=None):
        a8 = (np.clip(arr.astype(np.float32), 0, 1) * 255.0 + 0.5).astype(np.uint8)[::-1]
        p = os.path.join(out_dir, f'{name}_{suffix}.png')
        im = Image.fromarray(a8, 'RGB')
        if size and size != im.size[0]:
            im = im.resize((size, size), Image.LANCZOS)
        im.save(p, compress_level=1)
        img = d.image(p, non_color); img.reload()
        return img
    res = {'base': put(to_srgb(base_lin.astype(np.float32)), 'base', False),
           'orm': put(np.stack([ao, rough, metal], -1), 'orm', True, orm_size),
           'normal': put(normal, 'normal', True)}
    if emissive is not None:
        res['emissive'] = put(to_srgb(emissive.astype(np.float32)), 'emissive', False)
    return res


def in_strips(fn, M, *args, rows=1024):
    """Run a painter fn(M, *args) -> tuple of (h, w[, c]) arrays over horizontal strips of the maps (one row of
    overlap, for the normal map's differences) and stitch the results: a 4K set would otherwise need several
    gigabytes of temporaries."""
    h = M['ID'].shape[0]; out = None
    for r0 in range(0, h, rows):
        a, b = max(r0 - 1, 0), min(r0 + rows + 1, h); n = min(rows, h - r0)
        res = fn({k: v[a:b] for k, v in M.items()}, *args)
        if out is None:
            out = [np.empty((h,) + r.shape[1:], np.float16) for r in res]
        for o, r in zip(out, res):
            o[r0:r0 + n] = r[r0 - a:r0 - a + n]
        del res
    return out


def texel_size(ob, size):
    """Metres per texel of ob's layout at a texture of `size` pixels, not counting its own density factor."""
    return d.texel_density(ob, size) * ob.get('uvk', 1.0)
