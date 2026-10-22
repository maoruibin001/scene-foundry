import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,realpathSync} from 'node:fs';
import {join,resolve,relative,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderRepairPreview} from '../geometry/repair-engine-preview';
import {recordedRun} from '../recorded-runs';
import {reconstructionPython} from '../runtime-paths.mjs';
import {reservePreviewPort,previewMatches} from '../preview-endpoint';
import {ROOT,read,save,digest} from '../store';
import {benchReportHTML} from './report';

/**
 * Tier-0 bench: re-render already generated scenes with the current export, build and Engine code, with no model call,
 * and measure them against their reference photos and against a previous bench run. It shows whether rendering,
 * export, lighting or Engine changes help or regress the same scenes; it cannot show how a prompt change alters what
 * the model generates (replay that stage, or run a fresh job, for those).
 */
export const BENCH_REPLAY='bench-replay-v1';
export const BENCH_LIMITS={landmarkL:8,landmarkChroma:8,baselineDiffL:6,fpsDrop:.15,minSystemFps:50};
const engineRoot=resolve(ROOT,'../engine');

/** The delivered round of a recorded run: its scene, reference photos and observation boxes. */
export function benchSource(runDir:string){
 const job=read(join(runDir,'job.json')),folder=(existsSync(join(runDir,'delivery.json'))?read(join(runDir,'delivery.json')).best?.folder:null)??'.',base=join(runDir,folder);
 const scenePath=[join(base,'generated-scene.json'),join(runDir,'generated-scene.json')].find(existsSync);if(!scenePath)throw Error('记录缺少已生成场景：'+runDir);
 const uploads=resolve(realpathSync(runDir),'../../uploads'),images=(job.images??[]).map((i:any)=>({path:join(uploads,i.file),mime:i.mime}));
 if(!images.length||images.some((i:any)=>!existsSync(i.path)))throw Error('记录缺少参考图片：'+runDir);
 const observation=existsSync(join(runDir,'generation/reference-observations.json'))?read(join(runDir,'generation/reference-observations.json')):null;
 const delivered=existsSync(join(base,'delivery-assessment.json'))?read(join(base,'delivery-assessment.json')):null;
 return {jobId:job.id,kind:job.sceneKind??'scene',prompt:job.prompt,folder,scenePath,images,refs:(job.images??[]).map((i:any)=>i.id),observation,score:delivered?.score??null};
}
/** Observation boxes of one reference, normalised to that reference frame. */
export function landmarkBoxes(observation:any,referenceIndex:number){
 return (observation?.landmarks??[]).flatMap((l:any)=>(l.views??[]).filter((v:any)=>v.referenceIndex===referenceIndex&&Array.isArray(v.box)&&v.box.length===4).map((v:any)=>({id:l.id,label:l.label??l.id,box:v.box})));
}
/** Landmarks whose colour moved further from the reference, frames that changed a lot, and FPS losses, against a baseline. */
export function benchRegressions(current:any,baseline:any){
 const flags:any[]=[],off=(l:any)=>Math.hypot(l.dL,l.dChroma);
 for(const ref of current.colour?.references??[]){const prior=baseline?.colour?.references?.find((r:any)=>r.referenceIndex===ref.referenceIndex);
  if(Number.isFinite(ref.baselineDiffL)&&ref.baselineDiffL>BENCH_LIMITS.baselineDiffL)flags.push({kind:'frame-changed',referenceIndex:ref.referenceIndex,baselineDiffL:ref.baselineDiffL});
  for(const l of ref.landmarks){const p=prior?.landmarks?.find((x:any)=>x.id===l.id);if(p&&off(l)>off(p)+BENCH_LIMITS.landmarkL/2)flags.push({kind:'landmark-further',referenceIndex:ref.referenceIndex,id:l.id,label:l.label,before:+off(p).toFixed(1),after:+off(l).toFixed(1)});}}
 const fps=current.fps?.system?.median,prior=baseline?.fps?.system?.median;
 if(Number.isFinite(fps)&&Number.isFinite(prior)&&fps<prior*(1-BENCH_LIMITS.fpsDrop))flags.push({kind:'fps-drop',before:prior,after:fps});
 if(current.error&&!baseline?.error)flags.push({kind:'render-failed',error:current.error});
 return flags;
}
/** Reference-colour summary: landmarks off by more than the bench limits, worst first. */
export function landmarkOffsets(colour:any){
 return (colour?.references??[]).flatMap((r:any)=>r.landmarks.map((l:any)=>({...l,referenceIndex:r.referenceIndex,off:+Math.hypot(l.dL,l.dChroma).toFixed(1)})))
  .filter((l:any)=>Math.abs(l.dL)>BENCH_LIMITS.landmarkL||Math.abs(l.dChroma)>BENCH_LIMITS.landmarkChroma).sort((a:any,b:any)=>b.off-a.off);
}

function python(script:string,input:any){
 const r=spawnSync(reconstructionPython(),[join(import.meta.dirname,script)],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000});
 if(r.status!==0)throw Error(script+' 失败：'+String(r.stderr||r.error||'').slice(0,300));return JSON.parse(r.stdout);
}
async function systemFps(game:string){
 const {port,release}=await reservePreviewPort(),url=`http://localhost:${port}/`,expected=digest(readFileSync(join(game,'dist/forgeax-dist.json')));
 const p=Bun.spawn(['node',join(engineRoot,'packages/engine/dist/bin/forgeax.mjs'),'project','preview','--root',game,'--port',String(port),'--json'],{cwd:game,stdout:'ignore',stderr:'ignore'});void p.exited.then(release,release);
 try{let ready=false;for(let n=0;n<120&&!ready;n++){try{ready=await previewMatches(url,expected);}catch{}if(!ready)await Bun.sleep(250);}
  if(!ready)return {error:'预览未启动'};
  const r=spawnSync('node',[join(import.meta.dirname,'system-fps.mjs'),engineRoot,url],{encoding:'utf8',timeout:180000});return JSON.parse(r.stdout.trim().split('\n').at(-1)||'{"error":"无输出"}');
 }finally{p.kill();await p.exited;}
}

export async function replayScene(entry:{id:string;run:string},out:string,baselineDir?:string){
 const runDir=recordedRun(entry.run);if(!runDir)return {id:entry.id,run:entry.run,skipped:'本机没有该记录（PIPELINE_RECORDED_RUNS_DIR）'};
 const src=benchSource(runDir),folder=join(out,entry.id),started=Date.now();mkdirSync(folder,{recursive:true});
 const result:any={id:entry.id,run:basename(runDir),jobId:src.jobId,kind:src.kind,deliveredScore:src.score,sourceFolder:src.folder};
 try{
  const scene=read(src.scenePath);await renderRepairPreview(scene,src.images,src.refs,join(folder,'render'),new AbortController().signal,{preJudge:true});
  const receipt=read(join(folder,'render/capture/preview-capture.json')),baseline=baselineDir&&existsSync(join(baselineDir,entry.id,'result.json'))?read(join(baselineDir,entry.id,'result.json')):null;
  const frames=receipt.frames.map((f:any,i:number)=>({referenceIndex:scene.cameras[i]?.referenceIndex??null,file:join(folder,'render/capture',f.file)})).filter((f:any)=>Number.isInteger(f.referenceIndex));
  result.frames=frames.map((f:any)=>{const original=src.images[f.referenceIndex-1].path,copy=join(folder,`reference-${f.referenceIndex}${original.slice(original.lastIndexOf('.'))}`);copyFileSync(original,copy);
   // Without a previous bench run the frame the judge saw at delivery is the comparison column.
   const prior=baseline?.frames?.find((b:any)=>b.referenceIndex===f.referenceIndex)?.frame,delivered=join(runDir,src.folder,'runtime',`reference-${f.referenceIndex}.png`),deliveredCopy=join(folder,`delivered-${f.referenceIndex}.png`);
   if(!baseline&&existsSync(delivered))copyFileSync(delivered,deliveredCopy);
   return {referenceIndex:f.referenceIndex,frame:relative(out,f.file),reference:relative(out,copy),baseline:baseline?(prior?join(relative(out,baselineDir!),prior):null):existsSync(deliveredCopy)?relative(out,deliveredCopy):null};});
  const pairs=result.frames.map((f:any)=>({referenceIndex:f.referenceIndex,original:join(out,f.reference),frame:join(out,f.frame),...(f.baseline?{baseline:resolve(out,f.baseline)}:{}),boxes:landmarkBoxes(src.observation,f.referenceIndex)}));
  result.objective=python('../geometry/objective-metrics.py',{version:'objective-reference-metrics-v1',pairs}).references;
  result.colour=python('landmark-color.py',{pairs});result.offLandmarks=landmarkOffsets(result.colour);
  result.fps={capture:receipt.report?.performance?.submittedFps??null,system:await systemFps(join(folder,'render/project/game'))};
  if(baseline)result.regressions=benchRegressions(result,baseline);
 }catch(error){result.error=String((error as any)?.message??error).slice(0,1200);}
 result.durationMs=Date.now()-started;save(join(folder,'result.json'),result);return result;
}

if(import.meta.main){
 const [setFile,out,...rest]=process.argv.slice(2),baselineAt=rest.indexOf('--baseline'),baselineDir=baselineAt>=0?resolve(rest[baselineAt+1]):undefined;
 if(!setFile||!out)throw Error('usage: bun src/bench/replay.ts <scenes.json> <out dir> [--baseline <previous out dir>]');
 const set=read(setFile),outDir=resolve(out);mkdirSync(outDir,{recursive:true});const results=[];
 for(const entry of set.scenes){console.log('▶',entry.id);const r=await replayScene(entry,outDir,baselineDir);results.push(r);
  console.log(r.skipped?'  跳过：'+r.skipped:r.error?'  失败：'+r.error.slice(0,200):`  完成 ${Math.round(r.durationMs/1000)}s · 系统Chrome ${r.fps.system?.median??r.fps.system?.error} FPS · 偏差地标 ${r.offLandmarks.length}${r.regressions?` · 退化 ${r.regressions.length}`:''}`);}
 const report={version:BENCH_REPLAY,createdAt:new Date().toISOString(),set:setFile,baseline:baselineDir??null,limits:BENCH_LIMITS,results};
 save(join(outDir,'report.json'),report);writeFileSync(join(outDir,'report.html'),benchReportHTML(report));console.log('报告：'+join(outDir,'report.html'));
}
