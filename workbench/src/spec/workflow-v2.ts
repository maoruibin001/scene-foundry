/** 场景已有可运行输出后，量测与模型评审只作为报告；取消仍应立即传播。 */
export async function optionalReport<T>(run:()=>Promise<T>,signal?:AbortSignal):Promise<{value:T|null;error:string|null}>{
 try{return {value:await run(),error:null};}catch(error){if(signal?.aborted)throw error;return {value:null,error:String(error)};}
}
/** 引擎必须可运行且无错误；画面是否认可只能由 owner 决定。 */
export function specV2Outcome(runtime:any){
 return runtime?.hard?.runtime===true&&runtime?.hard?.noErrors===true?'needs_review':'failed';
}
/** 只能由显式用户操作确认已保存的真实运行画面，不能把模型评分变成 owner 认可。 */
export function approveSpecReview(job:any,actual:{distManifestDigest:string;images:Record<string,string>},at=new Date().toISOString()){
 if(!job?.specJob||job.status!=='needs_review'||job.specGate?.ownerApproval!=='pending')throw Error('当前规格场景不处于待人工确认状态');
 if(specV2Outcome(job.runtime)!=='needs_review')throw Error('真实运行尚未成功');
 if(job.specExport?.unresolved||job.specExport?.proxies||(job.specExport?.unresolved==null&&job.specExport?.dropped))throw Error('场景仍有关键参数待处理或灰模代理，可预览草稿，不能确认为完整成品');
 const r=job.runtime,names=(r.images??[]).filter((x:unknown)=>typeof x==='string'&&(x as string).startsWith('inspection-'));
 if(!names.length||!r.distManifestDigest||r.distManifestDigest!==actual.distManifestDigest)throw Error('当前构建证据不一致');
 for(const name of names){const i=r.images.indexOf(name);if(!r.hashes?.[i]||r.hashes[i]!==actual.images[name])throw Error('场景截图证据不一致: '+name);}
 return {version:'spec-owner-approval-v1',at,method:'explicit-ui',distManifestDigest:r.distManifestDigest,images:names.map((name:string)=>({name,sha256:actual.images[name]}))};
}
