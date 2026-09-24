import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,digest} from './store';
import {JUDGE_PROMPT} from './prompts';
import {modelSchema} from './model-schema';
/** 只固定评审输入、解析和判定契约；生成代码变化不触发原画面重新评分。 */
export function assessmentProtocolId(){
 const files=['judge-request.ts','runtime-evidence.ts','assessment.ts','quality.ts','spec.ts'];
 return digest(JSON.stringify({prompt:JUDGE_PROMPT,schema:modelSchema('judge'),files:files.map(path=>[path,digest(readFileSync(join(ROOT,'src',path)))])}));
}
