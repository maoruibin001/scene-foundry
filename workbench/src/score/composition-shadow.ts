import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {read,save} from '../store';
import {compositionScore,COMPOSITION_SCORE_VERSION} from './composition-score';
/**
 * Shadow run of composition-score-v1 beside the space judge. It only writes records and never feeds a gate,
 * selection or repair. On 58 same-job graybox pairs judged blind by Claude and gpt-6.1-sol, the program score matched
 * both raters on 52 of 53 pairs where they agreed and astra on 45 of 48; scores are comparable within a job only,
 * because every job observes its own landmark boxes.
 */
export const COMPOSITION_SHADOW_VERSION='composition-shadow-v1';
type Gate={round:number;passed?:boolean;review?:{score?:number;confidence?:number}};
/** Score one graybox round and append it to the job's shadow log; failures are recorded, never thrown. */
export function recordCompositionShadow(folder:string,gate:Gate){
 const file=join(folder,'..','..','composition-shadow.json');
 try{
  const log=existsSync(file)?read(file):{version:COMPOSITION_SHADOW_VERSION,scoreVersion:COMPOSITION_SCORE_VERSION,gating:false,rounds:[] as any[]};
  const score=compositionScore(read(join(folder,'reference-composition.json')));
  save(join(folder,'composition-score.json'),score);
  const previous=log.rounds.filter((r:any)=>r.round<gate.round&&Number.isFinite(r.programScore)).at(-1);
  const judge=gate.review?.score??null,entry:any={round:gate.round,programScore:score.score,criticalScore:score.criticalScore,criticalMisses:score.criticalMisses,coverage:score.coverage,judgeScore:judge,judgeConfidence:gate.review?.confidence??null,judgePassed:gate.passed??null};
  if(previous&&Number.isFinite(score.score)&&Number.isFinite(judge)&&Number.isFinite(previous.judgeScore)){
   const program=(score.score as number)-previous.programScore,space=(judge as number)-previous.judgeScore;
   entry.vsPrevious={round:previous.round,program,judge:space,criticalMisses:score.criticalMisses-previous.criticalMisses,direction:!program||!space?'undecided':program*space>0?'agree':'disagree'};
  }
  log.rounds=[...log.rounds.filter((r:any)=>r.round!==gate.round),entry].sort((a:any,b:any)=>a.round-b.round);
  save(file,log);return entry;
 }catch(error){
  try{const log=existsSync(file)?read(file):{version:COMPOSITION_SHADOW_VERSION,gating:false,rounds:[]};log.errors=[...(log.errors??[]),{round:gate.round,error:String(error).slice(0,300)}];save(file,log);}catch{}
  return null;
 }
}
