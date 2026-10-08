import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {save,digest} from '../store';
import {pendingIterationRepair} from './pending-repair';
import {restoreRepairAttempt} from './repair-attempt-recovery';
import {recoveryInfo} from '../recovery';
function setup(){
 const root=mkdtempSync(join(tmpdir(),'pending-repair-')),dir=join(root,'source'),folder=join(dir,'generation/iteration-1/refinement');mkdirSync(folder,{recursive:true});
 const source={program:{templates:[{id:'t',parts:[]}],instances:[],materials:[]}},plan={acceptanceCriteria:[{id:'a'}]},policy={score:80},modelSettings={model:'gpt-6-astra-aihub-openai',reasoningEffort:'xhigh'},job:any={id:'source',status:'blocked',stage:'repair',sceneProgram:{file:'generated-scene.json'},refineScene:true,reuseSceneFrom:'earlier',executionRecoveryRoot:'original',plan,policy,modelSettings,profile:{assessmentProtocolSha256:'unchanged'}};
 const parsed={version:'scene-repair-goals-v1',summary:'已完成规划',goals:[{id:'g',kind:'surface',templateIds:['t']}],deferred:[]},receipt={role:'scene-repair-plan',stopReason:'completed',requestedModel:modelSettings.model};
 save(join(dir,'job.json'),job);save(join(dir,'generated-scene.json'),source);save(join(dir,'plan.json'),plan);save(join(folder,'source.json'),{sourceJobId:job.id,sourceIteration:0,sourceDigest:digest(JSON.stringify(source)),referenceSha256:['ref']});
 save(join(folder,'repair-goals.json'),{...parsed,sourceDigest:digest(JSON.stringify(source)),modelReceipt:receipt});save(join(folder,'scene-repair-plan-parsed.json'),parsed);save(join(folder,'scene-repair-plan-receipt.json'),receipt);save(join(folder,'repair-batches.json'),{batches:[{...parsed,id:'batch-1'}]});
 const target={...job,id:'target',reuseSceneFrom:job.id,recoverySourceJobId:job.id};
 return {root,dir,folder,source,job,target,plan,locate:(id:string)=>join(root,id),out:join(root,'target/refinement')};
}
test('自动修正的规划完成而请求未开始时，恢复修改而非重复原场景评审',()=>{const f=setup();try{
 expect(pendingIterationRepair(f.job,f.dir)?.sourceIteration).toBe(0);expect(recoveryInfo(f.job,[],undefined,f.dir).mode).toBe('repair-attempt');
 const result=restoreRepairAttempt(f.target,f.job.id,f.source,f.plan,['ref'],f.out,f.locate);expect(result?.goals.goals[0].id).toBe('g');expect(result?.batches).toHaveLength(1);expect(result?.recovery.files).toHaveLength(0);
 for(const status of ['running','queued','cancelled','passed'])expect(pendingIterationRepair({...f.job,status},f.dir)).toBeNull();
 save(join(f.folder,'receipt.json'),{completed:true});expect(pendingIterationRepair(f.job,f.dir)).toBeNull();
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('旧机位或原评分场景变化、不同执行根和模型不得继承规划',()=>{const f=setup();try{
 expect(()=>restoreRepairAttempt({...f.target,executionRecoveryRoot:'other'},f.job.id,f.source,f.plan,['ref'],f.out,f.locate)).toThrow('执行根');
 expect(()=>restoreRepairAttempt({...f.target,modelSettings:{model:'other'}},f.job.id,f.source,f.plan,['ref'],f.out,f.locate)).toThrow('契约');
 expect(()=>restoreRepairAttempt(f.target,f.job.id,f.source,f.plan,['changed'],f.out,f.locate)).toThrow('契约');
 save(join(f.dir,'generated-scene.json'),{...f.source,changed:true});expect(pendingIterationRepair(f.job,f.dir)).toBeNull();
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('恢复未成功预览的工具额度和补丁，不丢掉有用工作或重置次数',()=>{const f=setup();try{
 const feedback=join(f.folder,'batch-1/feedback');mkdirSync(join(feedback,'1'),{recursive:true});
 const stable=(x:any):any=>x&&typeof x==='object'?Array.isArray(x)?x.map(stable):Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 save(join(feedback,'tool-audit.json'),{sourceSha256:digest(JSON.stringify(stable(f.source))),counts:{render_scene_patch:1,enginePreviews:1},attempts:[{index:1,name:'render_scene_patch',status:'failed',patchSha256:'retained'}]});save(join(feedback,'1/patch.json'),{reason:'saved'});
 const r=restoreRepairAttempt(f.target,f.job.id,f.source,f.plan,['ref'],f.out,f.locate);expect(r?.recovery.files.map(x=>x.path)).toContain('batch-1/feedback/1/patch.json');
}finally{rmSync(f.root,{recursive:true,force:true});}});
