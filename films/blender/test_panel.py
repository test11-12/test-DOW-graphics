# Pipeline check: a bevelled, scanned-metal panel box baked to glTF maps -> assets/_test/panel.glb
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import bpy
import dowlib as d

d.reset()
d.ensure_world()
bpy.ops.mesh.primitive_cube_add(size=1)
ob = bpy.context.active_object
ob.name = 'panel'
ob.scale = (2.0, 1.0, 0.3)
bpy.ops.object.transform_apply(scale=True)
d.bevel(ob, 0.012, segments=3)
d.smooth(ob, 40)
d.smart_uv(ob, 66, 0.004)
print(d.stats(ob), 'texel', round(d.texel_density(ob, 1024) * 1000, 2), 'mm')

# detailed source material: scanned metal, tri-planar, worn bright at the edges, grimy where enclosed
src = d.polyhaven_texture('metal_plate', '2k', maps=('Diffuse', 'nor_gl', 'Rough', 'Metal'))
mat, bsdf, nodes, links = d.new_material('panel_src')
nt = mat.node_tree
tc = d.texcoord(nt)
col = d.tex(nt, d.image(src['Diffuse']), tc.outputs['Object'], 'BOX', 0.2, scale=0.5)
rough = d.tex(nt, d.image(src['Rough'], True), tc.outputs['Object'], 'BOX', 0.2, scale=0.5)
nrm = d.tex(nt, d.image(src['nor_gl'], True), tc.outputs['Object'], 'BOX', 0.2, scale=0.5)
edge = d.edge_mask(nt, 0.01)
ao = d.ao_mask(nt, 0.25)
worn = d.mix_rgb(nt, col.outputs['Color'], (0.85, 0.85, 0.86), d.math_node(nt, 'MULTIPLY', edge, 2.5, True))
grime = d.mix_rgb(nt, (0.12, 0.11, 0.1), worn, d.math_node(nt, 'POWER', ao, 0.6))
links.new(grime, bsdf.inputs['Base Color'])
links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
bsdf.inputs['Metallic'].default_value = 1.0
links.new(d.normal_map(nt, nrm.outputs['Color'], 1.0), bsdf.inputs['Normal'])
d.set_material(ob, mat)

maps = d.bake_pbr([ob], 1024, 'panel', d.bake_dir('_test'), ao_samples=64)
d.swap_to_baked([ob], 'panel', maps)
d.export_glb(d.out_path('_test', 'panel.glb'), [ob])
d.preview('/tmp/claude-0/-home-user-test-DOW-graphics/24d856ac-11c5-5d46-b31d-fe2100eb7024/scratchpad/work/blender/panel_preview.png', cam=(2.6, -2.4, 1.5), lens=40)
