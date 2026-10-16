import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {read} from '../store';
import {spatialGate} from './blockout';
import {judgeConsensus,judgeConsensusRule,marginalGate,consensusIndex,JUDGE_CONSENSUS} from './judge-consensus';

const policy={spatialPreflight:'composition-v3'},frames=['ref-1.png'];
const space={spatialRelations:[{id:'path',description:'主通道',critical:true,instanceIds:['a']},{id:'decor',description:'装饰',critical:false,instanceIds:['a']}]};
const review=(score:number,path=3.5,decor=2)=>({score,confidence:.88,summary:'s',relations:[{id:'path',score:path,verdict:path>=3?'met':'partial',reason:'r',frames},{id:'decor',score:decor,verdict:'partial',reason:'r',frames}]});
const gateOf=(v:any)=>spatialGate(v,space,frames,policy);

test('only new non-optimization jobs under the policy re-review',()=>{
 expect(judgeConsensusRule({judgeConsensusPolicy:JUDGE_CONSENSUS})).toBe(true);
 expect(judgeConsensusRule({judgeConsensusPolicy:JUDGE_CONSENSUS,optimizationRound:{index:1}})).toBe(false);
 expect(judgeConsensusRule({judgeConsensusPolicy:null})).toBe(false);
});

test('marginal band covers the measured retest spread and leaves clear verdicts single',()=>{
 for(const s of [3.2,3.4,3.5,3.6,3.8])expect(marginalGate(gateOf(review(s)),space)).toBe(true);
 for(const s of [2.4,3.1,3.9,4.5])expect(marginalGate(gateOf(review(s)),space)).toBe(false);
 // A clear score still re-reviews when a critical row sits on its threshold; a non-critical row does not count.
 expect(marginalGate(gateOf(review(4.2,3)),space)).toBe(true);
 expect(marginalGate(gateOf(review(4.2,2.9)),space)).toBe(true);
 expect(marginalGate(gateOf(review(4.2,3.5,3)),space)).toBe(false);
 expect(marginalGate(gateOf(review(3.0,3)),space)).toBe(false);
});

test('majority verdict keeps an agreeing review whose own gate reproduces it',()=>{
 const gates=[review(3.5),review(3.3),review(3.6)].map(gateOf);
 const i=consensusIndex(gates);expect(gates[i].passed).toBe(true);expect(gates[i].review.score).toBe(3.5);
 const fail=[review(3.5),review(3.4),review(3.3)].map(gateOf);
 const j=consensusIndex(fail);expect(fail[j].passed).toBe(false);expect(fail[j].review.score).toBe(3.4);
 // Critical-row failures count even when the score passes.
 const crit=[review(3.6,2.8),review(3.6,2.9),review(3.6,3)].map(gateOf);expect(crit[consensusIndex(crit)].passed).toBe(false);
});

function folderWith(first:any){const dir=mkdtempSync(join(tmpdir(),'judge-consensus-'));writeFileSync(join(dir,'scene-space-judge-parsed.json'),JSON.stringify(first));writeFileSync(join(dir,'scene-space-judge-receipt.json'),JSON.stringify({n:0}));return dir;}
const replica=(values:any[])=>{let n=0;return async(dir:string)=>{const v=values[n++];if(v instanceof Error)throw v;writeFileSync(join(dir,'scene-space-judge-parsed.json'),JSON.stringify(v));writeFileSync(join(dir,'scene-space-judge-receipt.json'),JSON.stringify({n}));return {value:v};};};

test('a flipped first review is outvoted and the folder holds the kept review files',async()=>{
 const first=review(3.5),dir=folderWith(first);
 try{
  const g=await judgeConsensus(dir,gateOf(first),replica([review(3.3),review(3.4)]),gateOf);
  expect(g.passed).toBe(false);expect(g.review.score).toBe(3.4);
  expect(read(join(dir,'scene-space-judge-parsed.json'))).toEqual(g.review);
  expect(read(join(dir,'judge-consensus/0/scene-space-judge-parsed.json'))).toEqual(first);
  const c=read(join(dir,'judge-consensus/consensus.json'));
  expect(c).toMatchObject({version:JUDGE_CONSENSUS,status:'complete',selected:2,passed:false});expect(c.reviews.map((r:any)=>r.passed)).toEqual([true,false,false]);
  expect(g.consensus).toEqual(c);
  // Replays of the stored review reproduce the stored verdict.
  expect(gateOf(g.review).passed).toBe(g.passed);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an agreeing majority keeps the first review files untouched',async()=>{
 const first=review(3.6),dir=folderWith(first);
 try{
  const before=readFileSync(join(dir,'scene-space-judge-parsed.json'),'utf8');
  const g=await judgeConsensus(dir,gateOf(first),replica([review(3.7),review(3.3)]),gateOf);
  expect(g.passed).toBe(true);expect(g.consensus.selected).toBe(0);expect(readFileSync(join(dir,'scene-space-judge-parsed.json'),'utf8')).toBe(before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a failed replica leaves the first verdict and records why',async()=>{
 const first=review(3.5),dir=folderWith(first);
 try{
  const g=await judgeConsensus(dir,gateOf(first),replica([review(3.3),Error('PROVIDER_TIMEOUT')]),gateOf);
  expect(g.passed).toBe(true);expect(g.review).toEqual(first);
  expect(g.consensus).toMatchObject({status:'incomplete',selected:0});expect(g.consensus.errors[0].error).toContain('PROVIDER_TIMEOUT');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('cancellation is not turned into a single-review verdict',async()=>{
 const first=review(3.5),dir=folderWith(first),abort=new AbortController();
 try{
  const judge=async()=>{abort.abort(Error('CANCELLED'));throw Error('CANCELLED');};
  await expect(judgeConsensus(dir,gateOf(first),judge,gateOf,abort.signal)).rejects.toThrow('CANCELLED');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
