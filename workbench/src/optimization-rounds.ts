import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {read,save,runDir} from './store';
import {improvement} from './improvement-governance';
export function optimizationState(){const p=process.env.PIPELINE_OPTIMIZATION_BATCH_FILE;return p&&existsSync(p)?read(p):null;}
export function reserveOptimizationRound(source:any,jobId:string,input:any){
 const file=process.env.PIPELINE_OPTIMIZATION_BATCH_FILE,v=optimizationState();
 if(!file||!v||source.improvementId!==v.improvementId)throw Error('此输入没有已授权的优化批次');
 if(v.rounds.length>=v.maxRounds)throw Error('已达到本批最多五轮优化上限');
 if(!input||typeof input.hypothesis!=='string'||input.hypothesis.trim().length<30||typeof input.analysis!=='string'||input.analysis.trim().length<40)throw Error('每轮需先记录具体原因分析和可验证改动');
 if(v.rounds.some((r:any)=>r.hypothesis.trim()===input.hypothesis.trim()))throw Error('不能原样重复相同假设');
 const prior=v.rounds.at(-1);if(prior&&['running','queued'].includes(read(join(runDir(prior.jobId),'job.json')).status))throw Error('上一轮尚未结束，须先分析结果');
 if(v.rounds.length&&!v.rounds.some((r:any)=>r.jobId===source.id)&&source.id!==v.baselineJobId)throw Error('只从本批已验证候选或固定基线继续');
 const ledger=improvement.get(source.improvementId);
 if(ledger.calls>=ledger.limits.calls||ledger.repairs>=ledger.limits.repairs)throw Error('累计预算已用完，不能继续');
 const row={batchId:v.id,index:v.rounds.length+1,jobId,sourceJobId:source.id,sourceScore:source.quality?.score,hypothesis:input.hypothesis.trim(),analysis:input.analysis.trim(),startedAt:new Date().toISOString(),calls:[]};
 (ledger.reviewedContinuations??=[]).push({batchId:v.id,index:row.index,analysis:row.analysis,hypothesis:row.hypothesis,previousStop:ledger.stopped??null,previousDiagnosis:ledger.diagnosis??null,at:Date.now()});
 delete ledger.stopped;delete ledger.diagnosis;save(improvement.path(source.improvementId),ledger);
 v.rounds.push(row);save(file,v);return row;
}
export function reserveOptimizationCall(job:any,role:string){
 if(!job.optimizationRound)return;
 const file=process.env.PIPELINE_OPTIMIZATION_BATCH_FILE,v=optimizationState(),r=v?.rounds.find((x:any)=>x.jobId===job.id);
 if(!file||!r||!['scene-refine','scene-space-judge','judge'].includes(role))throw Error('该调用不在本轮授权范围');
 if(r.calls.some((x:any)=>x.role===role)||r.calls.length>=3)throw Error('MODEL_BUDGET_EXHAUSTED：本轮每个阶段最多调用一次，共三次');
 r.calls.push({role,at:new Date().toISOString()});save(file,v);
}
