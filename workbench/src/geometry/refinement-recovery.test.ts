import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {digest,save,read} from '../store';
import {hasSavedRefinement,freezeSavedRefinement,validateSavedRefinement} from './refinement-recovery';
import {recoveryInfo} from '../recovery';
import {repairBudget} from './repair-budget';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'saved-refinement-')),sourceId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',dir=join(root,id),sourceDir=join(root,sourceId),folder=join(dir,'generation/refinement');
 mkdirSync(folder,{recursive:true});mkdirSync(join(sourceDir,'runtime'),{recursive:true});const image=join(root,'input.png');writeFileSync(image,'reference image');const ref=digest(readFileSync(image));writeFileSync(join(sourceDir,'runtime/reference-1.png'),'actual capture');
 const plan={requirements:[{id:'R1',critical:true,count:null}]},source:any={version:'scene-v1',spatialOpenings:[],program:{version:'geometry-v1',name:'通用场景',materials:[{id:'surface',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'object',parts:[{...pose,id:'part',material:'surface',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'main',label:'主体',template:'object',requirementIds:['R1']}]},entities:[{instanceId:'main',role:'subject',category:'主体'}],textures:[],textureReuse:[],cameras:[{name:'参考',referenceIndex:1,position:[3,-4,2],target:[0,0,0],fov:1},{name:'检查',referenceIndex:null,position:[-3,4,2],target:[0,0,0],fov:1}],lighting:{direction:[.5,.5,-.7],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]},assumptions:[]};
 const policy={score:90},modelSettings={model:'test-model',reasoningEffort:'xhigh'},profile={provider:'codex-cli',judgeModel:'test-model',reasoningEffort:'xhigh',specSha256:'spec',policy,engineSha:'engine',generatorSha:'generator'};
 const job:any={id,status:'failed',stage:'generate',refineScene:true,refinementMode:'general',reuseSceneFrom:sourceId,prompt:'移动主体，保留空间',complexity:'simple',images:[{id:ref,mime:'image/png',file:'input.png'}],policy,modelSettings,profile};
 const patch={version:'scene-refinement-v1',reason:'校正主体位置',instances:[{...source.program.instances[0],position:[.2,0,0]}],cameras:[],materials:[],parts:[],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]};
 const goal={version:'scene-repair-goals-v1',summary:'校正布局',goals:[{id:'G1',kind:'layout',dimension:'spatial',problem:'位置偏差',whyPriority:'影响整体关系',expectedChange:'主体向右微调',requirementIds:['R1'],instanceIds:['main'],templateIds:[],materialIds:[],cameraNames:[],openingIds:[],addGeometry:false,evidence:[{frame:'reference-1.png',referenceIndex:1,region:[0,0,1,1],observation:'当前主体位置偏左'}]}],deferred:[]};
 const frameHash=digest(readFileSync(join(sourceDir,'runtime/reference-1.png')));
 for(const [f,v] of Object.entries({'job.json':job,'plan.json':plan,'generation/refinement/source.json':{sourceJobId:sourceId,sourceIteration:null,sourceDigest:digest(JSON.stringify(source)),referenceSha256:[ref],frameNames:['reference-1.png'],qualityBefore:{score:60},originalQuality:{score:60}},'generation/refinement/repair-goals.json':goal,'generation/refinement/scene-refine-parsed.json':patch,'generation/refinement/scene-refine-receipt.json':{role:'scene-refine',stopReason:'completed',requestedModel:modelSettings.model,requestedReasoning:modelSettings.reasoningEffort},'generation/refinement/scene-refine-execution.json':{status:'completed',exitCode:0,endedAt:'2026-09-24T00:00:00Z'},'generation/refinement/scene-refine-input-receipt.json':{requestedModel:modelSettings.model,requestedReasoning:modelSettings.reasoningEffort,images:[{sha256:ref,mime:'image/png'},{sha256:frameHash,mime:'image/png'}]}})){mkdirSync(dirname(join(dir,f)),{recursive:true});save(join(dir,f),v);}
 writeFileSync(join(folder,'scene-refine-response.txt'),JSON.stringify(patch));save(join(sourceDir,'generated-scene.json'),source);save(join(sourceDir,'runtime/runtime.json'),{images:['reference-1.png'],hashes:[frameHash]});
 return {root,job,target:{...job,id:'33333333-3333-4333-8333-333333333333'},dir,folder,sourceDir,plan,source,patch,images:[{path:image,mime:'image/png'}],locate:(i:string)=>join(root,i)};
}
test('完整修改可从正常恢复入口重验，来源及失败记录不被改写',()=>{const f=fixture();try{
 const before=readFileSync(join(f.dir,'job.json'),'utf8');expect(hasSavedRefinement(f.job,f.dir)).toBe(true);expect(recoveryInfo(f.job,[],undefined,f.dir).mode).toBe('refinement-output');
 const r=validateSavedRefinement(freezeSavedRefinement(f.job,f.dir),f.target,f.plan,f.images,f.locate);expect(r.next.program.instances[0].position).toEqual([.2,0,0]);expect(r.next.cameras).toEqual(f.source.cameras);expect(readFileSync(join(f.dir,'job.json'),'utf8')).toBe(before);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('新版编辑额度与新增可见性图片在手动恢复时完整校验',()=>{const f=fixture();try{
 const patch={...f.patch,version:'scene-refinement-v3',removeInstances:[]};save(join(f.folder,'scene-refine-parsed.json'),patch);writeFileSync(join(f.folder,'scene-refine-response.txt'),JSON.stringify(patch));
 const meta=read(join(f.folder,'source.json'));meta.repairBudget=repairBudget('simple');save(join(f.folder,'source.json'),meta);
 writeFileSync(join(f.folder,'visibility-1.png'),'saved geometry diagnostic');save(join(f.folder,'visibility.json'),{source:'compiled geometry'});
 const diagnostic={file:'visibility-1.png',sha256:digest(readFileSync(join(f.folder,'visibility-1.png'))),actualFrame:'reference-1.png',actualFrameSha256:digest(readFileSync(join(f.sourceDir,'runtime/reference-1.png')))};
 const context={diagnosticImages:[diagnostic]};save(join(f.folder,'visibility-context.json'),context);
 save(join(f.folder,'visibility-receipt.json'),{sourceProgramSha256:digest(JSON.stringify(f.source.program)),sourceCamerasSha256:digest(JSON.stringify(f.source.cameras)),reportSha256:digest(readFileSync(join(f.folder,'visibility.json'))),contextSha256:digest(JSON.stringify(context)),images:[diagnostic]});
 const input=read(join(f.folder,'scene-refine-input-receipt.json'));input.images.push({sha256:diagnostic.sha256,mime:'image/png'});save(join(f.folder,'scene-refine-input-receipt.json'),input);
 const snapshot=freezeSavedRefinement(f.job,f.dir);expect(validateSavedRefinement(snapshot,f.target,f.plan,f.images,f.locate).next.program.instances[0].position).toEqual([.2,0,0]);
 writeFileSync(join(f.folder,'visibility-1.png'),'changed');expect(()=>validateSavedRefinement(snapshot,f.target,f.plan,f.images,f.locate)).toThrow('发生变化');
 writeFileSync(join(f.folder,'visibility-1.png'),'saved geometry diagnostic');meta.repairBudget=repairBudget('complex');save(join(f.folder,'source.json'),meta);
 expect(()=>validateSavedRefinement(freezeSavedRefinement(f.job,f.dir),f.target,f.plan,f.images,f.locate)).toThrow('编辑额度与复杂度不一致');
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('恢复拒绝已冻结输出、参考图片和来源场景被改写，不消耗模型修正次数',()=>{for(const target of ['patch','image','scene']){const f=fixture();try{
 const snapshot=freezeSavedRefinement(f.job,f.dir);if(target==='patch')save(join(f.folder,'scene-refine-parsed.json'),{});if(target==='image')writeFileSync(f.images[0].path,'changed');if(target==='scene')save(join(f.sourceDir,'generated-scene.json'),{...f.source,assumptions:['changed']});
 expect(()=>validateSavedRefinement(snapshot,f.target,f.plan,f.images,f.locate)).toThrow(/变化|摘要不符/);
 }finally{rmSync(f.root,{recursive:true,force:true});}}});
test('恢复不继承不同政策或模型基线，不接受被取消的半份输出或解析分歧',()=>{for(const target of ['policy','model','trace','parsed']){const f=fixture();try{
 if(target==='policy')f.target.policy={score:80};if(target==='model')f.target.modelSettings={model:'other',reasoningEffort:'xhigh'};
 if(target==='trace')save(join(f.folder,'scene-refine-execution.json'),{status:'cancelled',endedAt:'2026-09-24T00:00:00Z'});
 if(target==='parsed')save(join(f.folder,'scene-refine-parsed.json'),{...f.patch,reason:'modified'});
 expect(()=>validateSavedRefinement(freezeSavedRefinement(f.job,f.dir),f.target,f.plan,f.images,f.locate)).toThrow();
 }finally{rmSync(f.root,{recursive:true,force:true});}}});
test('完整输出依然接受当前几何和目标范围检查，存在文件不代表通过',()=>{const f=fixture();try{
 const patch={...f.patch,cameras:[{...f.source.cameras[0],position:[4,-4,2]}]};save(join(f.folder,'scene-refine-parsed.json'),patch);writeFileSync(join(f.folder,'scene-refine-response.txt'),JSON.stringify(patch));
 expect(()=>validateSavedRefinement(freezeSavedRefinement(f.job,f.dir),f.target,f.plan,f.images,f.locate)).toThrow('未选择的cameraNames');
 rmSync(join(f.folder,'scene-refine-input-receipt.json'));expect(hasSavedRefinement(f.job,f.dir)).toBe(false);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('新版实例移除可以重验恢复，保留原场景且不能借恢复越过目标范围',()=>{const f=fixture();try{
 f.source.program.instances.push({...f.source.program.instances[0],id:'duplicate',position:[2,0,0]});f.source.entities.push({...f.source.entities[0],instanceId:'duplicate'});
 save(join(f.sourceDir,'generated-scene.json'),f.source);const meta=read(join(f.folder,'source.json'));meta.sourceDigest=digest(JSON.stringify(f.source));save(join(f.folder,'source.json'),meta);
 const patch={...f.patch,version:'scene-refinement-v2',instances:[],removeInstances:[{instanceId:'duplicate',reason:'参考仅一组主体，额外实例遮挡通道'}]};
 save(join(f.folder,'scene-refine-parsed.json'),patch);writeFileSync(join(f.folder,'scene-refine-response.txt'),JSON.stringify(patch));
 const goals=read(join(f.folder,'repair-goals.json'));goals.goals[0].instanceIds=['duplicate'];save(join(f.folder,'repair-goals.json'),goals);
 const before=readFileSync(join(f.sourceDir,'generated-scene.json'),'utf8'),snapshot=freezeSavedRefinement(f.job,f.dir),r=validateSavedRefinement(snapshot,f.target,f.plan,f.images,f.locate);
 expect(r.next.program.instances.map((i:any)=>i.id)).toEqual(['main']);expect(r.next.entities.map((e:any)=>e.instanceId)).toEqual(['main']);expect(r.next.program.templates).toEqual(f.source.program.templates);
 expect(r.changes.removedInstanceIds).toEqual(['duplicate']);expect(r.patch.removeInstances).toEqual(patch.removeInstances);expect(readFileSync(join(f.sourceDir,'generated-scene.json'),'utf8')).toBe(before);
 goals.goals[0].instanceIds=['main'];save(join(f.folder,'repair-goals.json'),goals);
 expect(()=>validateSavedRefinement(freezeSavedRefinement(f.job,f.dir),f.target,f.plan,f.images,f.locate)).toThrow('未选择');
}finally{rmSync(f.root,{recursive:true,force:true});}});
