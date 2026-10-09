import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {checkpointFixture} from './checkpoint-fixture';
import {read,save,digest,runDir} from '../store';
import {stable} from '../validated-cache';
import {applyGrayboxSpaceRepair,grayboxSpaceRepairSchema,GRAYBOX_SPACE_REPAIR} from './graybox-space-repair';
import {createGrayboxSpacePreview} from './graybox-space-preview';
import {buildGrayboxPartScene} from './graybox-local-parts';
import {blockoutScene} from './blockout';
import {validateSpace} from './layout-stages';
import {persistReviewedGrayboxGeometry,reviewedGrayboxGeometry} from './graybox-reviewed-geometry';
import {generateBlockoutTemplates} from './blockout-assets';
import {matchingPolicy} from '../matching-level';
import {reconstructionPython} from '../runtime-paths.mjs';

test('正常灰模交接与技术恢复复用实际预览过的部件网格，不退回旧生成缓存或再调用模型',async()=>{
 const f=checkpointFixture(),id=crypto.randomUUID(),root=runDir(id),repair=join(f.root,'repair'),sourceFolder=join(f.root,'source');
 try{
  mkdirSync(sourceFolder,{recursive:true});mkdirSync(root,{recursive:true});
  const space:any={...read(join(f.registration.generationDir,'layout.json')),version:'scene-space-v1',spatialContacts:[],spatialOpenings:[],spatialRelations:[{id:'rel',critical:true,description:'两个原图支架的相对位置',instanceIds:['one','two']}]};delete space.program.materials;
  const geometry={templates:[{...f.geometry.template,parts:f.geometry.template.parts.map(p=>({...p,material:'blockout'}))}]},source=blockoutScene(space,geometry,read(f.registration.planFile),2);
  save(join(sourceFolder,'space.json'),space);save(join(sourceFolder,'scene.json'),source);
  const images=[1,2].map(n=>({path:join(f.root,'ref-'+n+'.png'),mime:'image/png'}));const refs=Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; [Image.new("RGB",(1600,900)).save(p) for p in sys.argv[1:]]',...images.map(i=>i.path)]);if(refs.exitCode)throw Error('test PNG fixture unavailable');
  const ctx:any={job:{...f.job,id,plan:read(f.registration.planFile),blockout:{},executionRecoveryRoot:id,reuseMode:'fresh',matchingPolicy:matchingPolicy('standard'),optimizationPolicy:{matchingLevel:'standard'},executionSettings:{assetConcurrency:2}},plan:read(f.registration.planFile),images,signal:new AbortController().signal};save(join(root,'job.json'),ctx.job);
  const patch={version:GRAYBOX_SPACE_REPAIR,reason:'原图两个支架之间仍需保留缺口，仅调整已有轮廓部件微小位置，不改形状与预算。',instances:[],templates:[],parts:[{templateId:'shape',partId:'body',position:[.1,0,0],rotation:[0,0,0],scale:[1,1,1]}],cameras:[],contacts:[],checks:[{relationIds:['rel'],evidence:'真实灰模轮廓偏离原计划但主体存在',expectedChange:'局部部件微调，原始缺口与两实例数量保留'}]};
  const render:any=async(scene:any,_i:any,_r:any,dir:string)=>{mkdirSync(join(dir,'capture'),{recursive:true});const frames=scene.cameras.map((c:any,n:number)=>{const file='candidate-'+(n+1)+'.png',b=Buffer.alloc(32);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(c.frame?.width??1600,16);b.writeUInt32BE(c.frame?.height??900,20);writeFileSync(join(dir,'capture',file),b);return {file,referenceIndex:c.referenceIndex,sha256:digest(b),pose:{selectedView:n,position:[c.position[0],c.position[2],-c.position[1]],target:[c.target[0],c.target[2],-c.target[1]],fov:c.fov,cameraProjection:{projection:0,fov:c.fov,aspect:(c.frame?.width??1600)/(c.frame?.height??900),near:.1,far:1000}}};});save(join(dir,'engine-preview-receipt.json'),{sceneSha256:digest(JSON.stringify(scene)),frames,report:{consoleErrors:[],pageErrors:[]}});};
  const tool=createGrayboxSpacePreview({space,sourceScene:source,images,folder:join(repair,'preview'),signal:ctx.signal,schema:grayboxSpaceRepairSchema(),apply:p=>applyGrayboxSpaceRepair(space,p,v=>validateSpace(v,ctx.plan,2,'simple')),buildScene:(s,p)=>buildGrayboxPartScene(source,s,p,ctx.plan,2),render});
  await tool.kit.call('preview_graybox_space',patch);
  const next=applyGrayboxSpaceRepair(space,patch,v=>validateSpace(v,ctx.plan,2,'simple')),scene=buildGrayboxPartScene(source,next.value,patch,ctx.plan,2);save(join(repair,'patch.json'),patch);save(join(repair,'reviewed-scene.json'),scene);save(join(repair,'repair-receipt.json'),{sourceFolder,preview:tool.assertReviewed(patch)});
  const folder=join(root,'generation/blockout/0');mkdirSync(folder,{recursive:true});save(join(folder,'space.json'),next.value);
  const result=persistReviewedGrayboxGeometry(repair,next.value,ctx,folder);save(join(folder,'scene.json'),blockoutScene(next.value,result.value,ctx.plan,2));
  expect(result.value.templates[0].parts[0].position).toEqual([.1,0,0]);expect(ctx.job.blockout.templateProgress).toMatchObject({patched:1,reused:0,modelRequests:0});
  const nextFolder=join(root,'generation/blockout/1');mkdirSync(nextFolder,{recursive:true});let calls=0;
  const recovered=await generateBlockoutTemplates(next.value,ctx,nextFolder,(async()=>{calls++;throw Error('unexpected model regeneration');}) as any);
  expect(calls).toBe(0);expect(stable(recovered.value)).toBe(stable(result.value));expect(read(join(nextFolder,'templates/shape/recovery-source.json')).reviewed).toBe(true);
  const bad=read(join(repair,'reviewed-scene.json'));bad.program.templates[0].parts[0].position[0]=.11;save(join(repair,'reviewed-scene.json'),bad);expect(()=>reviewedGrayboxGeometry(repair,ctx)).toThrow('摘要');
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});}
});
