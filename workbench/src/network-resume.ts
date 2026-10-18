import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {read} from './store';

export const NETWORK_RESUME='provider-network-resume-v1';
/** Continuations per execution chain; each one still needs fresh outage evidence and a live probe. */
export const NETWORK_RESUME_LIMIT=2;
/**
 * Connection failures recorded by the Codex CLI. Calibrated on 184 recorded provider attempts (voxel r1–r5 and the 2026-10-08 data):
 * 0 of 172 passed attempts and 0 of 5 plain timeouts match; only the three attempts of the 2026-10-16 chatgpt.com outage do.
 */
const NETWORK=/error sending request|Reconnecting\.\.\.|stream disconnected|connection (?:reset|refused|closed)|dns error|failed to lookup address|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network is unreachable|tls handshake/i;
const signature=(text:string)=>text.match(NETWORK)?.[0]??null;

// Recovery records live in the run, its generation folder and stage folders such as space-repair-1 or blockout/0/batches/2.
// Built projects, previews and archived attempts are skipped; they hold symlinked engine packages.
const SKIP=new Set(['provider-attempts','project','preview','delivery','runtime','uploads','assets','revisions','node_modules']);
function recoveryFiles(dir:string,depth=4):string[]{
 if(!existsSync(dir))return [];
 const found:string[]=[];
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(entry.isFile()&&entry.name.endsWith('-recovery.json'))found.push(join(dir,entry.name));
  else if(entry.isDirectory()&&depth>0&&!SKIP.has(entry.name))found.push(...recoveryFiles(join(dir,entry.name),depth-1));
 }
 return found;
}
/**
 * The bounded recovery of one logical call ran out and every failed attempt recorded a connection failure. Anything else
 * (plain timeouts, quota, input, contract or unknown errors) keeps the exhausted block and still needs diagnosis.
 */
export function networkExhaustion(job:any,dir:string){
 if(job.status!=='blocked'||!String(job.error).includes('PROVIDER_RECOVERY_EXHAUSTED'))return null;
 const calls:any[]=[];
 for(const file of recoveryFiles(dir)){
  let state:any;try{state=read(file);}catch{return null;}
  const attempts:any[]=Array.isArray(state?.attempts)?state.attempts:[];
  if(state.status==='completed'||(state.status!=='exhausted'&&!attempts.some(a=>a.fault==='exhausted')))continue;
  const failed=attempts.filter(a=>a.status!=='passed');
  if(!failed.length||failed.some(a=>['hard','input','unknown'].includes(a.fault)))return null;
  const evidence=failed.map(a=>{const log=join(dirname(file),'provider-attempts',state.role,String(a.index),'cli.log');return {index:a.index,fault:a.fault,signature:signature(String(a.error??''))??(existsSync(log)?signature(readFileSync(log,'utf8')):null)};});
  if(evidence.some(e=>!e.signature))return null;
  calls.push({role:state.role,file:file.slice(dir.length+1),attempts:evidence});
 }
 return calls.length?{version:NETWORK_RESUME,calls}:null;
}
/** Network continuations already spent on this execution chain. */
export function networkResumesUsed(job:any,all:any[]){
 let count=0,cursor=job;const seen=new Set<string>();
 while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);if(cursor.networkResume)count++;cursor=all.find(j=>j.id===cursor.recoverySourceJobId);}
 return count;
}
/** Read-only: whether the exhausted block came from an outage. Reachability is only probed when the user asks to continue. */
export function networkResumeInfo(job:any,all:any[],dir:string){
 const evidence=networkExhaustion(job,dir);
 if(!evidence)return {available:false,reason:'不是网络中断导致的恢复用尽'};
 const continued=all.find(j=>j.recoverySourceJobId===job.id);
 if(continued)return {available:false,evidence,continuationId:continued.id,reason:'此记录已续接，不能重复恢复'};
 const used=networkResumesUsed(job,all);
 if(used>=NETWORK_RESUME_LIMIT)return {available:false,evidence,used,reason:'本执行链网络恢复已用 '+used+' 次；需要先诊断网络或供应商状态'};
 return {available:true,evidence,used,limit:NETWORK_RESUME_LIMIT,reason:'恢复用尽的每次尝试都记录了网络连接失败；网络恢复后可继续一次，保留已有尝试和累计调用'};
}
/** Any HTTP answer, including 401 without credentials, proves the route is reachable. No credentials or model request are sent. */
export async function probeProviderRoute(url:string,fetcher:typeof fetch=fetch,timeoutMs=8000){
 const started=Date.now();
 try{const response=await fetcher(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});await response.body?.cancel();return {reachable:true,status:response.status,latencyMs:Date.now()-started,at:started};}
 catch(error){return {reachable:false,error:String(error).slice(0,200),latencyMs:Date.now()-started,at:started};}
}
