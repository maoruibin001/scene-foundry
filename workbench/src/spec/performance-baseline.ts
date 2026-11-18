/**
 * 性能基线、达标判定与有界优化回路的纯逻辑层。
 *
 * 边界：ForgeaX Engine 当前只导出 DEFAULT_STANDARD_PROFILE(一个渲染配置常量)，
 * 没有暴露 drawCalls / GPU time / rendererStats，也没有 optimize API。所以这里的
 * 「可观测性」是 frame time 分布 + 场景静态成本指纹 + 渲染配置指纹，不是 GPU 分解；
 * 不编造引擎没给出的数值，缺失项一律记 null 并写进 scope。
 */
import {createHash} from 'node:crypto';

export const PERFORMANCE_TARGET_FPS=30;
export const PERFORMANCE_MIN_GAIN_FPS=2;
export const PERFORMANCE_MAX_ROUNDS=3;
export const PERFORMANCE_P95_BUDGET_MS=33.4;

export type FrameTiming={
 submittedFps:number|null;p50FrameMs:number|null;p95FrameMs:number|null;p99FrameMs:number|null;
 minWindowFps:number|null;longFrameCount:number|null;frameSamples:number|null;
};

export type SceneCost={
 triangles:number|null;meshes:number|null;entities:number|null;materials:number|null;
 decals:number|null;instancingBatches:number|null;instancedInstances:number|null;
};

export type RenderConfiguration={
 renderPath:string|null;ibl:boolean|null;diffuseGi:boolean|null;lightCount:number|null;
 volumetricFog:{quality:string|null;depth:number|null;tileSize:number|null}|null;
 preset:string|null;
};

export type PerformanceBaseline={
 version:'spec-performance-baseline-v1';
 at:string|null;
 frameTiming:FrameTiming;
 sceneCost:SceneCost;
 configuration:RenderConfiguration;
 contentDigest:string;
 scope:string;
};

export type OptimizationRoundRecord={
 round:number;preset:string;
 before:{fps:number;p95FrameMs:number|null};
 after?:{fps:number;p95FrameMs:number|null;distManifestDigest:string|null};
 improved?:boolean;visualReviewPassed?:boolean|null;
};

const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const quantile=(sorted:number[],q:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]!:null;

/** 从 runtime.json 的已有字段构造 frame time 分布；缺失的分解项保持 null，不补造。 */
export function frameTimingOf(runtime:any):FrameTiming{
 const p=runtime?.performance??{};
 const times=Array.isArray(runtime?.frameTimes)?runtime.frameTimes.filter((n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0):[];
 const sorted=[...times].sort((a:number,b:number)=>a-b);
 return {
  submittedFps:finite(runtime?.submittedFps),
  p50FrameMs:sorted.length?quantile(sorted,.5):finite(p.p50FrameMs),
  p95FrameMs:finite(p.p95FrameMs)??(sorted.length?quantile(sorted,.95):null),
  p99FrameMs:sorted.length?quantile(sorted,.99):finite(p.p99FrameMs),
  minWindowFps:finite(p.minWindowFps),
  longFrameCount:sorted.length?sorted.filter((n:number)=>n>PERFORMANCE_P95_BUDGET_MS).length:finite(p.longFrameCount),
  frameSamples:sorted.length?sorted.length:finite(p.frameSamples),
 };
}

function sceneCostOf(specExport:any,dist:any):SceneCost{
 const generated=dist?.generated??{};
 const instancing=specExport?.instancing??{};
 return {
  triangles:finite(specExport?.triangles)??finite(generated.triangles),
  meshes:finite(specExport?.meshes)??finite(generated.meshes),
  entities:finite(specExport?.entities),
  materials:finite(specExport?.materials)??finite(generated.materials),
  decals:finite(specExport?.decals),
  instancingBatches:finite(instancing.batches),
  instancedInstances:finite(instancing.totalInstances)??finite(specExport?.instancedInstances),
 };
}

function configurationOf(renderProfile:any,preset:string|null):RenderConfiguration{
 const fog=renderProfile?.volumetricFog??null;
 return {
  renderPath:typeof renderProfile?.renderPath==='string'?renderProfile.renderPath:null,
  ibl:typeof renderProfile?.ibl==='boolean'?renderProfile.ibl:null,
  diffuseGi:renderProfile?.diffuseGi?true:renderProfile?.diffuseGi===null?null:false,
  lightCount:finite(renderProfile?.lightCount),
  volumetricFog:fog?{quality:fog.quality??null,depth:finite(fog.depth),tileSize:finite(fog.tileSize)}:null,
  preset,
 };
}

/** 构造一份可跨任务对比的性能基线。at 由调用方注入，保证纯函数可测。 */
export function buildPerformanceBaseline(input:{
 runtime:any;specExport:any;renderProfile:any;dist:any;preset?:string|null;at?:string|null;
}):PerformanceBaseline{
 const frameTiming=frameTimingOf(input.runtime);
 const sceneCost=sceneCostOf(input.specExport,input.dist);
 const configuration=configurationOf(input.renderProfile,input.preset??null);
 const contentDigest=createHash('sha256').update(JSON.stringify({frameTiming,sceneCost,configuration})).digest('hex').slice(0,16);
 return {
  version:'spec-performance-baseline-v1',at:input.at??null,frameTiming,sceneCost,configuration,contentDigest,
  scope:'Engine 未暴露 drawCalls / GPU time / rendererStats；此处仅记录 frame time 分布、场景静态成本与渲染配置指纹，不能替代 GPU 分解诊断。',
 };
}

export type PerformanceComparison={
 fpsDelta:number|null;p95DeltaMs:number|null;
 improved:boolean;reasons:string[];visualReviewRequired:true;
};

/** 优化前后对比。帧率提升不足以抵消 p95 恶化时不算有效提升；视觉复评始终必需。 */
export function comparePerformance(before:PerformanceBaseline,after:PerformanceBaseline):PerformanceComparison{
 const b=before.frameTiming.submittedFps,a=after.frameTiming.submittedFps;
 const reasons:string[]=[];
 const fpsDelta=b!=null&&a!=null?a-b:null;
 const bp=before.frameTiming.p95FrameMs,ap=after.frameTiming.p95FrameMs;
 const p95DeltaMs=bp!=null&&ap!=null?ap-bp:null;
 if(fpsDelta==null)reasons.push('缺少可比较的真实帧率，不能判定提升');
 else if(fpsDelta<PERFORMANCE_MIN_GAIN_FPS)reasons.push(`帧率提升 ${fpsDelta.toFixed(2)} FPS 未达到 ${PERFORMANCE_MIN_GAIN_FPS} FPS 有效门槛`);
 if(p95DeltaMs!=null&&p95DeltaMs>PERFORMANCE_P95_BUDGET_MS*.5)reasons.push(`p95 帧时恶化 ${p95DeltaMs.toFixed(1)}ms，长帧变多`);
 if(a==null||a<PERFORMANCE_TARGET_FPS)reasons.push(`优化后 ${a?.toFixed(2)??'未知'} FPS 仍低于 ${PERFORMANCE_TARGET_FPS} FPS 目标`);
 return {fpsDelta,p95DeltaMs,improved:reasons.length===0,reasons,visualReviewRequired:true};
}

/** 按钮显隐与后端准入共用的判定条件。前后端保持同一套规则。 */
export function canOptimizePerformance(job:any):{allowed:boolean;reason:string}{
 if(!job?.specJob)return {allowed:false,reason:'非规格场景任务'};
 if(job.status!=='needs_review')return {allowed:false,reason:'仅场景已出图并进入待确认时可优化'};
 const fps=finite(job.runtime?.submittedFps);
 if(fps==null||fps<=0)return {allowed:false,reason:'缺少真实运行帧率证据'};
 const x=job.specExport??{};
 if(x.unresolved||x.proxies||x.errors)return {allowed:false,reason:'产物仍是草稿，请先补齐规格契约'};
 const failed=Array.isArray(job.specGate?.failed)?job.specGate.failed:[];
 if(!failed.includes('frameRate')&&fps>=PERFORMANCE_TARGET_FPS)return {allowed:false,reason:'性能已达标，无需优化'};
 return {allowed:true,reason:''};
}

export type OptimizationPlan={
 allowed:boolean;nextRound:number|null;stopReason:string|null;
 rollbackTo:string|null;completedRounds:number;
};

/** 有界回路：最多 PERFORMANCE_MAX_ROUNDS 轮，连续一轮无提升即停，并给出可回滚的最后一个有效档位。 */
export function planOptimizationRound(chain:OptimizationRoundRecord[]=[]):OptimizationPlan{
 const completed=chain.filter(r=>r.after);
 const last=completed.at(-1);
 const rollbackTo=[...completed].reverse().find(r=>r.improved)?.preset??null;
 if(completed.length>=PERFORMANCE_MAX_ROUNDS){
  return {allowed:false,nextRound:null,stopReason:`已达到 ${PERFORMANCE_MAX_ROUNDS} 轮上限`,rollbackTo,completedRounds:completed.length};
 }
 if(last&&last.improved===false){
  return {allowed:false,nextRound:null,stopReason:'上一轮无有效提升，停止并建议回滚',rollbackTo,completedRounds:completed.length};
 }
 return {allowed:true,nextRound:completed.length+1,stopReason:null,rollbackTo,completedRounds:completed.length};
}
