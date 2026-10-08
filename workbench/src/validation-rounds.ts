import {closeSync,openSync,unlinkSync,readFileSync} from 'node:fs';
import {save} from './store';
/** Optional acceptance boundary shared by all versions and normal creation/recovery paths. */
export function reserveValidationRound(job:any,source:any,file=process.env.PIPELINE_VALIDATION_CONTROL_FILE){
 if(!file)return null;
 const lock=file+'.round-lock';let fd:number;
 try{fd=openSync(lock,'wx');}catch{throw Error('VALIDATION_BOUNDARY_BUSY：验收轮次正在登记，请先核对已有任务');}
 try{
  const state=JSON.parse(readFileSync(file,'utf8'));
  if(state.enabled!==true||!state.id||!Number.isSafeInteger(state.maxRounds)||state.maxRounds<1||!Array.isArray(state.rounds))throw Error('VALIDATION_BOUNDARY_INVALID：验收边界无效，不能重置');
  const previous=state.rounds.find((r:any)=>r.jobId===job.id);if(previous)return previous;
  if(state.rounds.length>=state.maxRounds)throw Error(`VALIDATION_ROUND_LIMIT：已达到授权的 ${state.maxRounds} 轮验证上限，失败与中断也计入`);
  const root=source?.retryRoot??source?.id??job.retryRoot??job.id;
  if(!Array.isArray(state.executionRoots)||!state.executionRoots.includes(root))throw Error('VALIDATION_INPUT_NOT_AUTHORIZED：该输入不在本批验收范围');
  if(job.generationMode!=='first-pass'||job.iterationPolicy?.maxVisualRepairs!==0)throw Error('VALIDATION_ROUND_MODE：有界验证每次只运行一个成品轮次，需使用首轮验证模式');
  if(job.modelSettings?.model!==state.model)throw Error('VALIDATION_ROUTE_MISMATCH：实际模型与本批授权路由不一致');
  const row={batchId:state.id,index:state.rounds.length+1,maxRounds:state.maxRounds,jobId:job.id,sourceJobId:source?.id??null,executionRoot:root,createdAt:job.createdAt,pipelineVersion:job.pipelineVersion,modelSettings:job.modelSettings};
  state.rounds.push(row);save(file,state);return row;
 }finally{closeSync(fd!);unlinkSync(lock);}
}
