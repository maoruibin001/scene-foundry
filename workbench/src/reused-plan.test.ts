import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {save} from './store';
import {loadReusedPlan} from './reused-plan';
import {validateGroundedPlan} from './grounding';
import {CRITERION_DIMENSIONS} from './atomic-criteria';
const plan=()=>({name:'花盆',summary:'蓝色花盆',capabilities:['mapping','consistency'],requirements:[{id:'pot',text:'蓝色花盆',critical:true,weight:5,source:'prompt',evidence:'蓝色花盆',count:null}]});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'saved-plan-')),job={id:'source',prompt:'生成蓝色花盆',images:[{id:'reference'}],plan:plan()};
 save(join(dir,'job.json'),job);save(join(dir,'plan.json'),plan());
 return {dir,job,clean:()=>rmSync(dir,{recursive:true,force:true})};
}
test('保存的计划可复用，缺失模型原文不伪造响应或修改来源',()=>{
 const f=fixture();try{const before=readFileSync(join(f.dir,'job.json'),'utf8'),r=loadReusedPlan(f.dir,f.job);
 expect(r.plan.requirements[0].evidenceSpans).toEqual(['蓝色花盆']);expect(r.provenance.source).toBe('plan.json');
 expect(r.provenance.modelResponsePresent).toBe(false);expect(r.provenance.modelCall).toBe(false);
 expect(existsSync(join(f.dir,'plan-response.txt'))).toBe(false);expect(readFileSync(join(f.dir,'job.json'),'utf8')).toBe(before);
 }finally{f.clean();}
});
test('拒绝不一致的保存计划、原始响应以及不同输入',()=>{
 const f=fixture();try{
 writeFileSync(join(f.dir,'plan-response.txt'),JSON.stringify({...plan(),name:'不一致'}));
 expect(()=>loadReusedPlan(f.dir,f.job)).toThrow('REUSE_PLAN_CONFLICT');
 writeFileSync(join(f.dir,'plan-response.txt'),JSON.stringify(plan()));expect(loadReusedPlan(f.dir,f.job).provenance.modelResponsePresent).toBe(true);
 for(const job of [{...f.job,prompt:'生成红色花盆'},{...f.job,images:[{id:'other'}]}])expect(()=>loadReusedPlan(f.dir,job)).toThrow('REUSE_INPUT_CHANGED');
 save(join(f.dir,'plan.json'),{...plan(),requirements:[{...plan().requirements[0],evidence:'不存在的原文'}]});expect(()=>loadReusedPlan(f.dir,f.job)).toThrow();
 }finally{f.clean();}
});
test('仅保存任务计划也必须通过来源引用校验，完全缺失则明确拒绝',()=>{
 const f=fixture();try{rmSync(join(f.dir,'plan.json'));expect(loadReusedPlan(f.dir,f.job).provenance.source).toBe('job.json:plan');
 save(join(f.dir,'job.json'),{...f.job,plan:null});expect(()=>loadReusedPlan(f.dir,f.job)).toThrow('REUSE_PLAN_MISSING');
 }finally{f.clean();}
});
test('旧响应加新版原子条目须有模型来源，复用保留条目且不放宽原需求',()=>{
 const f=fixture();try{
  const migrated=validateGroundedPlan({...plan(),acceptanceCriteria:CRITERION_DIMENSIONS.map((dimension,i)=>({id:'AC'+i,requirementId:'pot',dimension,description:'检查蓝色花盆'+i,source:'prompt',evidence:['蓝色花盆'],critical:true,weight:1}))},f.job.prompt);
  save(join(f.dir,'plan.json'),migrated);save(join(f.dir,'job.json'),{...f.job,plan:migrated});writeFileSync(join(f.dir,'plan-response.txt'),JSON.stringify(plan()));
  expect(()=>loadReusedPlan(f.dir,f.job)).toThrow('缺少完整模型调用来源');
  save(join(f.dir,'judge-prompt.json'),{input:JSON.stringify({frozenPlan:migrated})});save(join(f.dir,'judge-receipt.json'),{stopReason:'completed'});
  expect(loadReusedPlan(f.dir,f.job).plan.acceptanceCriteria).toEqual(migrated.acceptanceCriteria);
  const changed=structuredClone(migrated);changed.acceptanceCriteria[0].description='改变标准';save(join(f.dir,'plan.json'),changed);expect(()=>loadReusedPlan(f.dir,f.job)).toThrow('原子标准不一致');
 }finally{f.clean();}
});
