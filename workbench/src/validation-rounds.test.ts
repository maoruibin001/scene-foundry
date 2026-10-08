import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {reserveValidationRound} from './validation-rounds';
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
test('missing or damaged configured ledger fails closed without resetting history',()=>fixture(f=>{
 for(const value of [{...seed,rounds:null},{...seed,maxRounds:0},{...seed,enabled:false}]){writeFileSync(f,JSON.stringify(value));expect(()=>reserveValidationRound(job('a'),{id:'root'},f)).toThrow('VALIDATION_BOUNDARY_INVALID');expect(JSON.parse(readFileSync(f,'utf8'))).toEqual(value);}
 rmSync(f);expect(()=>reserveValidationRound(job('a'),{id:'root'},f)).toThrow();
}));
