import {qualityGate} from './quality';
import {specGate} from './spec';
export function assess(job:any,review:any,runtime:any){
 const hard=assessmentHardChecks(job,runtime);
 const frames=new Set(runtime.images);
 for(const v of [...review.requirements??[],...review.dimensions??[],...review.specRules??[]])if(!Array.isArray(v.frames)||v.frames.some((f:string)=>!frames.has(f)))throw Error('评估引用了不存在的运行截图');
 const quality=qualityGate(job.plan,review,hard,job.policy),spec=specGate(review,runtime,job.plan,job.structure);
 const kinds=Object.keys(job.structure.semanticCounts).filter(k=>job.structure.semanticCounts[k]>0);
 if(!Array.isArray(review.entityCounts)||review.entityCounts.length!==kinds.length||kinds.some(k=>review.entityCounts.filter((c:any)=>c.kind===k&&Number.isInteger(c.visibleMin)&&Number.isInteger(c.visibleMax)&&c.visibleMin>=0&&c.visibleMax>=c.visibleMin).length!==1))throw Error('视觉计数缺少标准语义类别');
 const countContradictions=review.entityCounts.filter((c:any)=>{const actual=job.structure.semanticCounts[c.kind];return actual<c.visibleMin||actual>c.visibleMax;});
 const objections=job.postReview&&!job.postReview.resolvedAt?[job.postReview.finding??'产出后复核异议尚未解决']:[];
 const geometryReview=job.structure.geometry?.suspects?.length>0&&review.specRules.find((r:any)=>r.id==='S13')?.status!=='passed';
 let status=[quality.status,spec.status].includes('failed')?'failed':[quality.status,spec.status].includes('needs_review')||countContradictions.length||objections.length||geometryReview?'needs_review':'passed';
 if(countContradictions.length&&spec.status==='passed')spec.status='needs_review';
 return {quality,spec,countContradictions,objections,status,realizationStatus:quality.status};
}

export function assessmentHardChecks(job:any,runtime:any){return {build:job.stages?.build?.status==='passed',catalog:job.stages?.verify?.status==='passed',...runtime.hard,frameRate:runtime.hard.frameRate&&runtime.submittedFps>=job.policy.minSubmittedFps};}
