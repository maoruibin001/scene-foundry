import {test,expect} from 'bun:test';
import {rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createVoxelDetailBasis} from '../voxel/detail-scene';
import {VOXEL_DETAIL_POLICY} from '../voxel/entity-detail';
import {runDir,save} from '../store';
import {voxelDetailGuard} from './refinement';
const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const part=(id='seed',x=0)=>({...pose(),id,position:[x,0,0],material:'m',shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[2,2,2],operations:[{mode:'fill',min:[0,0,0],size:[2,2,2],repeat:null}]}});
function fixture(){
 const templates=['a','b'].map(id=>({id,label:'原生构件',description:'结构',origin:'冻结原点',bounds:{min:[0,0,0],max:[1,1,1]},materialIds:['m'],maxParts:4}));
 const layout:any={version:'scene-layout-v1',voxelLattice:{version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]},program:{version:'geometry-v1',name:'固定骨架',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates,instances:templates.map((t,n)=>({...pose(),id:'i'+n,label:'构件',template:t.id,requirementIds:[]}))},entities:templates.map((_,n)=>({instanceId:'i'+n,role:'subject',category:'建筑'})),spatialOpenings:[],spatialContacts:[],spatialRelations:[],observedBindings:[],textures:[],textureReuse:[],cameras:[],lighting:{},assumptions:[]};
 const scene={...structuredClone(layout),version:'scene-v1',program:{...structuredClone(layout.program),templates:[{id:'a',parts:[part()]},{id:'b',parts:[part('seed',.5)]}]}};
 return {scene,basis:createVoxelDetailBasis(layout,scene)};
}

test('evidence-led refinement shares the sealed voxel detail guard of scene refinement',()=>{
 const id=randomUUID(),f=fixture();
 try{
  expect(voxelDetailGuard({voxelDetailPolicy:null},id,{})).toBeNull();
  expect(()=>voxelDetailGuard({voxelDetailPolicy:VOXEL_DETAIL_POLICY},id,{})).toThrow('VOXEL_DETAIL_BASIS_MISSING');
  mkdirSync(join(runDir(id),'generation'),{recursive:true});save(join(runDir(id),'generation/voxel-detail-basis.json'),f.basis);
  const guard=voxelDetailGuard({voxelDetailPolicy:VOXEL_DETAIL_POLICY},id,{})!;
  expect(()=>guard.assert(structuredClone(f.scene))).not.toThrow();
  const added=structuredClone(f.scene);added.program.materials.push({id:'mat_pipe_metal',color:[.2,.2,.2,1],roughness:.4,metallic:1,textureId:null});
  expect(()=>guard.assert(added)).toThrow('材料ID');
  const tuned=structuredClone(f.scene);tuned.program.materials[0].roughness=.3;
  expect(()=>guard.assert(tuned)).not.toThrow();
 }finally{rmSync(runDir(id),{recursive:true,force:true});}
});
