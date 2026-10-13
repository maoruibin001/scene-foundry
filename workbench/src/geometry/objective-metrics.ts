import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {referenceViews} from '../image-reconstruction';

export const OBJECTIVE_METRICS='objective-reference-metrics-v1';
/** New ordinary jobs attach deterministic colour/structure metrics as a NON-GATING cross-check on the model's visual judgement; voxel and historical jobs are unchanged. */
export function objectiveMetricsRule(job:any){return job?.objectiveMetricsPolicy===OBJECTIVE_METRICS;}

export type ObjectivePair={referenceIndex:number;original:string;frame:string};

/** Pure pairing: for each reference, the frozen original photo and the same-camera render frame.
 *  Only global colour/structure statistics are computed downstream, but we still pair the same-camera
 *  view so the comparison is as fair as an estimated pose allows. */
export function objectiveMetricPairs(goal:any,images:any[],runtime:any,uploads:string,runtimeDir:string):ObjectivePair[]{
 const views=referenceViews(goal,runtime),pairs:ObjectivePair[]=[];
 for(const ref of goal.references){
  const img=(images??[]).find((i:any)=>i.id===ref.sha256),view=views.find((v:any)=>v.referenceIndex===ref.referenceIndex);
  if(!img||!view)continue;
  pairs.push({referenceIndex:ref.referenceIndex,original:join(uploads,img.file),frame:join(runtimeDir,view.file)});
 }
 return pairs;
}

/** Run the cv2/numpy metric script over the paired frames. Returns null when no pair is renderable.
 *  The result is informational only — nothing in the quality gate or delivery reads it. */
export function computeObjectiveMetrics(goal:any,images:any[],runtime:any,uploads:string,runtimeDir:string,python:string,script:string){
 const pairs=objectiveMetricPairs(goal,images,runtime,uploads,runtimeDir).filter(p=>existsSync(p.original)&&existsSync(p.frame));
 if(!pairs.length)return null;
 const res=spawnSync(python,[script],{input:JSON.stringify({version:OBJECTIVE_METRICS,pairs}),encoding:'utf8',maxBuffer:16*1024*1024,timeout:120000});
 if(res.status!==0)throw Error('客观指标脚本失败：'+String(res.stderr||res.error||'').slice(0,300));
 const parsed=JSON.parse(res.stdout);
 return {version:OBJECTIVE_METRICS,gating:false,
  method:'渲染帧与原图的全局 CIELAB 颜色（亮度、彩度、色相分布）与粗结构统计，不依赖像素级对齐；仅作主观评审的交叉校验。',
  references:parsed.references,
  limitation:'相机为估计位姿，这些是全局颜色/结构统计，不是语义或像素相似度，也未对人工评分校准；不单独判定还原质量、不改变通过判定，不替代真实评审。'};
}
