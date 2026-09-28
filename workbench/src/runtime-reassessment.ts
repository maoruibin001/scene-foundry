import {existsSync,mkdirSync,readFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,read,save,digest} from './store';
import {capturePlan} from './geometry/capture-plan.mjs';
import {verifiedRuntimeEvidence} from './runtime-evidence';
import {preserveOutput,saveDelivery} from './output-delivery';

/** Re-run the unchanged build with the current capture contract, preserving source evidence. */
export async function recaptureAssessment(job:any,dir:string,deps:{stage:Function;preview:Function;command:Function}){
 const prior=job.runtime,output=join(dir,'runtime');
 if(!job.reuseAssessmentFrom||!job.sceneProgram||!prior)throw Error('重新运行需要已核验的三维场景与来源');
 const expectedDigest=prior.distManifestDigest;
 const sourceDigest=digest(readFileSync(join(output,'runtime.json')));
 if(existsSync(join(dir,'runtime-source')))throw Error('运行来源已保存，不能覆盖');
 renameSync(output,join(dir,'runtime-source'));mkdirSync(output,{recursive:true});
 job.runtime=null;
 const runtime=await deps.stage('runtime',async()=>{
  job.capturePlan=capturePlan(read(join(dir,'project/game/assets/scene-audit.json')).views.length);
  job.previewUrl=await deps.preview(job.id);
  await deps.command(['node',join(ROOT,'src/geometry/capture.mjs'),join(dir,'project/game'),job.previewUrl,output],job.capturePlan.stageTimeoutMs);
  const result=read(join(output,'runtime.json'));
  const actual=digest(readFileSync(join(dir,'project/game/dist/forgeax-dist.json')));
  if(actual!==expectedDigest)throw Error('运行复评不得改变来源构建产物');
  verifiedRuntimeEvidence(read(join(dir,'project/evidence/run-report.json')),result,job.profile,actual,job.policy.minSubmittedFps);
  if(result.images.length!==result.hashes?.length||result.images.some((name:string,i:number)=>digest(readFileSync(join(output,name)))!==result.hashes[i]))throw Error('新采集画面摘要不一致');
  job.runtime=result;
  job.runtimeReassessment={sourceJobId:job.reuseAssessmentFrom,sourceRuntimeDigest:sourceDigest,distManifestDigest:actual,captureVersion:job.pipelineVersion,capturedAt:new Date().toISOString(),scope:'同一已保存构建的真实运行复评；不生成或修正场景，不计首轮生成成功'};
  save(join(dir,'runtime-reassessment.json'),job.runtimeReassessment);return result;
 });
 preserveOutput(job,dir,'','scene');saveDelivery(job,dir);return runtime;
}
