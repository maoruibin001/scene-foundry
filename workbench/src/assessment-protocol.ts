import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,digest} from './store';
import {JUDGE_PROMPT} from './prompts';
import {modelSchema} from './model-schema';
/** 只固定评审输入、解析和判定契约；生成代码变化不触发原画面重新评分。 */
export function assessmentProtocolId(){
 const files=['atomic-criteria.ts','generation-policy.ts','judge-request.ts','count-units.ts','runtime-evidence.ts','assessment.ts','delivery-standard.ts','quality.ts','spec.ts'];
 return digest(JSON.stringify({prompt:JUDGE_PROMPT,schema:modelSchema('judge'),atomicSchemas:['scene-quality-v6','scene-quality-v7'].map(qualityVersion=>[qualityVersion,modelSchema('judge',{qualityVersion})]),files:files.map(path=>[path,digest(readFileSync(join(ROOT,'src',path)))])}));
}
