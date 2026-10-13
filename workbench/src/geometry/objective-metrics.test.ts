import {test,expect} from 'bun:test';
import {objectiveMetricsRule,objectiveMetricPairs,OBJECTIVE_METRICS} from './objective-metrics';
import {freezeImageGoal} from '../image-reconstruction';

const h=(c:string)=>c.repeat(64);

test('只有带 objective-reference-metrics-v1 策略的任务开启客观指标',()=>{
 expect(objectiveMetricsRule({objectiveMetricsPolicy:OBJECTIVE_METRICS})).toBe(true);
 expect(objectiveMetricsRule({})).toBe(false);
 expect(objectiveMetricsRule({objectiveMetricsPolicy:null})).toBe(false);
 expect(objectiveMetricsRule(null)).toBe(false);
});

test('每张原图配同机位渲染帧：原图取自 uploads，帧取自同机位参考视图',()=>{
 const A=h('a'),B=h('b');
 const goal=freezeImageGoal([{id:A},{id:B}],'');
 const images=[{id:A,file:A+'.jpg'},{id:B,file:B+'.jpg'}];
 const runtime={distManifestDigest:h('c'),images:['reference-1.png','reference-2.png'],hashes:[h('d'),h('e')],
  referenceFrames:[{referenceIndex:1,file:'reference-1.png'},{referenceIndex:2,file:'reference-2.png'}]};
 const pairs=objectiveMetricPairs(goal,images,runtime,'/up','/rt');
 expect(pairs).toEqual([
  {referenceIndex:1,original:'/up/'+A+'.jpg',frame:'/rt/reference-1.png'},
  {referenceIndex:2,original:'/up/'+B+'.jpg',frame:'/rt/reference-2.png'},
 ]);
});

test('缺少同机位参考帧的原图不配对，不臆造',()=>{
 const A=h('a'),B=h('b');
 const goal=freezeImageGoal([{id:A},{id:B}],'');
 const images=[{id:A,file:A+'.jpg'},{id:B,file:B+'.jpg'}];
 // only reference 1 has a same-camera frame
 const runtime={distManifestDigest:h('c'),images:['reference-1.png'],hashes:[h('d')],referenceFrames:[{referenceIndex:1,file:'reference-1.png'}]};
 const pairs=objectiveMetricPairs(goal,images,runtime,'/up','/rt');
 expect(pairs.map(p=>p.referenceIndex)).toEqual([1]);
});
