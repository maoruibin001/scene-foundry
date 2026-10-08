import {test,expect} from 'bun:test';
import {recordedMotion} from './recorded-motion.mjs';
import {analyzeSceneRun} from './runtime-metrics.mjs';
import {boundedIterations} from './iteration-policy';
import {verifiedRuntimeEvidence} from '../runtime-evidence';
import {assessmentHardChecks} from '../assessment';
const receipt={sha256:'a'.repeat(64),bytes:4000};
const observations=Array.from({length:6},(_,i)=>({at:1000+i*3500,selectedView:0,position:[i*.03,1,5],target:[0,1,0],fov:1,frames:30+i*10,frameTimes:Array(100).fill(350),parts:[{id:'p',loaded:true}]}));
const incomplete={status:'incomplete',videoSha256:receipt.sha256,decodedFrames:89,durationMs:23726,frames:[],issue:{code:'VIDEO_POSE_COVERAGE',message:'真实录屏缺口'}};
test('丢失视频配对仍保留真实运行观测，不伪造连续截图或通过标记',()=>{
 const motion=recordedMotion(incomplete,receipt,observations,1000,6);
 expect(motion.videoPassed).toBe(false);expect(motion.issue).toEqual(incomplete.issue);
 expect(motion.samples.every(s=>s.kind==='motion-observation'&&!s.name.endsWith('.png'))).toBe(true);
 expect(motion.samples.map(s=>s.position)).toEqual(observations.map(s=>s.position));
 const audit={views:[{referenceIndex:1}],parts:[{id:'p'}],landmarks:[{id:'p',role:'subject',position:[0,1,0],size:[3,3,3]},{id:'b',role:'context',position:[0,1,-4],size:[3,3,3]}]};
 const metrics=analyzeSceneRun([{...observations[0],name:'reference-1.png',kind:'view'},...motion.samples],audit);
 expect(metrics.hard.entitiesLoaded).toBe(true);expect(metrics.hard.multipleViews).toBe(true);
 expect(metrics.hard.frameRate).toBe(false);expect(metrics.submittedFps).toBeCloseTo(50/17.5);
 const expected={engineSha:'a'.repeat(40),generatorSha:'b'.repeat(40)},digest='c'.repeat(64);
 const stages=['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'];
 const report={...expected,stages:Object.fromEntries(stages.map(s=>[s,{status:'passed'}])),buildInputDigest:'d'.repeat(64),distManifestDigest:digest,catalog:{sha256:'e'.repeat(64)}};
 const runtime={...metrics,distManifestDigest:digest,hard:{...metrics.hard,video:false,runtime:true,noErrors:true},captureIssue:motion.issue,recording:{decodedFps:88/23.726},images:['reference-1.png']};
 const evidence=verifiedRuntimeEvidence(report,runtime,expected,digest,10);
 expect(evidence.runtime.frames).toEqual(['reference-1.png']);expect(evidence.runtime.performance.frameRateCheckPassed).toBe(false);
 expect(assessmentHardChecks({policy:{minSubmittedFps:10}},runtime).video).toBe(false);
});
test('配对有效才能使用连续图像；来源摘要、观测时间、误差不许放宽',()=>{
 const frame={name:'continuous-1.png',observationIndex:1,observationTimeMs:3500,videoTimeMs:3490,observationDeltaMs:-10};
 const video={status:'complete',videoSha256:receipt.sha256,frames:[frame]};
 expect(recordedMotion(video,receipt,observations,1000,1).videoPassed).toBe(true);
 expect(()=>recordedMotion({...video,videoSha256:'wrong'},receipt,observations,1000,1)).toThrow('来源');
 expect(()=>recordedMotion({...video,frames:[{...frame,videoTimeMs:3751}]},receipt,observations,1000,1)).toThrow('观测');
 expect(()=>recordedMotion({...incomplete,frames:[frame]},receipt,observations,1000,1)).toThrow('回执');
});
test('录屏故障仍评分并保存候选，不让视觉模型反复重写场景来修本地采集',async()=>{
 const snapshots:any[]=[],repairs:number[]=[];
 const result=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>false,refineBlockedReason:()=> 'runtime-evidence',evaluate:async()=>({status:'failed',score:78,hardFailures:['video','frameRate']}),snapshot:async value=>{snapshots.push(value);},refine:async(_from,to)=>{repairs.push(to);}});
 expect(result.stopReason).toBe('runtime-evidence');expect(result.cycles).toHaveLength(1);expect(snapshots[0].score).toBe(78);expect(repairs).toEqual([]);
});
