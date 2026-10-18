import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertVoxelDetailPreservation,assertVoxelDetailOwnership,voxelOverrideSources} from './detail-ownership';
import {inspectOpenings} from '../geometry/openings';
import {recordedRun} from '../recorded-runs';

const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const part=(id='seed',origin=[0,0,0],dimensions=[1,1,1],operations:any[]=[{mode:'fill',min:[0,0,0],size:dimensions,repeat:null}])=>({...pose(),id,material:'m',shape:{type:'voxelVolume',cellSize:.1,origin,dimensions,operations}});
const asset=(id:string,parts:any[]):any=>({version:'asset-geometry-v1',template:{id,parts}});
function fixture(){
 const materials=[{id:'m',color:[.4,.4,.4,1],textureId:null,roughness:1,metallic:0}];
 const briefs=['a','b'].map(id=>({id,label:'主体',description:'细化主体',origin:'共同原点',bounds:{min:[0,0,0],max:[2,2,2]},materialIds:['m'],maxParts:4}));
 const layout:any={voxelLattice:{version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]},program:{version:'geometry-v1',name:'所有权保持',materials,templates:briefs,instances:briefs.map((b,n)=>({...pose(),id:'i'+n,label:'主体',template:b.id,requirementIds:[]}))},spatialOpenings:[]};
 const assets=[asset('a',[part()]),asset('b',[part('seed',[1,0,0])])];
 const accepted:any={program:{...layout.program,templates:assets.map(a=>structuredClone(a.template))},voxelLattice:layout.voxelLattice};
 return {layout,briefs,assets,accepted};
}
test('full requires every accepted seed and exact structure; partial may omit not-yet-uploaded seeds',()=>{
 const f=fixture();
 expect(()=>assertVoxelDetailPreservation(asset('a',[]),f.briefs[0],f.layout,f.accepted)).toThrow('PROCEDURAL_STRUCTURE_CHANGED');
 expect(assertVoxelDetailPreservation(asset('a',[]),f.briefs[0],f.layout,f.accepted,{partial:true}).addedOccupiedUpperBound).toBe(0);
 const changed=asset('a',[part()]);changed.template.parts[0].shape.operations[0].size=[1,1,2];
 for(const options of [{},{partial:true}])expect(()=>assertVoxelDetailPreservation(changed,f.briefs[0],f.layout,f.accepted,options)).toThrow('PROCEDURAL_STRUCTURE_CHANGED');
 const recolor=asset('a',[{...part(),material:'m'}]);expect(()=>assertVoxelDetailPreservation(recolor,f.briefs[0],f.layout,f.accepted)).not.toThrow();
});
test('new detail may use empty cells inside another coarse envelope, but cannot take its actual occupied cells',()=>{
 const f=fixture(),legal=asset('a',[part(),part('detail',[1.1,0,0])]);
 expect(assertVoxelDetailPreservation(legal,f.briefs[0],f.layout,f.accepted).addedOccupiedUpperBound).toBe(1);
 const blocked=asset('a',[part(),part('detail',[1,0,0])]);
 expect(()=>assertVoxelDetailPreservation(blocked,f.briefs[0],f.layout,f.accepted)).toThrow('侵入其他实体已接受格 10,0,0');
 expect(()=>assertVoxelDetailPreservation(asset('a',[blocked.template.parts[1]]),f.briefs[0],f.layout,f.accepted,{partial:true})).toThrow('侵入其他实体');
});
test('world ownership follows every instance and quarter-turn transform',()=>{
 const f=fixture();f.layout.program.instances[1].position=[0,1,0];f.layout.program.instances[1].rotation=[0,0,Math.PI/2];
 // b seed local[1,0,0] -> world center[-.05,2.05,.05] -> cell[-1,20,0].
 const collision=asset('a',[part(),part('detail',[-.1,2,0])]);
 expect(()=>assertVoxelDetailPreservation(collision,f.briefs[0],f.layout,f.accepted)).toThrow('侵入其他实体已接受格 -1,20,0');
});
test('merge rejects sibling newly occupied overlap even though both individually pass coarse ownership',()=>{
 const f=fixture(),a=asset('a',[part(),part('d',[.5,.5,0])]),b=asset('b',[part('seed',[1,0,0]),part('d',[.5,.5,0])]);
 expect(()=>assertVoxelDetailPreservation(a,f.briefs[0],f.layout,f.accepted)).not.toThrow();
 expect(()=>assertVoxelDetailPreservation(b,f.briefs[1],f.layout,f.accepted)).not.toThrow();
 expect(()=>assertVoxelDetailOwnership(f.layout,[a,b],f.accepted)).toThrow('新增细节实体在同一格冲突');
});
test('historical coarse overlap remains legal and is not mislabeled as a new collision',()=>{
 const f=fixture();f.assets[1]=asset('b',[part()]);f.accepted.program.templates=f.assets.map(a=>a.template);
 const a=asset('a',[part(),part('color-layer')]),b=asset('b',[part(),part('color-layer')]);
 const report=assertVoxelDetailOwnership(f.layout,[a,b],f.accepted);
 expect(report.baselineOwnedCells).toBe(1);expect(report.baselineOccupiedUpperBound).toBe(2);expect(report.newOwnedCells).toBe(0);
});
test('single clear opening sample cannot become blocked below the old 80% threshold; repeated instances are checked',()=>{
 const f=fixture();
 const portal=part('seed',[0,0,0],[10,1,10],[{mode:'fill',min:[0,0,0],size:[10,1,10],repeat:null},{mode:'erase',min:[3,0,0],size:[4,1,8],repeat:null}]);
 f.assets[0]=asset('a',[portal]);f.accepted.program.templates=f.assets.map(a=>structuredClone(a.template));
 f.layout.program.instances.push({...pose(),id:'second_a',label:'复用门洞',template:'a',position:[2,0,0],requirementIds:[]});
 const opening={id:'portal',label:'已接受门洞',instanceId:'i0',center:[.5,-.05,.4],normal:[0,1,0],up:[0,0,1],width:.3,height:.6,clearDepth:.4,expectedBeyond:'open-background',beyondDescription:'背景',referenceIndices:[],evidence:'可见开口'};
 f.layout.spatialOpenings=[opening,{...opening,id:'portal2',instanceId:'second_a'}];
 const baseline=assertVoxelDetailPreservation(f.assets[0],f.briefs[0],f.layout,f.accepted);
 expect(baseline.openings.checked).toBe(2);expect(baseline.openings.clearSamples).toBe(50);
 const added=part('thin-bar',[.4,0,.3]),value=asset('a',[portal,added]);
 const program={...f.layout.program,templates:[value.template],instances:f.layout.program.instances.filter((i:any)=>i.template==='a')};
 const report=inspectOpenings({program,spatialOpenings:f.layout.spatialOpenings},{assetTemplateId:'a'});
 expect(report.checks[0].blockedFraction).toBeGreaterThan(0);expect(report.checks[0].blockedFraction).toBeLessThan(.8);
 for(const options of [{},{partial:true}])expect(()=>assertVoxelDetailPreservation(value,f.briefs[0],f.layout,f.accepted,options)).toThrow('封堵已接受开口');
});
test('large hollow frozen volume records only occupied cells, with no input mutation',()=>{
 const f=fixture();f.assets[0]=asset('a',[part('seed',[0,0,0],[100,100,100],[{mode:'fill',min:[99,99,99],size:[1,1,1],repeat:null}])]);
 f.accepted.program.templates=f.assets.map(a=>a.template);const before=JSON.stringify(f);
 const report=assertVoxelDetailPreservation(f.assets[0],f.briefs[0],f.layout,f.accepted);
 expect(report.baselineOwnedCells).toBe(2);expect(report.baselineOccupiedUpperBound).toBe(2);expect(JSON.stringify(f)).toBe(before);
});
test('merge protects clear opening samples from details belonging to a different template',()=>{
 const f=fixture(),portal=part('seed',[0,0,0],[10,1,10],[{mode:'fill',min:[0,0,0],size:[10,1,10],repeat:null},{mode:'erase',min:[3,0,0],size:[4,1,8],repeat:null}]);
 f.assets[0]=asset('a',[portal]);f.accepted.program.templates=f.assets.map(a=>structuredClone(a.template));
 f.layout.spatialOpenings=[{id:'portal',label:'开口',instanceId:'i0',center:[.5,-.05,.4],normal:[0,1,0],up:[0,0,1],width:.3,height:.6,clearDepth:.4,expectedBeyond:'open-background',beyondDescription:'背景',referenceIndices:[],evidence:'参考开口'}];
 const b=asset('b',[part('seed',[1,0,0]),part('other-bar',[.4,0,.3])]);
 expect(()=>assertVoxelDetailPreservation(b,f.briefs[1],f.layout,f.accepted)).not.toThrow();
 expect(()=>assertVoxelDetailOwnership(f.layout,[f.assets[0],b],f.accepted)).toThrow('封堵已接受开口');
});
test('384k occupied-cell ownership remains bounded and supports sparse new detail',()=>{
 const f=fixture();
 f.assets[0]=asset('a',[part('seed',[0,0,0],[80,80,60])]);f.assets[1]=asset('b',[part('seed',[9,0,0])]);
 f.accepted.program.templates=f.assets.map(a=>structuredClone(a.template));
 const value=asset('a',[f.assets[0].template.parts[0],part('detail',[8,0,0])]);
 const report=assertVoxelDetailPreservation(value,f.briefs[0],f.layout,f.accepted);
 expect(report.baselineOwnedCells).toBe(384_001);expect(report.addedOccupiedUpperBound).toBe(1);
});

test('override sources list what real parts must carry and how many cells every instance can still take',()=>{
 const f=fixture();f.layout.program.instances[0].surfaceOverrides=[{sourceMaterialId:'m2',targetMaterialId:'m',uvScale:null}];
 const s=voxelOverrideSources(f.briefs[0],f.layout,f.accepted);
 expect(s.requiredSourceMaterialIds).toEqual(['m2']);expect(s.seedPartIds).toEqual(['seed']);
 // 20^3 bounds cells, one taken by template b at 10,0,0; the seed's own cell stays usable.
 expect(s.cellsUsableByEveryInstance).toBe(7999);
 expect(voxelOverrideSources(f.briefs[1],f.layout,f.accepted)).toMatchObject({requiredSourceMaterialIds:[],cellsUsableByEveryInstance:null});
 // A recolour overlay on the seed's own cells takes no other owner's cell; it still counts toward the expanded upper bound.
 expect(()=>assertVoxelDetailPreservation(asset('a',[part(),{...part('tint'),material:'m2'}]),f.briefs[0],f.layout,f.accepted)).not.toThrow();
});
test.skipIf(!recordedRun('a68ff1ce'))('recorded temple green cluster: both override sources required and no cell beyond the seed is safe',()=>{
 // Read-only replay of the recorded 2026-10-18 detail basis.
 const basis=JSON.parse(readFileSync(join(recordedRun('a68ff1ce')!,'generation/voxel-detail-basis.json'),'utf8'));
 const brief=basis.layout.program.templates.find((t:any)=>t.id==='green_cluster'),s=voxelOverrideSources(brief,basis.layout,basis.acceptedScene);
 expect(s.requiredSourceMaterialIds.sort()).toEqual(['mat_green_light','mat_green_sage']);
 expect(s.cellsUsableByEveryInstance).toBe(102);
});
