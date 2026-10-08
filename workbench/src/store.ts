import {JsonReadCache} from './read-cache';
import {pipelineDataDir} from './runtime-paths.mjs';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,renameSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const ROOT=resolve(import.meta.dirname,'..'),DATA=pipelineDataDir(),RUNS=join(DATA,'runs'),UPLOADS=join(DATA,'uploads');
for(const p of [DATA,RUNS,UPLOADS])mkdirSync(p,{recursive:true});
export const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
export const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
export function save(p:string,v:any){const tmp=p+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';try{writeFileSync(tmp,JSON.stringify(v,null,2)+'\n');renameSync(tmp,p)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}}
export function runDir(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('非法任务 ID');return join(RUNS,id)}
const jobReadCache=new JsonReadCache();
export function getJob(id:string){return jobReadCache.read(join(runDir(id),'job.json'))}
export function saveJob(job:any){save(join(runDir(job.id),'job.json'),{...job,updatedAt:new Date().toISOString()})}
export function listJobs(directory=RUNS){return readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^[a-f0-9-]{36}$/.test(e.name)).flatMap(e=>{
 // A newly created directory is not a published job until atomic job.json save.
 // It can also disappear between enumeration and read; neither may crash scheduling.
 try{return [jobReadCache.read(join(directory,e.name,'job.json'))]}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
export function event(job:any,type:string,message:string){job.events.push({at:new Date().toISOString(),type,message});saveJob(job)}
export function publicJob(j:any){return j}
