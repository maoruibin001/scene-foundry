import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,save,read,RUNS} from './store';
import {sealAssessment,preserveOutput,inspectOutput} from './output-delivery';
import {compilePipelinePlan} from './pipeline-plan';
import {profileQualityPolicy} from './quality';
import {scoringSignature} from './weighted-reassessment';
import {saveReweight,listReweights} from './weighted-receipts';
import {productionTimingSnapshot} from './production-timing';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'profile-delivery-'));
 for(const p of ['runtime','project/game/dist','project/evidence'])mkdirSync(join(root,p),{recursive:true});
 const manifest='{"fixture":"output-contract-only"}',frame='fixture-frame-bytes',hash=digest(manifest);
 writeFileSync(join(root,'project/game/dist/forgeax-dist.json'),manifest);writeFileSync(join(root,'runtime/view.png'),frame);
 const plan=compilePipelinePlan({pipelinePreset:'effects'},{engineSha:'engine',generatorSha:'generator'})!,policy=profileQualityPolicy(plan.weights);
 const runtime={distManifestDigest:hash,hard:{runtime:true,noErrors:true,entitiesLoaded:true},images:['view.png'],hashes:[digest(frame)]};
 const spec={status:'passed',rules:[]},quality={status:'passed',score:80};
 const binding={candidateSha256:hash,sourceAssessmentSha256:'c'.repeat(64),scoringSignature:scoringSignature(policy.version,plan.weights)};
 const job:any={id:'profile-output-fixture',pipelineVersion:{id:'v'},status:'passed',profile:{engineSha:'engine',generatorSha:'generator'},policy,pipelinePlan:plan,runtime,quality,spec,
  commonDeliveryAssessment:{...binding,status:'passed'},goalAssessment:{...binding,status:'passed'},defaultBenchmarkAssessment:{...binding,sourceScoringSignature:binding.scoringSignature,scoringSignature:'old-benchmark',strictStatus:'failed'},deliveryAssessment:{...binding,standard:'profile70',scoringVersion:policy.version,dimensionWeights:plan.weights,status:'passed',score:80,rawScore:75}};
 save(join(root,'runtime/runtime.json'),runtime);save(join(root,'quality.json'),quality);save(join(root,'review.json'),{summary:'contract fixture'});save(join(root,'spec-report.json'),spec);
 save(join(root,'project/evidence/run-report.json'),{distManifestDigest:hash,engineSha:'engine',generatorSha:'generator',browser:{distManifestDigest:hash},spec,stages:Object.fromEntries(['engine-build','catalog','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))});
 return {root,job};
}
test('profile output must seal plan and all independent receipts to the same candidate and signature',()=>{
 const f=fixture();try{
  for(const key of ['pipelinePlan','commonDeliveryAssessment','goalAssessment','defaultBenchmarkAssessment']){const bad=structuredClone(f.job);delete bad[key];expect(()=>sealAssessment(bad,f.root)).toThrow();}
  const bad=structuredClone(f.job);bad.commonDeliveryAssessment.candidateSha256='d'.repeat(64);expect(()=>sealAssessment(bad,f.root)).toThrow('候选');
  sealAssessment(f.job,f.root);const output=preserveOutput(f.job,f.root,'','scene')!;expect(output.deliveryStatus).toBe('passed');
  const evidence=read(join(f.root,output.folder,'assessment-evidence.json'));
  for(const file of ['pipeline-plan.json','common-delivery-assessment.json','goal-assessment.json','default-benchmark-assessment.json'])expect(evidence.files[file]).toBe(digest(readFileSync(join(f.root,output.folder,file))));
  rmSync(join(f.root,'goal-assessment.json'));const damaged=inspectOutput(f.job,f.root,'','scene');expect(damaged?.deliveryStatus).toBeNull();expect(damaged?.score).toBeNull();expect(damaged?.assessmentError).toContain('不匹配');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('independent reweight storage is idempotent and leaves original source JSON untouched',()=>{
 const id=crypto.randomUUID(),root=join(RUNS,id);mkdirSync(root,{recursive:true});save(join(root,'job.json'),{id,status:'failed',originalScore:69});const before=readFileSync(join(root,'job.json'));
 try{const receipt={id:'a'.repeat(64),sourceJobId:id,kind:'reweight-only',dimensionWeights:{coverage:100},score:80,rawScore:80,sourceAssessmentSha256:'b'.repeat(64)};
  const a=saveReweight(id,receipt),b=saveReweight(id,receipt);expect(b).toEqual(a);expect(listReweights(id)).toHaveLength(1);expect(readFileSync(join(root,'job.json'))).toEqual(before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('saved profile70 milestone cannot count as old strict80 success',()=>{
 const f=fixture(),id=crypto.randomUUID(),root=join(RUNS,id),cycle=join(root,'iterations/0');
 try{mkdirSync(join(cycle,'project/evidence'),{recursive:true});const hard=['framing','cameraMotion','nonFlat','multipleViews','entitiesLoaded','frameRate','runtime','noErrors','hudToggle','video','cameraStopped'];
  const job={...f.job,id,prompt:'fixture',images:[],createdAt:new Date(1000).toISOString(),startedAt:1100,endedAt:5000,status:'passed'};
  save(join(root,'job.json'),job);save(join(cycle,'project/evidence/run-report.json'),read(join(f.root,'project/evidence/run-report.json')));
  save(join(cycle,'candidate.json'),{jobId:id,cycle:{endedAt:4500},fields:{...job,runtime:{...job.runtime,hard:Object.fromEntries(hard.map(k=>[k,true]))}}});
  const timing=productionTimingSnapshot(id,10000);expect(timing.profileSuccessAt).toBe(4500);expect(timing.formalSuccessAt).toBeNull();expect(timing.basicSuccessAt).toBeNull();expect(timing.totalMs).toBe(3500);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});}
});
