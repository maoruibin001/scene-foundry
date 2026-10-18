import {test,expect} from 'bun:test';
import {existsSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {networkExhaustion,networkResumeInfo,networkResumesUsed,probeProviderRoute,NETWORK_RESUME_LIMIT} from './network-resume';
import {executionFaultOf} from './provider-recovery';
import {save} from './store';

const EXHAUSTED='Error: PROVIDER_RECOVERY_EXHAUSTED：当前逻辑调用及排队已达恢复总时长上限';
// Shape of the 2026-10-16 mecha repair: a timeout and a transient failure, then the elapsed limit, every log with chatgpt.com connection errors.
function fixture(logs=['error sending request for url (https://chatgpt.com/backend-api/ps/mcp)','Reconnecting... 3/5','error sending request'],faults=['timeout','transient','exhausted']){
 const dir=mkdtempSync(join(tmpdir(),'network-resume-')),folder=join(dir,'generation/space-repair-1');mkdirSync(folder,{recursive:true});
 const attempts=faults.map((fault,i)=>({index:i+1,cycle:1,status:fault==='exhausted'?'blocked':'failed',fault,error:fault==='timeout'?'Error: PROVIDER_TIMEOUT：Codex 本次调用在 1512 秒后超时（inactive-at-deadline）':fault==='exhausted'?EXHAUSTED:'Error: PROVIDER_CODEX_FAILED：worker quit'}));
 save(join(folder,'scene-space-recovery.json'),{version:'provider-recovery-v1',role:'scene-space',status:'blocked',attempts});
 attempts.forEach((a,i)=>{const d=join(folder,'provider-attempts/scene-space',String(a.index));mkdirSync(d,{recursive:true});writeFileSync(join(d,'cli.log'),'codex\n'+(logs[i]??'')+'\n');});
 save(join(dir,'generation/scene-observation-recovery.json'),{role:'scene-observation',status:'completed',attempts:[{index:1,status:'passed'}]});
 return {dir,job:{id:'a',status:'blocked',stage:'space',error:EXHAUSTED}};
}

test('a recovery exhausted by a recorded outage is offered once more; the exhausted block itself is unchanged',()=>{
 const f=fixture();try{
  const e=networkExhaustion(f.job,f.dir)!;
  expect(e.calls).toHaveLength(1);expect(e.calls[0]).toMatchObject({role:'scene-space',file:'generation/space-repair-1/scene-space-recovery.json'});
  expect(e.calls[0].attempts.map((a:any)=>a.signature)).toEqual(['error sending request','Reconnecting...','error sending request']);
  expect(networkResumeInfo(f.job,[f.job],f.dir)).toMatchObject({available:true,used:0,limit:NETWORK_RESUME_LIMIT});
  // Automatic resume still treats the job as exhausted and requiring diagnosis.
  expect(executionFaultOf(f.job).kind).toBe('exhausted');
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('a timeout or failure without a connection error keeps the job blocked',()=>{
 for(const logs of [['','Reconnecting... 1/5','error sending request'],['error sending request','',''],['plain slow call','plain slow call','plain slow call']]){
  const f=fixture(logs);try{expect(networkExhaustion(f.job,f.dir)).toBeNull();expect(networkResumeInfo(f.job,[f.job],f.dir).available).toBe(false);}finally{rmSync(f.dir,{recursive:true,force:true});}
 }
 const hard=fixture(undefined,['transient','hard','exhausted']);try{expect(networkExhaustion(hard.job,hard.dir)).toBeNull();}finally{rmSync(hard.dir,{recursive:true,force:true});}
 const unknown=fixture(undefined,['unknown','exhausted']);try{expect(networkExhaustion(unknown.job,unknown.dir)).toBeNull();}finally{rmSync(unknown.dir,{recursive:true,force:true});}
 const f=fixture();try{
  for(const job of [{...f.job,status:'failed'},{...f.job,error:'Error: PROVIDER_TIMEOUT'},{...f.job,status:'cancelled'}])expect(networkExhaustion(job,f.dir)).toBeNull();
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('the chain limit counts earlier network continuations and does not reset',()=>{
 const f=fixture();try{
  const root={id:'r',networkResume:null},one={id:'b',recoverySourceJobId:'r',networkResume:{version:'x'}},two={id:'a',recoverySourceJobId:'b',status:'blocked',stage:'space',error:EXHAUSTED,networkResume:{version:'x'}};
  expect(networkResumesUsed(one,[root,one])).toBe(1);
  expect(networkResumeInfo({...two,networkResume:null},[root,one,two],f.dir)).toMatchObject({available:true,used:1});
  expect(networkResumeInfo(two,[root,one,two],f.dir)).toMatchObject({available:false,used:2});
  // One continuation per blocked record, even after that continuation has ended.
  const blocked={...two,networkResume:null},done={id:'c',recoverySourceJobId:'a',status:'failed'};
  expect(networkResumeInfo(blocked,[root,one,blocked,done],f.dir)).toMatchObject({available:false,continuationId:'c'});
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('recorded runs: the 2026-10-16 outage qualifies, the 2026-10-08 slow exhausted space call does not',()=>{
 const outage='/tmp/sf-vx-r4/data/runs/3f1d9235-289a-4c4f-9c55-03d2d7b2c48b',slow='/tmp/sf-vx-20261008/data/runs/dd15f78b-6bd2-4eea-9443-fbb397d76ca4';
 if(!existsSync(outage)||!existsSync(slow))return;
 // Read-only scan of the recorded runs.
 const job={status:'blocked',error:EXHAUSTED};
 expect(networkExhaustion(job,outage)?.calls.map((c:any)=>c.role)).toEqual(['scene-space']);
 expect(networkExhaustion(job,slow)).toBeNull();
});

test('the reachability probe sends no credentials and treats any HTTP answer as reachable',async()=>{
 let seen:any;const ok=await probeProviderRoute('http://route/v1',(async(url:any,init:any)=>{seen={url,init};return new Response('',{status:401});}) as any);
 expect(ok).toMatchObject({reachable:true,status:401});expect(seen.init.headers).toBeUndefined();expect(seen.init.method).toBe('GET');
 const down=await probeProviderRoute('http://route/v1',(async()=>{throw Error('error sending request');}) as any);
 expect(down).toMatchObject({reachable:false});expect(down.error).toContain('error sending request');
});
