import {test,expect} from 'bun:test';
import {qualityGate,profileQualityPolicy,PROFILE_DIMENSIONS,HARD_CHECKS} from './quality';
import {PROFILE_QUALITY_VERSION} from './atomic-criteria';
import {profileDelivery} from './weighted-reassessment';
import {calibratePreview} from './human-calibration';

const weights={coverage:20,spatial:30,shape:15,material:15,lighting:10,readability:10};
function fixture(score=4){
 const frames=['reference-1.png'];
 const plan={qualityVersion:PROFILE_QUALITY_VERSION,requirements:[{id:'R1',text:'完整主体',critical:true,weight:1,source:'image',evidence:['图1'],count:null}],acceptanceCriteria:PROFILE_DIMENSIONS.map((d,i)=>({id:'C'+i,requirementId:'R1',dimension:d.id,description:d.label,source:'image',evidence:['图1'],critical:true,weight:1}))};
 const review={confidence:.9,requirements:[{id:'R1',verdict:'met',reason:'主体完整',frames}],criteria:plan.acceptanceCriteria.map(c=>({id:c.id,score,verdict:'met',reason:'原子条件实拍可见',frames})),dimensions:PROFILE_DIMENSIONS.map(d=>({id:d.id,score,reason:'独立视觉判断',frames})),specRules:[],entityCounts:[]};
 const runtime={distManifestDigest:'a'.repeat(64),images:frames,hashes:['b'.repeat(64)],hard:Object.fromEntries([...HARD_CHECKS,'video','cameraStopped'].map(k=>[k,true])),submittedFps:30};
 const job={policy:profileQualityPolicy(weights),plan,prompt:'',images:[],structure:{passed:true,semanticCounts:{}},stages:{build:{status:'passed'},verify:{status:'passed'}}};
 return {job,plan,review,runtime};
}

test('six-dimensional profile keeps the mainline calibration hook and raw implementation score',()=>{
 const f=fixture(),before=JSON.stringify(f),seen:string[]=[];
 const quality=qualityGate(f.plan,f.review,f.runtime.hard,f.job.policy,(id,score)=>{seen.push(id);return id==='material'?score+.5:score;});
 expect(seen).toEqual(PROFILE_DIMENSIONS.map(d=>d.id));
 expect(quality.dimensions.find(d=>d.id==='material')).toMatchObject({score:4.5,rawScore:4,weight:15});
 expect(quality.dimensions.find(d=>d.id==='lighting')).toMatchObject({score:4,rawScore:4,weight:10});
 expect(quality.score).toBe(81.5);expect(quality.diagnostic?.score).toBe(80);
 const result=profileDelivery(f.job,f.review,f.runtime,quality,{status:'passed',rules:[]});
 expect(result.goalAssessment).toMatchObject({score:81.5,rawScore:80,status:'passed'});
 const preview=calibratePreview(quality.dimensions,{applied:true,dimensions:{material:{scale:1,bias:.5}}});
 expect(preview.rows.find(d=>d.id==='material')).toMatchObject({base:4,calibrated:4.5});
 expect(JSON.stringify(f)).toBe(before);
});

test('human calibration cannot lift an insufficient independent visual score through profile70',()=>{
 const f=fixture(3.49),quality=qualityGate(f.plan,f.review,f.runtime.hard,f.job.policy,(_id,s)=>s+.5);
 expect(quality.score).toBeGreaterThan(70);expect(quality.diagnostic?.score).toBe(69.8);
 const result=profileDelivery(f.job,f.review,f.runtime,quality,{status:'passed',rules:[]});
 expect(result.goalAssessment.status).toBe('failed');expect(result.deliveryAssessment.status).toBe('failed');
 expect(result.goalAssessment.unroundedRawScore).toBeLessThan(70);
});
