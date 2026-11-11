# Hermeus Quarterhorse Mk 2.1 (N21QH) for film 1 -> assets/quarterhorse/quarterhorse.glb
#
#   node tools/blender.mjs quarterhorse [geo|bake|paint|export|all] [--preview]
#
# geo     model every part (qh_geo.py), lay out metric UVs per texture set and pack them; saves a .blend in the cache
# bake    bake per-texel data maps for each set: object-space position, normal, part id, occlusion, coverage
# paint   synthesise the PBR maps from those data maps and CC0 photoscans (qh_paint.py; numpy only)
# export  glTF materials from the painted maps (anisotropic bare metal), named nodes 'gear' and 'ab_glow', GLB export
#
# Texture sets: SKIN 4K (fuselage), WING 4K (wings, elevons, fin, rudder, chute boom, nose fairing, booms, blades),
# HOT 2K (nozzle, inlet duct, afterburner), GEAR 2K (landing gear, doors, wells).
import os
import sys
import time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, HERE)
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
import dowlib as d
import qh_geo as G
from qh_shape import X0, X

WORK = d.bake_dir('quarterhorse')
BLEND = os.path.join(WORK, 'qh_geo.blend')
SCRATCH = os.environ.get('QH_PREVIEW_DIR', '/tmp/claude-0/-home-user-test-DOW-graphics/24d856ac-11c5-5d46-b31d-fe2100eb7024/scratchpad/work/quarterhorse/blender')
SETS = {'skin': 4096, 'wing': 4096, 'hot': 2048, 'gear': 2048}
MARGIN_PX = 10


# ------------------------------------------------------------------ geometry
def uv_scale(ob, f, rect=None):
    """Scale an object's UVs (all loops, or loops whose uv lies in rect=(u0,v0,u1,v1)) about the rect origin."""
    uvl = ob.data.uv_layers.active
    a = np.zeros(len(uvl.data) * 2, np.float32); uvl.data.foreach_get('uv', a); a = a.reshape(-1, 2)
    if rect is None:
        a *= f
    else:
        m = (a[:, 0] >= rect[0]) & (a[:, 1] >= rect[1]) & (a[:, 0] <= rect[2]) & (a[:, 1] <= rect[3])
        a[m] = (a[m] - [rect[0], rect[1]]) * f + [rect[0], rect[1]]
    uvl.data.foreach_set('uv', a.ravel())


def uv_areas(ob):
    me = ob.data
    uvl = me.uv_layers.active
    a = np.zeros(len(uvl.data) * 2, np.float32); uvl.data.foreach_get('uv', a); a = a.reshape(-1, 2)
    A2 = A3 = 0.0
    for p in me.polygons:
        A3 += p.area
        idx = list(p.loop_indices)
        u = a[idx]
        A2 += 0.5 * abs(np.dot(u[:, 0], np.roll(u[:, 1], -1)) - np.dot(u[:, 1], np.roll(u[:, 0], -1)))
    return A3, A2


def smart_metric(ob, density=1.0, angle=60):
    """Smart-project an object and scale its islands to metres x density."""
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name='UVMap')
    d.smart_uv(ob, angle, 0.002)
    A3, A2 = uv_areas(ob)
    uv_scale(ob, (A3 / max(A2, 1e-12)) ** 0.5 * density)


def pack_set(objs, size, shape='CONCAVE'):
    d.select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', scale=True, margin_method='FRACTION',
                            margin=MARGIN_PX / size, shape_method=shape)
    bpy.ops.object.mode_set(mode='OBJECT')


def build():
    t0 = time.time()
    d.reset()
    sc = bpy.context.scene
    C = {k: bpy.data.collections.new(k) for k in ('skin', 'wing', 'hot', 'gear', 'glow')}
    for c in C.values():
        sc.collection.children.link(c)
    # --- airframe
    fus = G.tag(G.build_fuselage(C['skin']), 1)
    inlet, fan = G.build_inlet(C['hot'])
    G.tag(inlet, 2); G.tag(fan, 3)
    wings = [G.tag(G.build_wing(C['wing'], s), 10 if s > 0 else 11) for s in (1, -1)]
    elev = [G.tag(o, 12) for s in (1, -1) for o in G.build_elevons(C['wing'], s)]
    fair = [G.tag(G.build_fairing(C['wing'], sd), 19) for sd in (1, -1)]
    fin = G.tag(G.build_fin(C['wing']), 13)
    rud = G.tag(G.build_rudder(C['wing']), 14)
    boom = G.tag(G.build_boom(C['wing']), 15)
    dors = G.tag(G.build_dorsal_fairing(C['wing']), 16)
    adb = G.tag(G.build_airdata_boom(C['wing']), 17)
    blades = [G.tag(G.build_blade(f'blade{i}', s, a, C['wing'], h=h), 18) for i, (s, a, h) in enumerate(
        ((5.45, 0.62, 0.10), (5.45, -0.62, 0.10), (4.25, 0.55, 0.08), (4.25, -0.55, 0.08), (6.6, 3.14159, 0.16), (11.2, 3.14159, 0.12)))]
    nozzle, liner, holder = G.build_nozzle(C['hot'], C['glow'])
    # --- gear (all of it hangs under the 'gear' node)
    gparts = G.build_gear(C['gear'])
    for o in gparts:
        n = o.name
        pid = 52
        if 'tyre' in n: pid = 50
        elif 'hub' in n: pid = 51
        elif 'piston' in n or 'axle' in n or 'nut' in n or 'pin' in n: pid = 54
        elif 'brake' in n or 'caliper' in n: pid = 56
        elif 'line' in n: pid = 58
        elif 'oleo' in n or 'gland' in n or 'collar' in n or 'band' in n: pid = 53
        if pid != 50 and pid != 51:
            G.tag(o, pid)
    doors = G.build_doors(C['gear'])
    for o in doors:
        if 'rib' in o.name or 'arm' in o.name:
            G.tag(o, 60)
    wells = [G.tag(o, 61) for o in G.build_wells(C['gear'])]
    log('built parts in', round(time.time() - t0), 's')

    # --- UV layouts: metric, per-part density, then pack each set
    # inlet: lip roll at full density, the dark duct at a quarter (separate island)
    uvl = inlet.data.uv_layers.active
    a = np.zeros(len(uvl.data) * 2, np.float32); uvl.data.foreach_get('uv', a); a = a.reshape(-1, 2)
    lip = 0.08
    duct = a[:, 0] > lip + 1e-4
    face_duct = np.zeros(len(a), bool)
    for p in inlet.data.polygons:
        idx = list(p.loop_indices)
        if (a[idx, 0] > lip - 1e-4).all() and (a[idx, 0] > lip + 1e-4).any():
            face_duct[idx] = True
    a[face_duct] = (a[face_duct] - [lip, 0]) * 0.22 + [lip + 1.0, 0]
    uvl.data.foreach_set('uv', a.ravel())
    smart_metric(fan, 0.3)
    for w in wings:  # lower surfaces: a little less density (rarely seen close)
        uv_scale(w, 0.85, (-50, 5.5, 50, 11.0))
    for o in elev:
        uv_scale(o, 0.85, (-50, 5.5, 50, 11.0))
    uv_scale(fin, 1.15); uv_scale(rud, 1.15); uv_scale(boom, 1.2)
    for o in [dors, adb] + blades:
        smart_metric(o, 1.0)
    smart_metric(nozzle, 1.0, 55)
    for o in (liner, holder):
        smart_metric(o, 0.6)
    for o in gparts + doors + wells:
        if o.name.startswith(('nose_door', 'main_door')) and 'rib' not in o.name and 'arm' not in o.name:
            continue   # curved doors carry metric UVs
        if o in wells:
            continue
        smart_metric(o, 1.0, 50)
    # --- join per texture set / node
    skin = G.join([fus], 'airframe_skin')
    wing = G.join(wings + elev + fair + [fin, rud, boom, dors, adb] + blades, 'airframe_wing')
    hot = G.join([nozzle, inlet, fan], 'airframe_hot')
    gear = G.join(gparts + doors + wells, 'gear_parts')
    glow = {'liner': liner, 'holder': holder}
    t1 = time.time()
    pack_set([skin], SETS['skin'], 'CONCAVE')
    pack_set([wing], SETS['wing'], 'CONCAVE')
    pack_set([hot, liner, holder], SETS['hot'], 'AABB')
    pack_set([gear], SETS['gear'], 'AABB')
    log('packed UVs in', round(time.time() - t1), 's')
    for o in (skin, wing, hot, gear, liner, holder):
        log(d.stats(o), 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))
    for name, o, size in (('skin', skin, 4096), ('wing', wing, 4096), ('hot', hot, 2048), ('gear', gear, 2048)):
        log(f'texel {name}: {d.texel_density(o, size) * 1000:.2f} mm')
    # hierarchy: root / airframe meshes, ab_glow / (liner, flame holder), gear / parts
    root = bpy.data.objects.new('quarterhorse', None); sc.collection.objects.link(root)
    abg = bpy.data.objects.new('ab_glow', None); sc.collection.objects.link(abg); abg.parent = root
    gnode = bpy.data.objects.new('gear', None); sc.collection.objects.link(gnode); gnode.parent = root
    for o in (skin, wing, hot):
        o.parent = root
    liner.parent = abg; holder.parent = abg
    gear.parent = gnode
    for o in (skin, wing, hot, liner, holder, gear):
        o.data.uv_layers.active.name = 'UVMap'
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log('saved', BLEND, 'in', round(time.time() - t0), 's')


def log(*a):
    d.log('[qh]', *a)


# ------------------------------------------------------------------ data bakes
SET_OBJECTS = {'skin': ['airframe_skin'], 'wing': ['airframe_wing'], 'hot': ['airframe_hot', 'ab_liner', 'ab_flameholder'], 'gear': ['gear_parts']}


def float_image(name, size, fill=(0, 0, 0, 0)):
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = fill
    return img


def data_material():
    mat = bpy.data.materials.new('qh_data'); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    att = nt.nodes.new('ShaderNodeAttribute'); att.attribute_type = 'GEOMETRY'; att.attribute_name = 'pid'
    em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    edge = d.edge_mask(nt, 0.006, 8)
    return mat, {'pos': geo.outputs['Position'], 'nrm': geo.outputs['Normal'], 'pid': att.outputs['Fac'], 'edge': edge}, em


def img_array(img, ch=4):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[..., :ch]


def bake_data(only=None):
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    w = d.ensure_world((0.0, 0.0, 0.0))
    w.light_settings.distance = 0.9
    mat, socks, em = data_material()
    gear_ob = bpy.data.objects['gear_parts']
    for key, names in SET_OBJECTS.items():
        if only and key not in only:
            continue
        size = SETS[key]
        objs = [bpy.data.objects[n] for n in names]
        saved = {o.name: [s.material for s in o.material_slots] for o in objs}
        for o in objs:
            o.data.materials.clear(); o.data.materials.append(mat)
        out = {}
        for kind in ('pos', 'nrm', 'pid'):
            img = float_image(f'{key}_{kind}', size)
            mat.node_tree.links.new(socks[kind], em.inputs['Color'])
            d.bake(objs, 'EMIT', img, samples=1, margin=0)
            out[kind] = img_array(img, 3 if kind != 'pid' else 1)
            bpy.data.images.remove(img)
        np.save(os.path.join(WORK, f'{key}_pos.npy'), out['pos'].astype(np.float32))
        np.save(os.path.join(WORK, f'{key}_nrm.npy'), out['nrm'].astype(np.float16))
        np.save(os.path.join(WORK, f'{key}_pid.npy'), np.round(out['pid'][..., 0]).astype(np.uint8))
        del out
        # occlusion from the rest of the airframe, gear retracted (except for the gear's own set)
        gear_ob.hide_render = key != 'gear'
        img = float_image(f'{key}_ao', size // 2, (1, 1, 1, 1))
        d.bake(objs, 'AO', img, samples=32, margin=0)
        np.save(os.path.join(WORK, f'{key}_ao.npy'), img_array(img, 1)[..., 0].astype(np.float16))
        bpy.data.images.remove(img)
        gear_ob.hide_render = False
        if key in ('hot', 'gear'):
            img = float_image(f'{key}_edge', size)
            mat.node_tree.links.new(socks['edge'], em.inputs['Color'])
            d.bake(objs, 'EMIT', img, samples=12, margin=0)
            np.save(os.path.join(WORK, f'{key}_edge.npy'), img_array(img, 1)[..., 0].astype(np.float16))
            bpy.data.images.remove(img)
        for o in objs:
            o.data.materials.clear()
            for m in saved[o.name]:
                if m is not None:
                    o.data.materials.append(m)
        log('baked data maps for', key)


# ------------------------------------------------------------------ export
GLB = d.out_path('quarterhorse', 'quarterhorse.glb')
ANISO = {'skin': 0.55, 'wing': 0.5}
ORIGIN_DZ = -0.215          # modelled with the nozzle axis at z = 0.06; exported with the fuselage axis at the origin


def add_anisotropy(mat, img, strength):
    """Principled anisotropy driven by a glTF-layout map (RG direction in tangent space, B strength): the node shape the
    glTF exporter recognises, so it writes KHR_materials_anisotropy with this very texture."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    ma = nt.nodes.new('ShaderNodeVectorMath'); ma.operation = 'MULTIPLY_ADD'
    ma.inputs[1].default_value = (2.0, 2.0, 1.0); ma.inputs[2].default_value = (-1.0, -1.0, 0.0)
    nt.links.new(tex.outputs['Color'], ma.inputs[0])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(ma.outputs[0], sep.inputs[0])
    at = nt.nodes.new('ShaderNodeMath'); at.operation = 'ARCTAN2'
    nt.links.new(sep.outputs['Y'], at.inputs[0]); nt.links.new(sep.outputs['X'], at.inputs[1])
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'; add.inputs[1].default_value = 0.0
    nt.links.new(at.outputs[0], add.inputs[0])
    div = nt.nodes.new('ShaderNodeMath'); div.operation = 'DIVIDE'; div.inputs[1].default_value = 6.283185
    nt.links.new(add.outputs[0], div.inputs[0]); nt.links.new(div.outputs[0], bsdf.inputs['Anisotropic Rotation'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = strength
    nt.links.new(sep.outputs['Z'], mul.inputs[0]); nt.links.new(mul.outputs[0], bsdf.inputs['Anisotropic'])
    tg = nt.nodes.new('ShaderNodeTangent'); tg.direction_type = 'UV_MAP'; tg.uv_map = 'UVMap'
    nt.links.new(tg.outputs['Tangent'], bsdf.inputs['Tangent'])


def export_glb():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    PD = os.path.join(WORK, 'paint')

    def img(name, srgb=False):
        im = bpy.data.images.load(os.path.join(PD, name))
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        return im
    T = {k: (img(f'{k}_base.png', True), img(f'{k}_orm.png'), img(f'{k}_normal.png')) for k in SETS}
    mats = {}
    for k in SETS:
        b, o, n = T[k]
        m = d.gltf_material('qh_' + k, base=b, orm=o, normal=n)
        if k in ANISO:
            add_anisotropy(m, img(f'{k}_aniso.png'), ANISO[k])
        mats[k] = m
    em = img('hot_emissive.png', True)
    b, o, n = T['hot']
    mats['liner'] = d.gltf_material('qh_ab_liner', base=b, orm=o, normal=n, emissive=em, emissive_strength=1.0)
    mats['holder'] = d.gltf_material('qh_ab_flameholder', base=b, orm=o, normal=n, emissive=em, emissive_strength=1.0)
    for obn, k in (('airframe_skin', 'skin'), ('airframe_wing', 'wing'), ('airframe_hot', 'hot'), ('gear_parts', 'gear'), ('ab_liner', 'liner'), ('ab_flameholder', 'holder')):
        d.set_material(bpy.data.objects[obn], mats[k])
    objs = [bpy.data.objects[n] for n in ('quarterhorse', 'ab_glow', 'gear', 'airframe_skin', 'airframe_wing', 'airframe_hot', 'gear_parts', 'ab_liner', 'ab_flameholder')]
    for o in objs:
        if o.type != 'MESH':
            continue
        if o.data.attributes.get('pid'):
            o.data.attributes.remove(o.data.attributes['pid'])
        # caps are n-gons: triangulate them so the exporter can write MikkTSpace tangents (UVs are unchanged)
        bm = bmesh.new(); bm.from_mesh(o.data)
        ng = [f for f in bm.faces if len(f.verts) > 4]
        if ng:
            bmesh.ops.triangulate(bm, faces=ng, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(o.data); bm.free(); o.data.update()
    # film origin on the fuselage reference axis (as the film's shots are framed): nozzle axis at y = -0.155
    bpy.data.objects['quarterhorse'].location = (0.0, 0.0, ORIGIN_DZ)
    d.export_glb(GLB, objs)
    # only the anisotropic skins need stored tangents; the rest shade from derivative tangent frames
    glb_drop_attribute(GLB, 'TANGENT', keep=('airframe_skin', 'airframe_wing'))
    log(f'{os.path.basename(GLB)} {os.path.getsize(GLB) / 1e6:.2f} MB')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'qh_final.blend'))


def glb_drop_attribute(path, attr, keep=()):
    """Rewrite a .glb without vertex attribute `attr` on every mesh not named in `keep` (unused accessors and
    buffer views are removed and the binary chunk is repacked)."""
    import json
    import struct
    with open(path, 'rb') as f:
        magic, ver, _ = struct.unpack('<III', f.read(12))
        n, _t = struct.unpack('<II', f.read(8)); js = json.loads(f.read(n))
        n, _t = struct.unpack('<II', f.read(8)); blob = f.read(n)
    for m in js['meshes']:
        if m.get('name') in keep:
            continue
        for pr in m['primitives']:
            pr['attributes'].pop(attr, None)
    used = set()
    for m in js['meshes']:
        for pr in m['primitives']:
            used.update(pr['attributes'].values())
            if 'indices' in pr:
                used.add(pr['indices'])
    amap = {old: new for new, old in enumerate(sorted(used))}
    js['accessors'] = [js['accessors'][i] for i in sorted(used)]
    for m in js['meshes']:
        for pr in m['primitives']:
            pr['attributes'] = {k: amap[v] for k, v in pr['attributes'].items()}
            if 'indices' in pr:
                pr['indices'] = amap[pr['indices']]
    vused = sorted({a['bufferView'] for a in js['accessors']} | {im['bufferView'] for im in js.get('images', []) if 'bufferView' in im})
    vmap = {old: new for new, old in enumerate(vused)}
    out = bytearray(); views = []
    for i in vused:
        bv = dict(js['bufferViews'][i]); o = bv.get('byteOffset', 0)
        while len(out) % 4:
            out.append(0)
        bv['byteOffset'] = len(out); out += blob[o:o + bv['byteLength']]; views.append(bv)
    while len(out) % 4:
        out.append(0)
    js['bufferViews'] = views
    for a in js['accessors']:
        a['bufferView'] = vmap[a['bufferView']]
    for im in js.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = vmap[im['bufferView']]
    js['buffers'] = [{'byteLength': len(out)}]
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * (-len(jb) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', magic, ver, 12 + 8 + len(jb) + 8 + len(out)))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)


# ------------------------------------------------------------------ previews
def silhouette_side(path, view='side'):
    """Orthographic silhouette (white on black) matching the 4K reference photo's framing (171.5 px/m)."""
    sc = bpy.context.scene
    w = d.ensure_world((0, 0, 0))
    mat = bpy.data.materials.new('sil'); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs[0])
    saved = {}
    for o in bpy.data.objects:
        if o.type == 'MESH':
            saved[o.name] = [s.material for s in o.material_slots]
            o.data.materials.clear(); o.data.materials.append(mat)
    cd = bpy.data.cameras.new('ortho'); cd.type = 'ORTHO'
    co = bpy.data.objects.new('ortho', cd); sc.collection.objects.link(co); sc.camera = co
    if view == 'side':
        PX = 171.5; Wpx, Hpx = 1425, 455                # half of the photo crop (450..3300, 850..1760)
        cx = X0 - (3212 - (450 + 1425)) / PX
        cz = 0.255 + (1400 - 1305) / PX
        cd.ortho_scale = 2850 / PX
        co.location = (cx, -60, cz); co.rotation_euler = (np.pi / 2, 0, 0)
    else:
        PX = 1038 / 14.6; Wpx, Hpx = 800, 1660
        cd.ortho_scale = 1660 / PX
        cx = X0 - (830 - 307) / PX
        co.location = (cx, 0, 60); co.rotation_euler = (0, 0, -np.pi / 2)
    sc.render.resolution_x, sc.render.resolution_y = Wpx, Hpx
    sc.cycles.samples = 4
    sc.render.filepath = path
    sc.view_settings.view_transform = 'Standard'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(co)
    for o in bpy.data.objects:
        if o.name in saved:
            o.data.materials.clear()
            for m in saved[o.name]:
                o.data.materials.append(m)
    log('silhouette', path)


def preview_simple(path, cam, target, lens=50, size=(960, 540)):
    """Quick Cycles look at the shape with plain metals (no bakes)."""
    m1, b1, _, _ = d.new_material('pv_metal'); b1.inputs['Base Color'].default_value = (0.8, 0.81, 0.82, 1); b1.inputs['Metallic'].default_value = 1; b1.inputs['Roughness'].default_value = 0.3
    m2, b2, _, _ = d.new_material('pv_dark'); b2.inputs['Base Color'].default_value = (0.05, 0.05, 0.05, 1); b2.inputs['Metallic'].default_value = 0.6; b2.inputs['Roughness'].default_value = 0.5
    m3, b3, _, _ = d.new_material('pv_white'); b3.inputs['Base Color'].default_value = (0.7, 0.7, 0.68, 1); b3.inputs['Roughness'].default_value = 0.4
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        o.data.materials.clear()
        o.data.materials.append(m2 if o.name in ('airframe_hot', 'ab_liner', 'ab_flameholder') else (m3 if o.name == 'gear_parts' else m1))
    ground = None
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, G.GROUND))
    ground = bpy.context.active_object
    mg, bg, _, _ = d.new_material('pv_ground'); bg.inputs['Base Color'].default_value = (0.35, 0.32, 0.28, 1); bg.inputs['Roughness'].default_value = 0.9
    ground.data.materials.append(mg)
    d.preview(path, target=target, cam=cam, lens=lens, size=size, samples=24, sun_el=25, sun_az=200)
    bpy.data.objects.remove(ground)


# ------------------------------------------------------------------ main
if __name__ == '__main__':
    args = d.args()
    stage = args[0] if args else 'all'
    os.makedirs(SCRATCH, exist_ok=True)
    if stage in ('geo', 'all'):
        build()
        if '--preview' in args or stage == 'geo':
            silhouette_side(os.path.join(SCRATCH, 'sil_side.png'), 'side')
            silhouette_side(os.path.join(SCRATCH, 'sil_top.png'), 'top')
            preview_simple(os.path.join(SCRATCH, 'geo_34.png'), cam=(14, -13, 3.5), target=(0.5, 0, 0.2), lens=40)
            preview_simple(os.path.join(SCRATCH, 'geo_rear.png'), cam=(-14, 7, 1.2), target=(-3, 0, 0.2), lens=40)
    if stage in ('bake', 'all'):
        only = [a for a in args[1:] if a in SETS]
        bake_data(only or None)
    if stage in ('paint', 'all'):
        import qh_paint
        qh_paint.paint([a for a in args[1:] if a in SETS] or list(SETS))
    if stage in ('export', 'all'):
        export_glb()
