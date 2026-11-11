"""Hermeus Quarterhorse Mk 2.1 (N21QH): geometry for films/blender/quarterhorse.py.

Measured from Hermeus photography: the 4K side view (171.5 px/m against the 14.6 m lip-to-nozzle length used by the
film) for the fuselage profile, fin, boom, gear and markings, and the overhead view for the planform.
Blender frame: +X forward (nose), +Z up, +Y port. After glTF export that is the film's body frame (+x forward, +y up,
+z starboard). Station s = metres aft of the inlet lip; X = X0 - s. The nozzle axis is at z = NOZ_Z (the film hangs
its plume there); the tyres stand on z = GROUND.

Every surface gets a metric UV layout (metres, with a per-part texel-density factor) so the painter can work in
surface coordinates; the packer then fits each texture set into 0..1.
"""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix

from qh_shape import *  # noqa: F401,F403  (stations, planform, constants)



# ------------------------------------------------------------------ mesh helpers
def link(ob, coll):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def mesh_object(name, verts, faces, coll=None, smooth=True, uv_loops=None):
    """Object from a vertex array (n,3) and faces; uv_loops: optional (n_loops, 2) UVs in face-corner order."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    if uv_loops is not None:
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', np.asarray(uv_loops, np.float32).ravel())
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    return ob


def grid_faces(nu, nv, close_v=False):
    """Quads of a (nu x nv) vertex grid (index i*nv + j); close_v wraps j."""
    f = []
    jm = nv if close_v else nv - 1
    for i in range(nu - 1):
        for j in range(jm):
            j1 = (j + 1) % nv
            f.append((i * nv + j, (i + 1) * nv + j, (i + 1) * nv + j1, i * nv + j1))
    return f


def wrapped_uv(F, nv, ufun, vfun):
    """Per-loop UVs for a closed grid (index i*nv + j): the wrap face gets column nv instead of 0."""
    uv = []
    for f in F:
        js = [vi % nv for vi in f]
        wrap = (nv - 1) in js and 0 in js
        for vi in f:
            i, j = divmod(vi, nv)
            if wrap and j == 0:
                j = nv
            uv.append((ufun(i, j), vfun(i, j)))
    return np.array(uv)


def clean(ob, dist=1e-6):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def recalc_normals(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def flip_all(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def orient_radial(ob, axis_y, axis_z, outward=True):
    """Make a (possibly open) tube's faces point away from (or toward) the X axis through (axis_y, axis_z), as a
    whole: decide from the area-weighted majority so the surface stays consistently oriented."""
    recalc_normals(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    vote = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        vote += f.normal.dot(Vector((0, c.y - axis_y, c.z - axis_z))) * f.calc_area()
    if (vote > 0) != outward:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def tag(ob, pid, faces=None):
    """Per-face part id (float attribute 'pid') that the painter reads back from a baked id map."""
    me = ob.data
    at = me.attributes.get('pid') or me.attributes.new('pid', 'FLOAT', 'FACE')
    vals = np.zeros(len(me.polygons), np.float32)
    at.data.foreach_get('value', vals)
    if faces is None:
        vals[:] = pid
    else:
        vals[np.asarray(faces, int)] = pid
    at.data.foreach_set('value', vals)
    return ob


def face_probe(ob, point, direction):
    """Flip the whole (consistently oriented) surface if the face nearest `point` does not face `direction`."""
    recalc_normals(ob)
    me = ob.data
    best, bd = None, 1e9
    P = Vector(point)
    for f in me.polygons:
        d = (f.center - P).length
        if d < bd:
            bd, best = d, f
    if best is not None and best.normal.dot(Vector(direction)) < 0:
        flip_all(ob)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    select_only(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob


def apply_xform(ob):
    select_only([ob])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def sharp_edges(ob, deg=40):
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(deg))


def local_lathe(name, prof, seg=64, coll=None, rfun=None, facing='radial_out'):
    """Surface of revolution about the local X axis. prof: [(x, r), ...]. UV: (profile arc, r_mean * theta).
    facing: 'radial_out' | 'radial_in' | '+x' | '-x' | None (keep the closed-solid orientation from recalc)."""
    prof = np.asarray(prof, float)
    th = np.arange(seg) / seg * 2 * math.pi
    rows = []
    for x, r in prof:
        rr = r if rfun is None else rfun(th, x, r)
        rows.append(np.stack([np.full(seg, x), rr * np.cos(th), rr * np.sin(th)], 1))
    V = np.concatenate(rows)
    F = grid_faces(len(prof), seg, close_v=True)
    arc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(prof[:, 0]), np.diff(prof[:, 1])))])
    rm = max(float(prof[:, 1].mean()), 1e-3)
    uv = wrapped_uv(F, seg, lambda i, j: arc[i], lambda i, j: j / seg * 2 * math.pi * rm)
    ob = mesh_object(name, V, F, coll, True, uv_loops=uv)
    clean(ob)
    face_toward(ob, facing)
    return ob


def face_toward(ob, facing, axis_y=0.0, axis_z=0.0):
    """Orient all faces consistently, then flip the whole surface so it faces `facing` (area-weighted vote)."""
    recalc_normals(ob)
    if facing is None:
        return
    bm = bmesh.new(); bm.from_mesh(ob.data)
    vote = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        if facing in ('radial_out', 'radial_in'):
            d = Vector((0, c.y - axis_y, c.z - axis_z))
            v = f.normal.dot(d.normalized() if d.length > 1e-9 else d)
            vote += v * f.calc_area() * (1 if facing == 'radial_out' else -1)
        else:
            vote += f.normal.x * f.calc_area() * (1 if facing == '+x' else -1)
    if vote < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def lathe(name, prof, seg=64, axis_z=NOZ_Z, coll=None, rfun=None, facing='radial_out'):
    """Surface of revolution about the aircraft X axis at height axis_z. prof: [(s station, r), ...].
    For 'x' facings use '+x' = forward, '-x' = aft."""
    ob = local_lathe(name, [(-s, r) for s, r in prof], seg, coll, (None if rfun is None else (lambda th, x, r: rfun(th, -x, r))), facing)
    ob.matrix_world = Matrix.Translation((X0, 0, axis_z))
    apply_xform(ob)
    return ob


def orient(ob, c, axis):
    q = Vector((1, 0, 0)).rotation_difference(Vector(axis).normalized())
    ob.matrix_world = Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4()
    apply_xform(ob)


def tube(name, p0, p1, r0, r1=None, seg=24, coll=None, caps=True, bevel=0.0):
    """Cylinder / cone from p0 to p1; caps with a rounded edge of radius `bevel`."""
    r1 = r0 if r1 is None else r1
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    b = min(bevel, 0.45 * min(r0, r1), 0.45 * L)
    prof = []
    if caps:
        prof.append((0.0, 0.0))
    if caps and b > 0:
        prof += [(b - b * math.cos(k / 4 * math.pi / 2), r0 - b + b * math.sin(k / 4 * math.pi / 2)) for k in range(5)]
        prof += [(L - b + b * math.sin(k / 4 * math.pi / 2), r1 - b + b * math.cos(k / 4 * math.pi / 2)) for k in range(5)]
    else:
        prof += [(0.0, r0), (L, r1)]
    if caps:
        prof.append((L, 0.0))
    ob = local_lathe(name, prof, seg, coll, facing=None if caps else 'radial_out')
    orient(ob, p0, p1 - p0)
    if not (caps and b > 0):
        sharp_edges(ob, 40)
    return ob


def box(name, center, size, coll=None, bevel=0.0, segments=2, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); link(ob, coll)
    if bevel > 0:
        m = ob.modifiers.new('bv', 'BEVEL'); m.width = min(bevel, 0.45 * min(size)); m.segments = segments; m.limit_method = 'NONE'
        select_only([ob])
        bpy.ops.object.modifier_apply(modifier=m.name)
    M = Matrix.Translation(Vector(center))
    if rot is not None:
        M = M @ rot
    ob.matrix_world = M
    apply_xform(ob)
    sharp_edges(ob, 50)
    return ob


def bar(name, p0, p1, w, h, up=(0, 0, 1), coll=None, bevel=0.004):
    """Rectangular bar from p0 to p1, width w, height h along `up` (projected perpendicular to the bar)."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    d = (p1 - p0).normalized()
    upv = Vector(up)
    if abs(upv.normalized().dot(d)) > 0.98:
        upv = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    side = upv.cross(d).normalized()
    upv = d.cross(side).normalized()
    R = Matrix((d, side, upv)).transposed().to_4x4()
    ob = box(name, (0, 0, 0), (L, w, h), coll, bevel=bevel)
    ob.matrix_world = Matrix.Translation((p0 + p1) / 2) @ R
    apply_xform(ob)
    return ob


# ------------------------------------------------------------------ fuselage
def build_fuselage(coll, N=FUS_N):
    S = fus_stations()
    nS = len(S)
    R, girth = fus_ring(S, N)
    V = np.zeros((nS, N, 3))
    V[:, :, 0] = X(S)[:, None]
    V[:, :, 1] = R[:, :, 0]
    V[:, :, 2] = R[:, :, 1]
    # open tail: a short inward return shows a skin thickness against the nozzle shroud
    zc_end = float(fus_params([FUS_S1])[0][0])
    inner = V[-1].copy()
    inner[:, 1] *= 0.976; inner[:, 2] = zc_end + (inner[:, 2] - zc_end) * 0.976
    inner[:, 0] += 0.004
    Vall = np.concatenate([V.reshape(-1, 3), inner])
    F = grid_faces(nS + 1, N, close_v=True)
    uv = []
    for f in F:
        i0, j0 = divmod(f[0], N)
        smid = S[min(i0, nS - 1)] + 1e-4
        pc = len(FUS_PIECES) - 1
        for k, (a, b, _) in enumerate(FUS_PIECES):
            if smid < b:
                pc = k; break
        dens = FUS_PIECES[pc][2]
        half = 0 if j0 < N // 2 else 1
        for vi in f:
            i, j = divmod(vi, N)
            i = min(i, nS - 1)
            if half == 1 and j == 0:
                j = N
            a = j / N * girth[i] if half == 0 else (N - j) / N * girth[i]
            uv.append((S[i] * dens + pc * 30.0, a * dens + half * 8.0))
    ob = mesh_object('fuselage', Vall, F, coll, True, uv_loops=np.array(uv))
    recalc_normals(ob)
    return ob


def build_inlet(coll, N=FUS_N):
    """Rolled inlet lip running into the dark duct, and a compressor face deep inside."""
    s_ref = FUS_S0
    zc, hw, ht, hb, nt, nb = [float(a[0]) for a in fus_params([s_ref])]
    rho = 0.024
    prof = [(s_ref - rho * math.sin(k / 12 * math.pi), rho * (1 - math.cos(k / 12 * math.pi))) for k in range(13)]
    prof += [(0.09, 2 * rho + 0.004), (0.4, 2 * rho + 0.016), (1.0, 2 * rho + 0.03), (2.0, 2 * rho + 0.05), (2.75, 2 * rho + 0.06)]
    # the lip ring at s_ref must match the fuselage's first station ring exactly
    R0, g0 = fus_ring([s_ref], N)
    rows = []
    for s, dd in prof:
        y = R0[0, :, 0] * (hw - dd) / hw
        z = zc + (R0[0, :, 1] - zc) * np.where(R0[0, :, 1] < zc, (hb - dd) / hb, (ht - dd) / ht)
        rows.append(np.stack([np.full(N, X0 - s), y, z], 1))
    V = np.concatenate(rows)
    F = grid_faces(len(prof), N, close_v=True)
    arc = np.concatenate([[0], np.cumsum(np.abs(np.diff([p[0] for p in prof])) + np.abs(np.diff([p[1] for p in prof])))])
    uv = wrapped_uv(F, N, lambda i, j: arc[i], lambda i, j: j / N * g0[0])
    ob = mesh_object('inlet', V, F, coll, True, uv_loops=uv)
    recalc_normals(ob)
    # the outer lip (first rows) must face outward
    bm = bmesh.new(); bm.from_mesh(ob.data)
    vote = 0.0
    for f in bm.faces[:N]:
        c = f.calc_center_median()
        vote += f.normal.dot(Vector((0, c.y, c.z - zc)))
    if vote < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    # compressor face: hub, spinner, 24 twisted blades
    parts = [lathe('fan_disc', [(2.745, 0.0), (2.745, 0.38)], seg=48, axis_z=zc, coll=coll, facing='+x'),
             lathe('fan_spinner', [(2.50, 0.0), (2.55, 0.06), (2.64, 0.11), (2.72, 0.13), (2.73, 0.0)], seg=32, axis_z=zc, coll=coll, facing=None)]
    for k in range(24):
        a = k / 24 * 2 * math.pi
        b = bar(f'fan_blade{k}', (X(2.70), 0.125 * math.cos(a), zc + 0.125 * math.sin(a)), (X(2.70), 0.375 * math.cos(a), zc + 0.375 * math.sin(a)), 0.055, 0.005, up=(1, 0, 0), coll=coll, bevel=0.0015)
        c0 = Vector((X(2.70), 0.25 * math.cos(a), zc + 0.25 * math.sin(a)))
        b.matrix_world = Matrix.Translation(c0) @ Matrix.Rotation(math.radians(40), 4, Vector((0, math.cos(a), math.sin(a)))) @ Matrix.Translation(-c0)
        apply_xform(b)
        parts.append(b)
    fan = join(parts, 'fan')
    return ob, fan


# ------------------------------------------------------------------ wing
def build_wing(coll, side=1):
    """side=+1 port (y>0), -1 starboard. Main wing with the elevon cut-out (blunt hinge face), rounded tip."""
    K = 46
    ys = np.round(np.concatenate([np.linspace(0.5, 0.98, 7), np.linspace(0.98, 1.65, 8), np.linspace(1.65, 4.29, 24), np.linspace(4.29, 4.42, 4)]), 5)
    ys = sorted(set(ys.tolist()))
    loops, ycoord = [], []
    for y in ys:
        def cut(yy):
            c = float(wing_te(yy) - wing_le(yy))
            return 1 - (float(elevon_chord(yy)) + HINGE_GAP * 0.5) / c
        if abs(y - 0.98) < 1e-6:
            loops += [wing_loop(y, K), wing_loop(y, K, cut(y))]
        elif abs(y - 4.29) < 1e-6:
            loops += [wing_loop(y, K, cut(y)), wing_loop(y, K)]
        else:
            loops.append(wing_loop(y, K, cut(y) if 0.98 < y < 4.29 else None))
    # rounded tip: two squashed loops just outboard of the last station
    for dy, sq in ((0.006, 0.55), (0.011, 0.12)):
        lp = wing_loop(TIP_Y, K)
        zc = wing_camber_z(X0 - lp[:, 0], TIP_Y)
        lp[:, 2] = zc + (lp[:, 2] - zc) * sq
        lp[:, 1] = TIP_Y + dy
        loops.append(lp)
    L = len(loops[0]); nS = len(loops)
    V = np.concatenate(loops)
    F = grid_faces(nS, L, close_v=True)
    F.append(tuple(range((nS - 1) * L, nS * L)))
    if side < 0:
        V = V * np.array([1, -1, 1])
    uv = []
    for f in F:
        if len(f) > 4:
            for vi in f:
                uv.append((X0 - V[vi][0], abs(V[vi][1]) + 12.0))
            continue
        js = [vi % L for vi in f]
        lower = min(js) >= K - 1 or ((L - 1) in js and 0 in js)
        for vi in f:
            uv.append((X0 - V[vi][0], abs(V[vi][1]) + (6.0 if lower else 0.0)))
    ob = mesh_object('wing_' + ('L' if side > 0 else 'R'), V, F, coll, True, uv_loops=np.array(uv))
    clean(ob, 1e-5)
    recalc_normals(ob)
    return ob


def build_elevons(coll, side=1):
    out = []
    K = 16
    for n, (y0, y1) in enumerate(ELEVONS):
        ys = np.linspace(y0, y1, 10)
        loops = []
        for y in ys:
            sl, st = float(wing_le(y)), float(wing_te(y))
            c = st - sl
            x0 = 1 - (float(elevon_chord(y)) - HINGE_GAP * 0.5) / c
            xs = x0 + (1 - x0) * (1 - np.cos(np.linspace(0, math.pi / 2, K)))
            t = naca_t(xs, float(wing_tau(y)), 0.0012 / c) * c
            s = sl + xs * c
            zc = wing_camber_z(s, y)
            up = np.stack([X0 - s, np.full(K, y), zc + t], 1)[::-1]
            lo = np.stack([X0 - s, np.full(K, y), zc - t], 1)
            nose = np.array([[X0 - s[0] + 0.7 * t[0], y, zc[0]]])
            loops.append(np.concatenate([up, nose, lo], 0))
        L = len(loops[0]); nS = len(loops)
        V = np.concatenate(loops)
        F = grid_faces(nS, L, close_v=True)
        F.append(tuple(range(0, L)))
        F.append(tuple(range((nS - 1) * L, nS * L)))
        if side < 0:
            V = V * np.array([1, -1, 1])
        uv = []
        for f in F:
            lower = len(f) == 4 and min(vi % L for vi in f) >= K
            for vi in f:
                uv.append((X0 - V[vi][0], abs(V[vi][1]) + (6.0 if lower else 0.0) + (12.0 if len(f) > 4 else 0.0)))
        ob = mesh_object(f'elevon_{"L" if side > 0 else "R"}{n}', V, F, coll, True, uv_loops=np.array(uv))
        recalc_normals(ob)
        sh0 = float(wing_te(y0) - elevon_chord(y0)); sh1 = float(wing_te(y1) - elevon_chord(y1))
        p0 = Vector((X0 - sh0, side * y0, float(wing_camber_z(np.array([sh0]), y0)[0])))
        p1 = Vector((X0 - sh1, side * y1, float(wing_camber_z(np.array([sh1]), y1)[0])))
        axis = (p1 - p0).normalized()
        ang = -math.radians(ELEVON_DROOP) * side
        ob.matrix_world = Matrix.Translation(p0) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-p0)
        apply_xform(ob)
        out.append(ob)
    return out


# ------------------------------------------------------------------ fin and rudder
def build_fin(coll):
    K = 42
    zs = np.linspace(1.17, FIN_Z1, 28)
    loops = []
    for z in zs:
        zz = max(z, FIN_Z0)
        c = fin_lerp(FIN_TE, zz) - fin_lerp(FIN_LE, zz)
        xh = (fin_lerp(FIN_HINGE, zz) - HINGE_GAP * 0.5 - fin_lerp(FIN_LE, zz)) / c
        p, q, _, _ = fin_loop(zz, K, 0.0, xh)
        lp = np.concatenate([p, q[1:]], 0); lp[:, 2] = z
        loops.append(lp)
    for dz, sq in ((0.006, 0.5), (0.011, 0.1)):
        lp = loops[-1].copy(); lp[:, 1] *= sq; lp[:, 2] = FIN_Z1 + dz
        loops.append(lp)
    L = len(loops[0]); nS = len(loops)
    V = np.concatenate(loops)
    F = grid_faces(nS, L, close_v=True)
    F.append(tuple(range((nS - 1) * L, nS * L)))
    uv = []
    for f in F:
        if len(f) > 4:
            for vi in f:
                uv.append((X0 - V[vi][0], V[vi][1] + 10.0))
            continue
        js = [vi % L for vi in f]
        stbd = min(js) >= K - 1 or ((L - 1) in js and 0 in js)
        for vi in f:
            uv.append((X0 - V[vi][0], V[vi][2] + (4.0 if stbd else 0.0)))
    ob = mesh_object('fin', V, F, coll, True, uv_loops=np.array(uv))
    recalc_normals(ob)
    return ob


def build_rudder(coll):
    K = 16
    zs = np.linspace(FIN_Z0 + 0.012, FIN_Z1 - 0.006, 20)
    loops = []
    for z in zs:
        c = fin_lerp(FIN_TE, z) - fin_lerp(FIN_LE, z)
        xh = (fin_lerp(FIN_HINGE, z) + HINGE_GAP * 0.5 - fin_lerp(FIN_LE, z)) / c
        p, q, s, t = fin_loop(z, K, xh, 1.0)
        nose = np.array([[X0 - s[0] + 0.7 * t[0], 0.0, z]])
        loops.append(np.concatenate([p, nose, q], 0))
    L = len(loops[0]); nS = len(loops)
    V = np.concatenate(loops)
    F = grid_faces(nS, L, close_v=True)
    F.append(tuple(range(0, L)))
    F.append(tuple(range((nS - 1) * L, nS * L)))
    uv = []
    for f in F:
        stbd = len(f) == 4 and min(vi % L for vi in f) >= K
        for vi in f:
            uv.append((X0 - V[vi][0], V[vi][2] + (4.0 if stbd else 0.0) + (10.0 if len(f) > 4 else 0.0)))
    ob = mesh_object('rudder', V, F, coll, True, uv_loops=np.array(uv))
    recalc_normals(ob)
    return ob


# ------------------------------------------------------------------ drag-chute boom: box beam under the fin
def boom_section(hw, zt, zb, M):
    """Rounded-top box with chamfered lower corners; loop from the bottom centre round the starboard side."""
    ch = min(0.055, (zt - zb) * 0.2, hw * 0.5)
    r = min(0.024, hw * 0.4)
    pts = [(0.0, zb), (-(hw - ch), zb), (-hw, zb + ch), (-hw, zt - r)]
    pts += [(-hw + r - r * math.cos(k / 6 * math.pi / 2), zt - r + r * math.sin(k / 6 * math.pi / 2)) for k in range(1, 6)]
    pts += [(-(hw - r), zt), (0.0, zt)]
    half = np.array(pts)
    full = np.concatenate([half, (half[::-1] * [-1, 1])[1:-1]], 0)
    fc = np.concatenate([full, full[:1]])
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(fc, axis=0), axis=1))])
    t = np.arange(M) / M * arc[-1]
    return np.stack([np.interp(t, arc, fc[:, 0]), np.interp(t, arc, fc[:, 1])], 1), arc[-1]


def build_boom(coll):
    M = 60
    S = np.concatenate([np.linspace(9.25, 10.9, 14), np.linspace(11.0, 15.30, 30)])
    hw = np.interp(S, [9.25, 9.7, 10.3, 10.8, 15.3], [0.03, 0.065, 0.098, 0.105, 0.105])
    zt = np.interp(S, [9.25, 9.7, 10.3, 10.9, 15.3], [1.02, 1.11, 1.178, FIN_Z0, FIN_Z0])
    zb = np.interp(S, [9.25, 11.5, 12.3, 15.3], [0.80, 0.70, BOOM_ZB, BOOM_ZB])
    rings, girths = [], []
    for i, s in enumerate(S):
        sec, g = boom_section(hw[i], zt[i], zb[i], M)
        rings.append(np.stack([np.full(M, X0 - s), sec[:, 0], sec[:, 1]], 1)); girths.append(g)
    sec, g = boom_section(0.105, FIN_Z0, BOOM_ZB, M)
    send = BOOM_END_BOT + (BOOM_END_TOP - BOOM_END_BOT) * (sec[:, 1] - BOOM_ZB) / (FIN_Z0 - BOOM_ZB)
    rings.append(np.stack([X0 - send, sec[:, 0], sec[:, 1]], 1)); girths.append(g)
    sec2, _ = boom_section(0.093, FIN_Z0 - 0.012, BOOM_ZB + 0.012, M)
    send2 = BOOM_END_BOT + 0.008 + (BOOM_END_TOP - BOOM_END_BOT) * (sec2[:, 1] - BOOM_ZB) / (FIN_Z0 - BOOM_ZB)
    rings.append(np.stack([X0 - send2, sec2[:, 0], sec2[:, 1]], 1)); girths.append(g)
    V = np.concatenate(rings); nS = len(rings)
    F = grid_faces(nS, M, close_v=True)
    F.append(tuple(range((nS - 1) * M, nS * M)))
    uv = []
    for f in F:
        if len(f) > 4:
            for vi in f:
                uv.append((V[vi][1] + 30.0, V[vi][2]))
            continue
        js = [vi % M for vi in f]
        wrap = 0 in js and (M - 1) in js
        for vi in f:
            i, j = divmod(vi, M)
            if wrap and j == 0:
                j = M
            uv.append((X0 - V[vi][0], j / M * girths[min(i, nS - 1)]))
    ob = mesh_object('boom', V, F, coll, True, uv_loops=np.array(uv))
    recalc_normals(ob)
    return ob


# ------------------------------------------------------------------ nose: dorsal fairing, air-data boom, antennas
def build_dorsal_fairing(coll):
    """Black teardrop fairing on top of the nose (s 0.80..1.47); the air-data boom leaves from its nose."""
    S = np.linspace(0.80, 1.47, 26)
    M = 34
    zc, hw, ht, hb, nt, nb = fus_params(S)
    top = zc + ht
    w = np.interp(S, [0.80, 0.86, 1.0, 1.2, 1.36, 1.47], [0.034, 0.058, 0.108, 0.134, 0.105, 0.004])
    h = np.interp(S, [0.80, 0.86, 1.0, 1.2, 1.36, 1.47], [0.110, 0.116, 0.114, 0.096, 0.058, 0.004])
    rows = []
    for i, s in enumerate(S):
        a = np.linspace(0, math.pi, M)
        y = -w[i] * np.cos(a)
        z = top[i] - 0.03 + (h[i] + 0.03) * np.sin(a) ** 0.75
        rows.append(np.stack([np.full(M, X0 - s), y, z], 1))
    V = np.concatenate(rows)
    F = grid_faces(len(S), M)
    F.append(tuple(range(0, M)))
    ob = mesh_object('dorsal_fairing', V, F, coll, True,
                     uv_loops=np.array([(X0 - V[vi][0], V[vi][1]) for f in F for vi in f]))
    recalc_normals(ob)
    return ob


def build_airdata_boom(coll):
    zc = ADB_Z
    parts = [tube('adb_root', (X(0.86), 0, zc), (X(-0.02), 0, zc), 0.029, 0.028, seg=24, coll=coll, caps=True, bevel=0.003),
             tube('adb_mid', (X(-0.02), 0, zc), (X(-1.03), 0, zc), 0.026, 0.022, seg=24, coll=coll, caps=True, bevel=0.002),
             tube('adb_tip', (X(-1.03), 0, zc), (X(-1.44), 0, zc), 0.022, 0.010, seg=24, coll=coll, caps=True, bevel=0.002),
             tube('adb_collar', (X(-0.62), 0, zc), (X(-0.70), 0, zc), 0.032, seg=24, coll=coll, bevel=0.005),
             tube('adb_collar2', (X(-1.04), 0, zc), (X(-1.13), 0, zc), 0.028, seg=24, coll=coll, bevel=0.004)]
    for k, (dy, dz) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        out = Vector((0, dy, dz))
        base = Vector((X(-1.085), 0, zc)) + out * 0.026
        parts.append(tube(f'vane_shaft{k}', base, base + out * 0.035, 0.0045, seg=10, coll=coll, bevel=0.001))
        v0 = base + out * 0.035
        pts = [v0 + Vector((0.014, 0, 0)), v0 + out * 0.085 + Vector((-0.022, 0, 0)), v0 + out * 0.085 + Vector((-0.062, 0, 0)), v0 + Vector((-0.046, 0, 0))]
        side = Vector((1, 0, 0)).cross(out).normalized() * 0.0019
        bm = bmesh.new()
        vs = [bm.verts.new(p + side) for p in pts] + [bm.verts.new(p - side) for p in pts]
        bm.faces.new(vs[:4]); bm.faces.new(vs[4:][::-1])
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((vs[i], vs[4 + i], vs[4 + j], vs[j]))
        me = bpy.data.meshes.new(f'vane{k}'); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(f'vane{k}', me); link(ob, coll)
        recalc_normals(ob); sharp_edges(ob, 40)
        parts.append(ob)
    return join(parts, 'airdata_boom')


def fus_surface_point(s, ang):
    """Point and outward normal on the fuselage at station s, around-angle ang (0 = top, + toward port)."""
    P, arc = fus_dense([s], 4096)
    zc = float(fus_params([s])[0][0])
    a = np.arctan2(P[0, :, 0], P[0, :, 1] - zc)
    k = int(np.argmin(np.abs(np.angle(np.exp(1j * (a - ang))))))
    p = P[0, k]; q = P[0, (k + 1) % len(P[0])]; r = P[0, k - 1]
    tng = np.array([q[0] - r[0], q[1] - r[1]])
    nrm = np.array([tng[1], -tng[0]]); nrm /= np.linalg.norm(nrm)
    if nrm[0] * p[0] + nrm[1] * (p[1] - zc) < 0:
        nrm = -nrm
    return Vector((X0 - s, p[0], p[1])), Vector((0, nrm[0], nrm[1]))


def build_blade(name, s, ang, coll, h=0.11, chord=0.16, sweep=0.06, thick=0.012):
    """Small swept blade antenna standing on the fuselage."""
    base, nrm = fus_surface_point(s, ang)
    fwd = Vector((1, 0, 0))
    side = nrm.cross(fwd).normalized()
    prof = [(chord * 0.5, -0.01), (-chord * 0.5, -0.01), (-chord * 0.5 + sweep + 0.035, h), (-chord * 0.5 + sweep - 0.005, h), (chord * 0.15 + sweep * 0.4, h * 0.3)]
    bm = bmesh.new()
    vp = [bm.verts.new(base + fwd * a + nrm * b + side * thick * 0.5 * (1 - max(b, 0) / h * 0.5)) for a, b in prof]
    vq = [bm.verts.new(base + fwd * a + nrm * b - side * thick * 0.5 * (1 - max(b, 0) / h * 0.5)) for a, b in prof]
    bm.faces.new(vp); bm.faces.new(vq[::-1])
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        bm.faces.new((vp[i], vq[i], vq[j], vp[j]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); link(ob, coll)
    recalc_normals(ob)
    m = ob.modifiers.new('bv', 'BEVEL'); m.width = 0.0025; m.segments = 2; m.limit_method = 'ANGLE'
    select_only([ob]); bpy.ops.object.modifier_apply(modifier=m.name)
    sharp_edges(ob, 45)
    return ob


# ------------------------------------------------------------------ nozzle: F100 convergent-divergent, outer flaps off
def build_nozzle(coll, glow_coll):
    parts = []
    sh = lathe('shroud', [(13.36, 0.552), (13.37, 0.568), (13.50, 0.567), (13.70, 0.562), (13.755, 0.558), (13.772, 0.550), (13.776, 0.538), (13.765, 0.530), (13.60, 0.528), (13.38, 0.540)], seg=96, coll=coll, facing=None)
    face_probe(sh, (X(13.5), 0, NOZ_Z + 0.567), (0, 0, 1))
    parts.append(tag(sh, 30))
    parts.append(tag(lathe('convergent', [(13.28, 0.470), (13.30, 0.525), (13.55, 0.505), (13.78, 0.462), (13.90, 0.446)], seg=96, coll=coll, facing='radial_in'), 31))
    s_th, s_ex = 13.90, NOZZLE_EXIT_S
    r_th, r_ex = 0.446, 0.472
    prof = [(s_th, r_th), (13.95, r_th + 0.002), (14.2, r_th + 0.011), (14.45, r_ex - 0.004), (s_ex, r_ex)]
    n = len(prof)
    for k in range(NF):
        a0 = (k + 0.5) / NF * 2 * math.pi
        half = math.pi / NF * 0.80
        nth = 7
        th = a0 + np.linspace(-half, half, nth)
        Vi = np.concatenate([np.stack([np.full(nth, X0 - s), r * np.cos(th), NOZ_Z + r * np.sin(th)], 1) for s, r in prof])
        Vo = np.concatenate([np.stack([np.full(nth, X0 - s), (r + (0.007 if s < s_ex - 0.01 else 0.0095)) * np.cos(th), NOZ_Z + (r + (0.007 if s < s_ex - 0.01 else 0.0095)) * np.sin(th)], 1) for s, r in prof])
        V = np.concatenate([Vi, Vo]); nv = n * nth
        F = grid_faces(n, nth) + [tuple(np.array(f[::-1]) + nv) for f in grid_faces(n, nth)]
        for i in range(n - 1):
            F.append((i * nth, nv + i * nth, nv + (i + 1) * nth, (i + 1) * nth))
            F.append(((i + 1) * nth + nth - 1, nv + (i + 1) * nth + nth - 1, nv + i * nth + nth - 1, i * nth + nth - 1))
        for j in range(nth - 1):
            a, b = (n - 1) * nth + j, (n - 1) * nth + j + 1
            F.append((a, b, nv + b, nv + a))
            F.append((j + 1, j, nv + j, nv + j + 1))
        ob = mesh_object(f'flap{k}', V, F, coll, True)
        recalc_normals(ob); sharp_edges(ob, 50)
        parts.append(tag(ob, 32))
        p0 = Vector((X(13.93), (r_th + 0.013) * math.cos(a0), NOZ_Z + (r_th + 0.013) * math.sin(a0)))
        p1 = Vector((X(14.55), (r_ex + 0.013) * math.cos(a0), NOZ_Z + (r_ex + 0.013) * math.sin(a0)))
        radial = Vector((0, math.cos(a0), math.sin(a0)))
        parts.append(tag(bar(f'rib{k}', p0, p1, 0.026, 0.026, up=radial, coll=coll, bevel=0.004), 33))
        parts.append(tag(bar(f'clevis{k}', Vector((X(13.895), 0, NOZ_Z)) + radial * (r_th + 0.03), Vector((X(13.955), 0, NOZ_Z)) + radial * (r_th + 0.03), 0.036, 0.05, up=radial, coll=coll, bevel=0.006), 33))
        q0 = Vector((X(13.80), 0, NOZ_Z)) + radial * 0.535
        q1 = Vector((X(14.16), 0, NOZ_Z)) + radial * (r_th + 0.032)
        dq = (q1 - q0).normalized()
        parts.append(tag(tube(f'link{k}', q0, q1, 0.0085, seg=12, coll=coll, bevel=0.002), 34))
        parts.append(tag(tube(f'linkeye{k}', q1 - dq * 0.014, q1 + dq * 0.012, 0.016, seg=12, coll=coll, bevel=0.003), 34))
        b0 = a0 + math.pi / NF
        hs = math.pi / NF * 0.34
        th2 = b0 + np.linspace(-hs, hs, 4)
        Vs = np.concatenate([np.stack([np.full(4, X0 - s), (r + 0.0035) * np.cos(th2), NOZ_Z + (r + 0.0035) * np.sin(th2)], 1) for s, r in prof[1:]])
        sealob = mesh_object(f'seal{k}', Vs, grid_faces(n - 1, 4), coll, True)
        orient_radial(sealob, 0.0, NOZ_Z, outward=True)
        parts.append(tag(sealob, 35))
    parts.append(tag(lathe('sync_ring', [(13.79, 0.528), (13.775, 0.537), (13.79, 0.547), (13.815, 0.547), (13.83, 0.537), (13.815, 0.528), (13.79, 0.528)], seg=96, coll=coll, facing=None), 34))
    nozzle = join(parts, 'nozzle')
    # afterburner liner (corrugated, seen from inside) and flame holder: the film animates their emissive
    liner = lathe('ab_liner', [(11.62, 0.470), (12.4, 0.474), (13.0, 0.478), (13.30, 0.474)], seg=160, coll=glow_coll,
                  rfun=lambda th, s, r: r + 0.0032 * np.cos(th * 40), facing=None)
    orient_radial(liner, 0.0, NOZ_Z, outward=False)
    tag(liner, 36)
    fh = [lathe('fh_back', [(11.60, 0.0), (11.60, 0.472)], seg=64, coll=glow_coll, facing='-x'),
          lathe('fh_cone', [(11.60, 0.20), (11.78, 0.15), (11.92, 0.06), (11.97, 0.0)], seg=48, coll=glow_coll)]
    for rr in (0.25, 0.37):
        fh.append(lathe(f'fh_ring{int(rr * 100)}', [(11.71, rr - 0.03), (11.62, rr), (11.71, rr + 0.03)], seg=96, coll=glow_coll, facing='-x'))
    for k in range(10):
        a = (k + 0.25) / 10 * 2 * math.pi
        radial = Vector((0, math.cos(a), math.sin(a)))
        fh.append(bar(f'fh_spoke{k}', Vector((X(11.645), 0, NOZ_Z)) + radial * 0.12, Vector((X(11.645), 0, NOZ_Z)) + radial * 0.46, 0.045, 0.03, up=(1, 0, 0), coll=glow_coll, bevel=0.004))
    for o in fh:
        tag(o, 37)
    holder = join(fh, 'ab_flameholder')
    return nozzle, liner, holder


# ------------------------------------------------------------------ landing gear (the aircraft uses F-16 gear)
def tyre(name, c, axis, R, W, coll, seg=72, grooves=4):
    """Aircraft tyre about +X (then oriented): rounded-square section, circumferential tread grooves."""
    rim = R * (0.56 if R > 0.25 else 0.52)
    hw = 0.5 * W
    prof = [(-hw * 0.80, rim - 0.004)]
    for k in range(1, 9):                       # inboard sidewall, bead -> shoulder
        a = k / 9 * math.pi / 2
        prof.append((-hw * (0.80 + 0.20 * math.sin(a) ** 0.6), rim + (R - 0.035 - rim) * (1 - math.cos(a))))
    for k in range(1, 4):                       # shoulder round
        a = k / 4 * math.pi / 2
        prof.append((-hw + 0.035 * (1 - math.cos(a)) * 0.9 + 0.0, R - 0.035 + 0.035 * math.sin(a)))
    tx = np.linspace(-hw * 0.82, hw * 0.82, 41)
    gx = np.linspace(-0.27, 0.27, grooves) * W
    for x in tx:
        dpt = 0.0
        for g in gx:
            dd = abs(x - g)
            if dd < 0.009:
                dpt = 0.0065
            elif dd < 0.013:
                dpt = max(dpt, 0.0065 * (0.013 - dd) / 0.004)
        prof.append((x, R - dpt - 0.003 * (abs(x) / hw) ** 2))
    for k in range(3, 0, -1):
        a = k / 4 * math.pi / 2
        prof.append((hw - 0.035 * (1 - math.cos(a)) * 0.9, R - 0.035 + 0.035 * math.sin(a)))
    for k in range(8, 0, -1):
        a = k / 9 * math.pi / 2
        prof.append((hw * (0.80 + 0.20 * math.sin(a) ** 0.6), rim + (R - 0.035 - rim) * (1 - math.cos(a))))
    prof.append((hw * 0.80, rim - 0.004))
    ob = local_lathe(name, prof, seg, coll, facing='radial_out')
    orient(ob, c, axis)
    return tag(ob, 50)


def wheel_hub(name, c, axis, R, W, coll, holes=10):
    """Light-alloy wheel half seen from its outer face (+X local): rim flange, web with real lightening holes, hub cap."""
    rim = R * (0.56 if R > 0.25 else 0.52)
    hw = 0.5 * W
    parts = [local_lathe(name + '_rim', [(-hw * 0.95, rim - 0.006), (-hw * 0.95, rim + 0.012), (-hw * 0.84, rim + 0.012), (-hw * 0.80, rim - 0.002), (hw * 0.80, rim - 0.002), (hw * 0.84, rim + 0.012), (hw * 0.95, rim + 0.012), (hw * 0.95, rim - 0.006), (hw * 0.62, rim - 0.022)], 72, coll, facing='radial_out')]
    xo = hw * 0.58
    web = local_lathe(name + '_web', [(xo + 0.032, 0.0), (xo + 0.032, R * 0.17), (xo + 0.016, R * 0.25), (xo + 0.004, R * 0.31), (xo, rim - 0.024), (xo - 0.012, rim - 0.024), (xo - 0.016, R * 0.31), (xo - 0.012, R * 0.17), (xo - 0.012, 0.0)], 72, coll, facing=None)
    sc = R / 0.305
    cutters = []
    for k in range(holes):
        a = k / holes * 2 * math.pi
        big = k % 2 == 0
        rr = (0.031 if big else 0.017) * sc
        rad = R * (0.405 if big else 0.43)
        cutters.append(tube(f'{name}_cut{k}', Vector((xo - 0.04, rad * math.cos(a), rad * math.sin(a))), Vector((xo + 0.05, rad * math.cos(a), rad * math.sin(a))), rr, seg=20, coll=coll))
    cut = join(cutters, name + '_cutters')
    m = web.modifiers.new('holes', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cut; m.solver = 'EXACT'
    select_only([web]); bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cut)
    sharp_edges(web, 50)
    parts.append(web)
    parts.append(tube(name + '_cap', Vector((xo + 0.03, 0, 0)), Vector((xo + 0.05, 0, 0)), R * 0.15, R * 0.12, seg=24, coll=coll, bevel=0.004))
    for k in range(3):
        a = k / 3 * 2 * math.pi
        parts.append(tube(f'{name}_lobe{k}', Vector((xo + 0.046, 0.045 * sc * math.cos(a), 0.045 * sc * math.sin(a))), Vector((xo + 0.056, 0.045 * sc * math.cos(a), 0.045 * sc * math.sin(a))), 0.016 * sc, seg=12, coll=coll, bevel=0.003))
    for o in parts:
        tag(o, 51)
    ob = join(parts, name)
    orient(ob, c, axis)
    return ob


def build_gear(coll):
    out = []
    nw = NOSE_WHEEL
    cN = Vector((X(nw['s']), 0.0, GROUND + nw['r']))
    out.append(tyre('nose_tyre', cN, (0, 1, 0), nw['r'], nw['w'], coll))
    out.append(wheel_hub('nose_hub_p', cN, (0, 1, 0), nw['r'], nw['w'], coll, holes=6))
    out.append(wheel_hub('nose_hub_s', cN, (0, -1, 0), nw['r'], nw['w'], coll, holes=6))
    top = Vector((X(nw['s'] + 0.13), 0, -0.50))
    crown = Vector((X(nw['s'] + 0.035), 0, -1.02))
    out.append(tube('nose_oleo', top, top + (crown - top) * 0.62, 0.052, seg=28, coll=coll, bevel=0.006))
    out.append(tube('nose_piston', top + (crown - top) * 0.55, crown, 0.036, seg=28, coll=coll, bevel=0.004))
    out.append(tube('nose_collar', top + (crown - top) * 0.30, top + (crown - top) * 0.36, 0.068, seg=28, coll=coll, bevel=0.008))
    out.append(tube('nose_gland', top + (crown - top) * 0.60, top + (crown - top) * 0.64, 0.060, seg=28, coll=coll, bevel=0.006))
    out.append(box('nose_crown', crown + Vector((0, 0, -0.02)), (0.09, 0.22, 0.05), coll, bevel=0.012))
    for sy in (1, -1):
        out.append(bar(f'nose_fork{sy}', crown + Vector((0, sy * 0.094, -0.03)), cN + Vector((0.0, sy * 0.094, 0.0)), 0.05, 0.018, up=(0, sy, 0), coll=coll, bevel=0.006))
        out.append(tube(f'nose_axlecap{sy}', cN + Vector((0, sy * 0.085, 0)), cN + Vector((0, sy * 0.115, 0)), 0.024, seg=16, coll=coll, bevel=0.003))
    out.append(tube('nose_axle', cN + Vector((0, -0.1, 0)), cN + Vector((0, 0.1, 0)), 0.016, seg=16, coll=coll))
    tl0 = top + (crown - top) * 0.5 + Vector((-0.06, 0, 0))
    knee = top + (crown - top) * 0.74 + Vector((-0.15, 0, 0))
    tl1 = crown + Vector((-0.05, 0, 0.01))
    out.append(bar('nose_tl_up', tl0, knee, 0.03, 0.04, up=(0, 1, 0), coll=coll, bevel=0.006))
    out.append(bar('nose_tl_lo', knee, tl1, 0.03, 0.04, up=(0, 1, 0), coll=coll, bevel=0.006))
    out.append(tube('nose_tl_pin', knee + Vector((0, -0.03, 0)), knee + Vector((0, 0.03, 0)), 0.012, seg=12, coll=coll, bevel=0.002))
    out.append(tube('nose_brace', top + (crown - top) * 0.25 + Vector((-0.04, 0, 0)), Vector((X(nw['s'] + 0.75), 0, -0.55)), 0.022, seg=14, coll=coll, bevel=0.004))
    out.append(tube('nose_line', top + Vector((0.055, 0.04, 0)), crown + Vector((0.05, 0.05, 0.04)), 0.005, seg=8, coll=coll))
    mw = MAIN_WHEEL
    for sy in (1, -1):
        cM = Vector((X(mw['s']), sy * mw['y'], GROUND + mw['r']))
        out.append(tyre(f'main_tyre{sy}', cM, (0, sy, 0), mw['r'], mw['w'], coll, seg=84))
        out.append(wheel_hub(f'main_hub{sy}', cM, (0, sy, 0), mw['r'], mw['w'], coll, holes=12))
        bc = cM + Vector((0, -sy * 0.035, 0))
        out.append(tube(f'main_brake{sy}', bc + Vector((0, -sy * 0.045, 0)), bc + Vector((0, sy * 0.03, 0)), 0.15, seg=40, coll=coll, bevel=0.006))
        out.append(box(f'main_caliper{sy}', bc + Vector((0.0, -sy * 0.055, 0.13)), (0.12, 0.05, 0.07), coll, bevel=0.01))
        ox = X(mw['s'] + 0.06)
        yo = sy * (mw['y'] - 0.15)
        topM = Vector((ox, yo, -0.22))
        botM = Vector((ox - 0.02, yo, cM.z + 0.11))
        out.append(tube(f'main_oleo{sy}', topM, topM + (botM - topM) * 0.58, 0.072, seg=32, coll=coll, bevel=0.008))
        out.append(tube(f'main_piston{sy}', topM + (botM - topM) * 0.5, botM, 0.05, seg=32, coll=coll, bevel=0.004))
        out.append(tube(f'main_gland{sy}', topM + (botM - topM) * 0.56, topM + (botM - topM) * 0.60, 0.082, seg=32, coll=coll, bevel=0.007))
        out.append(tube(f'main_band{sy}', topM + (botM - topM) * 0.18, topM + (botM - topM) * 0.24, 0.080, seg=32, coll=coll, bevel=0.006))
        out.append(box(f'main_knuckle{sy}', botM + Vector((0, 0, -0.045)), (0.13, 0.12, 0.12), coll, bevel=0.018))
        out.append(tube(f'main_axle{sy}', Vector((cM.x, yo, cM.z)), cM + Vector((0, sy * 0.09, 0)), 0.03, seg=20, coll=coll, bevel=0.004))
        out.append(tube(f'main_nut{sy}', cM + Vector((0, sy * 0.085, 0)), cM + Vector((0, sy * 0.11, 0)), 0.04, seg=6, coll=coll, bevel=0.003))
        t0 = topM + (botM - topM) * 0.45 + Vector((0.075, 0, 0))
        kn = topM + (botM - topM) * 0.72 + Vector((0.21, 0, 0))
        t1 = botM + Vector((0.07, 0, -0.02))
        out.append(bar(f'main_tl_up{sy}', t0, kn, 0.034, 0.05, up=(0, 1, 0), coll=coll, bevel=0.008))
        out.append(bar(f'main_tl_lo{sy}', kn, t1, 0.034, 0.05, up=(0, 1, 0), coll=coll, bevel=0.008))
        out.append(tube(f'main_tl_pin{sy}', kn + Vector((0, -0.035, 0)), kn + Vector((0, 0.035, 0)), 0.014, seg=12, coll=coll, bevel=0.002))
        db0 = topM + (botM - topM) * 0.32
        for dy in (-0.05, 0.05):
            out.append(tube(f'main_drag{sy}{dy}', db0 + Vector((0, dy, 0)), Vector((X(mw['s'] - 0.75), yo + dy * 1.6, -0.16)), 0.024, seg=14, coll=coll, bevel=0.004))
        out.append(tube(f'main_side{sy}', topM + (botM - topM) * 0.28, Vector((ox + 0.05, sy * 0.62, -0.30)), 0.026, seg=14, coll=coll, bevel=0.004))
        out.append(box(f'main_lock{sy}', topM + (botM - topM) * 0.3 + Vector((0.02, -sy * 0.07, 0)), (0.09, 0.05, 0.08), coll, bevel=0.01))
        out.append(tube(f'main_line{sy}', topM + Vector((-0.06, sy * 0.06, 0)), botM + Vector((-0.06, sy * 0.05, 0.05)), 0.006, seg=8, coll=coll))
        out.append(tube(f'main_line2{sy}', topM + Vector((-0.07, -sy * 0.03, 0)), botM + Vector((-0.07, -sy * 0.05, 0.08)), 0.005, seg=8, coll=coll))
    return out


def curved_door(name, s0, s1, z0, z1, y, sy, coll, bulge=0.025, thick=0.022, ns=14, nz=10):
    """Door panel in the X-Z plane at lateral y, outer face toward sy, slightly curved, with a thickness."""
    ss = np.linspace(s0, s1, ns); zs = np.linspace(z0, z1, nz)
    Vo, Vi = [], []
    for s in ss:
        for k, z in enumerate(zs):
            b = bulge * math.sin(math.pi * k / (nz - 1))
            Vo.append((X0 - s, y + sy * b, z))
            Vi.append((X0 - s, y + sy * (b - thick), z))
    nv = len(Vo)
    V = np.array(Vo + Vi)
    F = grid_faces(ns, nz) + [tuple(np.array(f[::-1]) + nv) for f in grid_faces(ns, nz)]
    for i in range(ns - 1):
        F.append((i * nz + nz - 1, (i + 1) * nz + nz - 1, nv + (i + 1) * nz + nz - 1, nv + i * nz + nz - 1))
        F.append((nv + i * nz, nv + (i + 1) * nz, (i + 1) * nz, i * nz))
    for k in range(nz - 1):
        F.append((k + 1, k, nv + k, nv + k + 1))
        F.append(((ns - 1) * nz + k, (ns - 1) * nz + k + 1, nv + (ns - 1) * nz + k + 1, nv + (ns - 1) * nz + k))
    uv = []
    for f in F:
        inner = all(vi >= nv for vi in f)
        for vi in f:
            p = V[vi]
            uv.append(((X0 - p[0]), (-p[2]) + (3.0 if inner else 0.0)))
    ob = mesh_object(name, V, F, coll, True, uv_loops=np.array(uv))
    recalc_normals(ob)
    tag(ob, 60)
    tag(ob, 59, [i for i, f in enumerate(F) if all(vi < nv for vi in f)])
    m = ob.modifiers.new('bv', 'BEVEL'); m.width = 0.006; m.segments = 2; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(50)
    select_only([ob]); bpy.ops.object.modifier_apply(modifier=m.name)
    sharp_edges(ob, 50)
    return ob


def build_doors(coll):
    out = []
    s0, s1, z0, z1, yy = DOORS['nose']
    for sy in (1, -1):
        out.append(curved_door(f'nose_door{sy}', s0, s1, z0, z1, sy * yy, sy, coll))
        for s in (4.62, 4.98, 5.34):
            out.append(bar(f'nose_door_rib{sy}{s}', (X(s), sy * (yy - 0.03), z0 - 0.04), (X(s), sy * (yy - 0.03), z1 + 0.05), 0.018, 0.03, up=(0, sy, 0), coll=coll, bevel=0.003))
        for s in (4.55, 5.5):
            out.append(bar(f'nose_door_arm{sy}{s}', (X(s), sy * (yy - 0.02), z0 + 0.02), (X(s), sy * 0.12, -0.52), 0.02, 0.012, up=(1, 0, 0), coll=coll, bevel=0.002))
    s0, s1, z0, z1, yy = DOORS['main']
    for sy in (1, -1):
        out.append(curved_door(f'main_door{sy}', s0, s1, z0, z1, sy * yy, sy, coll, bulge=0.012, thick=0.024))
        for s in (7.95, 8.45, 8.95):
            out.append(bar(f'main_door_rib{sy}{s}', (X(s), sy * (yy - 0.03), z0 - 0.05), (X(s), sy * (yy - 0.03), z1 + 0.06), 0.02, 0.035, up=(0, sy, 0), coll=coll, bevel=0.003))
        for s in (7.85, 9.05):
            out.append(bar(f'main_door_arm{sy}{s}', (X(s), sy * (yy - 0.02), z0 - 0.03), (X(s), sy * 1.05, -0.03), 0.022, 0.014, up=(1, 0, 0), coll=coll, bevel=0.002))
    return out


def build_wells(coll, N=FUS_N):
    """Dark well openings 3 mm proud of the skin: a lowered gear shows an open bay."""
    out = []
    ss = np.linspace(4.38, 5.70, 16)
    R, g = fus_ring(ss, N)
    jw = int(round(0.235 / (g.mean() / N)))
    rows = []
    for i, s in enumerate(ss):
        idx = [(-jw + k) % N for k in range(2 * jw + 1)]
        p = R[i, idx]
        zc = float(fus_params([s])[0][0])
        d = p - np.array([0, zc]); d /= np.linalg.norm(d, axis=1, keepdims=True)
        p = p + d * 0.003
        rows.append(np.stack([np.full(len(idx), X0 - s), p[:, 0], p[:, 1]], 1))
    V = np.concatenate(rows)
    ob = mesh_object('nose_well', V, grid_faces(len(ss), 2 * jw + 1), coll, True,
                     uv_loops=np.array([(X0 - V[vi][0], V[vi][1]) for f in grid_faces(len(ss), 2 * jw + 1) for vi in f]))
    face_probe(ob, (X(5.0), 0, -1.0), (0, 0, -1))
    out.append(ob)
    for sy in (1, -1):
        ys = np.linspace(0.70, 1.29, 8)
        ss = np.linspace(7.60, 9.30, 12)
        V = np.array([(X0 - s, sy * y, float(wing_surface_z(np.array([s]), y, upper=False)[0]) - 0.003) for s in ss for y in ys])
        F = grid_faces(len(ss), len(ys))
        ob = mesh_object(f'main_well{sy}', V, F, coll, True, uv_loops=np.array([(X0 - V[vi][0], V[vi][1]) for f in F for vi in f]))
        recalc_normals(ob)
        # face downward
        bm = bmesh.new(); bm.from_mesh(ob.data)
        if sum(f.normal.z for f in bm.faces) > 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(ob.data); bm.free(); ob.data.update()
        out.append(ob)
    return out
