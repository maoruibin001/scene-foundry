import {closeCaptureResources} from '../capture-shutdown.mjs';
import {captureBrowserExecutable} from '../capture-browser.mjs';
import {createBrowserCapture} from '../../../engine/packages/engine/dist/facades/devkit.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [root,url,output]=process.argv.slice(2),browser=createBrowserCapture(root);let session;
try{
 const audit=JSON.parse(await readFile(join(root,'assets/scene-audit.json'),'utf8'));
 session=await browser.open({browser:captureBrowserExecutable(),backend:'auto',serverUrl:url,headless:true,width:1600,height:900,requireUi:true,outputDir:output});
 const page=session.page,frames=[];await page.locator('#scene-hud').waitFor({state:'visible'});await page.locator('canvas').click();await page.keyboard.press('h');
 for(let i=0;i<audit.views.length;i++){
  await page.keyboard.press(String(i+1));await page.waitForTimeout(500);
  const file='candidate-'+(i+1)+'.png';await session.capture(undefined,{output:join(output,file),requireUi:false,timeoutMs:15000});
  const pose=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.sceneAudit??'null'));
  if(!pose||pose.ambiguousSource||pose.selectedView!==i)throw Error('候选机位来源不完整');
  frames.push({file,referenceIndex:audit.views[i].referenceIndex,pose});
 }
 await writeFile(join(output,'preview-capture.json'),JSON.stringify({frames,report:session.report(),scope:'实际ForgeaX Engine静态预览；未执行完整巡航和独立质量验收'},null,2));
}finally{await closeCaptureResources(session,undefined,message=>console.log(message));}
