import {recordingSink} from './recording-sink.mjs';
import {createBrowserCapture} from '../../engine/packages/engine/dist/facades/devkit.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {analyzeRun} from './runtime-metrics.mjs';
const [root,url,output]=process.argv.slice(2),browser=createBrowserCapture(root);let session,sink;
const step=name=>console.log(JSON.stringify({phase:name,at:new Date().toISOString()}));
try{
 step('open');session=await browser.open({backend:'auto',serverUrl:url,headless:true,width:960,height:640,requireUi:true,outputDir:output});const page=session.page,errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.locator('#scene-hud').waitFor({state:'visible'});await session.capture(undefined,{output:join(output,'with-ui.png'),requireUi:true,timeoutMs:30000});
 await page.locator('canvas').click();await page.keyboard.press('h');
 const visibleUi=()=>page.evaluate(()=>Array.from(document.querySelectorAll('[data-scene-ui]')).filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).length);
 const hidden=await visibleUi()===0;await page.keyboard.press('r');
 step('record');const samples=[],images=[],start=Date.now();await page.keyboard.press('Space');
 for(let i=0;i<12;i++){const name='view-'+(i+1)+'.png';await session.capture(undefined,{output:join(output,name),requireUi:false,waitMs:i?3400:300,timeoutMs:30000});images.push(name);step(name);const s=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null'));if(!s||s.ambiguousSource)throw Error('Camera telemetry unavailable or ambiguous');samples.push({...s,at:Date.now()});}
 await page.keyboard.press('Space');await page.keyboard.press('r');await page.keyboard.press('h');const restored=await visibleUi()>0;
 step('save-recording');const link=page.getByRole('link',{name:'保存录屏'});await link.waitFor({state:'visible'});const recording=await link.getAttribute('href');if(!recording||(!recording.startsWith('blob:')&&!recording.startsWith('data:video/')))throw Error('Recording URL missing');
 sink=await recordingSink(join(output,'scene-tour.webm'),new URL(url).origin);
 const transfer=await page.evaluate(async ({recording,destination})=>{const blob=await (await fetch(recording)).blob();const response=await fetch(destination,{method:'POST',headers:{'Content-Type':'video/webm'},body:blob,signal:AbortSignal.timeout(18000)});if(!response.ok)throw Error('Recording upload failed '+response.status);return await response.json();},{recording,destination:sink.url});
 const recordingReceipt=await sink.receipt;if(transfer.sha256!==recordingReceipt.sha256||transfer.bytes!==recordingReceipt.bytes)throw Error('Recording transfer digest mismatch');step('recording-saved');
 const audit=JSON.parse(await readFile(join(root,'assets/scene-audit.json'),'utf8')),metrics=analyzeRun(samples,audit),fps=(samples.at(-1).frames-samples[0].frames)/((samples.at(-1).at-samples[0].at)/1000);
 const report=session.report();errors.push(...report.pageErrors,...report.consoleErrors);
 const hashes=await Promise.all(images.map(async n=>createHash('sha256').update(await readFile(join(output,n))).digest('hex')));
 const result={...metrics,hard:{...metrics.hard,runtime:fps>0,hudToggle:hidden&&restored,noErrors:errors.length===0},images,hashes,video:'scene-tour.webm',recording:{...recordingReceipt,source:'MediaRecorder output exposed by scene UI',browserSaveInteraction:'not measured by capture; independent normal UI download receipt is required'},durationMs:Date.now()-start,poses:samples.map(({frameTimes,...s})=>s),submittedFps:fps,errors,engineReport:report,distManifestDigest:createHash('sha256').update(await readFile(join(root,'dist/forgeax-dist.json'))).digest('hex')};
 await writeFile(join(output,'runtime.json'),JSON.stringify(result,null,2));await writeFile(join(output,'frame-times.json'),JSON.stringify(samples.at(-1).frameTimes));console.log(JSON.stringify({ok:Object.values(result.hard).every(Boolean),fps,hard:result.hard,missingParts:metrics.missingParts}));
}finally{step('close-recording-sink');await sink?.close();step('close-capture-page');if(session)await session.page.close({runBeforeUnload:false});step('close-capture-session');await session?.close();step('capture-closed');}
