import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {acceptanceBudget} from './call-budget';
import {codexEnvironment} from './codex-provider';
import {generationMode,iterationPolicyFor} from './generation-mode';
import {boundedIterations} from './geometry/iteration-policy';
import {ImprovementLedger} from './improvement-governance';
import {qualityDecision} from './quality-diagnosis';
import {AutomaticResumer,recoveryStallReason} from './automatic-resume';
import {automaticContinuationOptions} from './provider-recovery';
import {generationInput} from './reference-input';

test('explicit unlimited retains all old calls and cannot override disabled or malformed authority',()=>{
 const attempts=Array.from({length:318},(_,i)=>({index:i+1}));
 expect(acceptanceBudget({enabled:true,unlimited:true,maxCalls:null,attempts})).toMatchObject({used:318,max:null,remaining:null,unlimited:true});
 expect(acceptanceBudget({enabled:false,unlimited:true,maxCalls:null,attempts})).toMatchObject({unlimited:false,remaining:0});
 for(const state of [{enabled:true,maxCalls:null,attempts},{enabled:true,unlimited:true,maxCalls:320,attempts},{enabled:true,unlimited:true,maxCalls:null,attempts:318}])expect(()=>acceptanceBudget(state)).toThrow();
 expect(attempts.length).toBe(318);
});
test('real launcher accounting has the same explicit unlimited contract and counts every recovery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'qualified-accounting-')),file=join(dir,'control.json');
 try{
  writeFileSync(file,JSON.stringify({enabled:true,unlimited:true,maxCalls:null,attempts:[{index:1,original:true}]}));
  const code="import importlib.util, pathlib, sys\ns=importlib.util.spec_from_file_location('wrapper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nfor _ in range(3): m.reserve(pathlib.Path(sys.argv[2]))\n";
  const run=()=>Bun.spawnSync(['python3','-c',code,join(import.meta.dir,'candidate-codex.py'),file]);
  expect(run().exitCode).toBe(0);
  expect(JSON.parse(readFileSync(file,'utf8')).attempts.map((x:any)=>x.index)).toEqual([1,2,3,4]);
  expect(JSON.parse(readFileSync(file,'utf8')).attempts[0].original).toBe(true);
  for(const extra of [{enabled:false,unlimited:true,maxCalls:null},{enabled:true,maxCalls:4},{enabled:true,maxCalls:null},{enabled:true,unlimited:true,maxCalls:4}]){
   writeFileSync(file,JSON.stringify({...extra,attempts:Array.from({length:4},(_,i)=>({index:i+1}))}));
   expect(run().exitCode).not.toBe(0);expect(JSON.parse(readFileSync(file,'utf8')).attempts.length).toBe(4);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('only safe shared ledger location is forwarded; credentials and endpoint overrides remain excluded',()=>{
 expect(codexEnvironment({PATH:'/bin',PIPELINE_ACCEPTANCE_CONTROL_FILE:'/ledger.json',OPENAI_API_KEY:'secret',OPENAI_BASE_URL:'bad'})).toEqual({PATH:'/bin',PIPELINE_ACCEPTANCE_CONTROL_FILE:'/ledger.json'});
});
test('qualified input survives recovery and can pass after more than two repairs without rewriting first draft',async()=>{
 const input={id:'source',attempt:1,generationMode:'qualified',prompt:'machine',images:[],complexity:'complex',automaticResumeCount:5};
 expect(generationMode('qualified')).toBe('qualified');
 expect(iterationPolicyFor(generationInput(input)).maxVisualRepairs).toBeNull();
 expect(automaticContinuationOptions(input,true)).toMatchObject({attempt:1,automaticResumeCount:6,executionRecoveryPolicy:{maxContinuations:null}});
 const snapshots:any[]=[],sources:number[]=[];
 const result=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>true,
  evaluate:async i=>({status:i===4?'passed':'failed',score:60+i*6}),snapshot:async c=>{snapshots.push(c);},refine:async i=>{sources.push(i);}});
 expect(result.stopReason).toBe('passed');expect(result.bestIndex).toBe(4);expect(result.firstDraft.score).toBe(60);
 expect(snapshots.map(s=>s.index)).toEqual([0,1,2,3,4]);expect(sources).toEqual([0,1,2,3]);
});
test('uncapped mode still diagnoses a stalled strategy and honors cancellation',async()=>{
 const ctl=new AbortController();
 const args={maxRepairs:null,signal:ctl.signal,canRefine:()=>true,evaluate:async()=>({status:'failed',score:60}),snapshot:async()=>{},refine:async()=>{}};
 expect((await boundedIterations(args)).stopReason).toBe('no-improvement');
 ctl.abort();await expect(boundedIterations(args)).rejects.toThrow();
});
test('qualified ledger preserves cumulative usage past legacy caps but requires evidence after no gain',()=>{
 const root=mkdtempSync(join(tmpdir(),'qualified-governance-'));
 try{
  const l=new ImprovementLedger(root),input={prompt:'new machine',images:[],generationMode:'qualified'},id=l.enter(input,'source');
  for(let i=0;i<105;i++)l.call(id,'geometry-asset');
  for(let i=0;i<5;i++)l.reserveRepair(id,'final','真实画面显示缺少连接，修复端点后重新验收');
  expect(l.get(id)).toMatchObject({calls:105,repairs:5,limits:{calls:null,repairs:null}});
  expect(qualityDecision(l.get(id),false,input).action).toBe('repair');
  expect(l.enter(input,'continuation',[],{improvementId:id},'continuation')).toBe(id);
  for(let i=0;i<3;i++)l.result(id,{comparison:'same',score:60,status:'failed'});
  expect(qualityDecision(l.get(id),false,input).action).toBe('diagnose');
  expect(()=>l.call(id,'scene-refine')).toThrow('IMPROVEMENT_STOPPED');
  l.reviseStrategy(id,{id:'verified-new-mechanism',reason:'定位到端点变换错误并经回归验证',pipelineVersion:{id:'new'},additionalRepairs:0});
  expect(l.remaining(id)).toBe(Infinity);expect(l.get(id)).toMatchObject({calls:105,repairs:5});
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('continued execution uses progress, not total recovery count; repeated identical failure requires diagnosis',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qualified-resume-'));
 try{
  const make=(id:string,parent:string|undefined,n:number)=>({id,recoverySourceJobId:parent,generationMode:'qualified',status:'blocked',stage:'assets',error:'PROVIDER_TIMEOUT',automaticResumeCount:7,pipelineVersion:{id:'v1'},generationProgress:{phase:'assets',completed:n},executionRecoveryPolicy:{enabled:true}});
  const chain=[make('a',undefined,8),make('b','a',9),make('c','b',10)];
  expect(recoveryStallReason(chain[2],chain)).toBeNull();
  const stalled=[make('x',undefined,10),make('y','x',10),make('z','y',10)];
  expect(recoveryStallReason(stalled[2],stalled)).toContain('没有新增产物');
  expect(recoveryStallReason({...stalled[2],pipelineVersion:{id:'fix'}},stalled)).toBeNull();
  const jobs:any[]=[...chain,{id:'cancelled',status:'cancelled',generationMode:'qualified',error:'PROVIDER_TIMEOUT',executionRecoveryPolicy:{enabled:true}},{id:'hard',status:'blocked',generationMode:'qualified',error:'PROVIDER_HTTP_401',executionRecoveryPolicy:{enabled:true}}];
  // Earlier source jobs already have their continuation. Only the latest job may resume.
  let n=0;const resumer=new AutomaticResumer(join(root,'requests.json'),{list:()=>jobs,executing:()=>false,resume:async s=>{n++;const child={id:'next',recoverySourceJobId:s.id,status:'running',...automaticContinuationOptions(s,true)};jobs.push(child);return child;}});
  await resumer.tick();await resumer.tick();expect(n).toBe(1);expect(jobs.at(-1).automaticResumeCount).toBe(8);
 }finally{rmSync(root,{recursive:true,force:true});}
});
