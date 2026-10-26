// usage: node create-job.cjs <port> <base: ''|voxel/> <image> <prompt> [go]
const {chromium}=require('playwright-core');
(async()=>{
 const [port,base,image,prompt,go]=process.argv.slice(2);
 const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage();
 p.on('pageerror',e=>console.log('PAGEERR',e.message));
 await p.goto('http://127.0.0.1:'+(process.env.UI||19884)+'/'+base+'#create');await p.waitForSelector('#submit',{timeout:20000});
 await p.click('[data-mode=image_prompt]');
 const images=image.split(',');await p.setInputFiles('#image',images);
 await p.waitForFunction(n=>document.querySelectorAll('#upload-preview figure').length===n,images.length,{timeout:30000});
 await p.fill('#prompt',prompt);
 await p.check('[name=complexity][value=complex]');
 for(const [s,v] of [['#scene-model','gpt-6-astra-aihub-azure'],['#scene-effort','xhigh'],['#reuse-mode','fresh'],['#matching-level','standard']])await p.selectOption(s,v).catch(e=>console.log('sel',s,e.message));
 const info=await p.evaluate(()=>({gen:document.querySelector('#generation-mode')?.value,model:document.querySelector('#scene-model')?.value,effort:document.querySelector('#scene-effort')?.value,acc:document.querySelector('#scene-acceptance')?.value,reuse:document.querySelector('#reuse-mode')?.value,submit:document.querySelector('#submit')?.disabled,hint:document.querySelector('#create-hint')?.textContent}));
 console.log(JSON.stringify(info));
 if(go==='go'&&!info.submit){await p.click('#submit');await p.waitForFunction(()=>location.hash.startsWith('#reference/'),null,{timeout:60000});console.log('REF',(await p.evaluate(()=>location.hash)).split('/')[1]);
  await p.waitForSelector('#approve-ref',{timeout:30000});await p.click('#approve-ref');
  await p.waitForSelector('#start-ref',{timeout:30000});await p.click('#start-ref');
  await p.waitForFunction(()=>location.hash.startsWith('#job/'),null,{timeout:60000});console.log('HASH',await p.evaluate(()=>location.hash));}
 await b.close();})();
