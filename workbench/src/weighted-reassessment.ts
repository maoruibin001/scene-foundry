import {createHash} from 'node:crypto';
import {commonDelivery,basicDelivery} from './delivery-standard';
import {DIMENSIONS,EVIDENCE_POLICY,HARD_CHECKS,PROFILE_QUALITY_VERSION,validateDimensionWeights} from './quality';

const canonical=(v:any):any=>v===undefined?null:v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const round=(n:number)=>Math.round(n*100)/100;
const state=(failed:boolean,pending:boolean)=>failed?'failed':pending?'needs_review':'passed';

export function scoringSignature(version:string,weights:Record<string,number>){return hash({version,dimensions:Object.keys(weights).sort(),weights,threshold:70,commonChecks:'common-delivery-v1'});}
export function assessmentBinding(job:any,review:any,quality:any,spec:any,runtime:any){
 const candidateSha256=runtime?.distManifestDigest??null;
 const sourceAssessmentSha256=hash({pipelinePlanId:job.pipelinePlan?.id??null,postReview:job.postReview??null,scope:job.assessmentScope??'scene',partial:job.partialOutput??null,build:job.stages?.build?.status,verify:job.stages?.verify?.status,review,dimensions:quality?.dimensions,criteria:job.plan?.acceptanceCriteria??null,requirements:job.plan?.requirements??null,spec,structure:job.structure,
  images:(job.images??(job.image?[job.image]:[])).map((i:any)=>i.id),runtime:{distManifestDigest:candidateSha256,images:runtime?.images,hashes:runtime?.hashes,hard:runtime?.hard,submittedFps:runtime?.submittedFps},sourcePolicy:job.policy});
 return {candidateSha256,sourceAssessmentSha256,sourceAssessmentId:job.assessmentId??null};
}

/** Independent measured dimensions only. A zero weight never permits inventing a missing score. */
export function weightedDimensionScores(implementation:any[],visual:any[],weights:Record<string,number>){
 const ids=Object.keys(weights);validateDimensionWeights(weights,ids);
 const checked=(rows:any[],label:string)=>{
  if(!Array.isArray(rows)||rows.length!==ids.length||new Set(rows.map(d=>d.id)).size!==ids.length)throw Error(label+'评分维度重复或缺失；旧五维不能补造光照证据');
  return ids.map(id=>{const d=rows.find(d=>d.id===id);if(!d||!Number.isFinite(d.score)||d.score<0||d.score>5||!d.reason?.trim()||!Array.isArray(d.frames)||!d.frames.length||d.frames.some((f:any)=>typeof f!=='string'||!f.trim()))throw Error(label+'缺少独立评分证据：'+id);return {...structuredClone(d),weight:weights[id],points:d.score/5*weights[id]};});
 };
 const dimensions=checked(implementation,'实现度'),rawDimensions=checked(visual,'原始视觉');
 const unroundedScore=dimensions.reduce((n,d)=>n+d.points,0),unroundedRawScore=rawDimensions.reduce((n,d)=>n+d.points,0);
 return {score:round(unroundedScore),rawScore:round(unroundedRawScore),unroundedScore,unroundedRawScore,dimensions,rawDimensions};
}

export function profileDelivery(job:any,review:any,runtime:any,quality:any,spec:any,countContradictions:any[]=[],objections:any[]=[]){
 const weights=validateDimensionWeights(job.policy.dimensionWeights),scores=weightedDimensionScores(quality.dimensions,review.dimensions,weights);
 const signature=scoringSignature(PROFILE_QUALITY_VERSION,weights),binding=assessmentBinding(job,review,quality,spec,runtime);
 const commonDeliveryAssessment={...commonDelivery(job,review,runtime,quality,spec,countContradictions,objections),...binding,scoringSignature:signature};
 const scoringReasons=[...(scores.unroundedScore+1e-9<70?['综合分未达到70']:[]),...(scores.unroundedRawScore+1e-9<70?['原始维度加权分未达到70']:[])];
 const goalAssessment={version:'profile-goal-assessment-v1',standard:'profile70',scoringVersion:PROFILE_QUALITY_VERSION,scoringSignature:signature,dimensionWeights:weights,threshold:70,
  ...scores,status:scoringReasons.length?'failed':'passed',reasons:scoringReasons,...binding};
 const deliveryAssessment={standard:'profile70',threshold:70,score:scores.score,rawScore:scores.rawScore,dimensionWeights:weights,scoringVersion:PROFILE_QUALITY_VERSION,scoringSignature:signature,
  status:state(scoringReasons.length>0||commonDeliveryAssessment.status==='failed',commonDeliveryAssessment.status==='needs_review'),
  reasons:[...scoringReasons,...commonDeliveryAssessment.reasons],warnings:commonDeliveryAssessment.warnings,...binding,
  scope:'本次冻结权重的70分目标与共同交付底线；旧固定basic70/strict80仅作单列基准，不表示原图高还原'};
 return {commonDeliveryAssessment,goalAssessment,deliveryAssessment};
}

/** Five measured dimensions from v8, explicitly a projection, never a new independent v7 review. */
export function projectedBenchmark(job:any,review:any,runtime:any,quality:any,spec:any,countContradictions:any[]=[],objections:any[]=[]){
 const weights=EVIDENCE_POLICY.dimensionWeights!,scores=weightedDimensionScores(DIMENSIONS.map(d=>quality.dimensions.find((r:any)=>r.id===d.id)),DIMENSIONS.map(d=>review.dimensions.find((r:any)=>r.id===d.id)),weights);
 const low=scores.dimensions.filter(d=>d.score<3).map(d=>d.id),rawLow=scores.rawDimensions.filter(d=>d.score<3).map(d=>d.id);
 const benchmarkQuality={...quality,score:Math.round(scores.score*10)/10,dimensions:scores.dimensions,diagnostic:{score:scores.rawScore,lowDimensions:rawLow},policy:{...EVIDENCE_POLICY,deliveryStandard:'basic70' as const},
  status:quality.hardFailures?.length||quality.criticalMissing?.length||low.length||rawLow.length||scores.score<80||scores.rawScore<80?'failed':!quality.confidenceValid||quality.confidence<job.policy.confidenceFloor?'needs_review':'passed'};
 const geometryReview=job.structure.geometry?.suspects?.length>0&&review.specRules?.find((r:any)=>r.id==='S13')?.status!=='passed';
 const strictStatus=[benchmarkQuality.status,spec.status].includes('failed')?'failed':[benchmarkQuality.status,spec.status].includes('needs_review')||countContradictions.length||objections.length||geometryReview||job.partialOutput||job.assessmentScope==='partial'?'needs_review':'passed';
 return {...basicDelivery(job,review,runtime,benchmarkQuality,spec,strictStatus,countContradictions,objections),
  ...assessmentBinding(job,review,quality,spec,runtime),sourceScoringSignature:scoringSignature(PROFILE_QUALITY_VERSION,job.policy.dimensionWeights),scoringSignature:scoringSignature(EVIDENCE_POLICY.version,weights),
  source:'v8-projected-benchmark',sourceScoringVersion:PROFILE_QUALITY_VERSION,scoringVersion:EVIDENCE_POLICY.version,dimensionWeights:{...weights},
  label:'旧固定权重basic70基准（由v8已有五维投影，非独立v7评审）',strictStatus,
  scope:'仅对照既有五维固定权重；v8已将光照独立，因此不宣称与旧v7材质评审完全等价，不改历史评分或决定新目标成功'};
}

/** Pure result-page operation: no writes, new model review, rendering, task restart or history mutation. */
export function reweightResult(job:any,weights:Record<string,number>){
 if(!job.quality||!job.review||!job.runtime||!job.spec||!job.structure)throw Error('缺少已完成评审与运行证据，不能重算');
 const ids=job.policy?.version===PROFILE_QUALITY_VERSION?['coverage','spatial','shape','material','lighting','readability']:DIMENSIONS.map(d=>d.id);
 const selectedWeights=validateDimensionWeights(weights,ids),runtime=job.runtime;
 if(!/^[a-f0-9]{64}$/.test(runtime.distManifestDigest??''))throw Error('重算缺少同一候选产物摘要');
 const scores=weightedDimensionScores(job.quality.dimensions,job.review.dimensions,selectedWeights);
 const frames=new Set(runtime.images);for(const row of [...scores.dimensions,...scores.rawDimensions])if(row.frames.some((f:string)=>!frames.has(f)))throw Error('重算评分引用了不存在的运行截图');
 const counts=job.review.entityCounts;
 const kinds=Object.keys(job.structure.semanticCounts??{}).filter(k=>job.structure.semanticCounts[k]>0);
 if(!Array.isArray(counts)||counts.length!==kinds.length||kinds.some(k=>counts.filter((c:any)=>c.kind===k&&Number.isInteger(c.visibleMin)&&Number.isInteger(c.visibleMax)&&c.visibleMin>=0&&c.visibleMax>=c.visibleMin).length!==1))throw Error('重算缺少真实视觉计数证据');
 const contradictions=counts.filter((c:any)=>job.structure.semanticCounts[c.kind]<c.visibleMin||job.structure.semanticCounts[c.kind]>c.visibleMax);
 const objections=job.postReview&&!job.postReview.resolvedAt?[job.postReview.finding??'产出后复核异议尚未解决']:[];
 const hard={build:job.stages?.build?.status==='passed',catalog:job.stages?.verify?.status==='passed',...runtime.hard,frameRate:runtime.hard?.frameRate===true&&runtime.submittedFps>=job.policy.minSubmittedFps};
 const confidenceValid=Number.isFinite(job.review.confidence)&&job.review.confidence>=0&&job.review.confidence<=1;
 const commonQuality={...job.quality,confidenceValid,confidence:confidenceValid?job.review.confidence:null,hardFailures:[...new Set([...(job.quality.hardFailures??[]),...HARD_CHECKS.filter(k=>hard[k]!==true)])]};
 const commonJob={...job,policy:{...job.policy,deliveryStandard:'profile70',confidenceFloor:Math.max(EVIDENCE_POLICY.confidenceFloor,job.policy.confidenceFloor)}};
 const reasons=[...(scores.unroundedScore+1e-9<70?['综合分未达到70']:[]),...(scores.unroundedRawScore+1e-9<70?['原始维度加权分未达到70']:[])];
 const signature=scoringSignature(job.policy.version,selectedWeights),binding=assessmentBinding(job,job.review,job.quality,job.spec,runtime);
 const commonDeliveryAssessment={...commonDelivery(commonJob,job.review,runtime,commonQuality,job.spec,contradictions,objections),...binding,scoringSignature:signature};
 const id=hash({kind:'weighted-reassessment-v1',scoringSignature:signature,...binding});
 return {id,version:'weighted-reassessment-v1',kind:'reweight-only',immutable:true,sourceJobId:job.id,sourceTerminalStatus:job.status,sourceDeliveryStandard:job.policy.deliveryStandard??'strict',
  scoringVersion:job.policy.version,scoringSignature:signature,dimensionWeights:selectedWeights,threshold:70,...scores,...binding,
  commonDeliveryAssessment,goalAssessment:{status:reasons.length?'failed':'passed',reasons,score:scores.score,rawScore:scores.rawScore,scoringSignature:signature,dimensionWeights:selectedWeights,...binding},
  status:state(reasons.length>0||commonDeliveryAssessment.status==='failed',commonDeliveryAssessment.status==='needs_review'),reasons:[...reasons,...commonDeliveryAssessment.reasons],
  warnings:commonDeliveryAssessment.warnings,modelCalls:0,engineRenders:0,scope:'仅按同候选已有独立维度重算；原始回执和终态不变，未重新评审、渲染或开始制作'};
}
