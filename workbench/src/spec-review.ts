import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runDir,getJob,saveJob,save,digest,UPLOADS,event} from './store';
import {callSpecNode,validateNodeModels} from './spec/node-models';
import {VISUAL_SCHEMA,verifiedVisualReview,visualReferences} from './spec/visual-review';
import {STYLE_SYSTEM,styleGate} from './spec-run';
const active=new Set<string>();
/** A user-requested assessment of existing immutable output; never rebuilds or replaces the output. */
export function startSpecReview(id:string,selection:unknown){
 const job=getJob(id);if(!job.specJob||!['passed','needs_review','failed'].includes(job.status)||!job.runtime)throw Error('需要已完成的规格场景');
 if(active.has(id))throw Error('该场景已有视觉评审进行中');
 const refs=visualReferences<any>(job.styleImages??[]);
 const model=validateNodeModels({styleReview:selection}).styleReview;
 if(model.provider==='cbc4')throw Error('VISUAL_ROUTE_UNSUPPORTED：cbc4 当前未通过看图验证');
 active.add(id);const reviewId=randomUUID(),dir=join(runDir(id),'visual-reviews',reviewId);mkdirSync(dir,{recursive:true});
 job.visualReviewState={id:reviewId,status:'running',model,startedAt:new Date().toISOString()};saveJob(job);
 void (async()=>{try{
  const runtime=job.runtime,dist=digest(readFileSync(join(runDir(id),'project/game/dist/forgeax-dist.json')));
  if(dist!==runtime.distManifestDigest)throw Error('构建摘要与运行证据不一致');
  const shots=runtime.images.filter((f:string)=>/^inspection-[A-Za-z0-9_.-]+\.png$/.test(f));
  for(const f of shots)if(digest(readFileSync(join(runDir(id),'runtime',f)))!==runtime.hashes[runtime.images.indexOf(f)])throw Error('运行截图 SHA 不一致');
  const images=[...refs.map((im:any)=>({path:join(UPLOADS,im.file),mime:im.mime})),...shots.map((f:string)=>({path:join(runDir(id),'runtime',f),mime:'image/png'}))];
  const input=images.map((im,i)=>({index:i,sha256:digest(readFileSync(im.path)),mime:im.mime}));
  save(join(dir,'input.json'),{distManifestDigest:dist,images:input,model});
  const result=await callSpecNode({role:'spec-style-judge',system:STYLE_SYSTEM,text:JSON.stringify({scene:job.plan?.name,referenceCount:refs.length,screenshotFiles:shots}),images,signal:AbortSignal.timeout(240000)},dir,model,VISUAL_SCHEMA);
  const value=verifiedVisualReview(JSON.parse(result.text),images.length),gate=styleGate(value);
  if(digest(readFileSync(join(runDir(id),'project/game/dist/forgeax-dist.json')))!==dist)throw Error('评审期间输出发生变化');
  const receipt={...value,id:reviewId,model,route:result.receipt,distManifestDigest:dist,input,completedAt:new Date().toISOString()};save(join(dir,'review.json'),receipt);
  const current=getJob(id);current.visualReviews??=[];current.visualReviews.push({id:reviewId,file:`visual-reviews/${reviewId}/review.json`,overall:value.overall,distManifestDigest:dist});current.visualReviewState={id:reviewId,status:'completed',model};current.styleReview=value;
  current.specGate.styleJudge={version:value.version,overall:value.overall,verdict:value.verdict,passed:gate.passed,lowDimensions:gate.low,advisory:true,threshold:{overall:70,minDimension:2}};saveJob(current);event(current,'visual-review','已对现有场景完成独立看图评审，未修改场景');
 }catch(e){const current=getJob(id);current.visualReviewState={id:reviewId,status:'failed',model,error:String(e)};save(join(dir,'failure.json'),current.visualReviewState);saveJob(current);}finally{active.delete(id);}})();
 return {id:reviewId,status:'running'};
}
