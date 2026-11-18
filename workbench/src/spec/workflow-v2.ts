/** 场景已有可运行输出后，量测与模型评审只作为报告；取消仍应立即传播。 */
export async function optionalReport<T>(run:()=>Promise<T>,signal?:AbortSignal):Promise<{value:T|null;error:string|null}>{
 try{return {value:await run(),error:null};}catch(error){if(signal?.aborted)throw error;return {value:null,error:String(error)};}
}
/** 引擎必须可运行且无错误；构建/资产核对证据若已明确失败，也不能进入待确认；画面是否认可只能由 owner 决定。 */
export function specV2Outcome(runtime:any){
 const hard=runtime?.hard??{};
 const required=['runtime','noErrors'];
 // build/catalog 由 gate 阶段依据真实证据补上；历史记录没有这两个字段时不追溯判定。
 const evidence=['build','catalog'];
 return required.every(k=>hard[k]===true)&&evidence.every(k=>hard[k]!==false)?'needs_review':'failed';
}
/** owner 认可前必须显式知悉的问题：硬检查失败、可选报告未完成、风格判分未过线。 */
export function specApprovalIssues(job:any):string[]{
 const gate=job?.specGate??{},issues=new Set<string>();
 for(const key of Array.isArray(gate.failed)?gate.failed:[])if(typeof key==='string')issues.add(key);
 if(gate.verifyError)issues.add('verifyError');
 if(gate.styleReviewError)issues.add('styleReviewError');
 if(gate.styleJudge&&gate.styleJudge.passed===false)issues.add('styleJudge');
 // 历史任务里看不到像素的文本节点评分已作废：这是「证据无效需重评」，不能当普通低分确认掉。
 if(gate.historicalReviewInvalidation?.scoreUsable===false)issues.add('styleReviewInvalidated');
 if(gate.hard?.build===false)issues.add('build');
 if(gate.hard?.catalog===false)issues.add('catalog');
 return [...issues];
}
/** 只能由显式用户操作确认已保存的真实运行画面，不能把模型评分变成 owner 认可。
 * 已有失败项时，调用方必须逐项显式确认，并把被接受的结果写进回执，避免"检查 failed、任务 passed"。 */
export function approveSpecReview(job:any,actual:{distManifestDigest:string;images:Record<string,string>},at=new Date().toISOString(),acknowledgedFailures:string[]=[]){
 if(!job?.specJob||job.status!=='needs_review'||job.specGate?.ownerApproval!=='pending')throw Error('当前规格场景不处于待人工确认状态');
 if(specV2Outcome(job.runtime)!=='needs_review')throw Error('真实运行尚未成功');
 if(job.specExport?.unresolved||job.specExport?.proxies||(job.specExport?.unresolved==null&&job.specExport?.dropped))throw Error('场景仍有关键参数待处理或灰模代理，可预览草稿，不能确认为完整成品');
 const r=job.runtime,names=(r.images??[]).filter((x:unknown)=>typeof x==='string'&&(x as string).startsWith('inspection-'));
 if(!names.length||!r.distManifestDigest||r.distManifestDigest!==actual.distManifestDigest)throw Error('当前构建证据不一致');
 for(const name of names){const i=r.images.indexOf(name);if(!r.hashes?.[i]||r.hashes[i]!==actual.images[name])throw Error('场景截图证据不一致: '+name);}
 const issues=specApprovalIssues(job),ack=Array.isArray(acknowledgedFailures)?acknowledgedFailures.filter(x=>typeof x==='string'):[];
 const missing=issues.filter(x=>!ack.includes(x));
 if(missing.length)throw Error('存在未确认的运行/评审问题: '+missing.join(', ')+'。请查看固定机位与评审报告后再显式确认');
 return {version:'spec-owner-approval-v1',at,method:'explicit-ui',distManifestDigest:r.distManifestDigest,
  images:names.map((name:string)=>({name,sha256:actual.images[name]})),
  acknowledgedFailures:issues,fps:job.specGate?.fps??null,
  styleJudge:job.specGate?.styleJudge?{overall:job.specGate.styleJudge.overall,verdict:job.specGate.styleJudge.verdict,passed:job.specGate.styleJudge.passed}:null};
}
