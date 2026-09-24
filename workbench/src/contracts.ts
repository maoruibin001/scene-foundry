import {correctionPrompt} from './prompts';
import {callModel} from './provider';
import {existsSync,renameSync,writeFileSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {read,save} from './store';
/** 无可执行改进属于明确停止结果，不是可用补一次提示纠正的格式错误。 */
export class NoActionableChange extends Error {}
export function isProviderFailure(error:unknown){return /\b(?:IMPROVEMENT_STOPPED|PROVIDER_[A-Z0-9_]+|MODEL_BUDGET_EXHAUSTED|MODEL_ROUTE_UNVERIFIED|NOT_CONFIGURED)\b|^(?:AbortError|TimeoutError):|^TypeError: fetch failed/.test(String(error));}
/** Exactly one schema correction, using the original input and concrete validation error. */
export async function callValidated(input:Parameters<typeof callModel>[0],dir:string,validate:(v:any)=>any,request:typeof callModel=callModel){
 const journal=join(dir,input.role+'-attempts.json');const attempts:any[]=existsSync(journal)?read(journal):[];
 for(let attempt=0;attempt<2;attempt++){
  const record:any={index:attempts.length+1,role:input.role,startedAt:Date.now(),status:'running',modelSettings:input.modelSettings??null};attempts.push(record);save(journal,attempts);
  let rejectedValue:unknown;
  try{const response=await request(input,dir);rejectedValue=response.value;const value=validate(response.value);record.status='passed';return {...response,value}}
  catch(error){record.status=input.signal?.aborted?'cancelled':isProviderFailure(error)?'blocked':'failed';record.error=String(error);const message=String(error);if(attempt||input.signal?.aborted||isProviderFailure(error)||error instanceof NoActionableChange)throw error;
   record.corrected=true;
   for(const suffix of ['response.txt','receipt.json','parsed.json','execution.json','input-receipt.json','failure.json']){const p=join(dir,input.role+'-'+suffix);if(existsSync(p)&&statSync(p).mtimeMs>=record.startedAt-1){const archive=join(dir,'attempts',input.role,String(record.index));mkdirSync(archive,{recursive:true});copyFileSync(p,join(archive,suffix));}}
   for(const suffix of ['response.txt','receipt.json','parsed.json']){const p=join(dir,input.role+'-'+suffix);if(existsSync(p))renameSync(p,join(dir,input.role+'-invalid-'+suffix));}
   writeFileSync(join(dir,input.role+'-contract-error.txt'),message);
   input={...input,text:input.text+correctionPrompt(message,rejectedValue)};
  }finally{record.endedAt=Date.now();record.durationMs=record.endedAt-record.startedAt;save(journal,attempts);const archive=join(dir,'attempts',input.role,String(record.index));mkdirSync(archive,{recursive:true});save(join(archive,'attempt.json'),record);for(const suffix of ['response.txt','receipt.json','parsed.json','execution.json','input-receipt.json','failure.json']){const p=join(dir,input.role+'-'+suffix);if(existsSync(p)&&statSync(p).mtimeMs>=record.startedAt-1&&!existsSync(join(archive,suffix)))copyFileSync(p,join(archive,suffix));}}
 }
 throw Error('模型结构纠正次数已用尽');
}
