import {existsSync,readFileSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from './store';
import {modelSchema} from './model-schema';
import {PROMPT_CONTRACT} from './prompts';
import {assess} from './assessment';
import {comparableAssessment} from './geometry/refinement-baseline';

/** Only finish an interrupted assessment. Deliberate re-evaluation still calls the model. */
export function interruptedReviewMatches(source:any,target:any,request:any,saved:any){
 if(!source.review||source.quality||!['failed','blocked','cancelled'].includes(source.status)||!['judge','spec','gate'].includes(source.stage)||!comparableAssessment(source,target))return false;
 const {prompt,receipt,input,review,parsed,imageHashes,schemaHash}=saved;
 return prompt.contract===PROMPT_CONTRACT&&prompt.system===request.system&&prompt.input===request.text
  &&receipt.stopReason==='completed'&&receipt.requestedModel===request.modelSettings?.model
  &&receipt.requestedReasoning===request.modelSettings?.reasoningEffort
  &&receipt.executionRoute?.configurationSha256===target.profile.executionRoute?.configurationSha256
  &&input.schemaSha256===schemaHash&&JSON.stringify(input.images?.map((i:any)=>i.sha256))===JSON.stringify(imageHashes)
  &&JSON.stringify(source.review)===JSON.stringify(review)&&JSON.stringify(review)===JSON.stringify(parsed);
}

export function reuseInterruptedReview(source:any,target:any,request:any,from:string,to:string){
 const files=['judge-prompt.json','judge-input-receipt.json','judge-receipt.json','judge-parsed.json','review.json'];
 if(files.some(f=>!existsSync(join(from,f))))return null;
 const saved={prompt:read(join(from,files[0])),input:read(join(from,files[1])),receipt:read(join(from,files[2])),parsed:read(join(from,files[3])),review:read(join(from,files[4])),imageHashes:request.images.map((i:any)=>digest(readFileSync(i.path))),schemaHash:digest(JSON.stringify(modelSchema('judge',request.schemaContext)))};
 if(!interruptedReviewMatches(source,target,request,saved))return null;
 assess(target,saved.review,target.runtime);
 for(const f of [...files,'judge-response.txt'])if(existsSync(join(from,f)))cpSync(join(from,f),join(to,f));
 const provenance={sourceJobId:source.id,sourceVersion:source.pipelineVersion,reason:'完整视觉评审已返回，后续判定中断；请求、图片、模型、契约及响应均一致，复用评审继续固定脚本判定',reviewSha256:digest(JSON.stringify(saved.review)),newModelCalls:0};
 save(join(to,'judge-reuse.json'),provenance);target.reviewReuse=provenance;
 return saved.review;
}
