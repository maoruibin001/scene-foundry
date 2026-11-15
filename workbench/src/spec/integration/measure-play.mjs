import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export default async function(play){
 const out=resolve('artifacts/pipeline-comparison');await mkdir(out,{recursive:true});const windows=[];
 const observe=()=>play.page.evaluate(async()=>({at:performance.now(),renderer:await globalThis.__forgeaxGameInspection.renderer(),visible:document.visibilityState,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:[...document.querySelectorAll('canvas')].map(c=>[c.width,c.height])}));
 const measure=async(name)=>{
  let s=await play.state('hall');await play.waitFor(t=>t.frames>=s.frames+90,{read:'hall',timeoutMs:20000});
  const a=await observe();s=await play.state('hall');await play.waitFor(t=>t.frames>=s.frames+240,{read:'hall',timeoutMs:30000});const b=await observe();
  assert.equal(a.visible,'visible');assert.equal(b.visible,'visible');const elapsed=(b.at-a.at)/1000;
  const ids=[a.renderer.frameId,b.renderer.frameId];assert.ok(ids.every(Number.isFinite)&&ids[1]>ids[0]);
  windows.push({name,start:a,end:b,renderedFrames:ids[1]-ids[0],seconds:elapsed,renderedFps:(ids[1]-ids[0])/elapsed,engineFps:(b.renderer.execution.frame.completed-a.renderer.execution.frame.completed)/elapsed,gpuMs:null});await play.screenshot(name);
 };
 await play.step('matched ordinary entrance',()=>measure('entrance'));
 await play.keyboard.press('F2');
 await play.step('matched human eye view',async()=>{await play.keyboard.press('Digit2');await measure('eye');});
 await play.step('matched whole hall view',async()=>{await play.keyboard.press('Digit1');await measure('hero');});
 await play.keyboard.press('F2');
 await play.step('normal movement and inspection entry',async()=>{const s=await play.state('hall');await play.keyboard.hold('KeyW',500);assert.ok((await play.state('hall')).z<s.z-.3);await play.screenshot('movement');});
 const result={windows,scope:'Same normal project play, hardware browser, DPR1, original source views, 1280x720; renderer frameId throughput, not GPU timestamp duration or headroom'};
 await writeFile(resolve(out,'measurement.json'),JSON.stringify(result,null,2));return result;
}
