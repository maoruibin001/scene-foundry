import {test,expect} from 'bun:test';
import {jointFitCheck,assertJointFit,JOINT_FIT} from './graybox-joint-fit';

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
