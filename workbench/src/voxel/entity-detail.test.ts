import {test,expect} from 'bun:test';
import {VOXEL_DETAIL_POLICY,voxelDetailPolicyFor,allocateVoxelEntityDetails,voxelEntityAllocation,validateVoxelEntityDetail,assertVoxelDetailAssembly} from './entity-detail';
import {VOXEL_VOLUME_LIMITS} from '../geometry/voxel-volume';

const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const volume=(dimensions=[4,4,4],operations:any[]=[{mode:'fill',min:[0,0,0],size:dimensions,repeat:null}])=>({type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions,operations});
const part=(shape:any=volume(),id='anchor')=>({...pose(),id,material:'m',shape});
const asset=(id='t',parts:any[]=[part()]):any=>({version:'asset-geometry-v1',template:{id,parts}});
function fixture(counts=[1],maxParts=[4]){
 const briefs=counts.map((_,n)=>({id:'t'+n,label:'可见结构',description:'完整保留门洞',origin:'共同格原点',bounds:{min:[0,0,0],max:[2,2,2]},materialIds:['m'],maxParts:maxParts[n]??4}));
 const layout:any={version:'scene-layout-v1',voxelLattice:{version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]},program:{version:'geometry-v1',name:'体素精修',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:briefs,instances:counts.flatMap((count,n)=>Array.from({length:count},(_,i)=>({...pose(),id:'i'+n+'_'+i,label:'主体',template:'t'+n,requirementIds:[]})))},textures:[],textureReuse:[],spatialOpenings:[]};
 const assets=briefs.map(b=>asset(b.id)),accepted={program:{templates:assets.map(a=>a.template)}};
 return {layout,briefs,assets,accepted};
}

test('new voxel policy is explicit and historical/source policy never silently upgrades',()=>{
 expect(voxelDetailPolicyFor('voxel')).toBe(VOXEL_DETAIL_POLICY);
 expect(voxelDetailPolicyFor('ordinary')).toBeNull();
 expect(voxelDetailPolicyFor('voxel',{})).toBeNull();
 expect(voxelDetailPolicyFor('voxel',{voxelDetailPolicy:null})).toBeNull();
 expect(voxelDetailPolicyFor('voxel',{voxelDetailPolicy:VOXEL_DETAIL_POLICY})).toBe(VOXEL_DETAIL_POLICY);
 expect(()=>voxelDetailPolicyFor('voxel',{voxelDetailPolicy:'voxel-detail-v9'})).toThrow('未知精修策略');
});

test('allocation reserves actual accepted native work and divides occupancy by repeated instances',()=>{
 const f=fixture([1,8],[4,4]),before=JSON.stringify(f),allocation=allocateVoxelEntityDetails(f.layout,f.accepted);
 expect(JSON.stringify(f)).toBe(before);
 expect(allocation.expandedMinimum.gridCells).toBe(128); // unique templates, not 9 instances
 expect(allocation.expandedMinimum.operationCells).toBe(128);
 expect(allocation.expandedMinimum.occupiedCells).toBe(64*9);
 expect(allocation.expandedMaximum.gridCells).toBeLessThanOrEqual(VOXEL_VOLUME_LIMITS.programCells);
 expect(allocation.expandedMaximum.operationCells).toBeLessThanOrEqual(VOXEL_VOLUME_LIMITS.programWrites);
 expect(allocation.expandedMaximum.occupiedCells).toBeLessThanOrEqual(500_000);
 const repeated=voxelEntityAllocation(allocation,'t1');
 expect(repeated.instances).toBe(8);expect(repeated.maximum.occupiedCells).toBe(voxelEntityAllocation(allocation,'t0').maximum.occupiedCells);
 expect(repeated.maximum.occupiedCells*8+voxelEntityAllocation(allocation,'t0').maximum.occupiedCells).toBeLessThanOrEqual(500_000);
 expect(repeated.maximum.operations).toBe(4*VOXEL_VOLUME_LIMITS.operations);
 expect(repeated.maximum.expandedOperations).toBe(4*VOXEL_VOLUME_LIMITS.expandedOperations);
});

test('minimum accepted occupied structure can exceed equal shares without being discarded',()=>{
 const f=fixture([1,1],[1,1]);
 f.briefs[0].bounds.max=[5,5,5];f.accepted.program.templates[0].parts=[part(volume([50,50,50]))];
 const allocation=allocateVoxelEntityDetails(f.layout,f.accepted);
 expect(allocation.templates[0].minimum.occupiedCells).toBe(125_000);
 expect(allocation.templates[0].maximum.occupiedCells).toBeGreaterThanOrEqual(125_000);
 expect(allocation.templates[1].maximum.occupiedCells).toBeLessThan(allocation.templates[0].maximum.occupiedCells);
});

test('all instances including ground/context count toward 64, and missing accepted templates reject',()=>{
 const f=fixture([65]);f.layout.entities=f.layout.program.instances.map((i:any)=>({instanceId:i.id,role:'ground',category:'地面'}));
 expect(()=>allocateVoxelEntityDetails(f.layout,f.accepted)).toThrow('含ground、context、subject');
 const g=fixture([1,1]);g.accepted.program.templates.pop();
 expect(()=>allocateVoxelEntityDetails(g.layout,g.accepted)).toThrow('缺少唯一原生模板');
});

test('large hollow native bounds charge actual filled occupancy, never bounds volume as filled cells',()=>{
 const f=fixture();f.briefs[0].bounds.max=[10,10,10];
 const value=asset('t0',[part(volume([100,100,100],[{mode:'fill',min:[99,99,99],size:[1,1,1],repeat:null}]))]);
 f.accepted.program.templates=[value.template];
 const allocation=allocateVoxelEntityDetails(f.layout,f.accepted),measured=validateVoxelEntityDetail(value,f.briefs[0],f.layout,allocation,{});
 expect(measured.voxelMetrics.gridCells).toBe(1_000_000);expect(measured.voxelMetrics.occupiedCells).toBe(1);
 expect(measured.voxelMetrics.operationCells).toBe(1);
 expect(assertVoxelDetailAssembly(f.layout,[value],allocation,{}).occupiedCells).toBe(1);
});

test('ordered erase and repeat use native occupancy and write semantics without legacy 512-op cap',()=>{
 const f=fixture();
 const shape=volume([12,4,4],[{mode:'fill',min:[0,0,0],size:[2,4,4],repeat:{count:6,step:[2,0,0]}},{mode:'erase',min:[2,0,0],size:[8,4,4],repeat:null}]);
 const value=asset('t0',[part(shape)]);f.accepted.program.templates=[value.template];
 const allocation=allocateVoxelEntityDetails(f.layout,f.accepted),m=validateVoxelEntityDetail(value,f.briefs[0],f.layout,allocation,{}).voxelMetrics;
 expect(m.operations).toBe(2);expect(m.expandedOperations).toBe(7);expect(m.operationCells).toBe(320);expect(m.occupiedCells).toBe(64);
});

test('preview and partial checkpoint reject native allocation excess before any render',()=>{
 const f=fixture([1,1],[1,1]),allocation=allocateVoxelEntityDetails(f.layout,f.accepted);
 const altered=structuredClone(allocation);altered.templates[0].maximum.operationCells=64;
 const value=asset('t0',[part(volume([4,4,4],[{mode:'fill',min:[0,0,0],size:[4,4,4],repeat:null},{mode:'erase',min:[0,0,0],size:[1,1,1],repeat:null}]))]);
 for(const options of [{},{partial:true}])expect(()=>validateVoxelEntityDetail(value,f.briefs[0],f.layout,altered,{},options)).toThrow('operationCells 65 超过分配 64');
});

test('new detail policy rejects non-native, changed cell spacing and exact envelope drift',()=>{
 const f=fixture(),allocation=allocateVoxelEntityDetails(f.layout,f.accepted);
 expect(()=>validateVoxelEntityDetail(asset('t0',[part({type:'box',size:[.4,.4,.4],radius:0})]),f.briefs[0],f.layout,allocation,{})).toThrow('strict parts must use voxelVolume');
 expect(()=>validateVoxelEntityDetail(asset('t0',[part({...volume(),cellSize:.2})]),f.briefs[0],f.layout,allocation,{})).toThrow('spacing differs');
 // The ordinary 5% envelope tolerance would permit this .1m drift.
 const shifted=asset('t0',[{...part(volume([1,1,1])),position:[2,0,0]}]);
 expect(()=>validateVoxelEntityDetail(shifted,f.briefs[0],f.layout,allocation,{})).toThrow('精修几何超出冻结边界');
});

test('merge validates saved candidates again and rejects missing, duplicated, or changed repetition',()=>{
 const f=fixture([1,4]),allocation=allocateVoxelEntityDetails(f.layout,f.accepted);
 const report=assertVoxelDetailAssembly(f.layout,f.assets,allocation,{});expect(report.occupiedCells).toBe(320);expect(report.gridCells).toBe(128);
 expect(()=>assertVoxelDetailAssembly(f.layout,[f.assets[0]],allocation,{})).toThrow('不齐全');
 expect(()=>assertVoxelDetailAssembly(f.layout,[f.assets[0],f.assets[0]],allocation,{})).toThrow('身份重复');
 const layout=structuredClone(f.layout);layout.program.instances.pop();
 expect(()=>assertVoxelDetailAssembly(layout,f.assets,allocation,{})).toThrow('实例倍数已改变');
});
