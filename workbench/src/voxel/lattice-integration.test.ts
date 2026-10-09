import {inspectOpenings} from '../geometry/openings';
import {test,expect} from 'bun:test';
import {modelSchema} from '../model-schema';
import {assetSchema,validateAssetParts} from '../geometry/layout';
import {validateScene,type SceneInput} from '../geometry/scene-contract';
import {voxelizeScene} from './voxelize';
import {prepareNativeRaster} from './native-raster';
import {compileGeometryProgram} from '../geometry/program';
import {validateVoxelGeometry} from './geometry-lattice';
const lattice={version:'voxel-lattice-v1' as const,cellSize:.1,origin:[0,0,0] as [number,number,number]};
const plan={requirements:[{id:'R1',critical:true,count:null}]};
function scene():SceneInput{
 return {version:'scene-v1',voxelLattice:structuredClone(lattice),program:{version:'geometry-v1',name:'严格格网门洞与板缝',materials:[{id:'gray',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'door',parts:[{id:'volume',material:'gray',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[7,2,7],operations:[{mode:'fill',min:[0,0,0],size:[7,2,7]},{mode:'erase',min:[3,0,0],size:[1,2,5]}]}}]},{id:'bridge',parts:[{id:'boards',material:'gray',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[5,8,2],operations:[{mode:'fill',min:[0,0,0],size:[5,2,2],repeat:{count:3,step:[0,3,0]}}]}}]}],instances:[{id:'wall',label:'墙',template:'door',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['R1']},{id:'planks',label:'板桥',template:'bridge',position:[2,0,0],rotation:[0,0,Math.PI/2],scale:[1,1,1],requirementIds:['R1']}]},entities:[{instanceId:'wall',role:'subject',category:'墙'},{instanceId:'planks',role:'subject',category:'桥'}],cameras:[{name:'参考',referenceIndex:1,position:[-3,-4,3],target:[0,0,.5],fov:.785,projection:'perspective',orthographicHeight:null},{name:'检查',referenceIndex:null,position:[3,4,3],target:[0,0,.5],fov:.785,projection:'perspective',orthographicHeight:null}],textures:[],lighting:{direction:[.4,-.6,-.7],color:[1,1,1],intensity:2,ambientColor:[1,1,1],ambientIntensity:.65,points:[]},assumptions:[]};
}
function owner(r:any,p:number[]){const c=p.map((n,k)=>Math.floor((n-r.program.origin[k])/r.program.cellSize));return r.grid.owners[c[0]+r.grid.size[0]*(c[1]+r.grid.size[1]*c[2])];}
test('strict source keeps frozen lattice through rotation and actual final conversion, preserving door and board voids',()=>{
 const source=scene(),before=JSON.stringify(source),r=voxelizeScene(source,plan,1,{}, {resolution:16});
 expect(r.program.cellSize).toBe(.1);expect(r.report.nativeLattice!.fallbackMeshes).toEqual([]);expect(r.report.nativeLattice!.exactMeshes).toHaveLength(2);
 expect(r.grid.filled).toBe(148);expect(owner(r,[.35,.05,.25])).toBe(0);expect(owner(r,[.25,.05,.25])).toBe(1);
 expect(owner(r,[1.75,.25,.05])).toBe(0);expect(owner(r,[1.9,.25,.05])).toBe(2);expect(JSON.stringify(source)).toBe(before);
 expect(r.scene.cameras).toEqual(source.cameras);expect(r.scene).not.toHaveProperty('voxelLattice');
});
test('strict semantic entry rejects tiny drift, changed scale, arbitrary angle, or mismatched shape spacing before rasterization',()=>{
 for(const mutate of [s=>s.program.instances[0].position[0]=.000123,s=>s.program.instances[0].rotation[2]=.00001,s=>s.program.instances[0].scale[1]=1.0001,s=>s.program.templates[0].parts[0].position[0]=.05,s=>s.program.templates[0].parts[0].shape.cellSize=.125]){
  const s:any=scene();mutate(s);expect(()=>validateScene(s,plan,1)).toThrow('VOXEL_LATTICE');expect(()=>voxelizeScene(s,plan,1,{})).toThrow('VOXEL_LATTICE');
 }
});
test('strict asset draft rejects continuous primitives and unsafe palettes; ordinary and legacy paths remain available',()=>{
 const s:any=scene(),brief={id:'door',label:'门墙',description:'贯通门洞',origin:'角',maxParts:8,materialIds:['gray'],bounds:{min:[0,0,0],max:[.7,.2,.7]}},layout={...s,program:{...s.program,templates:[brief]}};
 const asset:any={version:'asset-geometry-v1',template:structuredClone(s.program.templates[0])};expect(()=>validateAssetParts(asset,brief,layout,{})).not.toThrow();
 asset.template.parts[0].shape={type:'box',size:[.2,.2,.2],radius:0};expect(()=>validateAssetParts(asset,brief,layout,{})).toThrow('strict parts');
 delete layout.voxelLattice;expect(()=>validateAssetParts(asset,brief,layout,{})).toThrow('共享布局边界');
 s.program.materials[0].textureId='any';expect(()=>validateVoxelGeometry(s)).toThrow('opaque, untextured');
});
test('strict final refuses grid overflow and occupancy expansion rather than coarsening spacing or dropping entities',()=>{
 const wide=scene();wide.program.instances[1].position=[19.2,0,0];expect(()=>voxelizeScene(wide,plan,1,{})).toThrow('192');
 const crowded:any=scene();crowded.program.templates[0].parts[0].shape.dimensions=[80,80,80];crowded.program.templates[0].parts[0].shape.operations=[{mode:'fill',min:[0,0,0],size:[80,80,80]}];expect(()=>validateVoxelGeometry(crowded)).toThrow('500000');
});
test('strict native admission cannot fallback even if called directly with a transformed incompatible source',()=>{
 const s=scene();s.program.instances[0].rotation=[0,0,Math.PI/4];const compiled=compileGeometryProgram(s.program);
 expect(()=>prepareNativeRaster(s.program,compiled,lattice)).toThrow('no resampling fallback');
 const legacy=prepareNativeRaster(s.program,compiled);expect(legacy.provenance.fallbackMeshes).toHaveLength(1);
});
test('all model and incremental geometry schemas constrain strict shapes and inherited cell size; ordinary schemas stay continuous',()=>{
 for(const role of ['geometry-asset','scene-blockout','geometry']){
  const schema=modelSchema(role,{voxel:true,voxelLattice:lattice});const template=role==='geometry-asset'?schema.properties.template: schema.properties.templates.items;
  const p=template.properties.parts.items.properties;expect(p.shape.anyOf.map(s=>s.properties.type.enum[0])).toEqual(['voxelVolume']);expect(p.shape.anyOf[0].properties.cellSize.enum).toEqual([.1]);expect(p.scale.items.enum).toEqual([1]);
 }
 expect(assetSchema(true,lattice).properties.template.properties.parts.items.properties.shape.anyOf).toHaveLength(1);
 expect(modelSchema('geometry-asset').properties.template.properties.parts.items.properties.shape.anyOf.some(s=>s.properties.type.enum[0]==='box')).toBe(true);
 expect(modelSchema('geometry-asset').properties.template.properties.parts.items.properties.shape.anyOf.some(s=>s.properties.type.enum[0]==='voxelVolume')).toBe(false);
});

test('strict repair schemas never mutate already returned or future ordinary geometry constraints',()=>{const before=modelSchema('geometry-asset'),saved=JSON.stringify(before);modelSchema('scene-space',{grayboxRepair:true,voxel:true,voxelLattice:lattice});expect(JSON.stringify(before)).toBe(saved);expect(JSON.stringify(modelSchema('geometry-asset'))).toBe(saved);});
test('finished-scene repair keeps native volume and frozen spacing available on wire',()=>{const p=modelSchema('scene-refine',{repairComplexity:'complex',voxelLattice:lattice}).properties.parts.items.properties.part.properties;expect(p.shape.anyOf.map(s=>s.properties.type.enum[0])).toEqual(['voxelVolume']);expect(p.shape.anyOf[0].properties.cellSize.enum).toEqual([.1]);});

test('strict surface admission rejects procedural detail that compiles into texture before assets or final conversion',()=>{const source:any=scene();source.program.materials[0].surfaceDetail={seed:1,scale:1,variation:0,dirt:0,scratches:0,chips:0,vertical:0};expect(()=>validateVoxelGeometry(source)).toThrow('surfaceDetail');const s=modelSchema('scene-surface',{voxel:true,voxelLattice:lattice});expect(s.properties.materials.items.properties.surfaceDetail).toEqual({type:'null'});});

test('strict final world-baked meshes retain actual opening and contact coordinates after parent translation',()=>{const source=scene();source.program.instances[0].position=[3,0,0];source.spatialOpenings=[{id:'opening',label:'门洞',instanceId:'wall',center:[.35,0,.25],normal:[0,1,0],up:[0,0,1],width:.08,height:.35,clearDepth:.3,expectedBeyond:'open-background',beyondDescription:'门后空域',referenceIndices:[1],evidence:'原图门洞'}];source.spatialContacts=[{id:'anchor',label:'诊断连接点',kind:'support',aId:'wall',bId:'planks',points:[[0,0,0]],referenceIndices:[1],evidence:'固定坐标诊断，不称为接触合格'}];const before=JSON.stringify(source),r=voxelizeScene(source,plan,1,{});expect(r.scene.spatialOpenings[0].center).toEqual([3.35,0,.25]);expect(r.scene.spatialContacts[0].points).toEqual([[3,0,0]]);expect(inspectOpenings(source).checks[0].status).toBe(inspectOpenings(r.scene).checks[0].status);expect(JSON.stringify(source)).toBe(before);});

test('strict repair wire does not invite continuous screen scaling while ordinary repair retains it',()=>{expect(modelSchema('scene-refine',{voxelLattice:lattice}).properties.screenTargets.maxItems).toBe(0);expect(modelSchema('scene-refine').properties.screenTargets.maxItems).toBe(8);});
