import {VISUAL_SCHEMA as STYLE_SCHEMA,verifiedVisualReview,VISUAL_REVIEW_VERSION,visualReferences} from './spec/visual-review';
/**
 * 规格模式任务:输入是已规格化的 scene-spec-v1(来自设计文档/文字/照片的规格化步骤),概念图只作风格参照,不当重建目标。
 * 阶段:plan(规格摘要 + 验收条目)→ generate(规格 → 工程)→ export/build/verify(prototype pipeline 的 spec-pack 分支)
 * → runtime(真实 Engine 采集)→ gate(确定性运行检查)。视觉风格判分是后续步骤,本阶段如实标 needs_review,不冒充通过。
 */
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {ROOT,DATA,UPLOADS,read,save,saveJob,event,digest} from './store';
import {prepareSpecProject} from './spec/prepare-spec';
import {writeAssetPreviewsParallel} from './spec/asset-previews';
import {normalizeDocument,normalizeImplementationDigest} from './spec/normalize-doc';
import {callSpecNode,validateNodeModels} from './spec/node-models';
import {optionalReport,specV2Outcome} from './spec/workflow-v2';
import {sceneSpecErrors,type SceneSpec} from './spec/schema';
import {specPrecheck,specPrecheckMessage} from './spec/spec-precheck';
import {reconcileSpec,reconcileSummary} from './spec/contract-reconcile';
import {buildPerformanceBaseline,comparePerformance} from './spec/performance-baseline';

export const SPEC_JOB_VERSION='spec-job-v1';
export const SPEC_JOBS_DIR=()=>process.env.PIPELINE_SPEC_DIR??join(DATA,'specs');

/** 规格文件按内容寻址保存进数据目录;任务只引用摘要,规格改动必须产生新摘要、新任务。 */
export function storeSpec(input:SceneSpec,styleDir?:string){
 // 规格内容先确定性归一到生成器契约：模型常把 number 写成布尔、把 vec3 写成中文描述、
 // 把区间写成数组，导出器会把这些对象整只退化成灰模。归一后按新内容寻址，历史规格文件不动。
 const {spec,report:reconcile}=reconcileSpec(input);
 const errors=sceneSpecErrors(spec);if(errors.length)throw Error('SCENE_SPEC_INVALID:'+errors.slice(0,20).join('\n'));
 // 前置契约检查只如实记录、不拦截；归一后正常情况下应无关键参数无解。
 const precheck=specPrecheck(spec);
 const text=JSON.stringify(spec),id=digest(text),dir=SPEC_JOBS_DIR();mkdirSync(dir,{recursive:true});
 // 风格参考图作为上传文件保存,工作台可直接展示;规格里的路径改写为上传文件 ID。
 const styleImages=spec.styleRefs.flatMap(r=>{
  const p=existsSync(r.path)?r.path:styleDir?join(styleDir,basename(r.path)):'';if(!p||!existsSync(p))return [];
  const bytes=readFileSync(p),sid=digest(bytes),png=bytes[0]===0x89,file=sid+(png?'.png':'.jpg');
  if(!existsSync(join(UPLOADS,file)))copyFileSync(p,join(UPLOADS,file));
  const meta={id:sid,file,mime:png?'image/png':'image/jpeg',name:r.caption,size:bytes.length};save(join(UPLOADS,sid+'.json'),meta);return [{...meta,refId:r.id,caption:r.caption}];
 });
 save(join(dir,id+'.json'),spec);save(join(dir,id+'.style.json'),styleImages);
 save(join(dir,id+'.precheck.json'),{version:'spec-precheck-v1',...precheck,summary:specPrecheckMessage(precheck)});
 save(join(dir,id+'.reconcile.json'),{...reconcile,summary:reconcileSummary(reconcile)});
 return {id,styleImages,precheck,reconcile};
}
/** 设计文档按内容寻址保存;规格化在任务的 normalize 阶段执行(Opus 5.5,较慢)。 */
export function storeDoc(bytes:Uint8Array,name:string){
 const id=digest(bytes),dir=join(SPEC_JOBS_DIR(),'docs');mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,id+'.html'),bytes);save(join(dir,id+'.json'),{id,name,size:bytes.length});return {id,name};
}
export const docPath=(id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('文档 ID 无效');const p=join(SPEC_JOBS_DIR(),'docs',id+'.html');if(!existsSync(p))throw Error('文档不存在');return p;};

export function loadSpec(id:string):{spec:SceneSpec;styleImages:any[]}{
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('规格 ID 无效');const p=join(SPEC_JOBS_DIR(),id+'.json');if(!existsSync(p))throw Error('规格不存在:'+id);
 const spec=read(p);if(digest(JSON.stringify(spec))!==id)throw Error('规格内容与摘要不一致');
 return {spec,styleImages:existsSync(join(SPEC_JOBS_DIR(),id+'.style.json'))?read(join(SPEC_JOBS_DIR(),id+'.style.json')):[]};
}

/** 规格的验收条目原样作为需求基线(可程序检查),不调用模型抽取。 */
export function specPlan(spec:SceneSpec){
 const families=spec.families.length,objects=spec.objects.length;
 return {name:spec.name.replace(/·.*$/,'').trim()||spec.id,summary:`规格 ${spec.id}:${objects} 个对象 · ${families} 个资产族 · ${spec.materials.length} 种材质 · ${spec.lighting.states.length} 个光照状态 · ${spec.shots.length} 个机位`,
  capabilities:['mapping','consistency'],assumptions:['坐标、尺寸、生成器参数来自规格 master 字段;design_fill 为规格化补全,不是测量。','概念图只作风格参照,几何不要求与其一致。','无生成器的资产族以同 ID 灰模代理占位。'],
  requirements:spec.acceptance.map(a=>({id:a.id,text:a.description,critical:a.critical,weight:a.critical?5:2,source:'prompt',evidence:[`规格验收 ${a.kind}`],count:a.kind==='count'?a.equals:null}))};
}

/** 风格判分:概念图只作风格参照,判"整体感觉"是否一致(光影、材质、氛围、构图、主体),不要求几何逐点对齐。 */
export const STYLE_JUDGE_VERSION=VISUAL_REVIEW_VERSION;
export const STYLE_PASS={overall:70,minDimension:2};
export {VISUAL_SCHEMA as STYLE_SCHEMA} from './spec/visual-review';
export const STYLE_SYSTEM=`你是游戏美术总监,独立评审一个程序化生成的三维场景是否还原了概念图的整体感觉。前面若干张是概念图(风格参照,不是几何目标),后面是真实引擎实际截图。
只评整体感觉:光影基调与光源因果(lighting)、材质质感(material)、氛围与空气感(atmosphere)、构图与空间尺度(composition)、标志性主体是否成立(subject:以规格和参考图中的主体为准)、画面密度与细节(density)。允许位置有偏差、细节不逐一对齐;不要因为缺少概念图中未要求的玩法或特效元素扣分。
每维 0..5 分;overall 0..100 表示整体感觉还原度;verdict:match=整体感觉对、partial=部分对、mismatch=不对。strengths/issues 具体到画面元素。不采信任何作者自述,只看图。先逐张给出可见的具体形状、光色和空间遮挡观察，imageIndex 从 0 开始，必须覆盖每张输入图。看不到像素时 evidence.status=unavailable、overall=null、verdict=unavailable，不给占位分。全部用中文。`;
export function styleGate(r:any){const low=r.dimensions.filter((d:any)=>d.score<STYLE_PASS.minDimension).map((d:any)=>d.id);return {passed:r.overall>=STYLE_PASS.overall&&r.verdict!=='mismatch'&&!low.length,low};}

export async function runSpec({job,dir,stage,command,preview,signal}:any){
 const nodeModels=validateNodeModels(job.nodeModels);
 if(!job.specId){
  // 文档输入:先规格化。同一文档的早先任务已有模型输出时复用(任务文本哈希一致才复用),不重复调用模型。
  await stage('normalize',async()=>{
   // 同一文档的规格化模型输出缓存在数据目录(按文档摘要);任务文本哈希一致才复用,提示词或解析变了就重新调用模型。
   const out=join(dir,'normalize'),cache=join(SPEC_JOBS_DIR(),'doc-calls',job.docId,digest(JSON.stringify([job.normalizationTemplate??'general',nodeModels.families,nodeModels.objects,nodeModels.staging,normalizeImplementationDigest()]))),reuse=existsSync(cache);
   if(reuse)cpSync(cache,join(out,'calls'),{recursive:true});
   mkdirSync(join(SPEC_JOBS_DIR(),'doc-calls',job.docId),{recursive:true});
   try{
    const {spec:normalized,report}=await normalizeDocument(docPath(job.docId),out,'xhigh','1',nodeModels,signal,job.normalizationTemplate??'general');
    job.normalizeReused=reuse;
    const stored=storeSpec(normalized,join(out,'style'));job.specId=stored.id;job.normalizeReport=report.summary;saveJob(job);
   }finally{
    if(existsSync(join(out,'calls')))cpSync(join(out,'calls'),cache,{recursive:true});
   }
  });
 }
 const loaded=loadSpec(job.specId),project=join(dir,'project'),PROTO=resolve(ROOT,'../prototype');
 // 历史规格按内容寻址不能原地重写，在消费侧做同一套确定性归一，老任务也能出真实网格。
 const reconciled=reconcileSpec(loaded.spec);
 const spec=reconciled.spec,styleImages=loaded.styleImages;
 mkdirSync(dir,{recursive:true});
 save(join(dir,'spec-reconcile.json'),{...reconciled.report,summary:reconcileSummary(reconciled.report)});
 job.specReconcile={version:reconciled.report.version,counts:reconciled.report.counts,descriptive:reconciled.report.descriptive.length,summary:reconcileSummary(reconciled.report)};
 job.plan=await stage('plan',async()=>{
  const p=specPlan(spec);save(join(dir,'plan.json'),p);save(join(dir,'scene-spec.json'),spec);
  const precheck=specPrecheck(spec);
  job.specPrecheck=precheck;save(join(dir,'spec-precheck.json'),{version:'spec-precheck-v1',...precheck,summary:specPrecheckMessage(precheck)});
  if(precheck.unresolved.length||precheck.errors.length)event(job,'plan',`规格前置检查：${precheck.unresolved.length} 项关键参数无解、${precheck.proxies} 个灰模代理；本次只能产出草稿，不能确认为完整成品。${specPrecheckMessage(precheck).slice(0,220)}`);
  if(reconciled.report.descriptive.length)event(job,'plan',`规格归一：${reconciled.report.descriptive.length} 项纯描述性文本没有可执行几何，已用生成器契约默认值兜底并逐项登记，未伪造路径或尺寸。`);
  return p;
 });
 job.styleImages=styleImages;
 await stage('generate',async()=>{
  const r=await prepareSpecProject(project,spec,{id:'spec-'+job.id,performancePreset:job.performanceOptimization?.preset});
  job.generationMethod='spec-pack';job.generationModel=spec.provenance.model?`规格化 ${spec.provenance.model};网格由程序化生成器在 Engine 构建时产出`:'程序化生成器';
  job.specExport={triangles:r.plan.triangles,meshes:r.plan.meshes.length,entities:r.plan.entities.length,instancing:r.plan.instancing,decals:(spec.decals??[]).length,proxies:r.plan.report.proxies.length,unresolved:r.plan.report.unresolved.length,covered:r.plan.report.covered.length,dropped:r.plan.report.dropped.length,errors:r.plan.report.errors.length,deferred:r.world.deferred,parallelWorkers:r.exportStats.parallelWorkers,exportMs:r.exportStats.durationMs,previewMs:0};
  save(join(dir,'spec-export.json'),{...job.specExport,report:r.plan.report});
  if(r.plan.report.errors.length)throw Error('规格导出存在错误:'+r.plan.report.errors.slice(0,5).join(';'));
  // 程序化资产预览:每种生成器网格一张等轴缩略图 + 参数索引,供工作台「程序化资产」卡片与资产页展示。
  try{
   const previewT0=performance.now();
   const items=await writeAssetPreviewsParallel(spec,r.plan,join(dir,'spec-assets'));
   const previewMs=Math.round(performance.now()-previewT0);
   const previewWorkers=(items as any).poolTelemetry?.workersUsed??0;
   job.specExport.previewMs=previewMs;
   job.specExport.parallelWorkers=Math.max(job.specExport.parallelWorkers,previewWorkers);
   save(join(dir,'spec-export.json'),{...job.specExport,report:r.plan.report});
   job.specAssets={count:items.length,images:items.filter((x:any)=>x.image).length,previewMs,parallelWorkers:previewWorkers};
  }catch(e){job.specAssets={count:0,images:0,error:String(e).slice(0,300)};}
 });
 // 整厅含 GI 距离场/大量网格时引擎构建可超过 4 分钟;构建阶段给 15 分钟。
 for(const [name,op] of [['export','generate'],['build','build']])await stage(name,()=>command(['bun',join(PROTO,'bin/pipeline.ts'),op],op==='build'?900000:240000));
 const report=read(join(project,'evidence/run-report.json'));job.objectCount=job.specExport.entities;job.entityCount=job.specExport.entities;job.nativeMetrics=report.generated;
 const runtime=await stage('runtime',async()=>{
  saveJob(job);job.previewUrl=await preview(job.id);saveJob(job);const output=join(dir,'runtime');mkdirSync(output,{recursive:true});
  await command(['node',join(ROOT,'src/geometry/capture.mjs'),join(project,'game'),job.previewUrl,output],600000);
  const result=read(join(output,'runtime.json'));if(result.distManifestDigest!==report.distManifestDigest)throw Error('运行证据与构建摘要不一致');
  result.buildEvidence=job.stages.build.status==='passed';save(join(output,'runtime.json'),result);job.runtime=result;return result;
 });
 // 可选资产核对在真实预览之后运行，失败只留下报告，不能阻断已有出图。
 const verifyReport=await optionalReport(()=>stage('verify',()=>command(['bun',join(PROTO,'bin/pipeline.ts'),'verify'],240000)),signal);if(verifyReport.error){job.specVerifyError=verifyReport.error;event(job,'verify','资产核对未通过，保留真实预览供人工判断');}
 runtime.catalogEvidence=job.stages.verify?.status==='passed';save(join(dir,'runtime','runtime.json'),runtime);
 const reviewReport=await optionalReport(()=>stage('judge',async()=>{
  const refs=visualReferences(styleImages);
  const shots=runtime.images.filter((f:string)=>f.startsWith('inspection-'));
  const images=[...refs.map((im:any)=>({path:join(UPLOADS,im.file),mime:im.mime})),...shots.map((f:string)=>({path:join(dir,'runtime',f),mime:'image/png'}))];
  mkdirSync(join(dir,'judge'),{recursive:true});
  const r=await callSpecNode({system:STYLE_SYSTEM,text:JSON.stringify({scene:spec.name,conceptImages:refs.map((im:any)=>im.caption??im.name),screenshots:shots,shotLabels:read(join(project,'game/assets/scene-audit.json')).views.map((v:any)=>v.name)}),images,role:'spec-style-judge',signal},join(dir,'judge'),nodeModels.styleReview,STYLE_SCHEMA);
  const value=verifiedVisualReview(JSON.parse(r.text),images.length);save(join(dir,'style-review.json'),{version:STYLE_JUDGE_VERSION,model:nodeModels.styleReview.model,provider:nodeModels.styleReview.provider,references:refs.map((im:any)=>im.id),screenshots:shots,...value});job.styleReview=value;return value;
 }),signal);const style:any=reviewReport.value;if(reviewReport.error){job.styleReviewError=reviewReport.error;event(job,'judge','风格报告未完成，保留场景并等待人工确认');}
 await stage('gate',async()=>{
  const hard={...runtime.hard,build:runtime.buildEvidence===true,catalog:runtime.catalogEvidence===true},failed=Object.entries(hard).filter(([,v])=>!v).map(([k])=>k),sg=style?styleGate(style):null;
  // 可选报告失败不再只写 event：写进门禁，owner 认可时必须逐项确认，避免失败被静默吞掉。
  const verifyError=verifyReport.error??null,styleReviewError=reviewReport.error??null;
  // 性能基线：frame time 分布 + 场景静态成本 + 渲染配置指纹，供有界优化回路前后对比。
  // Engine 未暴露 drawCalls / GPU time，这里不编造 GPU 分解，缺失项在 baseline.scope 里声明。
  const readIf=(p:string):any=>existsSync(p)?read(p):null;
  const baseline=buildPerformanceBaseline({runtime,specExport:job.specExport,
   renderProfile:readIf(join(project,'render-profile.json')),
   dist:readIf(join(project,'game/dist/forgeax-dist.json')),
   preset:readIf(join(project,'performance-preset.json'))?.preset??null,at:new Date().toISOString()});
  save(join(dir,'performance-baseline.json'),baseline);job.performanceBaseline=baseline;
  const optimization=job.performanceOptimization;
  if(optimization?.beforeBaseline){
   const comparison=comparePerformance(optimization.beforeBaseline,baseline);
   const record={round:optimization.round,preset:optimization.preset,
    before:{fps:optimization.beforeBaseline.frameTiming.submittedFps??0,p95FrameMs:optimization.beforeBaseline.frameTiming.p95FrameMs},
    after:{fps:runtime.submittedFps,p95FrameMs:baseline.frameTiming.p95FrameMs,distManifestDigest:runtime.distManifestDigest},
    improved:comparison.improved,visualReviewPassed:style?sg!.passed:null};
   job.performanceOptimizationResult={version:optimization.version,sourceJobId:optimization.sourceJobId,...record,comparison,
    visualReviewRequired:true,note:'优化不得冒充验收通过：owner 仍须查看固定机位并显式确认；画面变化须由视觉评审独立验证。'};
   job.performanceOptimizationChain=[...(optimization.chain??[]),record];
   save(join(dir,'performance-optimization.json'),job.performanceOptimizationResult);
   event(job,'gate',`第 ${record.round} 轮性能优化（${record.preset}）：${Number(record.after.fps??0).toFixed(1)} FPS，${comparison.improved?'有有效提升':'无有效提升'}；视觉评审仍需独立确认`);
  }
  job.specGate={version:SPEC_JOB_VERSION,hard,failed,fps:runtime.submittedFps,ownerApproval:'pending',complete:!job.specExport.unresolved&&!job.specExport.proxies,verifyError,styleReviewError,styleJudge:style?{version:STYLE_JUDGE_VERSION,overall:style.overall,verdict:style.verdict,passed:sg!.passed,lowDimensions:sg!.low,threshold:STYLE_PASS,advisory:true}:null};save(join(dir,'spec-gate.json'),job.specGate);
  job.status=specV2Outcome({hard});
 });
 event(job,'complete',job.status==='failed'?'运行存在错误，请检查运行报告':'场景已生成，风格及工程检查供参考，等待 owner 目视确认');
}
