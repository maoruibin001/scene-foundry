import {readdirSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {read} from './store';
/** Read only task-owned call records; never walk exported projects or dependencies. */
export function recoveryStatus(dir:string){
 const rows:any[]=[];
 const walk=(folder:string,depth:number)=>{if(depth>6||!existsSync(folder))return;for(const e of readdirSync(folder,{withFileTypes:true})){
  if(e.isDirectory()){if(!['project','game','node_modules','.git','dist','runtime','provider-attempts','attempts'].includes(e.name))walk(join(folder,e.name),depth+1);continue;}
  if(!e.name.endsWith('-recovery.json'))continue;try{const v=read(join(folder,e.name));if(v.version!=='provider-recovery-v1')continue;const execution=existsSync(join(folder,v.role+'-execution.json'))?read(join(folder,v.role+'-execution.json')):null;
   if(v.attempt>1||['waiting','retrying','exhausted','blocked','cancelled'].includes(v.status)||execution?.extensions?.length)rows.push({...v,extensions:execution?.extensions??[],deadlineAt:execution?.deadlineAt??null,path:relative(dir,join(folder,e.name))});
  }catch{}
 }};walk(dir,0);return rows.sort((a,b)=>b.startedAt-a.startedAt);
}
