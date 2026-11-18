import {test,expect} from 'bun:test';
import {
 PERFORMANCE_TARGET_FPS,buildPerformanceBaseline,comparePerformance,canOptimizePerformance,
 planOptimizationRound,frameTimingOf,type OptimizationRoundRecord,
} from './performance-baseline';

const runtime=(fps:number,p95:number)=>({submittedFps:fps,performance:{p95FrameMs:p95,minWindowFps:Number((fps-3).toFixed(2))},hard:{runtime:true,noErrors:true,frameRate:fps>=10}});
const specExport={triangles:426692,meshes:35,entities:90,decals:11,unresolved:0,proxies:0,errors:0,instancing:{batches:17,totalInstances:69}};
const renderProfile={renderPath:'deferred',ibl:true,lightCount:32,volumetricFog:{quality:'low',depth:48,tileSize:16}};
const baseline=(fps:number,p95:number,preset:string|null='quality')=>buildPerformanceBaseline({runtime:runtime(fps,p95),specExport,renderProfile,dist:{generated:{materials:30}},preset,at:'2026-11-17T00:00:00Z'});

test('性能基线记录 frame time 分布、场景成本与配置指纹，并声明没有 GPU 分解',()=>{
 const b=baseline(10.86,110.85);
 expect(b.version).toBe('spec-performance-baseline-v1');
 expect(b.frameTiming).toMatchObject({submittedFps:10.86,p95FrameMs:110.85,minWindowFps:7.86});
 expect(b.sceneCost).toMatchObject({triangles:426692,meshes:35,entities:90,decals:11,materials:30,instancingBatches:17});
 expect(b.configuration).toMatchObject({renderPath:'deferred',lightCount:32,volumetricFog:{depth:48}});
 expect(b.contentDigest).toHaveLength(16);
 expect(b.scope).toContain('不能替代 GPU 分解');
});

test('缺失指标保持 null，不补造引擎没给出的数值',()=>{
 const b=buildPerformanceBaseline({runtime:{submittedFps:12},specExport:{},renderProfile:null,dist:null});
 expect(b.frameTiming.p95FrameMs).toBeNull();
 expect(b.frameTiming.p99FrameMs).toBeNull();
 expect(b.sceneCost.triangles).toBeNull();
 expect(b.configuration.renderPath).toBeNull();
});

test('frame time 序列给出 p50/p95/p99 与长帧计数',()=>{
 const times=[...Array(90).fill(16),...Array(10).fill(120)] as number[];
 const t=frameTimingOf({submittedFps:20,frameTimes:times,performance:{p95FrameMs:120,minWindowFps:10}});
 expect(t.frameSamples).toBe(100);
 expect(t.p50FrameMs).toBe(16);
 expect(t.p95FrameMs).toBe(120);
 expect(t.longFrameCount).toBe(10);
 expect(t.p99FrameMs).toBe(120);
});

test('优化对比：帧率提升达标且 p95 不恶化才算有效，视觉复评始终必需',()=>{
 const before=baseline(10.86,110.85),good=baseline(34,30),weak=baseline(11.5,110),spiky=baseline(34,140),short=baseline(20,30);
 expect(comparePerformance(before,good)).toMatchObject({improved:true,visualReviewRequired:true});
 expect(comparePerformance(before,weak).improved).toBe(false);
 expect(comparePerformance(before,weak).reasons.join()).toContain('有效门槛');
 expect(comparePerformance(before,spiky).improved).toBe(false);
 expect(comparePerformance(before,spiky).reasons.join()).toContain('p95 帧时恶化');
 expect(comparePerformance(before,short).reasons.join()).toContain('仍低于');
 expect(comparePerformance(before,short).reasons.join()).toContain(String(PERFORMANCE_TARGET_FPS));
});

test('性能优化按钮只在出图但未达标时出现',()=>{
 const job:any={specJob:'spec-job-v1',status:'needs_review',runtime:runtime(10.86,110),specExport,specGate:{failed:['frameRate'],fps:10.86}};
 expect(canOptimizePerformance(job).allowed).toBe(true);
 expect(canOptimizePerformance({...job,status:'passed'}).reason).toContain('待确认');
 expect(canOptimizePerformance({...job,runtime:{}}).reason).toContain('帧率');
 expect(canOptimizePerformance({...job,specExport:{...specExport,proxies:58}}).reason).toContain('草稿');
 expect(canOptimizePerformance({...job,runtime:runtime(60,12),specGate:{failed:[]}}).reason).toContain('已达标');
 expect(canOptimizePerformance({...job,runtime:runtime(45,20),specGate:{failed:[]}}).reason).toContain('已达标');
 // failed 里明确有 frameRate 时，即使 FPS 过线也允许优化，尊重真实门禁结论。
 expect(canOptimizePerformance({...job,runtime:runtime(45,20),specGate:{failed:['frameRate']}}).allowed).toBe(true);
});

test('有界回路：轮次上限、连续无提升即停、给出可回滚档位',()=>{
 expect(planOptimizationRound([])).toMatchObject({allowed:true,nextRound:1});
 const r1:OptimizationRoundRecord={round:1,preset:'balanced',before:{fps:10,p95FrameMs:110},after:{fps:34,p95FrameMs:30,distManifestDigest:'a'},improved:true};
 expect(planOptimizationRound([r1])).toMatchObject({allowed:true,nextRound:2,rollbackTo:'balanced'});
 const r2:OptimizationRoundRecord={round:2,preset:'performance',before:{fps:34,p95FrameMs:30},after:{fps:34.5,p95FrameMs:29,distManifestDigest:'b'},improved:false};
 expect(planOptimizationRound([r1,r2])).toMatchObject({allowed:false,stopReason:'上一轮无有效提升，停止并建议回滚',rollbackTo:'balanced'});
 const r3:OptimizationRoundRecord={round:3,preset:'performance',before:{fps:34.5,p95FrameMs:29},after:{fps:40,p95FrameMs:25,distManifestDigest:'c'},improved:true};
 expect(planOptimizationRound([r1,r3,{...r3,round:4}]).stopReason).toContain('轮上限');
});
