import {recordingSink} from '../recording-sink.mjs';
import {captureShutdown} from '../capture-shutdown.mjs';
import {createBrowserCapture} from '../../../engine/packages/engine/dist/facades/devkit.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {analyzeSceneRun} from './runtime-metrics.mjs';
import {capturePlan} from './capture-plan.mjs';
const [root,url,output]=process.argv.slice(2),browser=createBrowserCapture(root);let session,sink;
const shutdown=captureShutdown(async()=>{try{await sink?.close();}finally{if(session)await session.page.close({runBeforeUnload:false}).catch(()=>{});await session?.close();}});
try{
 const audit=JSON.parse(await readFile(join(root,'assets/scene-audit.json'),'utf8'));
 const plan=capturePlan(audit.views.length),timings=[];
 const timed=async(name,fn)=>{const t={name,startedAt:Date.now(),status:'running'};timings.push(t);const persist=()=>writeFile(join(output,'capture-timing.json'),JSON.stringify({plan,timings},null,2));await persist();console.log('开始 '+name);try{const result=await fn();t.status='passed';return result;}catch(e){t.status='failed';t.error=String(e);throw e;}finally{t.endedAt=Date.now();t.durationMs=t.endedAt-t.startedAt;await persist();console.log(name+' '+t.status+' '+t.durationMs+'ms');}};
 session=await timed('打开引擎',()=>browser.open({backend:'auto',serverUrl:url,headless:true,width:1600,height:900,requireUi:true,outputDir:output}));if(shutdown.ready())throw Error('采集已被终止');const page=session.page,errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.locator('#scene-hud').waitFor({state:'visible'});await timed('with-ui.png',()=>session.capture(undefined,{output:join(output,'with-ui.png'),requireUi:true,timeoutMs:plan.frameTimeoutMs}));
 await page.locator('canvas').click();await page.keyboard.press('h');const hidden=await page.locator('#scene-hud').isHidden(),images=[],samples=[];
 // 等待机位稳定后只采一次；devkit 的 waitMs 会在首张采集后再采一遍，重复请求 GPU 诊断。
 const capture=async(name,kind,waitMs=plan.settleMs)=>{await page.waitForTimeout(waitMs);await timed(name,()=>session.capture(undefined,{output:join(output,name),requireUi:false,timeoutMs:plan.frameTimeoutMs}));const state=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null'));if(!state||state.ambiguousSource)throw Error('相机证据缺失或混入其他运行实例');images.push(name);samples.push({...state,name,kind,at:Date.now()});console.log('Captured '+name);};
 for(let i=0;i<audit.views.length;i++){await page.keyboard.press(String(i+1));await capture((audit.views[i].referenceIndex?'reference-'+audit.views[i].referenceIndex:'inspection-'+(i+1))+'.png','view');}
 await page.keyboard.press('1');await page.keyboard.press('r');
 const recordingStartedAt=await page.evaluate(()=>Number(document.documentElement.dataset.sceneRecordingStartedAt));
 if(!Number.isFinite(recordingStartedAt)||recordingStartedAt<=0)throw Error('录屏缺少真实开始时间');
 const targets=[];await page.keyboard.press('Space');
 await timed('连续录屏与相机观测',async()=>{for(let i=0;i<plan.continuousFrames;i++){
  await page.waitForTimeout(plan.movementWaitMs);const state=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null')),at=Date.now(),name='continuous-'+(i+1)+'.png';
  if(!state||state.ambiguousSource)throw Error('连续录屏相机来源无效');
  targets.push({name,timeMs:at-recordingStartedAt});images.push(name);samples.push({...state,name,kind:'continuous',at});
  await writeFile(join(output,'motion-samples.json'),JSON.stringify({recordingStartedAt,targets,samples},null,2));
 }});
 await page.keyboard.press('Space');await page.keyboard.press('r');await page.keyboard.press('h');const restored=await page.locator('#scene-hud').isVisible();
 await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null')?.running===false,null,{timeout:3000});
 const terminal=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null'));
 const link=page.getByRole('link',{name:'保存录屏'});await link.waitFor({state:'visible'});const recording=await link.getAttribute('href');
 sink=await recordingSink(join(output,'scene-tour.webm'),new URL(url).origin);
 const transfer=await page.evaluate(async({recording,destination})=>{const blob=await(await fetch(recording)).blob();const r=await fetch(destination,{method:'POST',headers:{'Content-Type':'video/webm'},body:blob});if(!r.ok)throw Error('录屏保存失败');return await r.json()},{recording,destination:sink.url});
 const receipt=await sink.receipt;if(transfer.sha256!==receipt.sha256||transfer.bytes!==receipt.bytes)throw Error('录屏来源摘要不一致');
 await writeFile(join(output,'video-frame-targets.json'),JSON.stringify(targets));
 await timed('原始录屏取帧',()=>promisify(execFile)(fileURLToPath(new URL('../../data/reconstruction-env/bin/python',import.meta.url)),[fileURLToPath(new URL('./video-frames.py',import.meta.url)),join(output,'scene-tour.webm'),output,join(output,'video-frame-targets.json')],{timeout:30000,maxBuffer:1024*1024}));
 const videoFrames=JSON.parse(await readFile(join(output,'video-frames.json'),'utf8'));
 if(videoFrames.videoSha256!==receipt.sha256||videoFrames.frames.length!==plan.continuousFrames)throw Error('连续画面与原始录屏来源不符');
 for(const frame of videoFrames.frames){if(frame.sha256!==createHash('sha256').update(await readFile(join(output,frame.name))).digest('hex'))throw Error('连续画面摘要不符');}
 await timed('录屏后引擎响应',()=>session.capture(undefined,{output:join(output,'after-motion.png'),requireUi:true,timeoutMs:plan.frameTimeoutMs}));
 const engineReport=session.report();errors.push(...engineReport.pageErrors,...engineReport.consoleErrors);
 const metrics=analyzeSceneRun(samples,audit),hashes=await Promise.all(images.map(async name=>createHash('sha256').update(await readFile(join(output,name))).digest('hex')));
 const videoFps=(videoFrames.decodedFrames-1)/(videoFrames.durationMs/1000);
 const result={...metrics,hard:{...metrics.hard,runtime:metrics.submittedFps>0,noErrors:errors.length===0,hudToggle:hidden&&restored,video:receipt.bytes>0,frameRate:metrics.hard.frameRate&&videoFps>=10,cameraStopped:terminal?.running===false,multipleViews:metrics.hard.multipleViews&&new Set(hashes.slice(0,audit.views.length)).size===audit.views.length},images,hashes,referenceFrames:audit.views.map((v,i)=>({referenceIndex:v.referenceIndex,file:images[i]})),video:'scene-tour.webm',recording:{...receipt,decodedFps:videoFps,frames:videoFrames},poses:samples.map(({frameTimes,...s})=>s),errors,engineReport,distManifestDigest:createHash('sha256').update(await readFile(join(root,'dist/forgeax-dist.json'))).digest('hex'),scope:'静态机位为Engine官方采集；连续画面从原始录屏按PTS提取，与实际相机观测相差不超过250毫秒；未见区域仍需视觉判断'};
 await writeFile(join(output,'runtime.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({hard:result.hard,fps:result.submittedFps}));
}finally{await shutdown.close();}
