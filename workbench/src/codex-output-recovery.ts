import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {cliReceipt,CODEX_WORKER_INSTRUCTIONS,validateCodexImages} from './codex-provider';
import {digest,read} from './store';
import {PROMPT_CONTRACT} from './prompts';
/** 只恢复 CLI 明确的最终回复块；不解析推理块、不拼补截断 JSON、不把超时改记为调用成功。 */
export function parseFinalJson(log:string){const marker='\ncodex\n',at=log.lastIndexOf(marker);if(at<0)throw Error('没有明确的最终回复块');const text=log.slice(at+marker.length).trim();try{return JSON.parse(text)}catch{throw Error('最终回复不是完整 JSON，不能恢复');}}
export function recoverCodexOutput(input:{role:string;system:string;text:string;images:{path:string;mime:string}[];modelSettings:{model:string;reasoningEffort:string}},dir:string){
 const prefix=join(dir,input.role+'-');if(!existsSync(prefix+'failure.json'))throw Error('来源不是已记录失败的调用');
 const trace=read(prefix+'execution.json'),prompt=read(prefix+'prompt.json'),receipt=read(prefix+'input-receipt.json'),log=readFileSync(prefix+'cli.log','utf8');
 if(!['timed_out','cancelled'].includes(trace.status)||!trace.endedAt)throw Error('调用尚未结束或不属于可恢复的中断');
 if(prompt.contract!==PROMPT_CONTRACT||prompt.language!=='zh-CN'||prompt.engine!=='ForgeaX Engine'||prompt.system!==input.system||prompt.input!==input.text)throw Error('恢复输出的提示词契约与本次不一致');
 if(receipt.requestedModel!==input.modelSettings.model||receipt.requestedReasoning!==input.modelSettings.reasoningEffort||receipt.workerInstructionsSha256!==digest(CODEX_WORKER_INSTRUCTIONS))throw Error('恢复输出的模型或执行规则不一致');
 const pick=(i:any)=>({sha256:i.sha256,mime:i.mime,bytes:i.bytes});if(JSON.stringify(receipt.images.map(pick))!==JSON.stringify(validateCodexImages(input.images).map(pick)))throw Error('恢复输出的图片内容或顺序不一致');
 const identity=cliReceipt(log,input.modelSettings.model,input.modelSettings.reasoningEffort,receipt.executionRoute?.providerId??'openai'),value=parseFinalJson(log);
 return {value,receipt:{...identity,executable:receipt.executable,role:input.role,stopReason:'recovered-final-output',originalProcessStatus:trace.status,sourceDirectory:dir,sourceLogSha256:digest(log),durationMs:0,originalDurationMs:trace.durationMs,usage:null,scope:'只复用已完整返回且契约一致的最终JSON；原CLI超时/取消状态不变，无新增模型调用'}};
}
