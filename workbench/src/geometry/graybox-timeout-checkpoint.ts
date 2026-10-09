import {externalProviderBlock} from '../provider-external-block';

export type GrayboxTimeoutCheckpointInput={target:any;source:any;sourceFolder:string;expectedBasis:{jobId:string;round:number};execution:any;recovery:any};
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=(v:any)=>typeof v==='string'&&v.trim().length>0;
const positive=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const exhausted=(v:any)=>typeof v==='string'&&/\bPROVIDER_RECOVERY_EXHAUSTED\b/.test(v);
function canonical(v:any,parents=new Set<any>(),depth=0):string{
 if(depth>32)throw Error('excessive identity nesting');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(!object(v)&&!Array.isArray(v)||parents.has(v))throw Error('non-JSON identity');
 parents.add(v);const result=Array.isArray(v)?'['+v.map(x=>canonical(x,parents,depth+1)).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],parents,depth+1)).join(',')+'}';parents.delete(v);return result;
}
const same=(a:any,b:any)=>a===undefined||b===undefined?a===b:canonical(a)===canonical(b);
function timestamp(v:any){
 if(typeof v==='number')return Number.isFinite(v)?v:NaN;
 return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)?Date.parse(v):NaN;
}
const cancelled=(j:any)=>j?.status==='cancelled'||j?.cancelled===true||j?.cancelRequested===true||j?.abortCause==='user'||j?.cancelRequestedAt!=null||j?.cancelledAt!=null;
function forbidden(error:any){
 if(error==null)return false;
 const s=String(error);
 return externalProviderBlock(s)||/MODEL_BUDGET_EXHAUSTED|IMPROVEMENT_STOPPED|CALL_BUDGET|\bbudget\b|\bquota\b|\bcredits?\b|NOT_CONFIGURED|PROVIDER_PAUSED|MODEL_ROUTE_UNVERIFIED|CODEX_ROUTE_UNVERIFIED|\b(?:ENOSPC|EACCES|EPERM|EROFS|EDQUOT)\b|disk\s+(?:full|quota)|storage|authentication|authorization|\bauth\b|\b(?:USER_CANCELLED|CANCELLED|AbortError)\b|用户取消|取消请求|存储|磁盘|权限|余额|额度/i.test(s);
}
function validFolder(folder:any,sourceId:string){
 if(folder==='generation/space-repair-0')return true; // Caller derives/validates the source DATA root.
 if(typeof folder!=='string'||!folder.startsWith('/')||/[\\\u0000-\u001f]/.test(folder))return false;
 const segments=folder.split('/').slice(1);if(segments.some(s=>!s||s==='.'||s==='..'||/%(?:2e|2f|5c)/i.test(s)))return false;
 return folder.endsWith('/runs/'+sourceId+'/generation/space-repair-0');
}

/** A deadline checkpoint is transport recovery only; actual candidate/hash validation is separate. */
export function canRecoverGrayboxPreview(input:GrayboxTimeoutCheckpointInput):boolean{
 try{
  const {target,source,sourceFolder,expectedBasis,execution,recovery}=input??{} as GrayboxTimeoutCheckpointInput;
  if(!object(target)||!object(source)||!object(expectedBasis)||!object(execution)||!object(recovery))return false;
  if(!uuid(source.id)||target.recoverySourceJobId!==source.id||source.status!=='blocked'||cancelled(source)||cancelled(target)||!validFolder(sourceFolder,source.id))return false;
  if(!exhausted(source.error)||!['failed','blocked'].includes(source.stages?.space?.status))return false;
  const root=source.executionRecoveryRoot??source.id;
  if(!nonempty(root)||target.executionRecoveryRoot!==root||!nonempty(source.reuseMode)||target.reuseMode!==source.reuseMode)return false;
  for(const key of ['prompt','modelSettings','policy'])if(!nonempty(source.prompt)||!same(target[key],source[key]))return false;
  if(!object(source.modelSettings)||!nonempty(source.modelSettings.model)||!object(source.policy))return false;
  for(const key of ['sceneKind','baselineId','complexity','matchingLevel','generationMode','assessmentProtocol','executionRoute'])if(!same(target[key],source[key]))return false;
  const imageIds=(job:any)=>Array.isArray(job.images)?job.images.map((i:any)=>i?.id):null,a=imageIds(source),b=imageIds(target);
  if(!a?.length||a.some(id=>!nonempty(id))||new Set(a).size!==a.length||!same(a,b))return false;
  if(!object(source.profile)||!object(target.profile))return false;
  for(const key of ['engineSha','generatorSha','assessmentProtocolSha256'])if(!nonempty(source.profile[key])||source.profile[key]!==target.profile[key])return false;
  if(!object(source.profile.executionRoute)||!same(source.profile.executionRoute,target.profile.executionRoute))return false;
  if(!uuid(expectedBasis.jobId)||!Number.isSafeInteger(expectedBasis.round)||expectedBasis.round<0||!same(source.spatialRepairSource,expectedBasis)||!same(target.spatialRepairSource,expectedBasis))return false;
  const diagnosis=source.spatialDiagnosis,nextDiagnosis=target.spatialDiagnosis;
  if(!object(diagnosis)||!object(nextDiagnosis)||diagnosis.contract!=='graybox-space-repair-v8'||nextDiagnosis.contract!==diagnosis.contract||!nonempty(diagnosis.revisionId)||nextDiagnosis.revisionId!==diagnosis.revisionId)return false;
  if(diagnosis.sourceJobId!==expectedBasis.jobId||diagnosis.sourceRound!==expectedBasis.round||nextDiagnosis.sourceJobId!==expectedBasis.jobId||nextDiagnosis.sourceRound!==expectedBasis.round)return false;
  const errors=[source.error,source.executionFault,source.stages.space.error,execution.error,execution.reason,recovery.error,recovery.reason];
  if(!Array.isArray(recovery.attempts)||!recovery.attempts.length)return false;
  for(const record of recovery.attempts){if(!object(record))return false;errors.push(record.error,record.reason);if(record.abortCause==='user'||record.status==='cancelled'||['hard','input'].includes(record.fault))return false;}
  if(errors.some(forbidden))return false;
  if(execution.status!=='cancelled'||!positive(execution.timeoutMs)||!positive(execution.maxTimeoutMs)||execution.maxTimeoutMs<execution.timeoutMs||!positive(execution.durationMs)||execution.durationMs<execution.timeoutMs)return false;
  const started=timestamp(execution.startedAt),ended=timestamp(execution.endedAt),deadline=timestamp(execution.deadlineAt);
  if(![started,ended,deadline].every(Number.isFinite)||deadline-started<execution.timeoutMs||deadline-started>execution.maxTimeoutMs||ended<deadline||ended-started<execution.timeoutMs)return false;
  if(recovery.version!=='provider-recovery-v1'||recovery.role!=='scene-space'||recovery.status!=='blocked'||recovery.abortCause!=='parent'||!exhausted(recovery.reason)||!positive(recovery.policy?.maxElapsedMs))return false;
  const latest=recovery.attempts.at(-1),cap=recovery.policy.maxElapsedMs;
  if(!Number.isSafeInteger(recovery.cycle)||recovery.cycle<1||latest.cycle!==recovery.cycle||latest.status!=='blocked'||latest.fault!=='exhausted'||latest.abortCause!=='parent'||!exhausted(latest.error)||!positive(latest.durationMs)||latest.durationMs<cap)return false;
  const cycleStart=timestamp(recovery.startedAt),cycleEnd=timestamp(recovery.endedAt),attemptStart=timestamp(latest.startedAt),attemptEnd=timestamp(latest.endedAt);
  if(![cycleStart,cycleEnd,attemptStart,attemptEnd].every(Number.isFinite)||cycleEnd-cycleStart<cap||attemptEnd-attemptStart<cap||attemptStart<cycleStart||attemptEnd>cycleEnd)return false;
  return true;
 }catch{return false;}
}
