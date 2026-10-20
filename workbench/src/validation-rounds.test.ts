import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {reserveValidationRound,validationBoundaryStatus} from './validation-rounds';
const seed={id:'test',enabled:true,maxRounds:3,rounds:[],executionRoots:['root'],model:'gpt-6-astra'};
const job=(id:string)=>({id,createdAt:'2026-10-08',generationMode:'first-pass',iterationPolicy:{maxVisualRepairs:0},modelSettings:{model:'gpt-6-astra',reasoningEffort:'high'},pipelineVersion:{id:'v'}});
function fixture(run:(f:string)=>void){const dir=mkdtempSync(join(tmpdir(),'round-boundary-'));const f=join(dir,'control.json');writeFileSync(f,JSON.stringify(seed));try{run(f);}finally{rmSync(dir,{recursive:true,force:true});}}
test('same task is idempotent; failures, continuation and candidate changes cannot create a fourth round',()=>fixture(f=>{
 const first=reserveValidationRound(job('a'),{id:'root'},f);expect(first.index).toBe(1);expect(reserveValidationRound(job('a'),{id:'root'},f)).toEqual(first);
 expect(reserveValidationRound({...job('b'),pipelineVersion:{id:'new'}},{id:'a',retryRoot:'root',status:'failed'},f).index).toBe(2);
 expect(reserveValidationRound(job('c'),{id:'b',retryRoot:'root',status:'cancelled'},f).index).toBe(3);
 expect(()=>reserveValidationRound(job('d'),{id:'c',retryRoot:'root'},f)).toThrow('VALIDATION_ROUND_LIMIT');expect(JSON.parse(readFileSync(f,'utf8')).rounds).toHaveLength(3);
}));
test('no unbounded iteration, unapproved input or route is admitted',()=>fixture(f=>{
 expect(()=>reserveValidationRound({...job('a'),generationMode:'qualified'},{id:'root'},f)).toThrow('VALIDATION_ROUND_MODE');
 expect(()=>reserveValidationRound(job('a'),{id:'other'},f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 expect(()=>reserveValidationRound({...job('a'),modelSettings:{model:'other'}},{id:'root'},f)).toThrow('VALIDATION_ROUTE_MISMATCH');
 expect(JSON.parse(readFileSync(f,'utf8')).rounds).toEqual([]);
}));
test('a refinement of an admitted job inherits its recorded root; rows from another batch or unknown jobs do not',()=>fixture(f=>{
 const first=reserveValidationRound(job('a'),{id:'root'},f);expect(first.executionRoot).toBe('root');
 const refined=reserveValidationRound(job('b'),{id:'a',retryRoot:'a'},f);expect(refined).toMatchObject({index:2,sourceJobId:'a',executionRoot:'root'});
 const state=JSON.parse(readFileSync(f,'utf8'));state.rounds.push({...state.rounds[0],batchId:'other',jobId:'foreign',executionRoot:'root'});state.maxRounds=5;writeFileSync(f,JSON.stringify(state));
 expect(()=>reserveValidationRound(job('c'),{id:'foreign',retryRoot:'foreign'},f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 expect(()=>reserveValidationRound(job('c'),{id:'stranger',retryRoot:'stranger'},f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
}));
test('missing or damaged configured ledger fails closed without resetting history',()=>fixture(f=>{
 for(const value of [{...seed,rounds:null},{...seed,maxRounds:0},{...seed,enabled:false}]){writeFileSync(f,JSON.stringify(value));expect(()=>reserveValidationRound(job('a'),{id:'root'},f)).toThrow('VALIDATION_BOUNDARY_INVALID');expect(JSON.parse(readFileSync(f,'utf8'))).toEqual(value);}
 rmSync(f);expect(()=>reserveValidationRound(job('a'),{id:'root'},f)).toThrow();
}));
test('fresh inputs require explicit opt-in; registered roots permit bounded continuation',()=>fixture(f=>{
 const fresh={...job('new'),retryRoot:'new',validationKind:'generation',images:[{id:'main'},{id:'side'}]};
 expect(()=>reserveValidationRound(fresh,null,f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 writeFileSync(f,JSON.stringify({...seed,allowFreshInputs:true}));
 expect(validationBoundaryStatus(f)?.remainingRounds).toBe(3);
 const row=reserveValidationRound(fresh,null,f);
 expect(row.inputImageIds).toEqual(['main','side']);expect(row.index).toBe(1);
 expect(JSON.parse(readFileSync(f,'utf8')).executionRoots).toEqual(['root','new']);
 expect(reserveValidationRound(job('resume'),{id:'new'},f).index).toBe(2);
 expect(reserveValidationRound({...fresh,id:'another',retryRoot:'another'},null,f).index).toBe(3);
 expect(()=>reserveValidationRound({...fresh,id:'fourth',retryRoot:'fourth'},null,f)).toThrow('VALIDATION_ROUND_LIMIT');
 expect(validationBoundaryStatus(f)).toMatchObject({usedRounds:3,remainingRounds:0,acceptsNewInputs:true,generationMode:'first-pass'});
}));
test('route transition appends to the same batch without changing historical rounds',()=>fixture(f=>{
 const old=reserveValidationRound(job('old'),{id:'root'},f);
 const state=JSON.parse(readFileSync(f,'utf8'));Object.assign(state,{provider:'fixture-route',model:'fixture-model-b',allowFreshInputs:true});writeFileSync(f,JSON.stringify(state));
 const fresh={...job('fresh'),validationKind:'generation'};
 expect(()=>reserveValidationRound(fresh,null,f)).toThrow('VALIDATION_ROUTE_MISMATCH');
 expect(JSON.parse(readFileSync(f,'utf8')).executionRoots).toEqual(['root']);
 const row=reserveValidationRound({...fresh,modelSettings:{model:state.model}},null,f);
 expect(row.index).toBe(2);expect(row.provider).toBe('fixture-route');expect(JSON.parse(readFileSync(f,'utf8')).rounds[0]).toEqual(old);
 expect(reserveValidationRound(job('old'),{id:'root'},f)).toEqual(old);
}));
test('fresh-input admission cannot authorize an unknown old root or non-generation recovery',()=>fixture(f=>{
 writeFileSync(f,JSON.stringify({...seed,allowFreshInputs:true}));
 for(const candidate of [{...job('new'),retryRoot:'unknown',validationKind:'generation'},{...job('new'),validationKind:'manual-continuation'}])expect(()=>reserveValidationRound(candidate,null,f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 expect(()=>reserveValidationRound({...job('new'),validationKind:'generation'},{id:'unknown'},f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 expect(()=>reserveValidationRound({...job('new'),validationKind:'generation',generationMode:'qualified'},null,f)).toThrow('VALIDATION_ROUND_MODE');
 expect(JSON.parse(readFileSync(f,'utf8'))).toEqual({...seed,allowFreshInputs:true});
}));
test('status never mutates or exposes ledger paths and fails closed for corrupt control',()=>fixture(f=>{
 const before=readFileSync(f,'utf8');expect(validationBoundaryStatus(f)).toEqual({maxRounds:3,usedRounds:0,remainingRounds:3,acceptsNewInputs:false,generationMode:'first-pass',model:seed.model,provider:null});expect(readFileSync(f,'utf8')).toBe(before);
 writeFileSync(f,JSON.stringify({...seed,executionRoots:null}));expect(()=>validationBoundaryStatus(f)).toThrow('VALIDATION_BOUNDARY_INVALID');
}));

test('新批明确授权有界两次成品修正，旧批仍只首稿；固定三输入不可重复或换图',()=>fixture(f=>{
 const sets=[['image-a'],['image-b','view-b'],['image-c']],state={...seed,id:'fresh-three',executionRoots:[],allowFreshInputs:true,generationMode:'bounded',inputSets:sets};
 writeFileSync(f,JSON.stringify(state));
 const fresh=(id:string,images:string[])=>({...job(id),generationMode:'bounded',iterationPolicy:{maxVisualRepairs:2},retryRoot:id,validationKind:'generation',images:images.map(id=>({id}))});
 expect(validationBoundaryStatus(f)?.generationMode).toBe('bounded');
 expect(()=>reserveValidationRound({...fresh('a',sets[0]),iterationPolicy:{maxVisualRepairs:null}},null,f)).toThrow('VALIDATION_ROUND_MODE');
 expect(()=>reserveValidationRound(fresh('wrong',['outside']),null,f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 expect(reserveValidationRound(fresh('a',sets[0]),null,f).index).toBe(1);
 expect(()=>reserveValidationRound(fresh('duplicate',sets[0]),null,f)).toThrow('VALIDATION_INPUT_ALREADY_USED');
 expect(reserveValidationRound(fresh('b',sets[1]),null,f).index).toBe(2);
 expect(reserveValidationRound(fresh('c',sets[2]),null,f).index).toBe(3);
 expect(()=>reserveValidationRound(fresh('d',sets[2]),null,f)).toThrow('VALIDATION_ROUND_LIMIT');
 expect(JSON.parse(readFileSync(f,'utf8')).rounds).toHaveLength(3);
}));
test('unbounded control cannot change the meaning of a fixed acceptance budget',()=>fixture(f=>{
 writeFileSync(f,JSON.stringify({...seed,generationMode:'qualified'}));expect(()=>validationBoundaryStatus(f)).toThrow('VALIDATION_BOUNDARY_INVALID');
}));


test('explicit unlimited allowance appends beyond three without resetting historical rows',()=>fixture(f=>{
 for(const id of ['a','b','c'])reserveValidationRound(job(id),{id:'root'},f);
 const before=JSON.parse(readFileSync(f,'utf8'));
 writeFileSync(f,JSON.stringify({...before,unlimited:true,maxRounds:null,allowFreshInputs:true,generationMode:'qualified'}));
 const fresh={...job('fourth'),validationKind:'generation',generationMode:'qualified',iterationPolicy:{maxVisualRepairs:null}};
 const row=reserveValidationRound(fresh,null,f);
 expect(row).toMatchObject({index:4,unlimited:true,maxRounds:null});
 expect(reserveValidationRound(fresh,null,f)).toEqual(row);
 const after=JSON.parse(readFileSync(f,'utf8'));
 expect(after.rounds.slice(0,3)).toEqual(before.rounds);expect(after.rounds).toHaveLength(4);
 expect(reserveValidationRound(job('a'),{id:'root'},f)).toEqual(before.rounds[0]);
 expect(validationBoundaryStatus(f)).toMatchObject({unlimited:true,maxRounds:null,remainingRounds:null,usedRounds:4,generationMode:'qualified'});
}));
test('unlimited requires explicit null limit and preserves model and input admission',()=>fixture(f=>{
 for(const value of [{...seed,maxRounds:null},{...seed,unlimited:true},{...seed,unlimited:'true',maxRounds:null}]){
  writeFileSync(f,JSON.stringify(value));expect(()=>validationBoundaryStatus(f)).toThrow('VALIDATION_BOUNDARY_INVALID');
  expect(JSON.parse(readFileSync(f,'utf8'))).toEqual(value);
 }
 const state={...seed,unlimited:true,maxRounds:null,allowFreshInputs:true,generationMode:'qualified'};
 writeFileSync(f,JSON.stringify(state));
 const fresh={...job('fresh'),validationKind:'generation',generationMode:'qualified',iterationPolicy:{maxVisualRepairs:null}};
 expect(()=>reserveValidationRound({...fresh,modelSettings:{model:'other'}},null,f)).toThrow('VALIDATION_ROUTE_MISMATCH');
 expect(()=>reserveValidationRound(fresh,{id:'unknown'},f)).toThrow('VALIDATION_INPUT_NOT_AUTHORIZED');
 expect(()=>reserveValidationRound({...fresh,iterationPolicy:{maxVisualRepairs:2}},null,f)).toThrow('VALIDATION_ROUND_MODE');
 expect(JSON.parse(readFileSync(f,'utf8'))).toEqual(state);
}));
