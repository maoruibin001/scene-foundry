/**
 * 规格 → 可构建的游戏工程(与 prepareGeometryProject 同一目录契约:brief.json、source/、game/assets/、scene-audit.json),
 * 之后照常走 prototype/bin/pipeline.ts generate/build/verify 与 capture.mjs。
 * brief.generator='spec-pack' 让 pipeline 的 generate 阶段调用 writeSpecPack,不经外部 scene-generator。
 */
import {performanceAudit} from './performance-audit';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {writeInspectionPlugins} from '../geometry/prepare';
import {getExportPlanTelemetry,pbrAssets,planSpecExportParallel,projectedDecalPlugin,toEnginePosition} from './export-pack';
import {ensurePbr} from './pbr-library';
import {validateSceneSpec,type SceneSpec} from './schema';
import {emitSpecWorld} from './world-emitter';
import {conceptLookPlugin,conceptLookUi} from './concept-look';
import {irradianceFieldGi,renderProfilePlugin} from './render-profile';
import {DEFAULT_STANDARD_PROFILE} from '@forgeax/engine/render';

const W=resolve(import.meta.dirname,'../..'),BASE=resolve(W,'..'),P=join(BASE,'prototype'),ENGINE=join(BASE,'engine');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

export async function prepareSpecProject(root:string,spec:SceneSpec,options:{id?:string;stateId?:string;maxTriangles?:number;concurrency?:number}={}){
 validateSceneSpec(spec);
 const plan=await planSpecExportParallel(spec,{cacheDir:join(root,'.mesh-cache'),concurrency:options.concurrency});
 const exportStats=getExportPlanTelemetry(plan)??{parallelWorkers:0,durationMs:0,uniqueMeshes:plan.meshes.length,workerMeshBuilds:0,meshCacheHits:0,surfaceBuilds:0};
 const game=join(root,'game'),source=join(root,'source'),assets=join(game,'assets');
 for(const p of [source,assets,join(game,'node_modules/@forgeax')])mkdirSync(p,{recursive:true});
 const pin=read(join(P,'brief.json')),existing=existsSync(join(root,'brief.json'))?read(join(root,'brief.json')):null;
 // 预算按实测三角数留余量;最终是否可用由运行时 FPS 门判定,不在这里猜。
 const brief={...pin,id:options.id??existing?.id??'spec-'+randomUUID(),name:spec.name,semanticBrief:`规格 ${spec.id} 驱动的程序化场景;只验证构建与运行,视觉验收独立进行。`,
  generator:'spec-pack',entry:'scene-spec.json',exportName:'spec',args:[],packageId:existing?.packageId??randomUUID(),sourceKey:'scene/spec',
  budget:{maxTriangles:options.maxTriangles??Math.max(250000,Math.ceil(plan.triangles*1.2)),maxMaterials:Math.max(128,plan.materials.length+plan.decals.length),consumerBuildMs:120000}};
 save(join(root,'brief.json'),brief);
 // 规格是 generate 阶段的唯一输入;pipeline 的 generationDigest 覆盖 source/,改规格必须重新 generate。
 save(join(source,'scene-spec.json'),spec);
 // 引用的 Poly Haven 贴图下载/解码后放进 source/pbr(generationDigest 覆盖 source/,贴图变化会触发重新 generate)。
 const pbr=pbrAssets(spec);if(pbr.length){mkdirSync(join(source,'pbr'),{recursive:true});for(const a of pbr)save(join(source,'pbr',a+'.json'),await ensurePbr(a));}
 save(join(root,'performance-audit.json'),performanceAudit(plan));
 save(join(root,'spec-export-plan.json'),{triangles:plan.triangles,meshes:plan.meshes.length,entities:plan.entities.length,instancing:plan.instancing,decals:plan.decals.length,parallelWorkers:exportStats.parallelWorkers,exportMs:exportStats.durationMs,report:plan.report});

 const cfg=read(join(P,'game/forge.json'));cfg.id=brief.id;cfg.name=spec.name;save(join(game,'forge.json'),cfg);
 save(join(game,'package.json'),{name:'spec-scene',private:true,type:'module',packageManager:'pnpm@12.15.0'});
 if(!lstatSync(join(game,'node_modules/@forgeax/engine'),{throwIfNoEntry:false}))symlinkSync(join(ENGINE,'packages/engine'),join(game,'node_modules/@forgeax/engine'),'dir');

 const world=emitSpecWorld(spec,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7',stateId:options.stateId});
 save(join(root,'lighting-export.json'),{version:'spec-lighting-v1',state:options.stateId??spec.lighting.defaultState,components:world.components,planarReflection:world.planar,deferred:world.deferred});
 copyFileSync(join(W,'src/camera-v3.txt'),join(assets,'camera.plugin.ts'));copyFileSync(join(W,'src/ui-v3.txt'),join(assets,'ui.plugin.ts'));
 writeFileSync(join(assets,'concept-look.plugin.ts'),conceptLookPlugin(world.entities));cfg.plugins.push({id:'concept-look',name:'./assets/concept-look.plugin.ts',realm:'engine',inject:['world','gameHost']});save(join(game,'forge.json'),cfg);
 if(world.planarPlugin){
  writeFileSync(join(assets,'planar-reflection.plugin.ts'),world.planarPlugin);
  cfg.plugins.push({id:'planar-reflection',name:'./assets/planar-reflection.plugin.ts',realm:'engine',inject:['world','gameHost','executionBootstrapHost']});save(join(game,'forge.json'),cfg);
 }
 if(world.volumetricPlugin){
  writeFileSync(join(assets,'volumetric-fog.plugin.ts'),world.volumetricPlugin);
  cfg.plugins.push({id:'volumetric-fog',name:'./assets/volumetric-fog.plugin.ts',realm:'engine',inject:['world','gameHost','assets']});save(join(game,'forge.json'),cfg);
 }
 if(plan.decals.length){
  writeFileSync(join(assets,'projected-decals.plugin.ts'),projectedDecalPlugin(plan.decals));
  cfg.plugins.push({id:'projected-decals',name:'./assets/projected-decals.plugin.ts',realm:'engine',inject:['world','gameHost','assets']});save(join(game,'forge.json'),cfg);
 }
 // 性能档(引擎会话 2026-11-06 建议):体积雾低画质、光照档 32;ProjectedDecal 与漫反射 GI 均要求 deferred 管线。
 const hasDecals=(spec.decals?.length??0)>0;
 const perfProfile={...DEFAULT_STANDARD_PROFILE,...(hasDecals?{renderPath:'deferred' as const}:{}),...(process.env.SPEC_RENDER_PATH?{renderPath:process.env.SPEC_RENDER_PATH}:{}),lightCount:32,volumetricFog:{quality:'low',depth:48,tileSize:16}};
 // 漫反射 GI:渲染器配置只能在构建期由 build 插件给出;默认 profile + 延迟渲染 + irradiance-field。
 const giState=spec.lighting.states.find(s=>s.id===(options.stateId??spec.lighting.defaultState))!.post.gi;
 if(!giState){
  writeFileSync(join(assets,'render-profile.plugin.ts'),renderProfilePlugin(perfProfile));
  cfg.plugins.push({id:'render-profile',name:'./assets/render-profile.plugin.ts',realm:'build',inject:[]});save(join(game,'forge.json'),cfg);
  save(join(root,'render-profile.json'),perfProfile);
 }
 if(giState){
  const profile={...perfProfile,renderPath:'deferred',ibl:false,visibleSurface:false,diffuseGi:irradianceFieldGi(spec,giState.environment)};
  writeFileSync(join(assets,'render-profile.plugin.ts'),renderProfilePlugin(profile));
  cfg.plugins.push({id:'render-profile',name:'./assets/render-profile.plugin.ts',realm:'build',inject:[]});save(join(game,'forge.json'),cfg);
  save(join(root,'render-profile.json'),profile);
 }
 const finalWorld=writeInspectionPlugins(root,assets,world.source,world.views);
 writeFileSync(join(assets,'ui.plugin.ts'),conceptLookUi(readFileSync(join(assets,'ui.plugin.ts'),'utf8')));
 writeFileSync(join(assets,'world.pack.ts'),finalWorld);
 save(join(root,'camera-tours.json'),{version:'camera-tour-v1',views:world.views});

 // 地标用规格对象的包围尺寸近似(引擎 Y 向上);部件绑定键即规格对象 ID(spec.pack 的实体键)。
 // 地标取实际生成网格的包围盒(局部 AABB 经实例缩放后近似为轴对齐尺寸,旋转只影响取景估计,不影响几何)。
 const landmarks=plan.entities.map(e=>{const a=plan.meshes.find(x=>x.key===e.mesh)!.aabb,size=[0,1,2].map(k=>Math.max(.01,(a[k+3]-a[k])*Math.abs(e.scale[k]))),center=[0,1,2].map(k=>e.pos[k]+(a[k]+a[k+3])/2*e.scale[k]);
  return {id:e.id,role:'subject',position:center,size};});
 const b=spec.bounds,center=toEnginePosition(b.min.map((v,k)=>(v+b.max[k])/2) as any),radius=Math.hypot(...b.max.map((v,k)=>v-b.min[k]))/2;
 save(join(assets,'scene-audit.json'),{name:spec.name,channelId:brief.packageId,specSha256:sha(JSON.stringify(spec)),camera:{center,radius,height:radius*.4},views:world.views,
  parts:plan.entities.map(e=>({id:e.id,entityId:e.id,bindingKey:e.bindingKey})),entities:[],landmarks,geometry:{nonFlat:true},
  provenance:{kind:'spec-scene-generation',validationKind:'generation',specId:spec.id,engineSha:pin.engineSha,qualityAssessment:'not-run'}});
 return {brief,plan,world,exportStats};
}

if(import.meta.main){
 const [specPath,root]=process.argv.slice(2);
 if(!specPath||!root)throw Error('用法: bun src/spec/prepare-spec.ts <spec.json> <projectRoot>');
 const r=await prepareSpecProject(resolve(root),read(resolve(specPath)));
 console.log(JSON.stringify({id:r.brief.id,triangles:r.plan.triangles,meshes:r.plan.meshes.length,entities:r.plan.entities.length,instancing:r.plan.instancing,decals:r.plan.decals.length,proxies:r.plan.report.proxies.length,errors:r.plan.report.errors,deferred:r.world.deferred},null,2));
}
