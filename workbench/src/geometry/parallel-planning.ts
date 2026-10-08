/** Speculate only independent material work; consumers wait for accepted geometry and matching surfaces. */
export async function parallelPlanning<T,S>(initial:T,accept:(space:T)=>Promise<T>,plan:(space:T,signal:AbortSignal)=>Promise<S>,signal:AbortSignal,same:(a:T,b:T)=>boolean){
 const controller=new AbortController(),child=AbortSignal.any([signal,controller.signal]);
 const material=Promise.resolve().then(()=>plan(initial,child)).then(value=>({value}),error=>({error}));
 let accepted:T;
 try{accepted=await accept(structuredClone(initial));}catch(error){
  // 已付费的独立材质调用可正常收尾；本地采集失败不证明空间规划无效。
  // 用户取消、空间确实未通过及其他故障仍立即清理，不追加新请求。
  if(signal.aborted||!String(error).includes('CAPTURE_EVIDENCE_FAILED：'))controller.abort(error);
  await material;signal.throwIfAborted();throw error;
 }
 const settled=await material;signal.throwIfAborted();
 // An accepted spatial revision invalidates speculation, even if the old surface call failed.
 if(!same(initial,accepted))return {space:accepted,surface:await plan(accepted,signal)};
 if('error' in settled)throw settled.error;
 return {space:accepted,surface:settled.value};
}
