import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {save} from '../store';

export const JUDGE_CONSENSUS='judge-consensus-v1';
/** Repeated reviews of one graybox moved the score by about 0.1 and a critical row by about 0.2, flipping 7 of 30 verdicts near the threshold. */
export const JUDGE_CONSENSUS_BAND={space:.3,critical:.2};
export const JUDGE_CONSENSUS_REVIEWS=3;
const ROLE='scene-space-judge',FILES=['parsed.json','receipt.json','input-receipt.json','response.txt','prompt.json'];
/** Only jobs created under the policy re-review; optimization rounds keep their one-call-per-stage budget. */
export function judgeConsensusRule(job:any){return job?.judgeConsensusPolicy===JUDGE_CONSENSUS&&!job.optimizationRound;}
/** A verdict is marginal when one review's ordinary spread could cross the score threshold or a critical-row threshold. */
export function marginalGate(gate:any,space:any){
 const t=gate.threshold,score=gate.review.score;
 if(Math.abs(score-t.space)<=JUDGE_CONSENSUS_BAND.space+1e-9)return true;
 if(score<t.space)return false;
 const critical=new Set(space.spatialRelations.filter((r:any)=>r.critical).map((r:any)=>r.id));
 return gate.review.relations.some((x:any)=>critical.has(x.id)&&Math.abs(x.score-t.critical)<=JUDGE_CONSENSUS_BAND.critical+1e-9);
}
/** Majority verdict; the kept review is the agreeing one nearest the median score, so its own gate reproduces the verdict. */
export function consensusIndex(gates:any[]){
 const passed=gates.filter(g=>g.passed).length*2>gates.length,scores=gates.map(g=>g.review.score).sort((a,b)=>a-b),median=scores[Math.floor(scores.length/2)];
 let best=-1;for(let i=0;i<gates.length;i++)if(gates[i].passed===passed&&(best<0||Math.abs(gates[i].review.score-median)<Math.abs(gates[best].review.score-median)))best=i;
 return best;
}
const copyReview=(from:string,to:string)=>{mkdirSync(to,{recursive:true});for(const f of FILES){const p=join(from,ROLE+'-'+f);if(existsSync(p))copyFileSync(p,join(to,ROLE+'-'+f));}};
/** Adds independent reviews of the same request. The folder's judge files always hold the kept review; every review stays under judge-consensus/. A replica that fails leaves the first verdict in place and says so. */
export async function judgeConsensus(folder:string,first:any,judge:(dir:string)=>Promise<{value:any}>,gateOf:(value:any)=>any,signal?:AbortSignal){
 const root=join(folder,'judge-consensus');copyReview(folder,join(root,'0'));
 const settled=await Promise.allSettled(Array.from({length:JUDGE_CONSENSUS_REVIEWS-1},(_,i)=>{const dir=join(root,String(i+1));mkdirSync(dir,{recursive:true});return judge(dir).then(r=>gateOf(r.value));}));
 signal?.throwIfAborted();
 const gates=[first,...settled.map(s=>s.status==='fulfilled'?s.value:null)],errors=settled.flatMap((s,i)=>s.status==='rejected'?[{index:i+1,error:String(s.reason).slice(0,800)}]:[]);
 const complete=!errors.length,selected=complete?consensusIndex(gates):0;
 if(selected)copyReview(join(root,String(selected)),folder);
 const record={version:JUDGE_CONSENSUS,status:complete?'complete':'incomplete',band:JUDGE_CONSENSUS_BAND,selected,passed:gates[selected].passed,reviews:gates.map((g,index)=>g?{index,score:g.review.score,confidence:g.review.confidence,passed:g.passed,failed:g.failed}:{index,score:null,passed:null}),errors};
 save(join(root,'consensus.json'),record);
 return {...gates[selected],consensus:record};
}
