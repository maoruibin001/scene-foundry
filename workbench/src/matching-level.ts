export type MatchingLevel='standard'|'detailed';
export function matchingLevel(value:any='standard'):MatchingLevel {
 if(!['standard','detailed'].includes(value))throw Error('匹配级别必须为标准还原或精细还原');
 return value;
}
export const STANDARD_MATCHING={version:'standard-quality-v3',level:'standard',targetMs:60*60*1000,preferredMs:120*60*1000,assessmentReserveMs:20*60*1000,assessmentCalls:2,grayboxBatchSize:4,assetVisualChecks:2} as const;
export function matchingPolicy(level:MatchingLevel){return level==='standard'?{...STANDARD_MATCHING}:{version:'detailed-v1',level:'detailed'};}
export function standardJob(job:any){return ['standard-hour-v1','standard-score-v2',STANDARD_MATCHING.version].includes(job?.matchingPolicy?.version);}
export const STANDARD_GUIDANCE='本任务为标准还原档：优先保留可见主体、前后高低、遮挡、开口、参考机位、主要轮廓、材质类别与整体光照。允许细小比例、裂纹、锈迹和零碎装饰差异；未明确要求的小道具可用组合模板表达，但不可删除关键主体或凭空添加内容。优先用少量高表现力的几何部件，重复构件使用参数化复用。约80%的还原意图不是像素相似度或80分保证。不要把图中每个微小细节都提炼为独立强制需求；用户明确要求仍必须保留。';
export function matchingGuidance(job:any){return standardJob(job)?STANDARD_GUIDANCE:'';}
/** Deadline follows the original submission through technical continuations. */
export function productionWindow(job:any,source?:any,extension=false,now=Date.now()){
 if(!standardJob(job))return null;
 if(source?.productionWindow){
  const previous=source.productionWindow;
  if(!extension||previous.version==='quality-delivery-window-v3')return structuredClone(previous);
  return {...previous,version:'score-delivery-window-v2',targetAt:previous.targetAt??previous.startedAt+STANDARD_MATCHING.targetMs,preferredAt:previous.startedAt+STANDARD_MATCHING.preferredMs,workDeadlineAt:Math.max(previous.workDeadlineAt,now+40*60*1000),scoreDeadlineAt:previous.startedAt+STANDARD_MATCHING.preferredMs,extensions:[...(previous.extensions??[]),{at:now,reason:'user-resume',previousWorkDeadlineAt:previous.workDeadlineAt,previousScoreDeadlineAt:previous.scoreDeadlineAt}]};
 }
 const startedAt=Date.parse(job.createdAt);
 return {version:job.matchingPolicy.version===STANDARD_MATCHING.version?'quality-delivery-window-v3':'score-delivery-window-v2',startedAt,targetAt:startedAt+STANDARD_MATCHING.targetMs,preferredAt:startedAt+STANDARD_MATCHING.preferredMs,workDeadlineAt:startedAt+STANDARD_MATCHING.preferredMs-STANDARD_MATCHING.assessmentReserveMs,scoreDeadlineAt:startedAt+STANDARD_MATCHING.preferredMs,targetMs:STANDARD_MATCHING.targetMs};
}
export function remainingProductionMs(job:any,role:string,now=Date.now()){
 const w=job?.productionWindow;if(!standardJob(job)||!w)return Infinity;
 // Necessary work remains bounded by provider recovery and the cumulative call budget.
 if(w.version==='quality-delivery-window-v3')return Infinity;
 // Scoring has its own bounded provider retries; performance targets never discard a pending score.
 if(role==='judge'&&w.version==='score-delivery-window-v2')return Infinity;
 return Math.max(0,(role==='judge'?w.scoreDeadlineAt:w.workDeadlineAt)-now);
}
export function firstPassCallEstimate(templateCount:number,level:MatchingLevel='standard'){
 if(!Number.isInteger(templateCount)||templateCount<0||templateCount>16)throw Error('模板数量无效');
 return {templates:templateCount,grayboxCalls:level==='standard'?Math.ceil(templateCount/4):templateCount,assetCalls:templateCount,planningCalls:4,assessmentCalls:3,plannedCalls:templateCount+(level==='standard'?Math.ceil(templateCount/4):templateCount)+7,excludes:'技术重试、格式纠正和额外质量修正；实际调用仍按原累计上限记账'};
}
