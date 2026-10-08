import {test,expect} from 'bun:test';
import {mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runDir,save} from '../store';
import {PROMPT_CONTRACT} from '../prompts';
import {savedStage,persistStageReuse} from './saved-stage';
function fixture(){
 const id=randomUUID(),next=randomUUID(),dir=join(runDir(id),'generation'),nextDir=join(runDir(next),'generation');mkdirSync(dir,{recursive:true});mkdirSync(nextDir,{recursive:true});
 const job={id,prompt:'原图',images:[{id:'image'}],plan:{requirements:[]},reuseMode:'fresh',executionRecoveryRoot:id,profile:{executionRoute:{configurationSha256:'route'}},modelSettings:{model:'fixture',reasoningEffort:'high'}};
 save(join(runDir(id),'job.json'),job);const ctx={job:{...job,id:next,recoverySourceJobId:id},plan:job.plan,dir:nextDir};
 const request={system:'材质契约',text:JSON.stringify({space:{id:'unchanged'},references:['image']})};
 save(join(dir,'scene-surface-prompt.json'),{contract:PROMPT_CONTRACT,system:request.system,input:request.text});save(join(dir,'scene-surface-response.txt'),{materials:['stone']});save(join(dir,'scene-surface-receipt.json'),{requestedModel:'fixture',requestedReasoning:'high',stopReason:'completed',executionRoute:{configurationSha256:'route'}});
 return {job,ctx,dir,request,cleanup:()=>{rmSync(runDir(id),{recursive:true,force:true});rmSync(runDir(next),{recursive:true,force:true});}};
}
test('空间收尾中断后复用已经完成的同空间材质规划，二次恢复保留来源',()=>{const f=fixture();try{let validations=0;const get=(ctx:any)=>savedStage(ctx,'scene-surface',v=>{validations++;return v;},false,undefined,f.request);const saved=get(f.ctx);expect(saved?.value.materials).toEqual(['stone']);persistStageReuse(f.ctx,'scene-surface',saved);save(join(runDir(f.ctx.job.id),'job.json'),f.ctx.job);const again=get({...f.ctx,job:{...f.ctx.job,id:randomUUID(),recoverySourceJobId:f.ctx.job.id}});expect(again?.proof.sourceJobId).toBe(f.ctx.job.id);expect(validations).toBe(2);}finally{f.cleanup()}});
test('空间、请求、契约、模型来源变化或不完整响应不复用，也不借其他全新任务产物',()=>{const edits=[(f:any)=>f.request.text+=' changed',(f:any)=>f.request.system+=' changed',(f:any)=>f.ctx.job.profile={executionRoute:{configurationSha256:'different'}},(f:any)=>f.ctx.job.executionRecoveryRoot='another-root',(f:any)=>save(join(f.dir,'scene-surface-receipt.json'),{requestedModel:'fixture',requestedReasoning:'high',stopReason:'incomplete',executionRoute:{configurationSha256:'route'}})];for(const edit of edits){const f=fixture();try{edit(f);expect(savedStage(f.ctx,'scene-surface',v=>v,false,undefined,f.request)).toBeNull();}finally{f.cleanup()}}});
