import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSpaceConstruction} from './space-construction';
import {completeObservedSpacePlan,bindObservedSpace} from './reference-observations';
import {validateSpace} from './layout-stages';
import {compileGeometryProgram,validateGeometryProgram} from './program';
import {spaceDraftAllowed,withInitialSpaceDraft,spaceDraftScene,preserveInitialSpaceDraft,SPACE_DRAFT_LIMITATION} from './space-draft';
import {digest,save,read} from '../store';
import {stable} from '../validated-cache';
import {deliveryInfo,inspectOutput} from '../output-delivery';
import {deliveryHTML} from '../../public/delivery-ui.js';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'space-draft-test-')),dir=join(root,'generation');mkdirSync(dir);
 const signal=new AbortController(),job:any={id:'current',executionRecoveryRoot:'current',complexity:'simple',status:'blocked',stage:'space',error:'PROVIDER_RECOVERY_EXHAUSTED PROVIDER_TIMEOUT',profile:{engineSha:'engine',generatorSha:'generator'},pipelineVersion:{id:'frozen'},stages:{space:{status:'failed'}},blockout:undefined};
 const plan={requirements:[{id:'objects',critical:true,count:2}]},observation={landmarks:[{id:'near'},{id:'far'}],relations:[{id:'depth',description:'近构件位于远构件之前',critical:true,landmarkIds:['near','far']}]};
 const core:any={version:'scene-space-core-v1',program:{version:'geometry-v1',name:'有边界的布局',templates:[{id:'shape',label:'构件',description:'原图构件范围，开口仍待声明',origin:'底面中心',bounds:{min:[-.5,-.5,0],max:[.5,.5,2]},maxParts:1}],instances:['one','two'].map((id,i)=>({id,label:'构件'+i,template:'shape',position:[i*2,0,0],rotation:[0,0,i*.2],scale:[1,1,1],requirementIds:['objects']}))},entities:['one','two'].map(instanceId=>({instanceId,role:'subject',category:'构件'})),cameras:[{name:'参考机位',referenceIndex:1,position:[4,-6,3],target:[1,0,1],fov:1},{name:'检查机位',referenceIndex:null,position:[-4,6,3],target:[1,0,1],fov:1}],observedBindings:[{landmarkId:'near',instanceIds:['one']},{landmarkId:'far',instanceIds:['two']}],assumptions:['隐藏区域为推断']};
 const ctx={dir,job,plan,observation,images:[{path:'not-read-in-mocked-render',mime:'image/png'}],signal:signal.signal};
 const validate=(v:any)=>bindObservedSpace(validateSpace(completeObservedSpacePlan(v,observation),plan,1,'simple'),observation);
 const tool=createSpaceConstruction({folder:join(dir,'space-construction'),jobId:job.id,rootJobId:job.id,inputKey:digest('frozen prompt reference settings'),requirementIds:['objects'],signal:signal.signal,validate});
 const saveCore=()=>tool.kit.call('save_space_core',{expectedDraftSha256:tool.summary().draftSha256,coreJson:JSON.stringify(core)});
 const render=async(scene:any,folder:string)=>{for(const p of ['project/game/dist','project/evidence','runtime'])mkdirSync(join(folder,p),{recursive:true});const manifest='engine-artifact';writeFileSync(join(folder,'project/game/dist/forgeax-dist.json'),manifest);writeFileSync(join(folder,'runtime/view.png'),'fixture-pixels');save(join(folder,'render-scene.json'),scene);save(join(folder,'project/evidence/run-report.json'),{engineSha:'engine',generatorSha:'generator',distManifestDigest:digest(manifest),stages:Object.fromEntries(['engine-build','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))});const runtime={distManifestDigest:digest(manifest),hard:{runtime:true,noErrors:true,entitiesLoaded:true,multipleViews:true,framing:false},images:['view.png'],hashes:[digest('fixture-pixels')]};save(join(folder,'runtime/runtime.json'),runtime);return runtime;};
 return {root,ctx,job,core,tool,signal,saveCore,render,clean:()=>rmSync(root,{recursive:true,force:true})};
}
const noCommand=()=>{throw Error('mock render must not run commands');};
test('only saved current core can produce bounds-only geometry; layout, cameras and unknown declarations remain unchanged',async()=>{
 const f=fixture();try{await f.saveCore();const snapshot=f.tool.snapshot(),before=stable(snapshot),scene=spaceDraftScene(snapshot,f.ctx),mesh=compileGeometryProgram(scene.program,{});
  expect(stable(snapshot)).toBe(before);expect(scene.program.instances).toEqual(f.core.program.instances);expect(scene.cameras).toEqual(f.core.cameras);expect(scene.entities).toEqual(f.core.entities);
  expect(scene.spatialOpenings).toBeUndefined();expect(scene.spatialContacts).toBeUndefined();expect(scene.spatialRelations[0].critical).toBe(true);expect(scene.assumptions).toContain(SPACE_DRAFT_LIMITATION);
  expect(scene.program.templates[0].parts).toHaveLength(1);expect(mesh.meshes).toHaveLength(2);expect(mesh.triangles).toBeGreaterThan(0);expect(mesh.triangles).toBeLessThan(1000);validateGeometryProgram(scene.program);
  const points=scene.program.templates[0].parts[0].shape.points;for(const p of points)for(let i=0;i<3;i++){expect(p[i]).toBeGreaterThanOrEqual(f.core.program.templates[0].bounds.min[i]);expect(p[i]).toBeLessThanOrEqual(f.core.program.templates[0].bounds.max[i]);}
  expect(existsSync(join(f.ctx.dir,'space.json'))).toBe(false);expect(f.job.blockout).toBeUndefined();
 }finally{f.clean();}
});
test('invalid/tampered/foreign core is rejected, never replaced by a default scene',async()=>{
 const f=fixture();try{expect(()=>spaceDraftScene(f.tool.snapshot(),f.ctx)).toThrow('核心');await f.saveCore();const state=f.tool.snapshot();state.core.program.instances[0].position[0]=999;expect(()=>spaceDraftScene(state,f.ctx)).toThrow('检查点');
  expect(()=>spaceDraftScene(f.tool.snapshot(),{...f.ctx,job:{...f.job,id:'other'}})).toThrow('执行根');
  expect(()=>spaceDraftScene(f.tool.snapshot(),{...f.ctx,observation:{...f.ctx.observation,landmarks:[{id:'different'}]}})).toThrow();
 }finally{f.clean();}
});
test('successful planning never invokes fallback and failed planning preserves exactly the original error',async()=>{
 const f=fixture();let preserved=0,warnings=0;try{await f.saveCore();expect(await withInitialSpaceDraft(async()=>({valid:true}),()=>f.tool.snapshot(),async()=>{preserved++;},f.signal.signal,()=>warnings++)).toEqual({valid:true});expect(preserved).toBe(0);
  const failure=Error('PROVIDER_RECOVERY_EXHAUSTED PROVIDER_TIMEOUT');try{await withInitialSpaceDraft(async()=>{throw failure;},()=>f.tool.snapshot(),async()=>{preserved++;},f.signal.signal,()=>warnings++);}catch(error){expect(error).toBe(failure);}
  expect(preserved).toBe(1);expect(warnings).toBe(0);
  await expect(withInitialSpaceDraft(async()=>{throw failure;},()=>f.tool.snapshot(),async()=>{throw Error('build failed');},f.signal.signal,()=>warnings++)).rejects.toBe(failure);expect(warnings).toBe(1);
  await expect(withInitialSpaceDraft(async()=>{throw failure;},()=>{throw Error('corrupt checkpoint');},async()=>{preserved++;},f.signal.signal,()=>{throw Error('log disk failed');})).rejects.toBe(failure);expect(preserved).toBe(1);
 }finally{f.clean();}
});
test('no first core, external quota/auth, resource failure, cancellation and configuration cannot trigger a local fallback',async()=>{
 const f=fixture();let preserved=0;try{
  await expect(withInitialSpaceDraft(async()=>{throw Error('PROVIDER_TIMEOUT');},()=>f.tool.snapshot(),async()=>{preserved++;},f.signal.signal,()=>{})).rejects.toThrow('TIMEOUT');expect(preserved).toBe(0);
  for(const reason of ['PROVIDER_HTTP_402 insufficient_quota','PROVIDER_HTTP_401','ENOSPC PROVIDER_TIMEOUT','STORAGE_CAPACITY_BLOCKED','ENOMEM','EACCES','CANCELLED','CODEX_ROUTE_UNVERIFIED','model output invalid'])expect(spaceDraftAllowed(reason,f.signal.signal)).toBe(false);
  expect(spaceDraftAllowed('MODEL_BUDGET_EXHAUSTED PROVIDER_HTTP_402 insufficient_quota',f.signal.signal)).toBe(false);
  expect(spaceDraftAllowed('SCENE_BUDGET_INSUFFICIENT',f.signal.signal)).toBe(true);f.signal.abort();expect(spaceDraftAllowed('PROVIDER_TIMEOUT',f.signal.signal)).toBe(false);
 }finally{f.clean();}
});
test('real artifact discovery, preservation and UI keep bounds draft unscored and never promote it even with stale quality',async()=>{
 const f=fixture();try{await f.saveCore();const original=structuredClone(f.job),result=await preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,f.render,noCommand);expect(result.status).toBe('available');expect(f.job).toEqual(original);
  const info=deliveryInfo(f.job,f.root);expect(info.best).toMatchObject({kind:'graybox',assessmentScope:'graybox',qualityStatus:'not_assessed',score:null,deliveryStatus:null,layoutDraft:{scope:'bounds-only',completeScene:false}});
  expect(info.limitations).toBe(SPACE_DRAFT_LIMITATION);expect(deliveryHTML({...f.job,delivery:info})).toContain('布局范围草稿已可查看');expect(deliveryHTML({...f.job,delivery:info})).not.toContain('70分基础交付通过');
  const folder=info.best.folder;for(const file of ['layout-draft.json','checkpoint-source.json','scene.json','render-scene.json'])expect(existsSync(join(f.root,folder,file))).toBe(true);
  save(join(f.root,folder,'quality.json'),{status:'passed',score:100});expect(inspectOutput(f.job,f.root,folder,'scene')).toMatchObject({kind:'graybox',score:null,deliveryStatus:null});
 }finally{f.clean();}
});
test('one render attempt per job is persisted; repeats neither rerender nor consume model or quality allowance',async()=>{
 const f=fixture();let renders=0;try{await f.saveCore();const render=async(...args:any[])=>{renders++;return f.render(args[0],args[1]);};await preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,render,noCommand);const repeated=await preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,render,noCommand);expect(repeated.repeated).toBe(true);expect(renders).toBe(1);
  expect(f.tool.snapshot().writes).toBe(1);expect(f.job.stages.space.status).toBe('failed');expect(f.job.iteration).toBeUndefined();
 }finally{f.clean();}
});
test('failed render preserves source and failure, cannot publish success and cannot spin on the same attempt',async()=>{
 const f=fixture();let renders=0;try{await f.saveCore();const source=readFileSync(join(f.ctx.dir,'space-construction/checkpoint.json')),bad=async()=>{renders++;throw Error('Engine capture failed');};
  await expect(preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,bad,noCommand)).rejects.toThrow('Engine');
  expect(deliveryInfo(f.job,f.root).available).toBe(false);expect(read(join(f.ctx.dir,'space-draft/attempt.json')).status).toBe('failed');
  await preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,bad,noCommand);expect(renders).toBe(1);expect(readFileSync(join(f.ctx.dir,'space-construction/checkpoint.json')).equals(source)).toBe(true);
 }finally{f.clean();}
});
test('changed disk checkpoint is rejected before rendering; missing/tampered draft metadata cannot survive delivery checks',async()=>{
 const f=fixture();try{await f.saveCore();const state=f.tool.snapshot();save(join(f.ctx.dir,'space-construction/checkpoint.json'),{...state,inputKey:'other'});await expect(preserveInitialSpaceDraft(f.ctx,state,f.job.error,f.render,noCommand)).rejects.toThrow('改变');save(join(f.ctx.dir,'space-construction/checkpoint.json'),state);
  await preserveInitialSpaceDraft(f.ctx,state,f.job.error,f.render,noCommand);const best=deliveryInfo(f.job,f.root).best,proofPath=join(f.root,best.folder,'layout-draft.json'),proof=read(proofPath);
  for(const mutation of [{jobId:'other'},{completeScene:true},{spatialGatePassed:true},{quality:'passed'},{distManifestDigest:'wrong'}]){save(proofPath,{...proof,...mutation});expect(inspectOutput(f.job,f.root,best.folder,'graybox')).toBeNull();}
  save(proofPath,proof);writeFileSync(join(f.root,best.folder,'scene.json'),'changed');expect(inspectOutput(f.job,f.root,best.folder,'graybox')).toBeNull();rmSync(proofPath);expect(inspectOutput(f.job,f.root,best.folder,'graybox')).toBeNull();
 }finally{f.clean();}
});
test('ordinary runtime graybox is preferred over a bounds-only draft, detailed output remains higher priority',async()=>{
 const f=fixture();try{await f.saveCore();await preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,f.render,noCommand);await f.render({},join(f.ctx.dir,'blockout/0'));expect(deliveryInfo(f.job,f.root).best.folder).toBe('generation/blockout/0');await f.render({},f.root);expect(deliveryInfo(f.job,f.root).best.kind).toBe('scene');
 }finally{f.clean();}
});
test('normal download package retains draft identity, source and warning with verified checksums',async()=>{
 const f=fixture();try{await f.saveCore();await preserveInitialSpaceDraft(f.ctx,f.tool.snapshot(),f.job.error,f.render,noCommand);const info=deliveryInfo(f.job,f.root);
  const packaged=Bun.spawnSync(['python3',join(import.meta.dirname,'../output-package.py'),f.root],{stdin:new TextEncoder().encode(JSON.stringify(info)),stdout:'pipe',stderr:'pipe'});expect(packaged.exitCode).toBe(0);const zip=join(f.root,JSON.parse(new TextDecoder().decode(packaged.stdout)).file);
  const inspect=Bun.spawnSync(['python3','-c',"import sys,json,zipfile,hashlib;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;d=json.loads(z.read('delivery.json'));assert d['best']['layoutDraft']['scope']=='bounds-only';assert '仅显示当前规划' in z.read('使用说明.txt').decode();m=json.loads(z.read('manifest.sha256.json'));assert all(hashlib.sha256(z.read(f)).hexdigest()==v for f,v in m.items());assert all(f in m for f in ['layout-draft.json','checkpoint-source.json','scene.json','render-scene.json']);print('verified')",zip],{stdout:'pipe',stderr:'pipe'});expect(inspect.exitCode).toBe(0);
 }finally{f.clean();}
});

test('strict lattice checkpoint remains intact while unscored range cages avoid native-output claims',async()=>{const f=fixture();try{f.core.voxelLattice={version:'voxel-lattice-v1',cellSize:.25,origin:[0,0,0]};f.core.program.instances[1].rotation=[0,0,0];for(const l of f.ctx.observation.landmarks){l.geometryScope='object';l.critical=true;}const strict=createSpaceConstruction({folder:join(f.ctx.dir,'strict'),jobId:f.job.id,rootJobId:f.job.id,inputKey:digest('strict fixture'),requirementIds:['objects'],signal:f.signal.signal,strictVoxel:true,validate:v=>bindObservedSpace(validateSpace(completeObservedSpacePlan(v,f.ctx.observation),f.ctx.plan,1,'simple'),f.ctx.observation)});await strict.kit.call('save_space_core',{expectedDraftSha256:strict.summary().draftSha256,coreJson:JSON.stringify(f.core)});const snapshot=strict.snapshot(),before=stable(snapshot),scene=spaceDraftScene(snapshot,f.ctx);expect(stable(snapshot)).toBe(before);expect(snapshot.core.voxelLattice.cellSize).toBe(.25);expect(scene).not.toHaveProperty('voxelLattice');expect(scene.assumptions).toContain(SPACE_DRAFT_LIMITATION);expect(scene.program.templates[0].parts[0].shape.type).toBe('grid');}finally{f.clean();}});
