// Engine FPS readout of a served game in the system Chrome (not the bundled capture Chromium) at DPR 2.
// usage: node system-fps.mjs <engine root> <url> [width height]  →  {"browser","canvas","samples","median"} | {"error"}
// Study add64324 ran 89 FPS in the capture Chromium 148 but 37 in the system Chrome 155, so both must be measured.
import {createRequire} from 'node:module';
import {join} from 'node:path';
const [engine,url,width='1280',height='720']=process.argv.slice(2);
const {chromium}=createRequire(join(engine,'packages/engine/node_modules/@forgeax/engine-devkit/package.json'))('playwright');
let browser;
try{
 // Headless still reproduces the system-Chrome gap (MSAA 36-41 vs SMAA 60 on add64324) and opens no window on the desk.
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage({viewport:{width:+width,height:+height},deviceScaleFactor:2});
 await page.goto(url);
 await page.waitForFunction(()=>/FPS \d/.test(document.getElementById('forgeax-fps')?.textContent??''),null,{timeout:90000});
 const samples=[];for(let i=0;i<8;i++){await page.waitForTimeout(1000);samples.push(parseFloat((await page.evaluate(()=>document.getElementById('forgeax-fps').textContent)).slice(4)));}
 // The first two seconds still include shader and texture warm-up.
 const steady=samples.slice(2).sort((a,b)=>a-b),canvas=await page.evaluate(()=>[document.querySelector('canvas').width,document.querySelector('canvas').height]);
 console.log(JSON.stringify({browser:browser.version(),canvas,samples:samples.slice(2),median:steady[Math.floor(steady.length/2)]}));
}catch(error){console.log(JSON.stringify({error:String(error?.message??error).slice(0,300)}));}
finally{await browser?.close();}
