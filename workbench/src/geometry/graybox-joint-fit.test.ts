import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {read,save} from '../store';
import {jointFitBlockedRound} from './graybox-space-repair';
import {jointFitCheck,assertJointFit,JOINT_FIT,JOINT_FIT_NET,jointFitRule} from './graybox-joint-fit';

const row=(landmarkId:string,referenceIndex:number,edgeResidual:number|null,delta:number|null,extra:any={})=>({landmarkId,referenceIndex,critical:true,comparisonScope:'bound-instance-union',edgeResidual,
 sourceDelta:delta===null?null:{edgeResidual:delta,wasVisible:true,isVisible:true,visibilityLost:false},...extra});
const unverified=(landmarkId:string,referenceIndex:number)=>({landmarkId,referenceIndex,critical:true,comparisonScope:'unverified',edgeResidual:null,sourceDelta:null});
const source={rows:[row('a',1,.1,null),row('b',1,.1,null),row('far',2,.1,null),row('c',2,.1,null),unverified('u1',2),unverified('u2',2)]};

test('one camera improving while another regresses is not selectable (9e4efd45 r1p1 shape)',()=>{
 const r=jointFitCheck({rows:[row('a',1,.08,-.02),row('b',1,.09,-.01),row('far',2,.12,.0186),row('c',2,.0954,-.0142),unverified('u1',2),unverified('u2',2)]},source);
 expect(r.version).toBe(JOINT_FIT);expect(r.passed).toBe(false);
 expect(r.violations.map((v:any)=>v.kind).sort()).toEqual(['camera-mean-regression','critical-row-regression']);
 expect(r.cameras.find((c:any)=>c.referenceIndex===2)).toMatchObject({compared:2,meanEdgeResidualDelta:.0022,criticalCoverage:{source:{measured:2,unverified:2},candidate:{measured:2,unverified:2}}});
 expect(()=>assertJointFit(r)).toThrow('GRAYBOX_JOINT_FIT_REGRESSION');
});
test('a single critical row regressing past the limit blocks selection even when both camera means improve',()=>{
 const r=jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,.09,-.01),row('far',2,.11331,.01331),row('c',2,.06,-.04)]},source);
 expect(r.cameras.every((c:any)=>c.meanEdgeResidualDelta<0)).toBe(true);
 expect(r.violations).toEqual([{kind:'critical-row-regression',landmarkId:'far',referenceIndex:2,edgeResidualDelta:.01331,limit:.01}]);
});
test('a candidate improving every measured camera passes and only counts unverified rows',()=>{
 const r=jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,.09,-.009),row('far',2,.09,-.01),row('c',2,.0866,-.0134),unverified('u1',2),unverified('u2',2)]},source);
 expect(r.passed).toBe(true);expect(r.violations).toEqual([]);expect(()=>assertJointFit(r)).not.toThrow();
 expect(r.cameras.find((c:any)=>c.referenceIndex===2).compared).toBe(2);expect(r.scope).toContain('unverified');
 // Small regressions inside both limits remain selectable.
 expect(jointFitCheck({rows:[row('a',1,.1015,.0015),row('b',1,.1,0),row('far',2,.1,0),row('c',2,.1,0)]},source).passed).toBe(true);
});
test('critical visibility loss and reduced measured coverage are both regressions',()=>{
 const lost=jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,null,null,{sourceDelta:{edgeResidual:null,wasVisible:true,isVisible:false,visibilityLost:true}}),row('far',2,.09,-.01),row('c',2,.09,-.01)]},source);
 expect(lost.violations).toEqual([{kind:'critical-visibility-lost',landmarkId:'b',referenceIndex:1}]);
 const fewer=jointFitCheck({rows:[row('a',1,.09,-.01),unverified('b',1),row('far',2,.09,-.01),row('c',2,.09,-.01)]},source);
 expect(fewer.violations).toEqual([{kind:'critical-coverage-reduced',referenceIndex:1,source:2,candidate:1}]);
});
test('non-critical rows contribute to camera means but never to per-row critical violations',()=>{
 const r=jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,.09,-.01),row('far',2,.1,0),row('c',2,.1,0),row('bg',2,.15,.05,{critical:false})]},source);
 expect(r.violations.map((v:any)=>v.kind)).toEqual(['camera-mean-regression']);
});
test('v4 exclusive subsets count as measured coverage; a critical measured-identity change is never selectable',()=>{
 const subset=(id:string,i:number,e:number,d:number|null,extra:any={})=>row(id,i,e,d,{comparisonScope:'exclusive-instance-subset',measuredInstanceIds:[id],...extra});
 const src={rows:[subset('a',1,.1,null),subset('b',1,.1,null)]};
 const ok=jointFitCheck({rows:[subset('a',1,.09,-.01),subset('b',1,.1,0)]},src);
 expect(ok.passed).toBe(true);expect(ok.cameras[0].criticalCoverage).toEqual({source:{measured:2,unverified:0},candidate:{measured:2,unverified:0}});
 const changed=jointFitCheck({rows:[subset('a',1,.05,null,{sourceDelta:{edgeResidual:null,wasVisible:true,isVisible:true,visibilityLost:false,identityChanged:true}}),subset('b',1,.1,0)]},src);
 expect(changed.violations).toEqual([{kind:'critical-target-identity-changed',landmarkId:'a',referenceIndex:1}]);expect(()=>assertJointFit(changed)).toThrow('GRAYBOX_JOINT_FIT_REGRESSION');
 expect(jointFitCheck({rows:[subset('a',1,.05,null,{critical:false,sourceDelta:{edgeResidual:null,identityChanged:true}}),subset('b',1,.1,0)]},src).violations.map((v:any)=>v.kind)).not.toContain('critical-target-identity-changed');
});
test('joint-fit-net-v1 只在策略任务容忍同机位净改善下的单个有界关键退步（dc1c3f48 r2形态）',()=>{
 const shape={rows:[row('a',1,.09,-.01),row('b',1,.1,0),row('far',2,.12505,.02505),row('c',2,.05,-.05)]};
 const strict=jointFitCheck(shape,source);expect(strict.passed).toBe(false);expect(strict.tolerated).toBeUndefined();
 const net=jointFitCheck(shape,source,{net:true});expect(net.version).toBe(JOINT_FIT_NET);expect(net.passed).toBe(true);expect(net.violations).toEqual([]);
 expect(net.tolerated).toEqual([{kind:'critical-row-regression',landmarkId:'far',referenceIndex:2,edgeResidualDelta:.02505,limit:.01}]);
 // Beyond the cap, a second regressing row, or a camera without net gain stays blocking.
 expect(jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,.1,0),row('far',2,.135,.035),row('c',2,.04,-.06)]},source,{net:true}).passed).toBe(false);
 expect(jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,.1,0),row('far',2,.12,.02),row('c',2,.12,.02),row('d',2,.0,-.1)]},source,{net:true}).passed).toBe(false);
 const noGain=jointFitCheck({rows:[row('a',1,.09,-.01),row('b',1,.1,0),row('far',2,.12,.02),row('c',2,.075,-.025)]},source,{net:true});
 expect(noGain.passed).toBe(false);expect(noGain.tolerated).toEqual([]);
 // Other violation kinds are never tolerated.
 expect(jointFitCheck({rows:[row('a',1,.09,-.01),unverified('b',1),row('far',2,.12,.02),row('c',2,.04,-.06)]},source,{net:true}).violations.map((v:any)=>v.kind)).toEqual(['critical-coverage-reduced']);
 expect(jointFitRule({jointFitPolicy:JOINT_FIT_NET})).toBe(true);expect(jointFitRule({})).toBe(false);expect(jointFitRule({jointFitPolicy:null})).toBe(false);
});
test('跨机位阻断轮只保存拒绝证据，列出越限关键目标，不成为下一轮来源',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jf-blocked-'));try{
  mkdirSync(join(dir,'preview/1'),{recursive:true});
  save(join(dir,'preview/graybox-preview-audit.json'),{attempts:[{index:1,status:'rendered',patchSha256:'a'.repeat(64),changes:{parts:['p']}},{index:2,status:'failed',patchSha256:'b'.repeat(64)}]});
  save(join(dir,'preview/1/reference-composition.json'),{rows:[row('far',2,.13,.03),row('c',2,.05,-.05),row('bg',2,.2,.1,{critical:false})]});
  const v=jointFitBlockedRound(dir,2,Error('GRAYBOX_JOINT_FIT_REGRESSION：x'));
  expect(v.candidates).toEqual([{patchSha256:'a'.repeat(64),changes:{parts:['p']},rows:[{landmarkId:'far',referenceIndex:2,edgeResidualDelta:.03}]}]);
  expect(read(join(dir,'joint-fit-blocked.json'))).toEqual(v);expect(v.scope).toContain('不是下一轮来源');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
