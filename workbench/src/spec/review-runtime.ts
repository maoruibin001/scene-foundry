import {readFileSync} from 'node:fs';
import {join} from 'node:path';
/** A preserved screenshot can be judged after teardown failed, but that review
 * never upgrades a failed capture to a passed runtime or an accepted delivery. */
export function specReviewRuntime(job:any,dir:string){
 if(job.runtime)return {runtime:job.runtime,diagnosticOnly:false};
 if(job.status!=='failed'||job.stage!=='runtime'||!String(job.error).includes('CAPTURE_CLEANUP_TIMEOUT'))throw Error('需要已完成的规格场景或关闭失败后完整保留的画面');
 const runtime=JSON.parse(readFileSync(join(dir,'runtime/runtime.json'),'utf8'));
 if(!runtime.hard?.framing||!runtime.hard?.multipleViews||!runtime.hard?.nonFlat||!runtime.hard?.noErrors||runtime.errors?.length||!runtime.images?.filter((f:string)=>/^inspection-[^/]+\.png$/.test(f)).length)throw Error('DIAGNOSTIC_VISUAL_EVIDENCE_INCOMPLETE');
 return {runtime,diagnosticOnly:true};
}
