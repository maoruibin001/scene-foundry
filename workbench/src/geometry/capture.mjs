import {waitForReflections} from './reflection-ready.mjs';
import {captureFrame} from './reference-frame.mjs';
import {captureBrowserExecutable} from '../capture-browser.mjs';
import {reconstructionPython} from '../runtime-paths.mjs';
import {recordingSink} from '../recording-sink.mjs';
import {captureShutdown,closeCaptureResources} from '../capture-shutdown.mjs';
import {createBrowserCapture} from '../../../engine/packages/engine/dist/facades/devkit.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {analyzeSceneRun} from './runtime-metrics.mjs';
import {recordedMotion} from './recorded-motion.mjs';
import {capturePlan} from './capture-plan.mjs';
const [root,url,output]=process.argv.slice(2),browser=createBrowserCapture(root);let session,sink;
const shutdown=captureShutdown(()=>closeCaptureResources(session,sink,message=>console.log(message)));
try{
 const audit=JSON.parse(await readFile(join(root,'assets/scene-audit.json'),'utf8'));
 const plan=capturePlan(audit.views.length),timings=[],recordingFrame=captureFrame(audit.views[0]);
 const timed=async(name,fn)=>{const t={name,startedAt:Date.now(),status:'running'};timings.push(t);const persist=()=>writeFile(join(output,'capture-timing.json'),JSON.stringify({plan,timings},null,2));await persist();console.log('开始 '+name);try{const result=await fn();t.status='passed';return result;}catch(e){t.status='failed';t.error=String(e);throw e;}finally{t.endedAt=Date.now();t.durationMs=t.endedAt-t.startedAt;await persist();console.log(name+' '+t.status+' '+t.durationMs+'ms');}};
 session=await timed('打开引擎',()=>browser.open({browser:captureBrowserExecutable(),backend:'auto',serverUrl:url,headless:true,...recordingFrame,requireUi:true,outputDir:output}));if(shutdown.ready())throw Error('采集已被终止');const page=session.page,errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.locator('#scene-hud').waitFor({state:'visible'});const reflectionWarmup=await waitForReflections(page,audit);if(reflectionWarmup)await writeFile(join(output,'reflection-warmup.json'),JSON.stringify(reflectionWarmup,null,2));await timed('with-ui.png',()=>session.capture(undefined,{output:join(output,'with-ui.png'),requireUi:true,timeoutMs:plan.frameTimeoutMs}));
 await page.locator('canvas').click();await page.keyboard.press('h');const hidden=await page.locator('#scene-hud').isHidden(),images=[],samples=[];
 // 等待机位稳定后只采一次；devkit 的 waitMs 会在首张采集后再采一遍，重复请求 GPU 诊断。
 const capture=async(name,kind,waitMs=plan.settleMs)=>{await page.waitForTimeout(waitMs);await timed(name,()=>session.capture(undefined,{output:join(output,name),requireUi:false,timeoutMs:plan.frameTimeoutMs}));const state=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null'));if(!state||state.ambiguousSource)throw Error('相机证据缺失或混入其他运行实例');images.push(name);samples.push({...state,...page.viewportSize(),name,kind,at:Date.now()});console.log('Captured '+name);};
 for(let i=0;i<audit.views.length;i++){await page.setViewportSize(captureFrame(audit.views[i]));await page.keyboard.press(String(i+1));await capture((audit.views[i].referenceIndex?'reference-'+audit.views[i].referenceIndex:'inspection-'+(i+1))+'.png','view');}
 await writeFile(join(output,'static-frames.json'),JSON.stringify({version:'engine-static-frames-v1',images,samples,distManifestDigest:createHash('sha256').update(await readFile(join(root,'dist/forgeax-dist.json'))).digest('hex')},null,2));
 await page.setViewportSize(recordingFrame);await page.keyboard.press('1');await page.waitForTimeout(plan.settleMs);await page.keyboard.press('r');
 await page.waitForFunction(()=>Number(document.documentElement.dataset.sceneRecordingStartedAt)>0,null,{timeout:10000});
 const recordingStartedAt=await page.evaluate(()=>Number(document.documentElement.dataset.sceneRecordingStartedAt));
 if(!Number.isFinite(recordingStartedAt)||recordingStartedAt<=0)throw Error('录屏缺少真实开始时间');
 const recordingQuality=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneRecordingQuality??'null'));if(!recordingQuality||recordingQuality.version!=='scene-recording-quality-v1'||recordingQuality.width!==recordingFrame.width||recordingQuality.height!==recordingFrame.height||!(recordingQuality.reportedBitsPerSecond>0))throw Error('缺少与固定采集尺寸一致的录屏编码回执');
 const targets=Array.from({length:plan.continuousFrames},(_,i)=>({name:'continuous-'+(i+1)+'.png',timeMs:(i+1)*plan.movementWaitMs})),observations=[];
 await page.keyboard.press('Space');
 await timed('连续录屏与相机观测',async()=>{
  const deadline=Date.now()+plan.continuousFrames*plan.movementWaitMs+10000;
  while(Date.now()<deadline){
   const {state,at}=await page.evaluate(()=>({state:JSON.parse(document.documentElement.dataset.sceneAudit??'null'),at:performance.timeOrigin+performance.now()}));
   if(!state||state.ambiguousSource||!Number.isFinite(at)||at<=recordingStartedAt)throw Error('连续录屏相机来源无效');
   observations.push({...state,...recordingFrame,at});
   if(at-recordingStartedAt>=targets.at(-1).timeMs)break;
   await page.waitForTimeout(100);
  }
  await writeFile(join(output,'motion-observations.json'),JSON.stringify({version:'dense-observed-camera-v1',recordingStartedAt,observations}));
  if(observations.at(-1)?.at-recordingStartedAt<targets.at(-1).timeMs)throw Error('相机观测未覆盖完整录屏区间');
 });
 // 保留最后观测点之后的真实录屏尾部，再停止，避免异步编码截断观测帧。
 await page.keyboard.press('Space');await page.waitForTimeout(500);await page.keyboard.press('r');await page.keyboard.press('h');const restored=await page.locator('#scene-hud').isVisible();
 await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null')?.running===false,null,{timeout:3000});
 const terminal=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null'));
 const link=page.getByRole('link',{name:'保存录屏'});await link.waitFor({state:'visible'});const recording=await link.getAttribute('href');
 sink=await recordingSink(join(output,'scene-tour.webm'),new URL(url).origin);
 const transfer=await page.evaluate(async({recording,destination})=>{const blob=await(await fetch(recording)).blob();const r=await fetch(destination,{method:'POST',headers:{'Content-Type':'video/webm'},body:blob});if(!r.ok)throw Error('录屏保存失败');return await r.json()},{recording,destination:sink.url});
 const receipt=await sink.receipt;if(transfer.sha256!==receipt.sha256||transfer.bytes!==receipt.bytes)throw Error('录屏来源摘要不一致');
 await writeFile(join(output,'video-frame-targets.json'),JSON.stringify({targets,...recordingFrame,observations:observations.map(s=>s.at-recordingStartedAt),preserveIncomplete:true}));
 await timed('原始录屏取帧',()=>promisify(execFile)(reconstructionPython(),[fileURLToPath(new URL('./video-frames.py',import.meta.url)),join(output,'scene-tour.webm'),output,join(output,'video-frame-targets.json')],{timeout:30000,maxBuffer:1024*1024}));
 const videoFrames=JSON.parse(await readFile(join(output,'video-frames.json'),'utf8'));
 const motion=recordedMotion(videoFrames,receipt,observations,recordingStartedAt,plan.continuousFrames);
 for(const frame of videoFrames.frames){
  if(frame.sha256!==createHash('sha256').update(await readFile(join(output,frame.name))).digest('hex'))throw Error('连续画面摘要不符');
  images.push(frame.name);
 }
 samples.push(...motion.samples);
 if(motion.issue)console.log('录屏证据未通过，保留真实静态画面用于独立评分：'+motion.issue.message);
 await writeFile(join(output,'motion-samples.json'),JSON.stringify({recordingStartedAt,targets,samples},null,2));
 await timed('录屏后引擎响应',()=>session.capture(undefined,{output:join(output,'after-motion.png'),requireUi:true,timeoutMs:plan.frameTimeoutMs}));
 const engineReport=session.report();errors.push(...engineReport.pageErrors,...engineReport.consoleErrors);
 const metrics=analyzeSceneRun(samples,audit),hashes=await Promise.all(images.map(async name=>createHash('sha256').update(await readFile(join(output,name))).digest('hex')));
 const videoFps=(videoFrames.decodedFrames-1)/(videoFrames.durationMs/1000);
 const result={...metrics,hard:{...metrics.hard,runtime:metrics.submittedFps>0,noErrors:errors.length===0,hudToggle:hidden&&restored,video:motion.videoPassed,frameRate:metrics.hard.frameRate&&videoFps>=10,cameraStopped:terminal?.running===false,multipleViews:metrics.hard.multipleViews&&new Set(hashes.slice(0,audit.views.length)).size===audit.views.length},captureIssue:motion.issue,images,hashes,referenceFrames:audit.views.map((v,i)=>({referenceIndex:v.referenceIndex,file:images[i]})),video:'scene-tour.webm',recording:{...receipt,quality:recordingQuality,decodedFps:videoFps,frames:videoFrames},poses:samples.map(({frameTimes,...s})=>s),errors,engineReport,distManifestDigest:createHash('sha256').update(await readFile(join(root,'dist/forgeax-dist.json'))).digest('hex'),scope:motion.issue?'静态机位为Engine官方采集，仍可独立评估；原始录屏缺少250毫秒内的帧与实际相机配对，video硬检查失败。motion-observation仅为运行观测，不代表配对截图；不补造连续画面。':'静态机位为Engine官方采集；连续画面从原始录屏按PTS提取，与实际相机观测相差不超过250毫秒；未见区域仍需视觉判断'};
 await writeFile(join(output,'runtime.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({hard:result.hard,fps:result.submittedFps}));
}finally{await shutdown.close();}
