import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {codexPrompt} from './prompts';
import {withToolContinuation,type CodexToolKit} from './codex-tools';
export const CODEX_INPUT_LIMIT=1048576;
export const CODEX_WORKER_INSTRUCTIONS=readFileSync(join(import.meta.dirname,'codex-worker.zh.md'),'utf8');
/** Count the expanded request before ledger reservation or subprocess creation. Leave room for CLI framing. */
export function codexInputSize(input:{system:string;text:string;images?:{path:string;mime:string}[];tools?:CodexToolKit},schema:any={}){
 const expanded=withToolContinuation(input),promptChars=codexPrompt(expanded.system,expanded.text,!!expanded.tools).length;
 const instructionsChars=CODEX_WORKER_INSTRUCTIONS.length+(input.tools?.instructions.length??0),schemaChars=JSON.stringify(input.tools?.outputSchema??schema).length,toolChars=JSON.stringify(input.tools?.definitions??[]).length,imagePathChars=JSON.stringify(expanded.images??[]).length;
 return {version:'codex-input-preflight-v1',promptChars,instructionsChars,schemaChars,toolChars,imagePathChars,reservedFramingChars:16384,totalChars:promptChars+instructionsChars+schemaChars+toolChars+imagePathChars+16384,maxChars:CODEX_INPUT_LIMIT};
}
export function assertCodexInputSize(input:Parameters<typeof codexInputSize>[0],schema:any={}){
 const size=codexInputSize(input,schema);
 if(size.totalChars>size.maxChars)throw Error(`PROVIDER_INPUT_TOO_LARGE：请求含工具恢复上下文共 ${size.totalChars} 字符，超过 ${size.maxChars} 上限；请缩小输入并按需查询几何。未调用模型、未消耗本次调用额度，已有场景与评分保留。`);
 return size;
}
