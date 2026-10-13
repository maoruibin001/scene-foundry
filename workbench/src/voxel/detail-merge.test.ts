import {test,expect} from 'bun:test';
import {mergeVoxelDetails} from './detail-merge';
import {allocateVoxelEntityDetails} from './entity-detail';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const part=(id:string,x=0)=>({...pose,id,material:'m',position:[x,0,0],shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[1,1,1],operations:[{mode:'fill',min:[0,0,0],size:[1,1,1],repeat:null}]}});
function fixture(){
 const templates=['a','b'].map(id=>({id,label:id,description:'结构',origin:'原点',bounds:{min:[0,0,0],max:[1,1,1]},materialIds:['m'],maxParts:4}));
 const layout:any={version:'scene-layout-v1',voxelLattice:{version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]},program:{version:'geometry-v1',name:'fixture',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates,instances:templates.map(t=>({...pose,id:'i_'+t.id,label:t.id,template:t.id,requirementIds:[]}))},textures:[],spatialOpenings:[],spatialContacts:[]};
 const accepted:any={program:{templates:templates.map(t=>({id:t.id,parts:[part('anchor')]}))}};
 const assets:any[]=templates.map(t=>({version:'asset-geometry-v1',template:{id:t.id,parts:[part('anchor'),part('detail',.6)]}}));
 return {layout,accepted,assets,allocation:allocateVoxelEntityDetails(layout,accepted)};
}
test('one precise merge conflict feeds only the implicated template and freezes every sibling',async()=>{
 const f=fixture(),before=JSON.stringify(f.assets);let calls=0;
 const result=await mergeVoxelDetails(f.layout,f.assets,f.accepted,f.allocation,{}, {signal:new AbortController().signal,canRepair:()=>true,repair:async(id,feedback,validate)=>{
  calls++;expect(id).toBe('b');expect(feedback.frozenSiblings).toEqual([f.assets[0]]);expect(feedback.error).toContain('同一格冲突');
  const corrected=structuredClone(f.assets[1]);corrected.template.parts[1].position[0]=.8;validate(corrected);return corrected;
 }});
 expect(calls).toBe(1);expect(result.repair?.attempts).toBe(1);expect(result.report.ownership.newOwnedCells).toBe(2);expect(JSON.stringify(f.assets)).toBe(before);
});
test('continued conflict, abort, or unavailable model budget never dispatches another repair',async()=>{
 const f=fixture();let calls=0;
 await expect(mergeVoxelDetails(f.layout,f.assets,f.accepted,f.allocation,{}, {signal:new AbortController().signal,canRepair:()=>true,repair:async()=>{calls++;return f.assets[1];}})).rejects.toThrow('同一格冲突');expect(calls).toBe(1);
 calls=0;await expect(mergeVoxelDetails(f.layout,f.assets,f.accepted,f.allocation,{}, {signal:new AbortController().signal,canRepair:()=>false,repair:async()=>{calls++;return f.assets[1];}})).rejects.toThrow('同一格冲突');expect(calls).toBe(0);
 const abort=new AbortController();abort.abort(Error('用户取消'));
 await expect(mergeVoxelDetails(f.layout,f.assets,f.accepted,f.allocation,{}, {signal:abort.signal,canRepair:()=>true,repair:async()=>{calls++;return f.assets[1];}})).rejects.toThrow('用户取消');expect(calls).toBe(0);
});
test('budget and missing-asset faults are not relabeled as repairable ownership feedback',async()=>{
 const f=fixture();let calls=0;
 await expect(mergeVoxelDetails(f.layout,[f.assets[0]],f.accepted,f.allocation,{}, {signal:new AbortController().signal,canRepair:()=>true,repair:async()=>{calls++;return f.assets[1];}})).rejects.toThrow('不齐全');expect(calls).toBe(0);
});
