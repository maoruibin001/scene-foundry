import {calibrationGate} from './calibration';
export const MODES = ['prompt','image','image_prompt'] as const;
export type Mode = typeof MODES[number];
const LEGACY_WEIGHTS = {coverage:40,spatial:25,shape:15,material:10,readability:10};
const CURRENT_WEIGHTS = {coverage:32,spatial:40,shape:12,material:8,readability:8};
const VERSION_WEIGHTS:Record<string,typeof CURRENT_WEIGHTS> = {'scene-quality-v2':LEGACY_WEIGHTS,'scene-quality-v3':LEGACY_WEIGHTS,'scene-quality-v4':CURRENT_WEIGHTS};
export type QualityPolicy = {version:string;score:number;dimensionFloor:number;confidenceFloor:number;successRate:number;minPerMode:number;minWilsonLower:number;maxAttempts:number;minSubmittedFps:number;dimensionWeights?:Record<string,number>};
export const DEFAULT_POLICY:QualityPolicy = {version:'scene-quality-v4', dimensionWeights:{...CURRENT_WEIGHTS}, score:80, dimensionFloor:3, confidenceFloor:0.65, successRate:0.90, minPerMode:30, minWilsonLower:0.80, maxAttempts:2, minSubmittedFps:10};
export const DIMENSIONS = [
 {id:'coverage',label:'需求实现',weight:CURRENT_WEIGHTS.coverage}, {id:'spatial',label:'空间与构图',weight:CURRENT_WEIGHTS.spatial},
 {id:'shape',label:'主体形态',weight:CURRENT_WEIGHTS.shape}, {id:'material',label:'材质与色彩',weight:CURRENT_WEIGHTS.material},
 {id:'readability',label:'画面可读性',weight:CURRENT_WEIGHTS.readability},
];
/** 旧任务没有独立权重字段时按其冻结版本解释，绝不借用当前默认权重。 */
export function dimensionsFor(policy:QualityPolicy=DEFAULT_POLICY){
 const expected=VERSION_WEIGHTS[policy.version];if(!expected)throw Error('未知评分版本：'+policy.version);
 const weights=policy.dimensionWeights??expected;
 if(Object.keys(weights).length!==DIMENSIONS.length||DIMENSIONS.some(d=>weights[d.id]!==expected[d.id as keyof typeof expected]))throw Error('评分权重与冻结版本不一致');
 return DIMENSIONS.map(d=>({...d,weight:weights[d.id]}));
}
export function scoringGuidance(policy:QualityPolicy=DEFAULT_POLICY){return {version:policy.version,dimensions:dimensionsFor(policy),minimumScore:policy.score,dimensionFloor:policy.dimensionFloor,instructions:'优先保证整体空间比例、相机透视、主体位置与尺度、前中后景及遮挡关系，再完善表面和局部细节。关键需求、运行及制作规范必须全部通过。各维度独立按真实画面给出 0–5 分，权重仅用于脚本汇总，不得按权重抬高或压低维度分数。'};}
export const HARD_CHECKS = ['build','catalog','runtime','nonFlat','multipleViews','cameraMotion','hudToggle','noErrors','frameRate','framing','entitiesLoaded'] as const;
export function modeOf(prompt:string,image?:unknown):Mode {
 if(!prompt.trim()&&!image)throw Error('请输入 prompt 或选择参考图片');
 return image ? prompt.trim()?'image_prompt':'image' : 'prompt';
}
export function qualityGate(plan:any,review:any,hard:Record<string,boolean>,policy=DEFAULT_POLICY){
 if(!Array.isArray(plan.requirements)||!plan.requirements.length)throw Error('需求基线缺失');
 if(!Array.isArray(review.requirements)||!Array.isArray(review.dimensions))throw Error('评估格式无效');
 if(review.dimensions.length!==DIMENSIONS.length||new Set(review.dimensions.map((d:any)=>d.id)).size!==DIMENSIONS.length)throw Error('评估维度重复或缺失');
 const verdicts=new Map<string,any>();
 for(const v of review.requirements){if(verdicts.has(v.id)||!['met','partial','missing'].includes(v.verdict)||typeof v.reason!=='string'||!Array.isArray(v.frames)||!v.frames.length)throw Error('需求评估条目无效');verdicts.set(v.id,v);}
 if(verdicts.size!==plan.requirements.length)throw Error('评估必须逐项覆盖冻结需求');
 let totalWeight=0,coverage=0;const criticalMissing:string[]=[];
 for(const req of plan.requirements){const v=verdicts.get(req.id);if(!v)throw Error('评估缺少需求 '+req.id);const w=req.weight??1;totalWeight+=w;coverage+=w*(v.verdict==='met'?1:v.verdict==='partial'?0.5:0);if(req.critical&&v.verdict!=='met')criticalMissing.push(req.id);}
 const dimensions=dimensionsFor(policy).map(d=>{const v=review.dimensions.find((v:any)=>v.id===d.id);if(!v||!Number.isFinite(v.score)||v.score<0||v.score>5||!Array.isArray(v.frames)||!v.frames.length||!v.reason)throw Error('维度评估无效 '+d.id);const score=d.id==='coverage'?5*coverage/totalWeight:v.score;return {...d,score,reason:v.reason,frames:v.frames,points:score/5*d.weight};});
 const score=Math.round(dimensions.reduce((n,d)=>n+d.points,0)*10)/10;
 const hardFailures=HARD_CHECKS.filter(k=>hard[k]!==true),lowDimensions=dimensions.filter(d=>d.score<policy.dimensionFloor).map(d=>d.id);
 const reasons=[...hardFailures.map(k=>'运行硬检查失败：'+k),...criticalMissing.map(k=>'关键需求未完整实现：'+k),...lowDimensions.map(k=>'维度低于底线：'+k),...(score<policy.score?['实现度未达标']:[])];
 const confidenceValid=Number.isFinite(review.confidence)&&review.confidence>=0&&review.confidence<=1;
 const status=reasons.length?'failed':!confidenceValid||review.confidence<policy.confidenceFloor?'needs_review':'passed';
 if(!confidenceValid)reasons.push('评估置信度不符合 0..1 契约，需要人工复核');else if(review.confidence<policy.confidenceFloor)reasons.push('评估置信度低于底线');
 return {status,score,grade:score>=90?'A':score>=80?'B':score>=70?'C':'D',dimensions,hardFailures,criticalMissing,reasons,confidence:confidenceValid?review.confidence:null,rawConfidence:review.confidence,confidenceValid,policy:{...policy,dimensionWeights:Object.fromEntries(dimensions.map(d=>[d.id,d.weight]))}};
}
export function wilson(passed:number,n:number){
 if(!n)return {lower:0,upper:1};
 const p=passed/n,z=1.959963984540054,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return {lower:Math.max(0,c-h),upper:Math.min(1,c+h)};
}
export const automaticGeneration=(j:any)=>(j.validationKind??'generation')==='generation'&&!j.nativeCase&&!j.reuseCheckpoint&&!j.reuseSceneFrom&&!j.reusePlanFrom&&!j.reuseFrom;
export function batchGate(batch:any,jobs:any[],policy=DEFAULT_POLICY){
 // Denominator is the frozen cases, never just successful jobs or retries.
 const cases=batch.cases.map((c:any)=>{const attempts=jobs.filter(j=>automaticGeneration(j)&&j.batchId===batch.id&&j.caseId===c.id&&(!batch.profile?.id||j.profile?.id===batch.profile.id)&&(!j.assessmentProfile||j.assessmentProfile.id===batch.profile?.id)).sort((a,b)=>a.attempt-b.attempt);const allowed=attempts.slice(0,policy.maxAttempts);return {...c,attempts:allowed.length,firstPass:(allowed[0]?.firstDraft?.status??allowed[0]?.status)==='passed',passed:allowed.some(j=>j.status==='passed'),terminal:allowed.some(j=>j.status==='passed')||allowed.length>0&&allowed.every(j=>['failed','cancelled','blocked','needs_review'].includes(j.status))};});
 const groups=MODES.map(mode=>{const c=cases.filter((c:any)=>c.mode===mode),passed=c.filter((c:any)=>c.passed).length;return {mode,n:c.length,passed,rate:c.length?passed/c.length:0,firstPass:c.filter((c:any)=>c.firstPass).length,interval:wilson(passed,c.length)};});
 const passed=cases.filter((c:any)=>c.passed).length,n=cases.length,rate=n?passed/n:0,interval=wilson(passed,n),complete=cases.every((c:any)=>c.terminal);
 const calibration=calibrationGate(batch.calibration,batch.profile);const reasons=[...calibration.reasons,...(!complete?['仍有未完成的固定评测任务']:[]),...groups.filter(g=>g.n<policy.minPerMode).map(g=>g.mode+' 样本不足'),...groups.filter(g=>g.rate<policy.successRate).map(g=>g.mode+' 成功率未达标'),...(interval.lower<policy.minWilsonLower?['总体成功率的 95% Wilson 下界未达标']:[])];
 return {complexity:batch.complexity??null,status:calibration.status!=='certified'||!complete||groups.some(g=>g.n<policy.minPerMode)?'unverified':reasons.length?'unusable':'usable',n,passed,rate,firstPass:cases.filter((c:any)=>c.firstPass).length,interval,groups,complete,reasons,calibration,policy};
}
