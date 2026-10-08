import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';

const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e:any){return e.code==='EPERM';}};
const write=(file:string,value:any)=>{const temporary=file+'.'+randomUUID();writeFileSync(temporary,JSON.stringify(value,null,2)+'\n');renameSync(temporary,file);};

/** One shared lease protects the pair, including after reboot. Never evict a live or unknown owner. */
export function claimServiceLease(folder:string,candidate:string,pid=process.pid,isAlive=alive){
 mkdirSync(resolve(folder,'..'),{recursive:true});const owner={id:randomUUID(),pid,candidate,at:new Date().toISOString()};
 try{mkdirSync(folder);}catch(e:any){
  if(e.code!=='EEXIST')throw e;
  let old:any;try{old=JSON.parse(readFileSync(join(folder,'owner.json'),'utf8'));}catch{throw Error('SERVICE_OWNER_UNKNOWN：保留锁与输出，不能盲启第二个协调器');}
  if(!Number.isInteger(old.pid)||old.pid<=0||isAlive(old.pid))throw Error('SERVICE_ALREADY_OWNED：已有活跃或未知服务，不能重复启动');
  const archive=folder+'.stale-'+randomUUID();renameSync(folder,archive);rmSync(archive,{recursive:true});mkdirSync(folder);
 }
 write(join(folder,'owner.json'),owner);
 return {owner,release(){if(existsSync(join(folder,'owner.json'))&&JSON.parse(readFileSync(join(folder,'owner.json'),'utf8')).id===owner.id)rmSync(folder,{recursive:true});}};
}

export class ServiceRestartBudget{
 private counts=new Map<string,number>();
 private failures=new Map<string,string>();
 constructor(readonly maximum=2){if(!Number.isInteger(maximum)||maximum<0||maximum>2)throw Error('服务重启上限无效');}
 reserve(name:string,failure?:string){const used=this.counts.get(name)??0;if(used>=this.maximum||failure&&this.failures.get(name)===failure)return false;this.counts.set(name,used+1);if(failure)this.failures.set(name,failure);return true;}
 snapshot(){return Object.fromEntries(this.counts);}
}

export async function assertServicePortsFree(ports:number[]){
 for(const port of ports){if(!Number.isInteger(port)||port<1024||port>65535)throw Error('服务端口无效');
  await new Promise<void>((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(Error('SERVICE_PORT_OCCUPIED：'+port+' 已被使用，保留现有进程')));server.listen(port,'127.0.0.1',()=>server.close(e=>e?reject(e):resolve()));});
 }
 if(new Set(ports).size!==ports.length)throw Error('服务端口必须独立');
}

export async function superviseWorkbench(config:any){
 const candidate=resolve(import.meta.dirname,'..');
 if(config.candidate!==candidate||realpathSync(config.data)!==realpathSync(join(candidate,'data'))||config.bun!==process.execPath)throw Error('服务配置与实际来源不一致');
 const {initializeCodexRoute}=await import('./codex-provider');await initializeCodexRoute();
 const {currentVersionId,versions}=await import('./versions');
 if(currentVersionId()!==config.version.id)throw Error('服务候选源码或路由配置变化，停止启动');versions.verify(config.version.id);
 const lease=claimServiceLease(join(config.data,'workbench-service.lock'),candidate),restarts=new ServiceRestartBudget(),children=new Map<string,ReturnType<typeof Bun.spawn>>();
 const statusFile=join(config.data,'workbench-service-status.json'),events=join(config.logs,'service-events.jsonl');mkdirSync(config.logs,{recursive:true});
 let stopping=false,blocked:string|null=null;
 const event=(type:string,details:any={})=>{const v={at:new Date().toISOString(),type,...details};writeFileSync(events,JSON.stringify(v)+'\n',{flag:'a'});write(statusFile,{...lease.owner,version:config.version,status:type,children:Object.fromEntries([...children].map(([name,p])=>[name,{pid:p.pid}])),restarts:restarts.snapshot(),details});};
 const stop=()=>{stopping=true;for(const child of children.values())if(child.exitCode===null)child.kill('SIGTERM');};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{
  await assertServicePortsFree([config.apiPort,config.uiPort]);
  event('starting');
  const run=async(name:string,file:string,environment:Record<string,string>)=>{
   while(!stopping){
    const attempt=restarts.snapshot()[name]??0,outputFile=join(config.logs,name+'-'+attempt+'.log'),errorFile=join(config.logs,name+'-'+attempt+'-error.log');
    const child=Bun.spawn([config.bun,file],{cwd:candidate,env:{...process.env,...environment},stdin:'ignore',stdout:Bun.file(outputFile),stderr:Bun.file(errorFile)});children.set(name,child);event('started',{name,pid:child.pid,attempt,outputFile,errorFile});
    const code=await child.exited;children.delete(name);if(stopping)break;
    const error=existsSync(errorFile)?readFileSync(errorFile,'utf8').slice(-2000):'';
    const failure=(code+':'+error).replace(/\b\d{4}-\d{2}-\d{2}T[\d:.Z+-]+\b/g,'TIME').replace(/\bpid[=: ]+\d+/gi,'PID');
    event('process-exited',{name,code});
    if(/AUTHENTICATION_FAILED|INSUFFICIENT_QUOTA|CODEX_ROUTE_UNVERIFIED|COORDINATOR_ALREADY|固定依赖.*(?:缺失|变化)|ENOSPC|EACCES/.test(error))throw Error('SERVICE_HARD_BLOCK：'+name+' 启动存在认证、资源、来源或所有权阻塞；不重复启动');
    if(!restarts.reserve(name,failure))throw Error('SERVICE_RESTART_LIMIT：'+name+' 重复同因或两次恢复后仍退出；保留日志，不循环重启');
    await Bun.sleep(1000);if(stopping)break;await assertServicePortsFree([name==='worker'?config.apiPort:config.uiPort]);
   }
  };
  await Promise.all([run('worker','src/server.ts',{PORT:String(config.apiPort)}),run('ui','src/ui-server.ts',{UI_PORT:String(config.uiPort),UI_UPSTREAM:'http://127.0.0.1:'+config.apiPort})]);
 }catch(e){blocked=String(e);event('blocked',{error:blocked});throw e;}
 finally{stop();await Promise.allSettled([...children.values()].map(p=>p.exited));event(blocked?'blocked':'stopped',blocked?{error:blocked}:{});lease.release();process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}

if(import.meta.main){
 const file=process.argv[2];if(!file)throw Error('需要已冻结的服务配置文件');
 await superviseWorkbench(JSON.parse(readFileSync(file,'utf8')));
}
