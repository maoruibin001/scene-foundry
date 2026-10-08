import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyAssessmentEvidence} from './assessment-recovery';
import {AutomaticResumer} from './automatic-resume';
import {automaticContinuationOptions,executionFaultOf} from './provider-recovery';
import {save,read,digest} from './store';

// Reproduce the missing continuation: asset timeout -> judge timeout -> score
// recovery succeeds -> remaining asset recovery. All requests are injected.
test('先补评分再补缺失资产连续自动恢复，模型中断不增加质量轮次',async()=>{
 const root=mkdtempSync(join(tmpdir(),'delivery-recovery-')),from=join(root,'source'),to=join(root,'score');
 try{
  for(const dir of ['project/game/dist','project/evidence','runtime'])mkdirSync(join(from,dir),{recursive:true});
  const profile={engineSha:'a'.repeat(40),generatorSha:'b'.repeat(40)};save(join(from,'project/game/dist/forgeax-dist.json'),{scene:'fixed'});
  const hash=digest(readFileSync(join(from,'project/game/dist/forgeax-dist.json')));
  save(join(from,'project/evidence/run-report.json'),{...profile,distManifestDigest:hash,buildInputDigest:'c'.repeat(64),catalog:{sha256:'d'.repeat(64)},stages:Object.fromEntries(['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))});
  const source:any={id:'source',status:'blocked',stage:'assets',attempt:1,executionRecoveryRoot:'root',automaticResumeCount:0,executionRecoveryPolicy:{version:'execution-recovery-v2',enabled:true},executionFault:'PROVIDER_TIMEOUT',assetFailures:[{templateId:'window',error:'PROVIDER_HTTP_429 rate limit exceeded'}],partialOutput:{completed:15,total:16,missing:[{id:'window'}]},runtime:{distManifestDigest:hash,hard:{runtime:true,entitiesLoaded:true,noErrors:true,frameRate:true},submittedFps:30,images:['view.png']},structure:{},plan:{},pipelineVersion:{id:'source-version'},stages:{build:{status:'passed'}}};
  const before=JSON.stringify(source),jobs:any[]=[source];let dispatches=0;
  const requests=join(root,'requests.json'),resumer=new AutomaticResumer(requests,{list:()=>jobs,executing:()=>false,resume:async job=>{
   dispatches++;
   const next:any={id:dispatches===1?'score':'assets',recoverySourceJobId:job.id,...automaticContinuationOptions(job,true),profile,stages:{},status:'running'};
   if(dispatches===1)copyAssessmentEvidence(job,next,from,to);
   jobs.push(next);return next;
  }});
  await resumer.tick();expect(dispatches).toBe(1);const scored=jobs[1];expect(scored.assetFailures).toEqual(source.assetFailures);expect(scored.executionFault).toBeUndefined();
  // The real scoring callback resolves the judge fault, but not missing assets.
  Object.assign(scored,{status:'needs_review',stage:'gate',quality:{score:70}});expect(executionFaultOf(scored).recoverable).toBe(true);
  await resumer.tick();await resumer.tick();expect(dispatches).toBe(2);expect(jobs[2].attempt).toBe(1);expect(jobs[2].executionRecoveryRoot).toBe('root');expect(jobs[2].automaticResumeCount).toBe(2);expect(read(requests).requests.every(r=>r.status==='resumed')).toBe(true);expect(JSON.stringify(source)).toBe(before);
  expect(executionFaultOf({...scored,assetFailures:[{templateId:'window',error:'MODEL_BUDGET_EXHAUSTED'}]}).recoverable).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
