import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,save,read} from './store';
import {deliveryInfo,preserveOutput,failureDisposition,sealAssessment,inspectOutput} from './output-delivery';
import {snapshotIteration} from './geometry/iteration-snapshots';
import {deliveryHTML} from '../public/delivery-ui.js';
import {freezeImageGoal,assessImageReconstruction,IMAGE_ATTRIBUTES} from './image-reconstruction';
import {imageReconstructionHTML} from '../public/image-reconstruction-ui.js';
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

function imageScored(f:ReturnType<typeof fixture>,difference='major_difference'){
 scored(f,'passed');f.job.prompt='';f.job.images=[{id:'a'.repeat(64)}];f.job.reconstructionGoal=freezeImageGoal(f.job.images);
 f.job.runtime.referenceFrames=[{referenceIndex:1,file:'view.png'}];save(join(f.root,'runtime/runtime.json'),f.job.runtime);
 const review={referenceMatch:[{referenceIndex:1,referenceSha256:f.job.images[0].id,frames:['view.png'],attributes:Object.fromEntries(IMAGE_ATTRIBUTES.map(a=>[a.id,{status:a.id==='shape'?difference:'close',reason:'fixture evidence'}]))}]};
 save(join(f.root,'review.json'),review);save(join(f.root,'reconstruction-goal.json'),f.job.reconstructionGoal);
 f.job.imageReconstruction=assessImageReconstruction(f.job,review,f.job.runtime).imageReconstruction;save(join(f.root,'image-reconstruction.json'),f.job.imageReconstruction);
 f.job.deliveryAssessment={standard:'basic70',status:'passed',score:85.2,rawScore:80};sealAssessment(f.job,f.root);
}
test('70通过与原图明显不同分别交付，独立报告连同回执封存',()=>{
 const f=fixture();try{
  imageScored(f);const saved=preserveOutput(f.job,f.root,'','scene')!;
  expect(saved.deliveryStatus).toBe('passed');expect(saved.imageReconstruction.status).toBe('failed');
  expect(saved.imageReconstructionFile).toBe(saved.folder+'/image-reconstruction.json');
  const evidence=read(join(f.root,saved.folder,'assessment-evidence.json'));expect(evidence.files['image-reconstruction.json']).toBe(digest(readFileSync(join(f.root,saved.folder,'image-reconstruction.json'))));
  writeFileSync(join(f.root,'runtime/view.png'),'damaged root');const d=deliveryInfo(f.job,f.root);
  expect(d.best?.folder).toBe(saved.folder);expect(d.best?.imageReconstruction).toEqual(saved.imageReconstruction);
  expect(imageReconstructionHTML({...f.job,delivery:d})).toContain('存在明显差异');
 }finally{f.cleanup();}
});
test('缺少或改写原图侧车不丢弃场景也不改变70结果，且不冒称一致',()=>{
 for(const defect of ['missing-report','goal','report','frame-hash','dist','scope','status']){
  const f=fixture();try{
   imageScored(f,'close');const report=read(join(f.root,'image-reconstruction.json'));
   if(defect==='missing-report')rmSync(join(f.root,'image-reconstruction.json'));
   if(defect==='goal'){const goal=read(join(f.root,'reconstruction-goal.json'));goal.references[0].sha256='b'.repeat(64);save(join(f.root,'reconstruction-goal.json'),goal);}
   if(defect==='report'){report.references[0].attributes.shape.reason='changed';save(join(f.root,'image-reconstruction.json'),report);}
   if(defect==='frame-hash')report.references[0].frameHashes[0].sha256='b'.repeat(64);
   if(defect==='dist')report.distManifestDigest='b'.repeat(64);
   if(defect==='scope')report.scope='partial';
   if(defect==='status')report.status='failed';
   // Even sealing an internally inconsistent report cannot make its attribution valid.
   if(['frame-hash','dist','scope','status'].includes(defect)){save(join(f.root,'image-reconstruction.json'),report);sealAssessment(f.job,f.root);}
   const checked=inspectOutput(f.job,f.root,'','scene')!;
   expect(checked.deliveryStatus).toBe('passed');expect(checked.imageReconstruction.status).toBe('needs_review');expect(checked.imageReconstructionFile).toBeNull();
  }finally{f.cleanup();}
 }
});
test('报告缺失的草稿和历史输出保持未核实，不借用其他轮原图报告',()=>{
 const f=fixture();try{
  scored(f);expect(inspectOutput(f.job,f.root,'','scene')?.imageReconstruction).toBeNull();
  imageScored(f,'close');snapshotIteration(f.root,f.job,{index:0,status:'passed',score:85.2,startedAt:1,endedAt:2});
  f.job.selectedIteration=0;f.job.imageReconstruction={...f.job.imageReconstruction,status:'failed',level:'major_differences'};save(join(f.root,'image-reconstruction.json'),f.job.imageReconstruction);
  const best=deliveryInfo(f.job,f.root).best!;expect(best.folder).toBe('iterations/0');expect(best.imageReconstruction.status).toBe('passed');
  expect(imageReconstructionHTML({...f.job,delivery:{best}})).toContain('/iterations/0/image-reconstruction.json');
  const review=read(join(f.root,'review.json'));review.referenceMatch=null;save(join(f.root,'review.json'),review);
  f.job.partialOutput={completed:1,total:2,missing:[{id:'x'}]};f.job.imageReconstruction=assessImageReconstruction(f.job,review,f.job.runtime).imageReconstruction;save(join(f.root,'image-reconstruction.json'),f.job.imageReconstruction);sealAssessment(f.job,f.root);
  const partial=inspectOutput(f.job,f.root,'','scene')!;expect(partial.kind).toBe('partial');expect(partial.imageReconstruction).toMatchObject({status:'needs_review',scope:'partial'});expect(partial.imageReconstructionFile).toBe('image-reconstruction.json');
 }finally{f.cleanup();}
});

function evaluatedGrayboxes(){
 const f=fixture('generation/blockout/0');
 f.job.blockout={rounds:[],repairBasis:null};
 for(const round of [0,1,2]){
  const folder='generation/blockout/'+round,base=join(f.root,folder);
  if(round)cpSync(f.dir,base,{recursive:true});
  const manifest=JSON.stringify({engine:'ForgeaX',round}),hash=digest(manifest);
  writeFileSync(join(base,'project/game/dist/forgeax-dist.json'),manifest);
  const runtime=read(join(base,'runtime/runtime.json')),report=read(join(base,'project/evidence/run-report.json'));
  runtime.distManifestDigest=hash;report.distManifestDigest=hash;
  save(join(base,'runtime/runtime.json'),runtime);save(join(base,'project/evidence/run-report.json'),report);
  const proof={jobId:f.job.id,round,folder:base,score:round===1?3.4:3.2,passed:false,runtimeDigest:hash};
  const gate={round,passed:false,review:{score:proof.score,confidence:.9},runtimeDigest:hash,
   selection:{eligible:true,changed:round<2,retained:round<2?proof:f.job.blockout.repairBasis}};
  save(join(base,'gate.json'),gate);f.job.blockout.rounds.push(gate);
  if(round<2)f.job.blockout.repairBasis=proof;
  preserveOutput(f.job,f.root,folder,'graybox');
 }
 return f;
}
test('灰模交付遵从已核验保留候选，预览截图和下载项目指向同一轮',()=>{
 const f=evaluatedGrayboxes();try{for(const status of ['running','failed','blocked','cancelled']){
  f.job.status=status;const d=deliveryInfo(f.job,f.root);
  expect(d.best).toMatchObject({kind:'graybox',folder:'generation/blockout/1',project:'generation/blockout/1/project',score:null,qualityStatus:'not_assessed'});
  expect(d.best?.distManifestDigest).toBe(f.job.blockout.repairBasis.runtimeDigest);
  expect(d.selection).toMatchObject({status:'selected',requestedBlockout:{jobId:f.job.id,round:1},servedBlockout:1});
  const html=deliveryHTML({...f.job,delivery:d});expect(html).toContain('generation/blockout/1/runtime/view.png');
  expect(html).toContain('未完成成品评分');expect(html).not.toContain('正式验收通过');
 }}finally{f.cleanup();}
});
test('灰模保留候选证据异常时仅交付可运行备份并明确未重新选优',()=>{
 for(const defect of ['image','gate-missing','gate-score','proof-digest','unselected-round','foreign-job','path']){
  const f=evaluatedGrayboxes();try{
   const basis=f.job.blockout.repairBasis,path=join(f.root,'generation/blockout/1/gate.json');
   if(defect==='image')writeFileSync(join(f.root,'generation/blockout/1/runtime/view.png'),'corrupt');
   if(defect==='gate-missing')rmSync(path);
   if(defect==='gate-score'){const gate=read(path);gate.review.score=5;save(path,gate);}
   if(defect==='proof-digest')basis.runtimeDigest='other';
   if(defect==='unselected-round')f.job.blockout.repairBasis={...basis,round:2,folder:join(f.root,'generation/blockout/2'),score:3.2,runtimeDigest:read(join(f.root,'generation/blockout/2/gate.json')).runtimeDigest};
   if(defect==='foreign-job')basis.jobId='different-job';
   if(defect==='path')basis.folder=join(f.root,'..','other');
   const before=JSON.stringify(f.job),d=deliveryInfo(f.job,f.root);
   expect(d.available).toBe(true);expect(d.selection.status).toBe('fallback');
   expect(d.selection.reason).toContain('不代表重新选优');expect(JSON.stringify(f.job)).toBe(before);
   expect(d.best?.score).toBeNull();
  }finally{f.cleanup();}
 }
});
test('灰模不能取代完整或部分详细场景，历史无选优记录仍可查看',()=>{
 const f=evaluatedGrayboxes();try{
  const copy=(name:string)=>cpSync(join(f.dir,name),join(f.root,name),{recursive:true});
  copy('project');copy('runtime');
  expect(deliveryInfo(f.job,f.root).best?.kind).toBe('scene');
  f.job.partialOutput={completed:1,total:2,missing:[{id:'other'}]};
  expect(deliveryInfo(f.job,f.root).best?.kind).toBe('partial');
  rmSync(join(f.root,'runtime'),{recursive:true});delete f.job.blockout;
  expect(deliveryInfo(f.job,f.root).selection.status).toBe('available');
 }finally{f.cleanup();}
});
test('灰模选优兼容同一任务目录的真实路径和符号链接，不接受非法轮次',()=>{
 const f=evaluatedGrayboxes(),aliases=mkdtempSync(join(tmpdir(),'output-alias-'));
 try{
  const alias=join(aliases,'run');symlinkSync(f.root,alias,'dir');
  expect(deliveryInfo(f.job,alias).selection.status).toBe('selected');
  for(const round of [-1,.5,Infinity,'../other',Number.MAX_SAFE_INTEGER+1]){
   f.job.blockout.repairBasis.round=round;
   expect(deliveryInfo(f.job,f.root).selection.status).toBe('available');
  }
 }finally{rmSync(aliases,{recursive:true,force:true});f.cleanup();}
});
