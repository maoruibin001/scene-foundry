import {historySceneHTML} from '../public/history-scene-ui.js';
import {test,expect} from 'bun:test';
import {deliveryHTML} from '../public/delivery-ui.js';
import {imageReconstructionHTML} from '../public/image-reconstruction-ui.js';
import {automaticRecoveryHTML} from '../public/recovery-ui.js';
import {diagnosisHTML} from '../public/diagnosis-ui.js';
import {referencePage} from '../public/reference-ui.js';
import {refreshRoundAudit} from '../public/round-audit-ui.js';
import {apiPath as processApiPath} from '../public/process/api-path.js';

// Render the same shared components in both namespaces. Fixtures never access a
// service, create a scene, stop a task or write production data.
const id='11111111-1111-4111-8111-111111111111';
async function inScene(kind:'ordinary'|'voxel',run:()=>any){
 const old=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{pathname:kind==='voxel'?'/voxel/':'/',hash:'#records'}});
 try{return await run();}finally{if(old)Object.defineProperty(globalThis,'location',old);else delete (globalThis as any).location;}
}
function checkLinks(html:string,kind:'ordinary'|'voxel',paths:string[]){
 for(const path of paths){const expected=kind==='voxel'?(path.startsWith('/api/')?path.replace('/api/','/api/voxel/'):'/voxel'+path):path;expect(html).toContain('="'+expected+'"');}
 if(kind==='voxel')expect(html).not.toMatch(/(?:href|src)="\/(?:files\/|process\/|api\/(?!voxel\/))/);
}
for(const kind of ['ordinary','voxel'] as const){
 test(kind+' shared delivery, image report and recovery links use the matching data namespace',()=>inScene(kind,()=>{
  const best={kind:'scene',images:['runtime/front.png'],runtime:'runtime.json',score:72,qualityStatus:'not_met',distManifestDigest:'a'.repeat(64),reconstructionGoal:{id:'goal'},imageReconstructionFile:'iterations/1/image-reconstruction.json'};
  const job:any={id,delivery:{available:true,state:'available',execution:{},best},automaticRecovery:[{role:'plan',status:'completed',attempt:1,path:'generation/plan.recovery.json',attempts:[]}]};
  const before=JSON.stringify(job),html=deliveryHTML(job)+imageReconstructionHTML(job)+automaticRecoveryHTML(job);
  checkLinks(html,kind,['/files/runs/'+id+'/runtime/front.png','/api/jobs/'+id+'/download-output','/files/runs/'+id+'/runtime.json','/files/runs/'+id+'/iterations/1/image-reconstruction.json','/files/runs/'+id+'/generation/plan.recovery.json']);
  expect(JSON.stringify(job)).toBe(before);
 }));
 test(kind+' diagnostic evidence returned by the backend is mapped without changing report text',()=>inScene(kind,()=>{
  const job:any={id,diagnosis:{decision:{action:'diagnose',reason:'saved /files/report-text remains unchanged'},scoreUnit:'空间分',used:{repairs:1,calls:2},limits:{repairs:2,calls:10},rounds:[{jobId:id,round:0,score:3,confidence:.9,gate:'/files/runs/'+id+'/gate.json'}],findings:[],gaps:[],experiments:[{geometrySame:true,cameraSame:true,modelCalls:0,findings:[],frames:[{view:1,before:{p95MinusP05:1},after:{p95MinusP05:2},beforeUrl:'/files/runs/'+id+'/before.png',afterUrl:'/voxel/files/runs/'+id+'/after.png'}]}],plan:[],next:'next',method:'method'}};
  const before=JSON.stringify(job),html=diagnosisHTML(job);
  checkLinks(html,kind,['/files/runs/'+id+'/gate.json','/files/runs/'+id+'/before.png','/files/quality-diagnoses/'+id+'.json']);
  expect(html).toContain('="/voxel/files/runs/'+id+'/after.png"');
  expect(html).toContain('saved /files/report-text remains unchanged');expect(JSON.stringify(job)).toBe(before);
 }));
 test(kind+' confirmed reference images use the same component and correct namespace',()=>inScene(kind,async()=>{
  const content:any={innerHTML:'',querySelector:()=>null},oldInterval=globalThis.setInterval;
  globalThis.setInterval=(()=>0) as any;
  try{await referencePage({id:'reference',content,isActive:()=>true,onError:(error:any)=>{throw error;},api:async(path:string)=>path==='/api/reference-service'?{configured:false}:{id:'reference',status:'approved',prompt:'same input',origin:'uploaded',revision:1,createdAt:'2026-10-19T00:00:00Z',jobId:id,approval:{at:1},images:[{name:'reference.jpg',file:'reference.jpg'}]}});}
  finally{globalThis.setInterval=oldInterval;}
  checkLinks(content.innerHTML,kind,['/files/uploads/reference.jpg']);expect(content.innerHTML).toContain('href="#job/'+id+'"');
 }));
 test(kind+' timing, repair audit and process direct reads stay in the correct namespace',()=>inScene(kind,async()=>{
  // The browser module starts a polling timer on import. Load it under an
  // inert timer so this DOM fixture cannot leave a poller in the full suite.
  const intervalBefore=globalThis.setInterval;let refreshTimings:any;
  globalThis.setInterval=(()=>0) as any;
  try{({refreshTimings}=await import('../public/timing-ui.js'));}finally{globalThis.setInterval=intervalBefore;}
  const documentBefore=Object.getOwnPropertyDescriptor(globalThis,'document'),fetchBefore=globalThis.fetch,seen:string[]=[];
  const timing:any={dataset:{timingJob:id},isConnected:false},audit:any={dataset:{roundAudit:id},isConnected:false};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:(selector:string)=>selector==='[data-timing-job]'?timing:audit}});
  globalThis.fetch=(async(path:any)=>{seen.push(String(path));return Response.json({});}) as any;
  try{await refreshTimings();await refreshRoundAudit();}finally{globalThis.fetch=fetchBefore;if(documentBefore)Object.defineProperty(globalThis,'document',documentBefore);else delete (globalThis as any).document;}
  const prefix=kind==='voxel'?'/api/voxel':'/api';expect(seen).toEqual([prefix+'/jobs/'+id+'/timing',prefix+'/jobs/'+id+'/repair-audit']);
  expect(processApiPath('/api/process/index')).toBe(prefix+'/process/index');
  expect(processApiPath('http://127.0.0.1:19999/?scene=actual')).toBe('http://127.0.0.1:19999/?scene=actual');
 }));
 test(kind+' shared history preserves reference, output, download and process navigation',()=>inScene(kind,async()=>{
  const windowBefore=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},scrollTo(){}}});
  try{
   const {renderHistory}=await import('../public/history-ui.js'),nodes=new Map(),content:any={innerHTML:'',querySelector:(selector:string)=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',insertAdjacentHTML(){}});return nodes.get(selector);},querySelectorAll:()=>[]};
   const job={id,name:'same scene',prompt:'same prompt',mode:'image_prompt',complexity:'complex',image:{name:'reference.jpg',file:'reference.jpg'},thumbnail:'/files/runs/'+id+'/runtime/front.png',recording:'/files/runs/'+id+'/runtime/cruise.webm',downloadable:true,status:'running',createdAt:'2026-10-19T00:00:00Z',durationMs:1000,score:null,attempt:1,version:{id:'version',label:'fixed'},model:'fixed-model'};
   const data={items:[job],total:1,allTotal:1,page:1,pages:1,pageSize:20,from:1,to:1,summary:{scored:0,passed:0,notPassed:0,active:1},facets:{versions:[],batches:[],models:[]}},options={content,isActive:()=>true,onError:(error:any)=>{throw error;},api:async(path:string)=>path.startsWith('/api/jobs?')?data:{items:[]}};
   await renderHistory(options);
   const scene=historySceneHTML(job,{available:true,best:{kind:'scene',images:['delivery/outputs/scene-kept/runtime/front.png'],folder:'delivery/outputs/scene-kept',distManifestDigest:'a'.repeat(64)}});checkLinks(content.innerHTML+scene,kind,['/files/uploads/reference.jpg','/files/runs/'+id+'/delivery/outputs/scene-kept/runtime/front.png','/api/jobs/'+id+'/download-output']);
   const prefix=kind==='voxel'?'/voxel':'';expect(content.innerHTML).toContain('href="'+prefix+'/files/runs/'+id+'/runtime/cruise.webm?download=1"');expect(content.innerHTML).toContain('data-stop-job="'+id+'"');
   (globalThis as any).location.hash='#records?'+new URLSearchParams({process:'run:'+id,from:'job/'+id,tab:'assets'});
   await renderHistory(options);expect(content.innerHTML).toContain('src="'+prefix+'/process/#job=run%3A'+id);expect(content.innerHTML).toContain('tab=assets');expect(content.innerHTML).toContain('href="#job/'+id+'"');
  }finally{if(windowBefore)Object.defineProperty(globalThis,'window',windowBefore);else delete (globalThis as any).window;}
 }));
}
