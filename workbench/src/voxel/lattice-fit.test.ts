import {expect,test,spyOn} from 'bun:test';
import {fitVoxelLattice,type VoxelLatticeFitOptions} from './lattice-fit';

const pose=(id:string,position:[number,number,number]=[0,0,0])=>({id,position,rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]});
function row(id='target',instanceId='bridge',offset=.05){
 const expected=[.4,.4,.6,.6],visible=expected.map((n,k)=>n+(k%2===0?offset:0));
 return {targetId:id,landmarkId:id,instanceIds:[instanceId],expected,visible,status:'measured-visible-extent',comparisonScope:'bound-instance-union',edgeResidual:Math.abs(offset)/Math.SQRT2,centreDelta:[offset,0],spanRatio:[1,1],pixels:100};
}
const report=(rows:any[])=>({version:'reference-visible-composition-v3',source:{observationSha256:'original-reference'},rows});
function fixture(){
 const options:VoxelLatticeFitOptions={space:{program:{instances:[pose('bridge'),pose('water'),pose('wall')]}},
  basePatch:{version:'graybox-space-repair-v8',instances:[],groups:[{templateId:'bridge_geometry',parts:[{id:'slats',shape:{type:'voxelVolume',cellSize:.1}}]}],parts:[],contacts:[{id:'bridge-end',points:[[0,0,0]]}],checks:[{relationIds:['bridge-gap'],evidence:'original-image'}],cameras:[],templates:[],reason:'Preserve the original bridge gaps and fit its visible extent.'},
  instanceIds:['bridge'],step:.01,axes:[0],maxEvaluations:24,
  measure:patch=>report([row('bridge-target','bridge',.03+(patch.instances.find(i=>i.id==='bridge')?.position[0]??0))])};
 return options;
}
test('整数拟合真实矩形范围，以至多两格位移改善已验证目标而仍要求Engine及独立验收',()=>{
 const f=fixture(),before=structuredClone({space:f.space,basePatch:f.basePatch}),result=fitVoxelLattice(f);
 expect(result.report.improved).toBe(true);expect(result.patch.instances).toEqual([pose('bridge',[-.02,0,0])]);
 expect(result.report.integerOffsets.bridge).toEqual([-2,0,0]);expect(result.report.after!.objective).toBeLessThan(result.report.before!.objective);
 expect(result.report.quality).toBe('not-assessed');expect(result.report.requiresActualPreview).toBe(true);expect(result.report.requiresIndependentAcceptance).toBe(true);
 expect(result.patch.groups).toEqual(f.basePatch.groups);expect(result.patch.contacts).toEqual(f.basePatch.contacts);expect(result.patch.checks).toEqual(f.basePatch.checks);
 expect(result.report.evaluations).toBeLessThanOrEqual(24);expect(result.report.attempts.every(a=>a.patchSha256.length===64)).toBe(true);
 expect(f.space).toEqual(before.space);expect(f.basePatch).toEqual(before.basePatch);
});
test('已有完整补丁的姿态为整数基点，保留rotation和scale及其他实例',()=>{
 const f=fixture();f.basePatch.instances=[{...pose('bridge',[.1,0,0]),rotation:[0,0,.3],scale:[1.2,1,1]},pose('water',[0,1,0])];
 f.measure=patch=>report([row('bridge-target','bridge',.03+(patch.instances.find(i=>i.id==='bridge')!.position[0]-.1))]);
 const result=fitVoxelLattice(f);
 expect(result.patch.instances[0]).toEqual({...f.basePatch.instances[0],position:[.08,0,0]});expect(result.patch.instances[1]).toEqual(f.basePatch.instances[1]);
});
test('补丁从真实场景实例取姿态但不携带template或需求等未允许字段',()=>{
 const f=fixture();Object.assign(f.space.program.instances[0],{template:'bridge_geometry',label:'板桥',requirementIds:['bridge-gap'],surfaceOverrides:[]});
 const result=fitVoxelLattice(f);expect(result.report.improved).toBe(true);expect(Object.keys(result.patch.instances[0]).sort()).toEqual(['id','position','rotation','scale']);
});
test('新的targetId、其他实例身份、观测版本或目标框不能制造预测改善',()=>{
 for(const corrupt of [
  (r:any)=>r.rows[0].targetId='fake-target',
  (r:any)=>r.rows[0].instanceIds=['water'],
  (r:any)=>r.source.observationSha256='new-reference',
  (r:any)=>r.version='older-measurement',
  (r:any)=>{r.rows[0].expected=[.1,.1,.3,.3];},
 ]){
  const f=fixture();let calls=0;
  f.measure=()=>{const value=report([row('bridge-target','bridge',calls++===0?.05:0)]);if(calls>1)corrupt(value);return value;};
  const result=fitVoxelLattice(f);
  expect(result.report.improved).toBe(false);expect(result.patch).toEqual(f.basePatch);expect(result.report.attempts.slice(1).every(a=>['invalid','rejected'].includes(a.status))).toBe(true);
 }
});
test('隐藏原可测对象或牺牲另一可测目标不能赢得较低总误差',()=>{
 for(const candidate of [
  [row('bridge-target','bridge',0)],
  [row('bridge-target','bridge',0),{...row('water-target','water',0),visible:null,pixels:0,status:'unverified'}],
  [row('bridge-target','bridge',0),row('water-target','water',.011)],
 ]){
  const f=fixture();let calls=0;f.measure=()=>report(calls++===0?[row('bridge-target','bridge',.1),row('water-target','water',.01)]:candidate);
  const result=fitVoxelLattice(f);expect(result.report.improved).toBe(false);expect(result.patch).toEqual(f.basePatch);
  expect(result.report.attempts.slice(1).every(a=>a.status==='rejected')).toBe(true);
 }
});
test('null和未核实共享绑定保持未核实，不作零误差或额外目标',()=>{
 const f=fixture(),baseMeasure=f.measure;
 f.measure=patch=>{const r=baseMeasure(patch);r.rows.push({...row('door','wall',0),comparisonScope:'unverified-binding-scope',status:'unverified',visible:null,pixels:null,edgeResidual:null,centreDelta:null,spanRatio:null});return r;};
 const result=fitVoxelLattice(f);expect(result.report.improved).toBe(true);expect(result.report.before!.targets).toHaveLength(1);expect(result.report.after!.targets).toHaveLength(1);
 f.measure=()=>report([{...row(),comparisonScope:'unverified-binding-scope',visible:null,pixels:null,edgeResidual:null}]);
 const unknown=fitVoxelLattice(f);expect(unknown.report.termination).toBe('no-measurable-targets');expect(unknown.report.evaluations).toBe(1);expect(unknown.patch).toEqual(f.basePatch);
});
test('冻结约束校验拒绝的候选只记录错误，不能被选择',()=>{
 const f=fixture();f.measure=patch=>{const x=patch.instances.find(i=>i.id==='bridge')?.position[0]??0;if(x<0)throw Error('接触点脱离冻结边界');return report([row('bridge-target','bridge',.03+x)]);};
 const result=fitVoxelLattice(f);expect(result.report.improved).toBe(false);expect(result.patch).toEqual(f.basePatch);
 expect(result.report.attempts.some(a=>a.status==='invalid'&&a.error.includes('接触点脱离冻结边界'))).toBe(true);
});
test('没有实际收益时保持完整basePatch不变，选择不宣称质量',()=>{
 const f=fixture();f.measure=()=>report([row('bridge-target','bridge',.02)]);
 const result=fitVoxelLattice(f);expect(result.report.improved).toBe(false);expect(result.report.status).toBe('not-improved');expect(result.patch).toEqual(f.basePatch);
 expect(result.report.basePatchSha256).toBe(result.report.selectedPatchSha256);expect(result.report.integerOffsets.bridge).toEqual([0,0,0]);
});
test('单次或24次预算均包含来源，最后合法候选不会因预算结束而丢失',()=>{
 const f=fixture();f.maxEvaluations=1;let calls=0;const measure=f.measure;f.measure=p=>{calls++;return measure(p);};
 const one=fitVoxelLattice(f);expect(calls).toBe(1);expect(one.report.evaluations).toBe(1);expect(one.report.improved).toBe(false);expect(one.report.termination).toBe('evaluation-budget');
 f.maxEvaluations=2;calls=0;const two=fitVoxelLattice(f);expect(calls).toBe(2);expect(two.report.improved).toBe(true);expect(two.patch.instances[0].position[0]).toBe(-.01);
 const full=fixture();full.instanceIds=['bridge','water','wall'];full.axes=[0,1];full.measure=p=>report([row('bridge-target','bridge',.1+(p.instances.find(i=>i.id==='bridge')?.position[0]??0))]);
 const result=fitVoxelLattice(full);expect(result.report.evaluations).toBeLessThanOrEqual(24);expect(result.report.maxEvaluations).toBe(24);
});
test('调用前和测量过程中支持AbortSignal，不选取取消后的候选',()=>{
 const f=fixture(),controller=new AbortController();f.signal=controller.signal;controller.abort(Error('user-cancel'));
 expect(()=>fitVoxelLattice(f)).toThrow('user-cancel');
 const active=fixture(),running=new AbortController();active.signal=running.signal;let calls=0;const measure=active.measure;
 active.measure=patch=>{if(++calls===2)running.abort(Error('cancel-during-measure'));return measure(patch);};
 expect(()=>fitVoxelLattice(active)).toThrow('cancel-during-measure');expect(calls).toBe(2);
});
test('20秒时间预算丢弃过时同步结果，不新增测量',()=>{
 const now=spyOn(Date,'now');let clock=0;now.mockImplementation(()=>clock);
 try{const f=fixture(),measure=f.measure;let calls=0;f.measure=patch=>{if(++calls===2)clock=20000;return measure(patch);};
  const result=fitVoxelLattice(f);expect(calls).toBe(2);expect(result.report.termination).toBe('time-budget');expect(result.report.improved).toBe(false);expect(result.patch).toEqual(f.basePatch);expect(result.report.attempts[1].status).toBe('time-budget');
 }finally{now.mockRestore();}
});
test('测量回调收到克隆，不能修改拟合输入、累计候选或冻结其他字段',()=>{
 const f=fixture(),before=structuredClone(f.basePatch),source=structuredClone(f.space),measure=f.measure;
 f.measure=patch=>{const value=measure(patch);patch.groups[0].parts[0].id='mutated';patch.contacts=[];patch.instances.push(pose('intruder'));return value;};
 const result=fitVoxelLattice(f);expect(result.patch.groups).toEqual(before.groups);expect(result.patch.contacts).toEqual(before.contacts);expect(result.patch.instances.some(i=>i.id==='intruder')).toBe(false);
 expect(f.basePatch).toEqual(before);expect(f.space).toEqual(source);
});
test('来源身份、轴数、步长和有限工作量入口校验',()=>{
 for(const change of [
  (f:any)=>f.instanceIds=['missing'],(f:any)=>f.instanceIds=['bridge','bridge'],(f:any)=>f.instanceIds=['bridge','water','wall','fourth'],
  (f:any)=>f.axes=[0,1,2],(f:any)=>f.axes=[3],(f:any)=>f.axes=[0,0],(f:any)=>f.step=0,(f:any)=>f.step=1.1,
  (f:any)=>f.maxEvaluations=25,(f:any)=>f.maxEvaluations=0,(f:any)=>f.basePatch.instances=[pose('unrelated')],
 ]){const f=fixture();change(f);expect(()=>fitVoxelLattice(f)).toThrow('体素整数布局拟合');}
});
