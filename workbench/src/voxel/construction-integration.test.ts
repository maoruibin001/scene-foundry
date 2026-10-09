import {test,expect} from 'bun:test';
import {modelSchema} from '../model-schema';
import {assertBlockoutGeneration,compactBlockoutSchema,expandBlockoutGeometry} from '../geometry/blockout-contract';
import {GRAYBOX_SPACE_REPAIR,applyGrayboxSpaceRepair,grayboxSpaceRepairSchema} from '../geometry/graybox-space-repair';
import {assertProceduralHandoff,proceduralSeeds} from '../geometry/procedural-handoff';

const volume=()=>({type:'voxelVolume',cellSize:.1,origin:[-.5,0,0],dimensions:[10,2,12],operations:[{mode:'fill',min:[0,0,0],size:[10,2,12],repeat:null},{mode:'erase',min:[3,0,0],size:[4,2,8],repeat:null}]});
const part=()=>({id:'wall',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:volume()});
const types=(s:any)=>s.properties.templates.items.properties.parts.items.properties.shape.anyOf.map((x:any)=>x.properties.type.enum[0]);
test('native voxel construction is explicitly gated in model and repair wire schemas',()=>{
 expect(types(compactBlockoutSchema())).not.toContain('voxelVolume');
 expect(types(modelSchema('scene-blockout',{voxel:true}))).toContain('voxelVolume');
 const shape=(s:any)=>s.properties.groups.items.properties.parts.items.properties.shape.anyOf.map(x=>x.properties.type.enum[0]);
 expect(shape(grayboxSpaceRepairSchema())).not.toContain('voxelVolume');
 expect(shape(grayboxSpaceRepairSchema({voxel:true}))).toContain('voxelVolume');
 expect(modelSchema('scene-surface').properties.textures.maxItems).not.toBe(0);
 expect(modelSchema('scene-surface',{voxel:true}).properties.textures.maxItems).toBe(0);
 expect(modelSchema('scene-surface',{voxel:true}).properties.textureReuse.maxItems).toBe(0);
});
test('graybox native carve uses bounded real geometry; coarse budget cannot be evaded by schema omission',()=>{
 expect(assertBlockoutGeneration({templates:[{id:'t',parts:[part()]}]}).templates).toHaveLength(1);
 expect(()=>assertBlockoutGeneration({templates:[{id:'t',parts:[{...part(),shape:{...volume(),dimensions:[65,2,12]}}]}]})).toThrow('每轴最多64');
});
test('historical graybox patches cannot relabel new native operations as old evidence',()=>{
 const space={program:{templates:[],instances:[]},cameras:[],spatialRelations:[{id:'REL'}]};
 const patch={version:GRAYBOX_SPACE_REPAIR,reason:'原图门洞必须贯通，有依据使用整数挖空恢复纵深。',instances:[],templates:[],parts:[],groups:[{templateId:'t',parts:[part()]}],cameras:[],contacts:[],checks:[{relationIds:['REL'],evidence:'原图和实际灰模门洞没有贯通空间',expectedChange:'挖去门框中的整数体积并保留上梁'}]};
 expect(applyGrayboxSpaceRepair(space,patch,x=>x).value).toEqual(space);
 expect(()=>applyGrayboxSpaceRepair(space,{...patch,version:'graybox-space-repair-v7'},x=>x)).toThrow('历史灰模补丁');
});
test('accepted native voxel structural anchor survives material refinement and rejects occupancy or pose replacement',()=>{
 const seed=expandBlockoutGeometry({templates:[{id:'t',parts:[part()]}]}).templates[0];
 const scene={program:{templates:[seed]}};
 expect(proceduralSeeds(scene,'t')).toHaveLength(1);
 const asset={template:structuredClone(seed)};asset.template.parts[0].material='stone';
 expect(()=>assertProceduralHandoff(asset,scene)).not.toThrow();
 const solid=structuredClone(asset);solid.template.parts[0].shape.operations.pop();
 expect(()=>assertProceduralHandoff(solid,scene)).toThrow('填充/挖空');
 const shifted=structuredClone(asset);shifted.template.parts[0].position[0]=.1;
 expect(()=>assertProceduralHandoff(shifted,scene)).toThrow('姿态');
 const box=structuredClone(asset);box.template.parts[0].shape={type:'box',size:[1,.2,1.2],radius:0} as any;
 expect(()=>assertProceduralHandoff(box,scene)).toThrow('实心代理');
});
