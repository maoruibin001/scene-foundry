import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,save,read} from './store';
import {deliveryInfo,preserveOutput,failureDisposition,sealAssessment,inspectOutput} from './output-delivery';
import {snapshotIteration} from './geometry/iteration-snapshots';
import {deliveryHTML} from '../public/delivery-ui.js';
function fixture(folder=''){
 const root=mkdtempSync(join(tmpdir(),'output-contract-')),dir=join(root,folder);for(const p of ['runtime','project/game/dist','project/evidence'])mkdirSync(join(dir,p),{recursive:true});
 const job:any={id:'job',status:'running',stage:'assets',profile:{engineSha:'engine',generatorSha:'generator'},pipelineVersion:{id:'v1'}};
 const manifest='{"engine":"ForgeaX"}',image='actual-render-evidence';writeFileSync(join(dir,'project/game/dist/forgeax-dist.json'),manifest);writeFileSync(join(dir,'runtime/view.png'),image);
 save(join(dir,'runtime/runtime.json'),{distManifestDigest:digest(manifest),hard:{runtime:true,noErrors:true,entitiesLoaded:true,framing:false},images:['view.png'],hashes:[digest(image)]});save(join(dir,'project/evidence/run-report.json'),{engineSha:'engine',generatorSha:'generator',distManifestDigest:digest(manifest),stages:Object.fromEntries(['engine-build','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))});return {root,dir,job,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('灰模可运行即交付，之后模型中断也不假称成品评分通过',()=>{const f=fixture('generation/blockout/0');try{f.job.status='blocked';f.job.error='PROVIDER_HTTP_402 insufficient_quota';const d=deliveryInfo(f.job,f.root);expect(d.available).toBe(true);expect(d.best?.kind).toBe('graybox');expect(d.best?.score).toBeNull();expect(d.best?.hardChecks.framing).toBe(false);expect(d.execution.fault?.kind).toBe('external');expect(deliveryHTML({...f.job,delivery:d})).toContain('未完成成品评分');}finally{f.cleanup()}});
test('评审失败前保留真实成品快照；修正破坏当前产物仍可打开旧输出',()=>{const f=fixture();try{expect(preserveOutput(f.job,f.root,'','scene')).not.toBeNull();writeFileSync(join(f.dir,'project/game/dist/forgeax-dist.json'),'broken');f.job.status='failed';f.job.error='judge unavailable';const d=deliveryInfo(f.job,f.root);expect(d.available).toBe(true);expect(d.best?.folder).toStartWith('delivery/outputs/scene-');expect(d.best?.qualityStatus).toBe('not_assessed');expect(d.best?.score).toBeNull();}finally{f.cleanup()}});
test('图像/构建摘要损坏不提供运行成功入口',()=>{for(const path of ['runtime/view.png','project/game/dist/forgeax-dist.json']){const f=fixture();try{writeFileSync(join(f.root,path),'corrupt');expect(deliveryInfo(f.job,f.root).available).toBe(false);}finally{f.cleanup()}}});
test('没有真实输出的早期失败明确称为交付失败',()=>{const f=fixture();try{rmSync(join(f.root,'runtime/runtime.json'));f.job.status='failed';const d=deliveryInfo(f.job,f.root);expect(d.state).toBe('unavailable');expect(deliveryHTML({...f.job,delivery:d})).toContain('交付失败');}finally{f.cleanup()}});
test('部分草稿即使存在旧评分也不能显示为成品通过',()=>{const f=fixture();try{f.job.partialOutput={missing:[{id:'wall',label:'墙'}],completed:1,total:2};save(join(f.root,'quality.json'),{status:'passed',score:99});const d=deliveryInfo(f.job,f.root);expect(d.best?.kind).toBe('partial');expect(d.best?.score).toBeNull();expect(d.best?.qualityStatus).toBe('not_assessed');}finally{f.cleanup()}});
test('输出路径和图片链接不可逃逸任务目录',()=>{const f=fixture(),external=mkdtempSync(join(tmpdir(),'outside-output-'));try{writeFileSync(join(external,'x'),'x');symlinkSync(join(external,'x'),join(f.root,'runtime/out.png'));const r=read(join(f.root,'runtime/runtime.json'));r.images=['out.png'];r.hashes=[digest('x')];save(join(f.root,'runtime/runtime.json'),r);expect(deliveryInfo(f.job,f.root).available).toBe(false);}finally{f.cleanup();rmSync(external,{recursive:true,force:true})}});
test('预算限制不称为外部不可抗力，工具契约错误归管线配置',()=>{expect(failureDisposition('MODEL_BUDGET_EXHAUSTED').kind).toBe('budget');expect(failureDisposition('本角色禁止修复工具').kind).toBe('configuration');expect(failureDisposition('PROVIDER_RECOVERY_EXHAUSTED PROVIDER_TIMEOUT').retryable).toBe(false);expect(failureDisposition('PROVIDER_HTTP_503').retryable).toBe(true)});
function scored(f:ReturnType<typeof fixture>,status='failed'){
 const report=read(join(f.root,'project/evidence/run-report.json')),runtime=read(join(f.root,'runtime/runtime.json')),spec={status:'passed',rules:[]};
 report.spec=spec;report.browser={distManifestDigest:report.distManifestDigest};save(join(f.root,'project/evidence/run-report.json'),report);
 save(join(f.root,'spec-report.json'),spec);save(join(f.root,'quality.json'),{status:'passed',score:85.2});save(join(f.root,'review.json'),{summary:'真实草稿'});
 runtime.hard.framing=true;save(join(f.root,'runtime/runtime.json'),runtime);f.job.runtime=runtime;f.job.status=status;f.job.quality=read(join(f.root,'quality.json'));
}
test('真实已评草稿展示分数与范围，永不显示正式通过',()=>{const f=fixture();try{scored(f,'needs_review');f.job.partialOutput={completed:1,total:2,missing:[{id:'wall',label:'墙'}]};sealAssessment(f.job,f.root);const d=deliveryInfo(f.job,f.root);expect(d.best).toMatchObject({kind:'partial',score:85.2,assessmentScope:'partial',qualityStatus:'partial_assessed'});const html=deliveryHTML({...f.job,delivery:d});expect(html).toContain('草稿已评分');expect(html).toContain('85.2');expect(html).not.toContain('正式验收通过');}finally{f.cleanup()}});
test('评分后冻结结果；后续产物损坏仍可恢复同一份真实评分，早期快照不覆盖',()=>{const f=fixture();try{const before=preserveOutput(f.job,f.root,'','scene');scored(f);const contacts={status:'checked',checks:[{status:'gap'}]};save(join(f.root,'spatial-contacts.json'),contacts);sealAssessment(f.job,f.root);const after=preserveOutput(f.job,f.root,'','scene');expect(read(join(f.root,after!.folder,'spatial-contacts.json'))).toEqual(contacts);expect(after?.score).toBe(85.2);expect(after?.folder).not.toBe(before?.folder);expect(inspectOutput(f.job,f.root,before!.folder,'scene')?.score).toBeNull();writeFileSync(join(f.root,'project/game/dist/forgeax-dist.json'),'broken');const d=deliveryInfo(f.job,f.root);expect(d.best?.score).toBe(85.2);expect(d.best?.folder).toBe(after?.folder);}finally{f.cleanup()}});
test('改动评分文件不沿用旧证据，真实可运行输出仍交付',()=>{const f=fixture();try{scored(f);sealAssessment(f.job,f.root);save(join(f.root,'quality.json'),{status:'passed',score:99});const d=deliveryInfo(f.job,f.root);expect(d.available).toBe(true);expect(d.best?.score).toBeNull();expect(d.best?.assessmentError).toContain('不匹配');}finally{f.cleanup()}});
test('快照恢复后保留草稿身份，不能被 iterations 目录误升成完整成品',()=>{const f=fixture();try{scored(f,'needs_review');f.job.partialOutput={completed:1,total:2,missing:[{id:'wall'}]};sealAssessment(f.job,f.root);snapshotIteration(f.root,f.job,{index:0,score:85.2,status:'needs_review'} as any);delete f.job.partialOutput;rmSync(join(f.root,'runtime/runtime.json'));const best=deliveryInfo(f.job,f.root).best;expect(best).toMatchObject({kind:'partial',folder:'iterations/0',score:85.2,qualityStatus:'partial_assessed'});}finally{f.cleanup()}});
test('正式通过须同时保留最终判定；运行结束取消不抹掉此前合格快照',()=>{const f=fixture();try{scored(f,'needs_review');sealAssessment(f.job,f.root);expect(deliveryInfo(f.job,f.root).best?.qualityStatus).toBe('not_met');f.job.status='passed';sealAssessment(f.job,f.root);const saved=preserveOutput(f.job,f.root,'','scene');expect(saved?.qualityStatus).toBe('passed');f.job.status='cancelled';writeFileSync(join(f.root,'runtime/view.png'),'corrupt');expect(deliveryInfo(f.job,f.root).best?.qualityStatus).toBe('passed');}finally{f.cleanup()}});

function evaluatedPair(){
 const f=fixture();scored(f);sealAssessment(f.job,f.root);
 snapshotIteration(f.root,f.job,{index:0,score:85.2,status:'failed',startedAt:1,endedAt:2});
 f.job.quality={status:'failed',score:93.4,criticalMissing:['new-obstruction']};save(join(f.root,'quality.json'),f.job.quality);sealAssessment(f.job,f.root);
 snapshotIteration(f.root,f.job,{index:1,score:93.4,status:'failed',startedAt:3,endedAt:4,selection:{eligible:false,reasons:['新增关键未完成项']}});
 f.job.visualIterations={bestIndex:0};return f;
}
test('更高分但退步的候选不能覆盖选优画面、评分与导出路径',()=>{
 const f=evaluatedPair();try{for(const state of ['running','failed','cancelled']){
  f.job.status=state;const d=deliveryInfo(f.job,f.root);expect(d.best).toMatchObject({folder:'iterations/0',project:'iterations/0/project',score:85.2});
  expect(d.selection).toMatchObject({status:'selected',requestedIteration:0,servedIteration:0});
  expect(deliveryHTML({...f.job,delivery:d})).toContain('iterations/0/runtime/view.png');
  expect(read(join(f.root,'iterations/1/quality.json')).score).toBe(93.4);
 }}finally{f.cleanup();}
});
test('保留候选快照失效时仍有可运行输出，但明确提示未重新选优',()=>{
 for(const defect of ['image','identity','score','manifest']){
  const f=evaluatedPair();try{
   const path=join(f.root,'iterations/0/candidate.json'),snapshot=read(path);
   if(defect==='image')writeFileSync(join(f.root,'iterations/0/runtime/view.png'),'corrupt');
   if(defect==='identity')snapshot.jobId='other';
   if(defect==='score')snapshot.cycle.score=99;
   if(defect==='manifest')snapshot.fields.runtime.distManifestDigest='other';
   save(path,snapshot);const d=deliveryInfo(f.job,f.root);
   expect(d.available).toBe(true);expect(d.selection.status).toBe('fallback');
   expect(deliveryHTML({...f.job,delivery:d})).toContain('不代表重新选优');
   expect(f.job.visualIterations.bestIndex).toBe(0);
  }finally{f.cleanup();}
 }
});
test('缺少或非法选优索引不构造路径；按真实交付证据保留输出',()=>{
 const f=evaluatedPair();try{delete f.job.visualIterations;
  for(const index of [undefined,-1,0.5,Infinity,'../other',Number.MAX_SAFE_INTEGER+1]){
   f.job.selectedIteration=index;const d=deliveryInfo(f.job,f.root);expect(d.available).toBe(true);expect(d.selection.status).toBe('available');
  }
 }finally{f.cleanup();}
});

test('基础交付回执与运行证据一起冻结，不伪造完整规范通过，篡改会失效',()=>{
 const f=fixture();try{
  scored(f,'passed');const q={status:'failed',score:75.8};save(join(f.root,'quality.json'),q);f.job.quality=q;
  f.job.deliveryAssessment={standard:'basic70',status:'passed',score:75.8,rawScore:70.64,strictStatus:'failed'};
  sealAssessment(f.job,f.root);const saved=preserveOutput(f.job,f.root,'','scene')!;
  expect(saved).toMatchObject({deliveryStandard:'basic70',deliveryStatus:'passed',qualityStatus:'not_met'});
  expect(read(join(f.root,saved.folder,'delivery-assessment.json'))).toEqual(f.job.deliveryAssessment);
  expect(deliveryHTML({...f.job,delivery:deliveryInfo(f.job,f.root)})).toContain('70分基础交付通过');
  save(join(f.root,'delivery-assessment.json'),{...f.job.deliveryAssessment,rawScore:99});
  expect(inspectOutput(f.job,f.root,'','scene')?.deliveryStatus).toBeNull();
 }finally{f.cleanup();}
});
