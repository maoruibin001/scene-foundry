import {closeSync,openSync,unlinkSync,readFileSync} from 'node:fs';
import {save} from './store';
function readBoundary(file:string){
 const state=JSON.parse(readFileSync(file,'utf8'));
 const unlimited=state.unlimited===true&&state.maxRounds===null;
 const finite=state.unlimited!==true&&Number.isSafeInteger(state.maxRounds)&&state.maxRounds>=1;
 if(state.enabled!==true||!state.id||!(unlimited||finite)||!Array.isArray(state.rounds)||!Array.isArray(state.executionRoots)||state.executionRoots.some((v:any)=>typeof v!=='string')||typeof state.model!=='string'||!state.model)throw Error('VALIDATION_BOUNDARY_INVALID：验收边界无效，不能重置');
 if(!(unlimited?['first-pass','bounded','qualified']:['first-pass','bounded']).includes(state.generationMode??'first-pass'))throw Error('VALIDATION_BOUNDARY_INVALID：生成方式超出已授权验收范围');
 return state;
}
/** Expose the same boundary to the normal creation UI; never expose the control path or history. */
export function validationBoundaryStatus(file=process.env.PIPELINE_VALIDATION_CONTROL_FILE){
 if(!file)return null;
 const state=readBoundary(file);
 return {...(state.unlimited===true?{unlimited:true}:{}),maxRounds:state.maxRounds,usedRounds:state.rounds.length,remainingRounds:state.unlimited===true?null:Math.max(0,state.maxRounds-state.rounds.length),acceptsNewInputs:state.allowFreshInputs===true,generationMode:state.generationMode??'first-pass',model:state.model,provider:state.provider??null};
}
/** Optional acceptance boundary shared by all versions and normal creation/recovery paths. */
export function reserveValidationRound(job:any,source:any,file=process.env.PIPELINE_VALIDATION_CONTROL_FILE){
 if(!file)return null;
 const lock=file+'.round-lock';let fd:number;
 try{fd=openSync(lock,'wx');}catch{throw Error('VALIDATION_BOUNDARY_BUSY：验收轮次正在登记，请先核对已有任务');}
 try{
  const state=readBoundary(file);
  const previous=state.rounds.find((r:any)=>r.jobId===job.id);if(previous)return previous;
  if(state.unlimited!==true&&state.rounds.length>=state.maxRounds)throw Error(`VALIDATION_ROUND_LIMIT：已达到授权的 ${state.maxRounds} 轮验证上限，失败与中断也计入`);
  const root=source?.retryRoot??source?.id??job.retryRoot??job.id;
  const fresh=source==null&&root===job.id&&job.validationKind==='generation';
  if(!state.executionRoots.includes(root)&&!(state.allowFreshInputs===true&&fresh))throw Error('VALIDATION_INPUT_NOT_AUTHORIZED：该输入不在本批验收范围');
  const mode=state.generationMode??'first-pass',repairs=mode==='qualified'?null:mode==='bounded'?2:0;
  if(job.generationMode!==mode||job.iterationPolicy?.maxVisualRepairs!==repairs)throw Error('VALIDATION_ROUND_MODE：生成方式与本批有限成品修正额度不符');
  const imageIds=(job.images??(job.image?[job.image]:[])).map((image:any)=>image.id);
  if(state.inputSets){
   if(!Array.isArray(state.inputSets)||!state.inputSets.every((set:any)=>Array.isArray(set)&&set.length>0&&set.every((id:any)=>typeof id==='string')))throw Error('VALIDATION_BOUNDARY_INVALID：固定输入集合无效');
   if(!state.inputSets.some((set:any)=>JSON.stringify(set)===JSON.stringify(imageIds)))throw Error('VALIDATION_INPUT_NOT_AUTHORIZED：参考图片不在本批冻结输入中');
   if(fresh&&state.rounds.some((r:any)=>JSON.stringify(r.inputImageIds)===JSON.stringify(imageIds)))throw Error('VALIDATION_INPUT_ALREADY_USED：相同输入已登记，不得替换失败样本重跑');
  }
  if(job.modelSettings?.model!==state.model)throw Error('VALIDATION_ROUTE_MISMATCH：实际模型与本批授权路由不一致');
  const row={batchId:state.id,index:state.rounds.length+1,...(state.unlimited===true?{unlimited:true}:{}),maxRounds:state.maxRounds,jobId:job.id,sourceJobId:source?.id??null,executionRoot:root,createdAt:job.createdAt,pipelineVersion:job.pipelineVersion,modelSettings:job.modelSettings,provider:state.provider??null,inputImageIds:(job.images??(job.image?[job.image]:[])).map((image:any)=>image.id)};
  if(fresh&&!state.executionRoots.includes(root))state.executionRoots.push(root);
  state.rounds.push(row);save(file,state);return row;
 }finally{closeSync(fd!);unlinkSync(lock);}
}
