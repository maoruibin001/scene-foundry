import {calibrateRadiometry} from './spec/radiometry';
import {resolvePhotometricContinuity} from './spec/photometric-continuity';
import {getJob,runDir} from './store';
import {repairAppearance,resolveLightingSemantics} from './spec/appearance-continuation';
import {repairSpecParameters} from './spec/parameter-repair';
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
import {getParallelAssetStats} from './spec/parallel-assets';
import {normalizeDocument} from './spec/normalize-doc';
import {callSpecNode,validateNodeModels} from './spec/node-models';
import {optionalReport,specV2Outcome} from './spec/workflow-v2';
import {sceneSpecErrors,type SceneSpec} from './spec/schema';

export const SPEC_JOB_VERSION='spec-job-v1';
export const SPEC_JOBS_DIR=()=>process.env.PIPELINE_SPEC_DIR??join(DATA,'specs');

/** 规格文件按内容寻址保存进数据目录;任务只引用摘要,规格改动必须产生新摘要、新任务。 */
export function storeSpec(spec:SceneSpec,styleDir?:string){
 const errors=sceneSpecErrors(spec);if(errors.length)throw Error('SCENE_SPEC_INVALID:'+errors.slice(0,20).join('\n'));
 const text=JSON.stringify(spec),id=digest(text),dir=SPEC_JOBS_DIR();mkdirSync(dir,{recursive:true});
 // 风格参考图作为上传文件保存,工作台可直接展示;规格里的路径改写为上传文件 ID。
 const styleImages=spec.styleRefs.flatMap(r=>{
  const p=existsSync(r.path)?r.path:styleDir?join(styleDir,basename(r.path)):'';if(!p||!existsSync(p))return [];
  const bytes=readFileSync(p),sid=digest(bytes),png=bytes[0]===0x89,file=sid+(png?'.png':'.jpg');
  if(!existsSync(join(UPLOADS,file)))copyFileSync(p,join(UPLOADS,file));
  const meta={id:sid,file,mime:png?'image/png':'image/jpeg',name:r.caption,size:bytes.length};save(join(UPLOADS,sid+'.json'),meta);return [{...meta,refId:r.id,caption:r.caption}];
 });
 save(join(dir,id+'.json'),spec);save(join(dir,id+'.style.json'),styleImages);
 return {id,styleImages};
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
   const out=join(dir,'normalize'),cache=join(SPEC_JOBS_DIR(),'doc-calls',job.docId,digest(JSON.stringify([job.normalizationTemplate??'general',nodeModels.families,nodeModels.objects,nodeModels.staging]))),reuse=existsSync(cache);
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
 const {spec:sourceSpec,styleImages}=loadSpec(job.specId);let spec=sourceSpec;const project=join(dir,'project'),PROTO=resolve(ROOT,'../prototype');
 if(job.appearanceSourceJobId){
  const previous=getJob(job.appearanceSourceJobId),sourceDir=runDir(previous.id),shots=(previous.runtime?.images??[]).filter((f:string)=>/^inspection-[^/]+\.png$/.test(f));
  const images=[...visualReferences(styleImages).map((im:any)=>({path:join(UPLOADS,im.file),mime:im.mime})),...shots.map((f:string)=>({path:join(sourceDir,'runtime',f),mime:'image/png'}))];
  const revised=await stage('appearance',()=>job.appearanceKind==='radiometry'?calibrateRadiometry(sourceSpec,previous.styleReview,images,join(dir,'appearance'),nodeModels.parameterRepair,signal):job.appearanceKind==='photometric'?resolvePhotometricContinuity(loadSpec(getJob(previous.appearanceSourceJobId).specId).spec,sourceSpec,join(dir,'appearance')):job.appearanceKind==='physics'?resolveLightingSemantics(sourceSpec,previous.styleReview,join(dir,'appearance'),nodeModels.parameterRepair,signal):repairAppearance(sourceSpec,previous.styleReview,images,join(dir,'appearance'),nodeModels.parameterRepair,signal));
  spec=revised.spec;job.specContinuation=revised.receipt;job.appearanceRevision={sourceJobId:previous.id,before:previous.styleReview.overall,mechanism:'source-appearance-continuation-v1'};
  job.specId=storeSpec(spec).id;saveJob(job);
 }
 job.plan=await stage('plan',async()=>{const p=specPlan(spec);save(join(dir,'plan.json'),p);save(join(dir,'scene-spec.json'),spec);return p;});
 job.styleImages=styleImages;
 const repaired=await stage('parameters',()=>repairSpecParameters(spec,join(dir,'parameter-repair'),nodeModels.parameterRepair,signal));spec=repaired.spec;job.parameterResolution=repaired.receipt?{resolved:repaired.receipt.decisions.length,unresolved:repaired.receipt.remaining.unresolved.length,designFill:repaired.receipt.decisions.filter((x:any)=>x.basis==='design_fill').length}:null;save(join(dir,'source-scene-spec.json'),sourceSpec);save(join(dir,'scene-spec.json'),spec);saveJob(job);
 await stage('generate',async()=>{
  const r=await prepareSpecProject(project,spec,{id:'spec-'+job.id});
  job.generationMethod='spec-pack';job.generationModel=spec.provenance.model?`规格化 ${spec.provenance.model};网格由程序化生成器在 Engine 构建时产出`:'程序化生成器';
  job.specExport={reusedSourceObjects:spec.objects.filter(o=>o.sourceMesh).length,generatedObjects:spec.objects.filter(o=>!o.sourceMesh).length,triangles:r.plan.triangles,meshes:r.plan.meshes.length,entities:r.plan.entities.length,instancing:r.plan.instancing,decals:(spec.decals??[]).length,proxies:r.plan.report.proxies.length,unresolved:r.plan.report.unresolved.length,covered:r.plan.report.covered.length,dropped:r.plan.report.dropped.length,errors:r.plan.report.errors.length,deferred:r.world.deferred,parallelWorkers:r.exportStats.parallelWorkers,exportMs:r.exportStats.durationMs,previewMs:0};
  save(join(dir,'spec-export.json'),{...job.specExport,report:r.plan.report});
  if(r.plan.report.errors.length)throw Error('规格导出存在错误:'+r.plan.report.errors.slice(0,5).join(';'));
  // 程序化资产预览:每种生成器网格一张等轴缩略图 + 参数索引,供工作台「程序化资产」卡片与资产页展示。
  try{
   const previewT0=performance.now();
   const items=await writeAssetPreviewsParallel(spec,r.plan,join(dir,'spec-assets'));
   const previewMs=Math.round(performance.now()-previewT0);
   const previewWorkers=getParallelAssetStats().lastPoolWorkers;
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
  job.specGate={version:SPEC_JOB_VERSION,hard,failed,fps:runtime.submittedFps,ownerApproval:'pending',complete:!job.specExport.unresolved&&!job.specExport.proxies,styleJudge:style?{version:STYLE_JUDGE_VERSION,overall:style.overall,verdict:style.verdict,passed:sg!.passed,lowDimensions:sg!.low,threshold:STYLE_PASS,advisory:true}:null};save(join(dir,'spec-gate.json'),job.specGate);
  job.status=specV2Outcome(runtime);
 });
 event(job,'complete',job.status==='failed'?'运行存在错误，请检查运行报告':'场景已生成，风格及工程检查供参考，等待 owner 目视确认');
}
