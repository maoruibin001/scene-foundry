import {existsSync,readdirSync,readFileSync,mkdirSync,cpSync,constants,realpathSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {read,save,digest,runDir} from './store';
import {providerFault} from './provider-recovery';

/** Execution, output availability and quality are independent. No status/score is promoted here. */
export function failureDisposition(error:unknown){
 const text=String(error??'');
 if(/FIRST_SCORE_WINDOW_EXPIRED/.test(text))return {kind:'time-window',retryable:false,reason:'首轮时间窗已到；保留已有输出和未完成项，不把超时冒充评分完成'};
 if(/CANCELLED|AbortError/.test(text))return {kind:'cancelled',retryable:false,reason:'用户已取消；保留已经生成的结果'};
 if(/SCORE_BUDGET_RESERVED|SCENE_BUDGET_INSUFFICIENT|MODEL_BUDGET_EXHAUSTED|ASSESSMENT_BUDGET_RESERVED|预算不足/.test(text))return {kind:'budget',retryable:false,reason:'本任务调用预算不足，停止新增模型调用；已有结果仍可查看'};
 if(/PROVIDER_HTTP_(401|402|403)|insufficient[_ ]quota|额度耗尽|余额不足|quota exceeded|usage limit|unauthorized|authentication failed/i.test(text))return {kind:'external',retryable:false,reason:'供应商额度或授权不可用，需要外部恢复；保留已有结果'};
 if(/CODEX_ROUTE|MODEL_ROUTE|NOT_CONFIGURED|PROVIDER_TOOLS|本角色禁止|版本.*不一致|管线代码/.test(text))return {kind:'configuration',retryable:false,reason:'运行配置或工具契约错误，需要修复管线；不能原样重试'};
 if(/SPATIAL_GATE_FAILED|IMPROVEMENT_STOPPED/.test(text))return {kind:'quality',retryable:false,reason:'质量修正已达当前边界；交付已有候选及差距，等待有依据的改进'};
 if(providerFault(error).recoverable)return {kind:'transient',retryable:true,reason:'模型执行中断，自动校验检查点并恢复；不计场景质量失败，实际调用累计'};
 if(/TIMEOUT|超时|超过.*秒|PROVIDER_HTTP_(408|429|500|502|503|504)|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text))return {kind:'transient',retryable:!text.includes('RECOVERY_EXHAUSTED'),reason:'临时执行故障；在预算内有限恢复，保留现有结果'};
 return {kind:'pipeline',retryable:false,reason:'管线执行异常，需要依据错误修复；已有结果不会删除'};
}
const local=(root:string,p:string)=>{const f=resolve(root,p);if(!f.startsWith(resolve(root)+sep)&&f!==resolve(root))throw Error('交付路径越界');if(existsSync(f)&&!realpathSync(f).startsWith(realpathSync(root)+sep)&&realpathSync(f)!==realpathSync(root))throw Error('交付符号链接越界');return f;};
export function inspectOutput(job:any,root:string,folder:string,kind:'scene'|'graybox'|'partial'){
 const base=local(root,folder),runtimeFile=join(base,'runtime/runtime.json'),manifest=join(base,'project/game/dist/forgeax-dist.json'),reportFile=join(base,'project/evidence/run-report.json');
 if(![runtimeFile,manifest,reportFile].every(existsSync))return null;
 try{
  const runtime=read(runtimeFile),report=read(reportFile),hash=digest(readFileSync(manifest));
  if(report.distManifestDigest!==hash||runtime.distManifestDigest!==hash||report.engineSha!==job.profile.engineSha||report.generatorSha!==job.profile.generatorSha)return null;
  if(['engine-build','asset-verify','asset-ready','engine-status'].some(k=>report.stages?.[k]?.status!=='passed'))return null;
  if(!runtime.hard?.runtime||!runtime.hard?.noErrors||!runtime.hard?.entitiesLoaded||!runtime.images?.length||runtime.hashes?.length!==runtime.images.length)return null;
  const images=runtime.images.map((name:string,i:number)=>{if(typeof name!=='string'||!existsSync(local(join(base,'runtime'),name))||digest(readFileSync(local(join(base,'runtime'),name)))!==runtime.hashes[i])throw Error('交付截图摘要不匹配');return [folder,'runtime',name].filter(Boolean).join('/');});
  const assessed=report.browser?.distManifestDigest===hash&&report.spec&&existsSync(join(base,'spec-report.json'))&&digest(JSON.stringify(report.spec))===digest(JSON.stringify(read(join(base,'spec-report.json'))));
  const q=kind==='scene'&&assessed&&existsSync(join(base,'quality.json'))?read(join(base,'quality.json')):null;
  return {kind,folder,distManifestDigest:hash,images,project:[folder,'project'].filter(Boolean).join('/'),runtime:[folder,'runtime/runtime.json'].filter(Boolean).join('/'),engine:'ForgeaX Engine',pipelineVersion:job.pipelineVersion,qualityStatus:kind==='scene'&&q?(q.status==='passed'&&report.spec.status==='passed'&&Object.values(runtime.hard).every(x=>x===true)?'passed':'not_met'):'not_assessed',score:kind==='scene'&&q&&Number.isFinite(q.score)?q.score:null,hardChecks:runtime.hard,qualityFile:q?[folder,'quality.json'].filter(Boolean).join('/'):null};
 }catch{return null;}
}
export function deliveryInfo(job:any,root=runDir(job.id)){
 const candidates:any[]=[];
 const current=inspectOutput(job,root,'',job.partialOutput?'partial':'scene');if(current)candidates.push(current);
 const outputs=join(root,'delivery/outputs');if(existsSync(outputs))for(const n of readdirSync(outputs)){if(!/^(scene|graybox|partial)-[a-f0-9]{16}$/.test(n))continue;const v=inspectOutput(job,root,'delivery/outputs/'+n,n.split('-')[0] as any);if(v)candidates.push(v);}
 const iterations=join(root,'iterations');if(existsSync(iterations))for(const n of readdirSync(iterations).filter(n=>/^\d+$/.test(n))){const v=inspectOutput(job,root,'iterations/'+n,'scene');if(v)candidates.push(v);}
 const blockouts=join(root,'generation/blockout');if(existsSync(blockouts))for(const n of readdirSync(blockouts).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(b)-Number(a))){const v=inspectOutput(job,root,'generation/blockout/'+n,'graybox');if(v)candidates.push(v);}
 // Valid assessed candidates first, then actual scene, partial, and spatial draft. Never infer quality from a graybox.
 const rank=(v:any)=>(v.kind==='scene'?30:v.kind==='partial'?20:10)+(v.qualityStatus==='passed'?100:0)+(v.score??0)/100;
 candidates.sort((a,b)=>rank(b)-rank(a));const best=candidates[0]??null;
 return {version:'output-delivery-v1',available:!!best,state:best?'available':['running','queued'].includes(job.status)?'pending':'unavailable',best,execution:{status:job.status,stage:job.stage,error:job.error??null,fault:job.error?failureDisposition(job.error):null},partial:job.partialOutput??null,limitations:best?.kind==='graybox'?'空间草稿，尚未完成详细资产和成品验收':best?.kind==='partial'?'部分资产仍使用本次已经生成的灰模，未完成成品验收':best?.qualityStatus==='not_assessed'?'已生成并验证运行，视觉质量尚未完成评估':best?.qualityStatus==='not_met'?'已有场景输出，当前质量未达标':null};
}
/** Freeze a real render BEFORE external judging/repair; later exceptions cannot erase it. */
export function preserveOutput(job:any,root:string,folder:string,kind:'scene'|'graybox'|'partial'){
 const checked=inspectOutput(job,root,folder,kind);if(!checked)return null;
 const target='delivery/outputs/'+kind+'-'+checked.distManifestDigest.slice(0,16),dest=join(root,target);
 if(!existsSync(join(dest,'output.json'))){mkdirSync(dest,{recursive:true});for(const item of ['project','runtime','materials','generated-scene.json','quality.json','review.json','spec-report.json']){const p=join(root,folder,item);if(existsSync(p))cpSync(p,join(dest,item),{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});}save(join(dest,'output.json'),{createdAt:new Date().toISOString(),source:folder,pipelineVersion:job.pipelineVersion,kind,distManifestDigest:checked.distManifestDigest,partial:job.partialOutput??null});}
 return inspectOutput(job,root,target,kind);
}
export function saveDelivery(job:any,root=runDir(job.id)){const info=deliveryInfo(job,root);save(join(root,'delivery.json'),info);return info;}
