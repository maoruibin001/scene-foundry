import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createVoxelDetailBasis,validateVoxelDetailBasis,assertVoxelDetailScene} from './detail-scene';
const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const part=(id='seed',x=0)=>({...pose(),id,position:[x,0,0],material:'m',shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[2,2,2],operations:[{mode:'fill',min:[0,0,0],size:[2,2,2],repeat:null}]}});
function fixture(){
 const templates=['a','b'].map(id=>({id,label:'原生构件',description:'结构',origin:'冻结原点',bounds:{min:[0,0,0],max:[1,1,1]},materialIds:['m'],maxParts:4}));
 const layout:any={version:'scene-layout-v1',voxelLattice:{version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]},program:{version:'geometry-v1',name:'固定骨架',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates,instances:templates.map((t,n)=>({...pose(),id:'i'+n,label:'构件',template:t.id,requirementIds:[]}))},entities:templates.map((_,n)=>({instanceId:'i'+n,role:'subject',category:'建筑'})),spatialOpenings:[],spatialContacts:[],spatialRelations:[],observedBindings:[],textures:[],textureReuse:[],cameras:[],lighting:{},assumptions:[]};
 const acceptedScene={...structuredClone(layout),version:'scene-v1',program:{...structuredClone(layout.program),templates:[{id:'a',parts:[part()]},{id:'b',parts:[part('seed',.5)]}]}};
 const value=structuredClone(acceptedScene),basis=createVoxelDetailBasis(layout,acceptedScene);
 return {layout,acceptedScene,value,basis};
}
test('basis is cloned, allocation is independently derived, and changed budgets never authorize refinement',()=>{
 const f=fixture(),before=JSON.stringify(f.basis);
 f.layout.program.templates[0].bounds.max=[2,2,2];expect(JSON.stringify(f.basis)).toBe(before);
 expect(validateVoxelDetailBasis(f.basis)).toBe(f.basis);
 const edited=structuredClone(f.basis);edited.allocation.templates[0].maximum.occupiedCells++;
 expect(()=>validateVoxelDetailBasis(edited)).toThrow('分配与已接受原生基线不一致');
});
test('later scene may improve existing materials, cameras and lighting while retaining native anchors',()=>{
 const f=fixture();f.value.program.materials[0].color=[.8,.2,.1,1];f.value.program.materials[0].roughness=.3;
 f.value.cameras=[{name:'改进机位',position:[2,2,2],target:[0,0,0],referenceIndex:null,fov:1}];f.value.lighting={ambientIntensity:.8};
 f.value.program.templates[0].parts.push(part('detail',.8));
 expect(assertVoxelDetailScene(f.value,f.basis,{}).budget.occupiedCells).toBe(24);
});
test('later quality patches cannot remove or alter coarse seeds despite ordinary geometry still being native',()=>{
 const f=fixture(),changed=structuredClone(f.value);changed.program.templates[0].parts[0].shape.operations[0].size=[1,2,2];
 expect(()=>assertVoxelDetailScene(changed,f.basis,{})).toThrow('PROCEDURAL_STRUCTURE_CHANGED');
 const missing=structuredClone(f.value);missing.program.templates[0].parts=[part('detail',.8)];
 expect(()=>assertVoxelDetailScene(missing,f.basis,{})).toThrow('PROCEDURAL_STRUCTURE_CHANGED');
});
test('later patches cannot redefine lattice, template/material/entity identities, poses, or safety declarations',()=>{
 const f=fixture();
 const changes=[
  ['格网',(v:any)=>v.voxelLattice.cellSize=.2],
  ['模板身份',(v:any)=>v.program.templates[0].id='new'],
  ['实例身份',(v:any)=>v.program.instances[0].id='new'],
  ['实例骨架',(v:any)=>v.program.instances[0].position=[.1,0,0]],
  ['材料ID',(v:any)=>v.program.materials[0].id='new'],
  ['实体语义',(v:any)=>v.entities[0].category='更改类别'],
  ['spatialOpenings',(v:any)=>v.spatialOpenings=[{id:'shrunk'}]],
  ['spatialContacts',(v:any)=>v.spatialContacts=[{id:'moved'}]],
  ['spatialRelations',(v:any)=>v.spatialRelations=[{id:'relabeled'}]],
  ['observedBindings',(v:any)=>v.observedBindings=[{landmarkId:'relabeled'}]],
 ] as const;
 for(const [reason,edit] of changes){const v=structuredClone(f.value);edit(v);expect(()=>assertVoxelDetailScene(v,f.basis,{})).toThrow(reason);}
});
test('quality-stage newly occupied cells still reject frozen other-owner and sibling conflicts',()=>{
 const f=fixture(),foreign=structuredClone(f.value);foreign.program.templates[0].parts.push(part('detail',.5));
 expect(()=>assertVoxelDetailScene(foreign,f.basis,{})).toThrow('侵入其他实体');
 const siblings=structuredClone(f.value);for(const template of siblings.program.templates)template.parts.push(part('detail',.8));
 expect(()=>assertVoxelDetailScene(siblings,f.basis,{})).toThrow('新增细节实体在同一格冲突');
});
test('refinement without a sealed detail basis fails before any model invocation or runtime read',async()=>{
 const root=mkdtempSync(join(tmpdir(),'voxel-detail-refine-')),source=new URL('../',import.meta.url).pathname;
 const script=`
 import {mock} from 'bun:test';import assert from 'node:assert/strict';
 let calls=0;mock.module(${JSON.stringify(source+'contracts.ts')},()=>({NoActionableChange:class extends Error{},isProviderFailure:()=>false,callValidated:async()=>{calls++;throw Error('unexpected model call');}}));
 const {refineScene}=await import(${JSON.stringify(source+'geometry/refinement.ts')});
 await assert.rejects(()=>refineScene({sceneKind:'voxel',voxelDetailPolicy:'voxel-detail-v1',reuseSceneFrom:crypto.randomUUID()}, {}, [], ${JSON.stringify(join(root,'generation'))}, new AbortController().signal),/VOXEL_DETAIL_BASIS_MISSING/);
 assert.equal(calls,0);console.log('sealed basis fail-fast: 0 model calls');
 `;
 try{const child=Bun.spawn([process.execPath,'--eval',script],{cwd:join(source,'..'),env:{...process.env,PIPELINE_DATA_DIR:join(root,'data'),PIPELINE_PROVIDER:'codex-cli'},stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(stderr).toBe('');expect(exit).toBe(0);expect(stdout).toContain('0 model calls');
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);

test('a repair may rebind a part to another frozen material, never to a new one',()=>{
 // Camp 08f393d2: rebinding the tent lining and chimney to existing scene materials was refused as unallocated four times.
 const f=fixture(),second={...f.layout.program.materials[0],id:'n',color:[.3,.2,.1,1]};
 const layout=structuredClone(f.layout);layout.program.materials.push(second);layout.program.templates[1].materialIds=['n'];
 const accepted=structuredClone(f.acceptedScene);accepted.program.materials.push(second);accepted.program.templates[1].parts[0].material='n';
 const basis=createVoxelDetailBasis(layout,accepted),rebound=structuredClone(accepted);rebound.program.templates[0].parts[0].material='n';
 expect(()=>assertVoxelDetailScene(rebound,basis,{})).not.toThrow();
 const invented=structuredClone(rebound);invented.program.templates[0].parts[0].material='z';
 expect(()=>assertVoxelDetailScene(invented,basis,{})).toThrow();
});
