import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {callCodex,codexEnvironment,validateCodexImages} from '../codex-provider';
import {discoverCodexRoute,routeSummary,type CodexRoute} from '../codex-route';
import {useModelPermit} from '../concurrency';
import {verifiedVisualReview,VISUAL_SCHEMA} from './visual-review';
import {VISUAL_PANEL_VERSION,VISUAL_PANEL_LAUNCHERS} from './visual-panel-config';
import type {NodeRequest} from './node-models';

type Member={id:string;executable:string;model:string;reasoningEffort:string;route:CodexRoute;selectionLauncher?:{path:string;sha256:string}};
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
/** config/read reports the account default model, not the wrapper's --model.
 * Admit this simple subscription wrapper contract only; CLI execution must echo it later. */
export function subscriptionLauncherSelection(source:string){
 const m=source.match(/^#!\/bin\/sh\r?\nexec codex --yolo --model (gpt-[A-Za-z0-9._-]+) -c 'model_reasoning_effort="(low|medium|high|xhigh)"' "\$@"\s*$/);
 if(!m)throw Error('VISUAL_PANEL_CONFIG_UNVERIFIED：启动器不符合可审计的订阅模型选择契约');
 return {model:m[1],reasoningEffort:m[2]};
}
/** Configuration/auth checks make no inference request and never read credentials. */
export async function freezeVisualPanel():Promise<Member[]>{
 const members:Member[]=[];
 const executable=Bun.which('codex');if(!executable)throw Error('VISUAL_PANEL_LAUNCHER_MISSING: official codex');
 const route=await discoverCodexRoute(executable,codexEnvironment());
 if(route.providerId!=='openai'||route.definition)throw Error('VISUAL_PANEL_SUBSCRIPTION_REQUIRED: official codex');
 for(const id of VISUAL_PANEL_LAUNCHERS){
  const launcher=Bun.which(id);if(!launcher)throw Error('VISUAL_PANEL_LAUNCHER_MISSING: '+id);
  const bytes=readFileSync(launcher),selection=subscriptionLauncherSelection(bytes.toString());
  const login=Bun.spawnSync([executable,'login','status'],{env:codexEnvironment(),timeout:5000});
  if(login.exitCode!==0||!/Logged in using ChatGPT/.test(new TextDecoder().decode(login.stdout)+new TextDecoder().decode(login.stderr)))throw Error('VISUAL_PANEL_SUBSCRIPTION_LOGIN_REQUIRED: '+id);
  // These audited wrappers only choose model/effort plus --yolo. Resolve the same
  // subscription CLI directly so the visual node's read-only sandbox cannot be overridden.
  members.push({id,executable,...selection,route,selectionLauncher:{path:launcher,sha256:sha(bytes)}});
 }
 if(new Set(members.map(m=>m.model)).size!==members.length)throw Error('VISUAL_PANEL_DUPLICATE_MODELS：不同启动器指向同一模型，不能冒充独立评委');
 return members;
}
/** Highest valid complete report wins as a whole; never mix dimensions from different judges. */
export function aggregateVisualPanel(results:any[]){
 const valid=results.filter(r=>r.status==='completed'&&r.review);
 if(!valid.length)throw Error('VISUAL_PANEL_NO_VALID_REVIEW：全部评委无有效结果，不能给占位分');
 const winner=valid.reduce((a,b)=>b.review.overall>a.review.overall?b:a);
 const scores=valid.map(r=>r.review.overall).sort((a,b)=>a-b),n=scores.length;
 return {winner:winner.id,selection:'highest-valid-overall',overall:winner.review.overall,median:(scores[Math.floor((n-1)/2)]+scores[Math.floor(n/2)])/2,min:scores[0],max:scores.at(-1),spread:scores.at(-1)-scores[0],validCount:n,expectedCount:results.length,complete:n===results.length,review:winner.review};
}
export function jointVisualFeedback(results:any[]){
 return {version:'independent-visual-feedback-v1',rule:'All valid independent reports are evidence, including lower scores. Resolve conflicting advice against frozen requirements and pixels; never edit geometry or accept a claim merely because a judge said it.',judges:results.filter(r=>r.status==='completed').map(r=>({id:r.id,model:r.model,overall:r.review.overall,verdict:r.review.verdict,dimensions:r.review.dimensions,strengths:r.review.strengths,issues:r.review.issues,summary:r.review.summary}))};
}
/** One panel, exactly one attempt per judge. Persist failures and original image bytes too. */
export async function runVisualPanel(input:NodeRequest,dir:string,options:{members?:Member[];call?:typeof callCodex}={}){
 if(existsSync(join(dir,'panel.json')))throw Error('VISUAL_PANEL_ALREADY_EXISTS：已有评审禁止原地覆盖');
 mkdirSync(dir,{recursive:true});
 const members=options.members??await freezeVisualPanel(),source=validateCodexImages(input.images);
 if(!source.length)throw Error('VISUAL_PANEL_IMAGES_REQUIRED');
 const imageDir=join(dir,'images');mkdirSync(imageDir,{recursive:true});
 const images=source.map((im,index)=>{const path=join(imageDir,String(index)+(im.mime==='image/png'?'.png':'.jpg'));copyFileSync(im.path,path);if(sha(readFileSync(path))!==im.sha256)throw Error('VISUAL_PANEL_IMAGE_CHANGED');return {path,mime:im.mime};});
 const inputReceipt={version:VISUAL_PANEL_VERSION,sourceImages:source,transmittedImages:validateCodexImages(images),transformation:'none-original-file-bytes',systemSha256:sha(input.system),textSha256:sha(input.text),schemaSha256:sha(JSON.stringify(VISUAL_SCHEMA))};
 save(join(dir,'input.json'),inputReceipt);save(join(dir,'request.json'),{system:input.system,text:input.text});
 const results:any[]=members.map(m=>({id:m.id,model:m.model,reasoningEffort:m.reasoningEffort,status:'pending',route:routeSummary(m.route),selectionLauncher:m.selectionLauncher??null,file:m.id+'/review.json'}));
 const manifest=()=>save(join(dir,'panel.json'),{version:VISUAL_PANEL_VERSION,status:'running',aggregation:'highest-valid-overall',members:results,startedAt});
 const startedAt=new Date().toISOString();manifest();
 await Promise.all(members.map(async(m,i)=>{
  const folder=join(dir,m.id);mkdirSync(folder,{recursive:true});const started=Date.now();results[i].status='running';manifest();
  try{
   const r=await useModelPermit('spec-style-judge:'+sha(dir).slice(0,12)+':'+m.id,input.signal,()=>(options.call??callCodex)({...input,images,modelSettings:{model:m.model,reasoningEffort:m.reasoningEffort}},folder,m.model,VISUAL_SCHEMA,{executable:m.executable,route:m.route,selectionLauncher:m.selectionLauncher}));
   save(join(folder,'raw-response.json'),{text:r.text});save(join(folder,'route.json'),r.receipt);
   if(r.receipt.cliProvider!=='openai'||r.receipt.authentication!=='chatgpt-subscription'||r.receipt.cliModel!==m.model||r.receipt.cliReasoningEffort!==m.reasoningEffort||r.receipt.cliSandbox!=='read-only')throw Error('VISUAL_PANEL_EXECUTION_UNVERIFIED：实际模型、订阅或只读执行不符');
   for(const im of inputReceipt.transmittedImages)if(sha(readFileSync(im.path))!==im.sha256)throw Error('VISUAL_PANEL_IMAGE_CHANGED');
   const review=verifiedVisualReview(JSON.parse(r.text),images.length);
   const execution=join(folder,input.role+'-execution.json'),usageFile=join(folder,input.role+'-usage.json');
   const record={...results[i],status:'completed',review,receipt:r.receipt,durationMs:Date.now()-started,usage:r.receipt.usage,usageDetailsFile:existsSync(usageFile)?m.id+'/'+input.role+'-usage.json':null,execution:existsSync(execution)?JSON.parse(readFileSync(execution,'utf8')):null,cost:{amount:null,currency:null,basis:'subscription usage; no per-call billing receipt'},completedAt:new Date().toISOString()};
   results[i]=record;save(join(folder,'review.json'),record);
  }catch(error){results[i]={...results[i],status:input.signal?.aborted?'cancelled':'failed',error:String(error),durationMs:Date.now()-started,completedAt:new Date().toISOString()};save(join(folder,'failure.json'),results[i]);}
  manifest();
 }));
 input.signal?.throwIfAborted();
 let selected;try{selected=aggregateVisualPanel(results);}catch(error){save(join(dir,'panel.json'),{version:VISUAL_PANEL_VERSION,status:'failed',aggregation:'highest-valid-overall',members:results,error:String(error),startedAt,completedAt:new Date().toISOString()});throw error;}
 const {review,...stats}=selected,summary={version:VISUAL_PANEL_VERSION,status:selected.complete?'completed':'partial',aggregation:'highest-valid-overall',...stats,members:results,startedAt,completedAt:new Date().toISOString()};
 const feedback=jointVisualFeedback(results);save(join(dir,'joint-feedback.json'),feedback);save(join(dir,'panel.json'),summary);
 return {text:JSON.stringify({...review,panel:summary,jointFeedback:feedback}),receipt:{provider:'codex-subscription-panel',...stats,input:'input.json',panel:'panel.json',newModelCalls:members.length}};
}
