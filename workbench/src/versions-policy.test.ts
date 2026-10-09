import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VersionStore,releaseReadiness,releasePolicyOf} from './versions';
import {DEFAULT_POLICY,EVIDENCE_POLICY,type QualityPolicy} from './quality';

const basic:QualityPolicy={...EVIDENCE_POLICY,deliveryStandard:'basic70'};
function certified(policy:QualityPolicy=basic,id='version'){
 const profile={id:'profile',pipelineVersionId:id,policy},calibration={profileId:profile.id,cases:Array.from({length:12},(_,i)=>({evidenceDigest:'evidence'+i,reviewDigest:'review'+i,expected:i<6?'passed':'failed',predicted:i<6?'passed':'failed',reviewedBy:'fixture-reviewer',reviewerKind:'human',reviewedAt:'2026-10-09',reason:'fixture actual-frame label'}))};
 const batches=['simple','medium','complex'].map(complexity=>({id:'batch-'+complexity,complexity,purpose:'certification',pipelineVersion:{id},profile,policy,calibration,cases:Array.from({length:90},(_,i)=>({id:String(i),mode:['prompt','image','image_prompt'][Math.floor(i/30)]}))}));
 const jobs=batches.flatMap(batch=>batch.cases.map(c=>({id:batch.id+c.id,batchId:batch.id,caseId:c.id,attempt:1,profile,policy,pipelineVersion:{id},status:'passed',validationKind:'generation',quality:{score:policy.deliveryStandard==='basic70'?75:85}})));
 return {version:{id,kind:'snapshot',configuration:{policy}},batches,jobs};
}
test('explicit frozen v7/basic70 is certified under its own name; default strict80 cannot count it',()=>{
 const {version,batches,jobs}=certified(),before=structuredClone({version,batches,jobs});
 expect(releaseReadiness(version,batches,jobs).ready).toBe(false);
 const gate=releaseReadiness(version,batches,jobs,undefined,basic);
 expect(gate).toMatchObject({ready:true,policyName:'scene-quality-v7/basic70',policy:basic});
 expect(gate.certificationScope).toContain('不等于80分');expect(gate.batchIds).toHaveLength(3);
 expect(gate.policy.score).toBe(80);expect({version,batches,jobs}).toEqual(before);
});
test('strict v4.1 remains default; explicit v7 strict uses only its own exact frozen policy',()=>{
 for(const policy of [DEFAULT_POLICY,EVIDENCE_POLICY,{...EVIDENCE_POLICY,deliveryStandard:'strict' as const}]){
  const {version,batches,jobs}=certified(policy);
  expect(releaseReadiness(version,batches,jobs,undefined,policy).ready).toBe(true);
  expect(releaseReadiness(version,batches,jobs,undefined,policy).certificationScope).toBe('80分完整规范认证');
  expect(releaseReadiness(version,batches,jobs).ready).toBe(policy===DEFAULT_POLICY);
 }
});
test('explicit target cannot change the policy frozen in the source version or supply an unfrozen target',()=>{
 const {version,batches,jobs}=certified();
 expect(releaseReadiness({...version,configuration:{policy:EVIDENCE_POLICY}},batches,jobs,undefined,basic).reasons).toContain('目标认证策略须与版本中已冻结的配置完全一致');
 expect(releaseReadiness({id:version.id,kind:'snapshot'},batches,jobs,undefined,basic).ready).toBe(false);
});
test('unknown versions, lowered thresholds, changed weights, extra fields and nonfinite policies cannot certify',()=>{
 for(const policy of [{...basic,version:'scene-quality-v8'},{...basic,score:70},{...basic,dimensionFloor:2},{...basic,minPerMode:1},{...basic,successRate:.8},{...basic,minWilsonLower:.5},{...basic,dimensionWeights:{...basic.dimensionWeights,material:1}},{...basic,minSubmittedFps:Infinity},{...basic,extra:true}]){
  expect(()=>releasePolicyOf(policy)).toThrow('未支持');const c=certified(policy);
  expect(releaseReadiness(c.version,c.batches,c.jobs,undefined,policy).ready).toBe(false);
 }
});
test('same-version batches from different policies cannot combine across complexity levels',()=>{
 const {version,batches,jobs}=certified();batches[1]={...batches[1],policy:EVIDENCE_POLICY};
 expect(releaseReadiness(version,batches,jobs,undefined,basic)).toMatchObject({ready:false,missing:['medium']});
});
test('explicit target rejects mixed job policies, generation versions and assessment versions despite same profile id',()=>{
 for(const changed of [{policy:EVIDENCE_POLICY},{pipelineVersion:{id:'other-source'}},{assessmentVersion:{id:'other-assessment'}}]){
  const {version,batches,jobs}=certified();const mixed=jobs.map(j=>j.batchId==='batch-medium'?{...j,...changed}:j);
  expect(releaseReadiness(version,batches,mixed,undefined,basic).ready).toBe(false);
 }
});
test('named70 certification keeps independent calibration, fixed-mode sample counts and success floors',()=>{
 const a=certified();a.batches[1].calibration=null as any;expect(releaseReadiness(a.version,a.batches,a.jobs,undefined,basic).ready).toBe(false);
 const b=certified();b.batches[0].cases=b.batches[0].cases.slice(0,89);expect(releaseReadiness(b.version,b.batches,b.jobs,undefined,basic).ready).toBe(false);
 const c=certified();for(const j of c.jobs)if(j.batchId==='batch-simple'&&Number(j.caseId)<4)j.status='failed';expect(releaseReadiness(c.version,c.batches,c.jobs,undefined,basic).ready).toBe(false);
});
test('continuations and diagnostic stage batches remain ineligible for named certification',()=>{
 const a=certified();for(const j of a.jobs)j.validationKind='manual-continuation';expect(releaseReadiness(a.version,a.batches,a.jobs,undefined,basic).ready).toBe(false);
 const b=certified();for(const batch of b.batches)batch.purpose='stage-80';expect(releaseReadiness(b.version,b.batches,b.jobs,undefined,basic).ready).toBe(false);
});
test('synthetic local VersionStore persists the selected certification name and refuses changing it',()=>{
 const root=mkdtempSync(join(tmpdir(),'release-policy-fixture-'));
 try{
  const store=new VersionStore(root),v=store.freeze({configuration:{policy:basic},files:{'source.ts':'synthetic fixture only'}}),c=certified(basic,v.id);
  expect(()=>store.publish(v.id,c.batches,c.jobs)).toThrow('不能发布');
  const result=store.publish(v.id,c.batches,c.jobs,undefined,basic);
  expect(result.release.gate.policyName).toBe('scene-quality-v7/basic70');expect(result.release.gate.certificationScope).toContain('不等于80分');
  expect(result.release.gate.policy).toEqual(basic);expect(result.release.evidence.jobs).toHaveLength(270);
  expect(()=>store.publish(v.id,c.batches,c.jobs,undefined,EVIDENCE_POLICY)).toThrow('不可覆盖');
 }finally{rmSync(root,{recursive:true,force:true});}
});
