import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeImageGoal,IMAGE_ATTRIBUTES,imageMatchSchema} from './image-reconstruction';
import {judgeRequest} from './judge-request';
import {callValidated} from './contracts';
import {assess} from './assessment';
import {modelSchema} from './model-schema';
import {assessmentProtocolId} from './assessment-protocol';
import {SPEC,VISUAL_RULE_IDS} from './spec';
import {EVIDENCE_POLICY,HARD_CHECKS,DIMENSIONS} from './quality';
import {ROOT,UPLOADS,digest,save} from './store';
import {snapshotIteration,restoreIteration} from './geometry/iteration-snapshots';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'image-reconstruction-integration-'));for(const p of ['runtime','project/evidence','project/game/dist'])mkdirSync(join(dir,p),{recursive:true});
 const input='mock original '+crypto.randomUUID(),id=digest(input),image={id,file:id+'.png',mime:'image/png'};writeFileSync(join(UPLOADS,image.file),input);
 const frame='mock engine frame',build='mock dist';writeFileSync(join(dir,'runtime/reference-1.png'),frame);writeFileSync(join(dir,'project/game/dist/forgeax-dist.json'),build);
 const profile={engineSha:'a'.repeat(40),generatorSha:'b'.repeat(40)};
 const stages=['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'];
 save(join(dir,'project/evidence/run-report.json'),{...profile,stages:Object.fromEntries(stages.map(s=>[s,{status:'passed'}])),buildInputDigest:'d'.repeat(64),distManifestDigest:digest(build),catalog:{sha256:'e'.repeat(64)}});
 const runtime={distManifestDigest:digest(build),submittedFps:30,images:['reference-1.png'],hashes:[digest(frame)],referenceFrames:[{referenceIndex:1,file:'reference-1.png'}],hard:{...Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),video:true,cameraStopped:true}};
 const plan={requirements:[{id:'R1',text:'保持参考图主体',critical:true,weight:1,source:'image',evidence:['参考图1']}],capabilities:['consistency'],acceptanceCriteria:DIMENSIONS.map(d=>({id:'C_'+d.id,requirementId:'R1',dimension:d.id,description:d.label,source:'image',evidence:['参考图1'],critical:true,weight:1}))};
 const job:any={id:crypto.randomUUID(),pipelineVersion:{id:'fixed'},profile,policy:{...EVIDENCE_POLICY,deliveryStandard:'basic70'},prompt:'',images:[image],plan,reconstructionGoal:freezeImageGoal([image]),modelSettings:{model:'fixture',reasoningEffort:'high'},structure:{passed:true,semanticCounts:{结构:1}},stages:{build:{status:'passed'},verify:{status:'passed'}}};
 const review:any={confidence:.9,summary:'mock judgement, not a real image evaluation',specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'mock evidence',frames:runtime.images})),entityCounts:[{kind:'结构',visibleMin:1,visibleMax:1,reason:'mock'}],requirements:[{id:'R1',verdict:'met',reason:'mock',frames:runtime.images}],dimensions:DIMENSIONS.map(d=>({id:d.id,score:4.2,reason:'mock',frames:runtime.images})),criteria:plan.acceptanceCriteria.map(c=>({id:c.id,score:4.2,verdict:'met',reason:'mock',frames:runtime.images}))};
 return {dir,image,job,review,runtime,close(){rmSync(dir,{recursive:true,force:true});rmSync(join(UPLOADS,image.file),{force:true});}};
}
test('同一次judge承载原图对照；缺新报告不增加调用、不改70判定或丢弃输出',async()=>{
 const f=fixture();try{
  const request=judgeRequest(f.job,f.job.plan,f.runtime,f.dir,new AbortController().signal),input=JSON.parse(request.text);expect(request.role).toBe('judge');expect(request.maxTokens).toBe(9500);expect(input.reconstructionGoal.id).toBe(f.job.reconstructionGoal.id);expect(input.referenceViews).toEqual([{referenceIndex:1,file:'reference-1.png',sha256:f.runtime.hashes[0]}]);
  let calls=0;const result=await callValidated(request,f.dir,v=>assess(f.job,v,f.runtime),async()=>{calls++;return {value:f.review,receipt:{fixture:true}} as any;});
  expect(calls).toBe(1);expect(result.value.status).toBe('passed');expect(result.value.deliveryAssessment.status).toBe('passed');expect(result.value.imageReconstruction.status).toBe('needs_review');
  const r=structuredClone(f.review);r.referenceMatch=[{referenceIndex:1,referenceSha256:f.image.id,frames:f.runtime.images,attributes:Object.fromEntries(IMAGE_ATTRIBUTES.map(a=>[a.id,{status:a.id==='layout'?'major_difference':'close',reason:'mock visible difference'}]))}];
  const changed=assess(f.job,r,f.runtime);expect(changed.status).toBe(result.value.status);expect(changed.quality).toEqual(result.value.quality);expect(changed.imageReconstruction.status).toBe('failed');
  const legacy={...f.job};delete legacy.reconstructionGoal;expect(assess(legacy,f.review,f.runtime).imageReconstruction).toBeUndefined();
  expect(SPEC.evaluatorCalibration).toBe('not-certified');
 }finally{f.close();}
});
test('目标校验和截图摘要在调用前执行；新增judge结构进入协议指纹',()=>{
 const f=fixture();try{
  expect(modelSchema('judge',{qualityVersion:'scene-quality-v7',imageGoal:true}).properties.referenceMatch).toEqual(imageMatchSchema());
  expect(modelSchema('judge',{qualityVersion:'scene-quality-v7'}).properties.referenceMatch).toBeUndefined();
  expect(assessmentProtocolId()).toMatch(/^[a-f0-9]{64}$/);expect(assessmentProtocolId()).not.toBe('859250e7f00c799e1b9bdcd66249b2df1eac149ff6df8df9da6012369b0ddb26');
  expect(()=>judgeRequest({...f.job,images:[{...f.image,id:'f'.repeat(64)}]},f.job.plan,f.runtime,f.dir,new AbortController().signal)).toThrow('不一致');
  writeFileSync(join(f.dir,'runtime/reference-1.png'),'tampered frame');expect(()=>judgeRequest(f.job,f.job.plan,f.runtime,f.dir,new AbortController().signal)).toThrow('摘要');
 }finally{f.close();}
});
test('仅改变独立目标契约也必须改变assessmentProtocolId，不能复用旧评审协议',()=>{
 const parent=mkdtempSync(join(tmpdir(),'image-goal-protocol-')),copy=join(parent,'workbench');mkdirSync(copy);
 try{
  cpSync(join(ROOT,'src'),join(copy,'src'),{recursive:true});cpSync(join(ROOT,'spec'),join(copy,'spec'),{recursive:true});
  const run=()=>{const p=Bun.spawnSync(['bun','-e',"import {assessmentProtocolId} from './src/assessment-protocol.ts';process.stdout.write(assessmentProtocolId());"],{cwd:copy,env:{...process.env,PIPELINE_DATA_DIR:join(parent,'test-data')}});if(p.exitCode)throw Error(new TextDecoder().decode(p.stderr));return new TextDecoder().decode(p.stdout);};
  const before=run(),file=join(copy,'src/image-reconstruction.ts');writeFileSync(file,readFileSync(file,'utf8').replace('尽量复现全部原始参考图','尽量复现全部已冻结原始参考图'));
  expect(run()).not.toBe(before);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('恢复最佳候选时原图报告和截图一起恢复，不能展示后来失败轮的证据',()=>{
 const f=fixture();try{
  const good={version:'image-reconstruction-v1',goalId:f.job.reconstructionGoal.id,distManifestDigest:f.runtime.distManifestDigest,status:'passed',references:[]};f.job.imageReconstruction=good;save(join(f.dir,'image-reconstruction.json'),good);save(join(f.dir,'reconstruction-goal.json'),f.job.reconstructionGoal);
  snapshotIteration(f.dir,f.job,{index:0,status:'passed',score:84,startedAt:1,endedAt:2});f.job.imageReconstruction={...good,status:'failed'};save(join(f.dir,'image-reconstruction.json'),f.job.imageReconstruction);writeFileSync(join(f.dir,'runtime/reference-1.png'),'bad candidate');
  restoreIteration(f.dir,f.job,0);expect(f.job.imageReconstruction).toEqual(good);expect(f.job.reconstructionGoal.id).toBe(good.goalId);
 }finally{f.close();}
});
