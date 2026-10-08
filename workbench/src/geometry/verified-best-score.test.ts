import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../store';
import {DEFAULT_POLICY,ATOMIC_POLICY,HARD_CHECKS,qualityGate,DIMENSIONS} from '../quality';
import {verifiedBestScore} from './verified-best-score';
import {repairOutcome} from './repair-outcome';

function fixture(atomic=false){
 const root=mkdtempSync(join(tmpdir(),'verified-best-'));
 const profile={provider:'codex-cli',judgeModel:'test-model',reasoningEffort:'high',assessmentProtocolSha256:'protocol',specSha256:'spec',engineSha:'engine',generatorSha:'generator',executionRoute:{configurationSha256:'route'},policy:DEFAULT_POLICY};
 const plan:any={requirements:[{id:'R1',source:'image',weight:1,critical:true}]};
 const policy=atomic?ATOMIC_POLICY:DEFAULT_POLICY;profile.policy=policy;
 if(atomic)plan.acceptanceCriteria=DIMENSIONS.map((d,i)=>({id:'C'+i,requirementId:'R1',dimension:d.id,description:'可见要求'+i,source:'image',evidence:['参考图1'],critical:true,weight:1}));
 const job:any={id:'current',prompt:'同一场景',complexity:'complex',images:[{id:'reference'}],profile,policy,plan,startedAt:100,status:'running'};
 const write=(file:string,data:any)=>{mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,JSON.stringify(data));};
 const add=(id:string,value:number,endedAt=50)=>{
  const dir=join(root,id),image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const review:any={requirements:[{id:'R1',verdict:'partial',reason:'尚缺可见细节',frames:['view.png']}],dimensions:DIMENSIONS.map(d=>({id:d.id,score:value,reason:'实际观测',frames:['view.png']})),confidence:.9};
  if(atomic)review.criteria=plan.acceptanceCriteria.map(c=>({id:c.id,score:value,verdict:value===5?'met':value===0?'missing':'partial',reason:'可见残留',frames:['view.png']}));
  const quality=qualityGate(plan,review,Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),policy);
  const candidate={...structuredClone(job),id,status:'failed',endedAt,startedAt:10,quality,pipelineVersion:{id:'version'},validationKind:'native-assisted'};
  write(join(dir,'quality.json'),quality);write(join(dir,'review.json'),review);write(join(dir,'generated-scene.json'),{id});
  write(join(dir,'runtime/runtime.json'),{images:['view.png'],hashes:[digest(image)]});writeFileSync(join(dir,'runtime/view.png'),image);
  write(join(dir,'judge-receipt.json'),{stopReason:'completed',cliModel:'test-model',cliReasoningEffort:'high',executionRoute:{configurationSha256:'route'}});
  return candidate;
 };
 return {root,job,add,write,locate:(id:string)=>join(root,id),dispose:()=>rmSync(root,{recursive:true,force:true})};
}

test('无修改回执的真实复评可成为历史最佳；较高未来成绩不泄露到当轮',()=>{
 const f=fixture();try{
  const a=f.add('before',2.8),b=f.add('reevaluation',3),future=f.add('future',4,120);
  const r=verifiedBestScore(f.job,{jobs:[a,b,future],locate:f.locate});
  expect(r.best.jobId).toBe('reevaluation');expect(r.verifiedCount).toBe(2);expect(r.best.score).toBe(b.quality.score);
 }finally{f.dispose();}
});
test('不同需求、评审契约、模型和引擎不能成为可比分数',()=>{
 const f=fixture();try{
  const valid=f.add('valid',2.8),variants=['requirement','protocol','model','engine'].map(id=>f.add(id,4));
  variants[0].plan={requirements:[{id:'different',weight:1,critical:true}]};variants[1].profile.assessmentProtocolSha256='other';variants[2].profile.judgeModel='other';variants[3].profile.engineSha='other';
  const r=verifiedBestScore(f.job,{jobs:[valid,...variants],locate:f.locate});expect(r.best.jobId).toBe('valid');expect(r.verifiedCount).toBe(1);
 }finally{f.dispose();}
});
test('篡改分数、截图或回执拒绝，独立评分重算可以发现同步篡改',()=>{
 const f=fixture();try{
  const a=f.add('score',4),b=f.add('image',4),c=f.add('receipt',4);
  a.quality.score=99;f.write(join(f.root,a.id,'quality.json'),a.quality);
  writeFileSync(join(f.root,b.id,'runtime/view.png'),'wrong');
  f.write(join(f.root,c.id,'judge-receipt.json'),{stopReason:'timeout'});
  const r=verifiedBestScore(f.job,{jobs:[a,b,c],locate:f.locate});expect(r.best).toBe(null);expect(r.excluded).toHaveLength(3);
  expect(r.excluded.map(e=>e.reason).join(' ')).toContain('重算');
 }finally{f.dispose();}
});
test('运行中任务的已完成第五轮可比较，未完成根记录不参与',()=>{
 const f=fixture();try{
  const c=f.add('running',3);c.status='running';const round=join(f.root,c.id,'iterations/4');
  const {cpSync}=require('node:fs');for(const file of ['quality.json','review.json','generated-scene.json','runtime'])cpSync(join(f.root,c.id,file),join(round,file),{recursive:true});
  f.write(join(round,'candidate.json'),{jobId:c.id,pipelineVersionId:c.pipelineVersion.id,cycle:{index:4,startedAt:20,endedAt:60},fields:{quality:c.quality}});
  const r=verifiedBestScore(f.job,{jobs:[c],locate:f.locate});expect(r.verifiedCount).toBe(1);expect(r.best.iteration).toBe(4);
 }finally{f.dispose();}
});
test('恢复3.2分但仅比历史最佳增加1.3分必须复盘，输入和分数不改写',()=>{
 const input={comparable:true,before:{score:55.2},after:{score:58.4},historicalBest:{best:{score:57.1,jobId:'best'},verifiedCount:2}};
 const previous=JSON.stringify(input),r=repairOutcome(input);
 expect(r.comparison.delta).toBe(3.2);expect(r.comparison.gainOverBest).toBe(1.3);expect(r.scoreSignal).toBe('insufficient_gain');expect(r.requiresDiagnosis).toBe(true);
 expect(r.signals.map(s=>s.kind)).toContain('recovery_without_meaningful_new_best');expect(JSON.stringify(input)).toBe(previous);
});

test('v6相同原子契约的复评必须成为真实基线，条目变化不可混比',()=>{const f=fixture(true);try{const same=f.add('same',3.4),changed=f.add('changed',4);changed.plan.acceptanceCriteria[0].description='不同的通过要求';const r=verifiedBestScore(f.job,{jobs:[same,changed],locate:f.locate});expect(r.verifiedCount).toBe(1);expect(r.best?.jobId).toBe('same');expect(r.best?.score).toBe(same.quality.score);}finally{f.dispose();}});

test('纯复评遗留的修复选择结果不排除真实基线，生成退步仍排除',()=>{const f=fixture(true);try{const a=f.add('reeval',3.4),b=f.add('repair',4);a.validationKind='assessment-continuation';for(const c of [a,b])f.write(join(f.root,c.id,'repair-outcome.json'),{selection:{eligible:false}});const r=verifiedBestScore(f.job,{jobs:[a,b],locate:f.locate});expect(r.best?.jobId).toBe(a.id);expect(r.verifiedCount).toBe(1);expect(r.excluded[0].jobId).toBe(b.id);}finally{f.dispose();}});

test('历史评分按保存的阶段策略核对真实深度，标准档high不是xhigh路由错误',()=>{const f=fixture(true);try{
 f.job.profile.judgeModel='gpt-6-astra-aihub-openai';f.job.profile.reasoningEffort='xhigh';
 const capped=f.add('capped',3.4),wrong=f.add('wrong-depth',4),uncapped=f.add('uncapped',4);
 for(const c of [capped,wrong])c.optimizationPolicy={version:'reuse-parallel-v2',reasoning:'phase-capped',matchingLevel:'standard'};
 for(const c of [capped,wrong,uncapped])f.write(join(f.root,c.id,'judge-receipt.json'),{stopReason:'completed',cliModel:'gpt-6-astra-aihub-openai',cliReasoningEffort:c===wrong?'medium':'high',executionRoute:{configurationSha256:'route'}});
 const r=verifiedBestScore(f.job,{jobs:[capped,wrong,uncapped],locate:f.locate});
 expect(r.best?.jobId).toBe(capped.id);expect(r.verifiedCount).toBe(1);expect(r.excluded.map(e=>e.jobId).sort()).toEqual(['uncapped','wrong-depth']);
}finally{f.dispose();}});
