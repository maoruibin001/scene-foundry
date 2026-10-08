import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {read,save,digest} from '../store';
import {stable} from '../validated-cache';
import {pendingIteration,freezeIteration,validateIteration} from './iteration-recovery';
import {applyRefinement} from './refinement';
import {mergeRefinementPatches} from './repair-batches';
import {repairBudget} from './repair-budget';
import {recoveryInfo} from '../recovery';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'iteration-resume-')),id='source',dir=join(root,id),prefix='generation/iteration-1/refinement',base='iterations/0',pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const put=(f:string,v:any)=>{mkdirSync(dirname(join(dir,f)),{recursive:true});save(join(dir,f),v);};
 const image=join(root,'reference.png');writeFileSync(image,'photo');const ref=digest(readFileSync(image)),frame=digest('render');
 const plan={requirements:[{id:'R1',critical:true,count:null}]},profile={provider:'codex-cli',judgeModel:'test',reasoningEffort:'xhigh',engineSha:'fixed-engine',generatorSha:'fixed-generator',executionRoute:{providerId:'codex6'}},modelSettings={model:'test',reasoningEffort:'xhigh'};
 const scene:any={version:'scene-v1',spatialOpenings:[],program:{version:'geometry-v1',name:'场景',materials:[{id:'mat',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'object',parts:[{...pose,id:'part',material:'mat',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'main',label:'主体',template:'object',requirementIds:['R1']}]},entities:[{instanceId:'main',role:'subject',category:'主体'}],textures:[],textureReuse:[],cameras:[{name:'参考',referenceIndex:1,position:[3,-4,2],target:[0,0,0],fov:1},{name:'检查',referenceIndex:null,position:[-3,4,2],target:[0,0,0],fov:1}],lighting:{direction:[.5,.5,-.7],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]},assumptions:[]};
 const job:any={id,prompt:'还原主体位置',images:[{id:ref,mime:'image/png',file:'reference.png'}],complexity:'simple',mode:'reference',matchingLevel:'standard',reuseMode:'fresh',generationMode:'qualified',status:'failed',stage:'repair',iteration:0,visualIterations:{status:'interrupted'},plan,policy:{score:80},profile,modelSettings,pipelineVersion:{id:'frozen'},executionRecoveryRoot:id,sceneProgram:{file:'generated-scene.json'}};
 const target={...job,id:'next',reuseSceneFrom:id,recoverySourceJobId:id};
 const part:any={version:'scene-refinement-v5',reason:'移动主体校正位置',instances:[{...scene.program.instances[0],position:[.2,0,0]}],cameras:[],materials:[],parts:[],removeParts:[],removeInstances:[],surfaceUpdates:[],screenTargets:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]};
 const patch={...mergeRefinementPatches([part]),version:'scene-refinement-batches-v1',batches:[part]},next=applyRefinement(scene,patch,plan,1,'simple');
 const goals={version:'scene-repair-goals-v1',summary:'校正布局',goals:[{id:'G1',kind:'layout',dimension:'spatial',problem:'位置偏差',whyPriority:'影响整体',expectedChange:'向右微调',requirementIds:['R1'],instanceIds:['main'],templateIds:[],materialIds:[],cameraNames:[],openingIds:[],addGeometry:false,evidence:[{frame:'reference-1.png',referenceIndex:1,region:[0,0,1,1],observation:'主体偏左'}]}],deferred:[]};
 const meta={sourceJobId:id,sourceIteration:0,sourceDigest:digest(JSON.stringify(scene)),referenceSha256:[ref],frameNames:['reference-1.png'],repairBudget:repairBudget('simple')},receipt={...meta,sceneDigest:digest(JSON.stringify(next))};
 for(const [f,v] of Object.entries({'job.json':job,'plan.json':plan,[base+'/candidate.json']:{jobId:id,pipelineVersionId:'frozen',cycle:{index:0}},[base+'/generated-scene.json']:scene,[base+'/runtime/runtime.json']:{images:['reference-1.png'],hashes:[frame]},[prefix+'/source.json']:meta,[prefix+'/scene.json']:next,[prefix+'/patch.json']:patch,[prefix+'/receipt.json']:receipt,[prefix+'/repair-batches.json']:{batches:[{...goals,id:'batch-1'}]},[prefix+'/repair-goals.json']:goals,[prefix+'/repair-goals-result.json']:{},[prefix+'/camera-preflight.json']:{},[prefix+'/batch-1/scene-refine-parsed.json']:part,[prefix+'/batch-1/scene-refine-response.txt']:part,[prefix+'/batch-1/scene-refine-execution.json']:{status:'completed',exitCode:0,endedAt:'2026-10-03T00:00:00Z'},[prefix+'/batch-1/scene-refine-receipt.json']:{role:'scene-refine',stopReason:'completed',requestedModel:'test',requestedReasoning:'high',executionRoute:profile.executionRoute},[prefix+'/batch-1/scene-refine-input-receipt.json']:{requestedReasoning:'high',images:[{sha256:ref},{sha256:frame}]}}))put(f,v);
 writeFileSync(join(dir,base,'runtime/reference-1.png'),'render');
 return {root,id,dir,prefix,job,target,plan,part,put,images:[{path:image,mime:'image/png'}],locate:(x:string)=>join(root,x)};
}
test('磁盘中断后的自动修正优先于首稿，复原数据严格重验且不改历史',()=>{const f=fixture();try{
 const before=readFileSync(join(f.dir,'job.json'),'utf8');expect(recoveryInfo(f.job,[],undefined,f.dir).mode).toBe('iteration-output');
 const v=validateIteration(freezeIteration(f.job,f.dir),f.target,f.plan,f.images,f.locate);expect(v.next.program.instances[0].position).toEqual([.2,0,0]);expect(readFileSync(join(f.dir,'job.json'),'utf8')).toBe(before);
}finally{rmSync(f.root,{recursive:true,force:true})}});
test('工作中、已取消、完成评估或缺少完整写入的结果不能作为待续接候选',()=>{const f=fixture();try{
 for(const status of ['running','queued','passed','cancelled'])expect(pendingIteration({...f.job,status},f.dir)).toBeNull();
 f.put('iterations/1/candidate.json',{});expect(pendingIteration(f.job,f.dir)).toBeNull();rmSync(join(f.dir,'iterations/1/candidate.json'));rmSync(join(f.dir,f.prefix,'receipt.json'));expect(pendingIteration(f.job,f.dir)).toBeNull();
}finally{rmSync(f.root,{recursive:true,force:true})}});
test('拒绝被篡改的快照、不同输入与路由，以及未完成的模型输出',()=>{for(const kind of ['snapshot','input','root','route','incomplete','scene','patch']){const f=fixture();try{
 let snapshot=freezeIteration(f.job,f.dir);
 if(kind==='snapshot')f.put(f.prefix+'/scene.json',{});
 if(kind==='input')f.target.prompt='other';if(kind==='root')f.target.executionRecoveryRoot='unrelated';if(kind==='route')f.target.profile={...f.target.profile,executionRoute:{providerId:'other'}};
 if(kind==='incomplete')f.put(f.prefix+'/batch-1/scene-refine-execution.json',{status:'running'});
 if(kind==='scene')f.put(f.prefix+'/scene.json',{different:true});if(kind==='patch')f.put(f.prefix+'/batch-1/scene-refine-parsed.json',{...f.part,reason:'changed'});
 if(kind!=='snapshot')snapshot=freezeIteration(f.job,f.dir);expect(()=>validateIteration(snapshot,f.target,f.plan,f.images,f.locate)).toThrow();
}finally{rmSync(f.root,{recursive:true,force:true})}}});
test('工具选择必须指向真实预览过的同一补丁，预览文件损坏拒绝恢复',()=>{const f=fixture();try{
 const hash=digest(stable(f.part)),p=f.prefix+'/batch-1',preview=p+'/feedback/1';
 f.put(p+'/scene-refine-response.txt',{selectedPatchSha256:hash,reason:'选择实际预览'});
 const source=read(join(f.dir,'iterations/0/generated-scene.json'));f.put(p+'/feedback/tool-audit.json',{sourceSha256:digest(stable(source)),attempts:[{index:1,name:'render_scene_patch',status:'passed',patchSha256:hash}]});
 f.put(preview+'/patch.json',f.part);f.put(preview+'/scene.json',{});f.put(preview+'/engine-preview-receipt.json',{frames:[{file:'candidate-1.png',sha256:digest('actual')}]});mkdirSync(join(f.dir,preview,'capture'));writeFileSync(join(f.dir,preview,'capture/candidate-1.png'),'actual');
 expect(validateIteration(freezeIteration(f.job,f.dir),f.target,f.plan,f.images,f.locate).next).toBeTruthy();writeFileSync(join(f.dir,preview,'capture/candidate-1.png'),'corrupt');expect(()=>validateIteration(freezeIteration(f.job,f.dir),f.target,f.plan,f.images,f.locate)).toThrow('图片损坏');
}finally{rmSync(f.root,{recursive:true,force:true})}});
