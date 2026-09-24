import {mkdirSync,writeFileSync,readFileSync,readdirSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const ROOT=resolve(import.meta.dirname,'..'),DATA=join(ROOT,'data'),RUNS=join(DATA,'runs'),UPLOADS=join(DATA,'uploads');
for(const p of [DATA,RUNS,UPLOADS])mkdirSync(p,{recursive:true});
export const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
export const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
export function save(p:string,v:any){const tmp=p+'.tmp';writeFileSync(tmp,JSON.stringify(v,null,2)+'\n');renameSync(tmp,p)}
export function runDir(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('非法任务 ID');return join(RUNS,id)}
export function getJob(id:string){return read(join(runDir(id),'job.json'))}
export function saveJob(job:any){save(join(runDir(job.id),'job.json'),{...job,updatedAt:new Date().toISOString()})}
export function listJobs(){return readdirSync(RUNS).filter(id=>/^[a-f0-9-]{36}$/.test(id)).map(getJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
export function event(job:any,type:string,message:string){job.events.push({at:new Date().toISOString(),type,message});saveJob(job)}
export function publicJob(j:any){return j}
