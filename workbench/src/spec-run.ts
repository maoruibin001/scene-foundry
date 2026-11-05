/**
 * 规格模式任务:输入是已规格化的 scene-spec-v1(来自设计文档/文字/照片的规格化步骤),概念图只作风格参照,不当重建目标。
 * 阶段:plan(规格摘要 + 验收条目)→ generate(规格 → 工程)→ export/build/verify(prototype pipeline 的 spec-pack 分支)
 * → runtime(真实 Engine 采集)→ gate(确定性运行检查)。视觉风格判分是后续步骤,本阶段如实标 needs_review,不冒充通过。
 */
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {ROOT,DATA,UPLOADS,read,save,saveJob,event,digest} from './store';
import {prepareSpecProject} from './spec/prepare-spec';
import {normalizeDocument} from './spec/normalize-doc';
import {callClaude10,CLAUDE10_MODEL} from './claude10-provider';
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
export const STYLE_JUDGE_VERSION='spec-style-judge-v1';
export const STYLE_PASS={overall:70,minDimension:2};
const dim={type:'object',additionalProperties:false,required:['id','score','reason'],properties:{id:{type:'string',enum:['lighting','material','atmosphere','composition','subject','density']},score:{type:'number',minimum:0,maximum:5},reason:{type:'string'}}};
export const STYLE_SCHEMA={type:'object',additionalProperties:false,required:['overall','verdict','dimensions','strengths','issues','summary'],properties:{overall:{type:'number',minimum:0,maximum:100},verdict:{type:'string',enum:['match','partial','mismatch']},dimensions:{type:'array',minItems:6,maxItems:6,items:dim},strengths:{type:'array',items:{type:'string'},maxItems:8},issues:{type:'array',items:{type:'string'},maxItems:8},summary:{type:'string'}}};
const STYLE_SYSTEM=`你是游戏美术总监,独立评审一个程序化生成的三维场景是否还原了概念图的整体感觉。前面若干张是概念图(风格参照,不是几何目标),后面是真实引擎实际截图。
只评整体感觉:光影基调与光源因果(lighting)、材质质感(material)、氛围与空气感(atmosphere)、构图与空间尺度(composition)、标志性主体是否成立(subject:黑色核心球、三道环、能量柱、玻璃控制室、湿地面/水面倒影)、画面密度与细节(density)。允许位置有偏差、细节不逐一对齐;不要因为缺少概念图中纯玩法或特效元素(人物、火焰、破坏)扣分。
每维 0..5 分;overall 0..100 表示整体感觉还原度;verdict:match=整体感觉对、partial=部分对、mismatch=不对。strengths/issues 具体到画面元素。不采信任何作者自述,只看图。全部用中文。`;
export function styleGate(r:any){const low=r.dimensions.filter((d:any)=>d.score<STYLE_PASS.minDimension).map((d:any)=>d.id);return {passed:r.overall>=STYLE_PASS.overall&&r.verdict!=='mismatch'&&!low.length,low};}

export async function runSpec({job,dir,stage,command,preview}:any){
 if(!job.specId){
  // 文档输入:先规格化。同一文档的早先任务已有模型输出时复用(任务文本哈希一致才复用),不重复调用模型。
  await stage('normalize',async()=>{
   // 同一文档的规格化模型输出缓存在数据目录(按文档摘要);任务文本哈希一致才复用,提示词或解析变了就重新调用模型。
   const out=join(dir,'normalize'),cache=join(SPEC_JOBS_DIR(),'doc-calls',job.docId),reuse=existsSync(cache);
   if(reuse)cpSync(cache,join(out,'calls'),{recursive:true});
   const {spec:normalized,report}=await normalizeDocument(docPath(job.docId),out,'xhigh',reuse?'1':undefined);
   cpSync(join(out,'calls'),cache,{recursive:true});job.normalizeReused=reuse;
   const stored=storeSpec(normalized,join(out,'style'));job.specId=stored.id;job.normalizeReport=report.summary;saveJob(job);
  });
 }
 const {spec,styleImages}=loadSpec(job.specId),project=join(dir,'project'),PROTO=resolve(ROOT,'../prototype');
 job.plan=await stage('plan',async()=>{const p=specPlan(spec);save(join(dir,'plan.json'),p);save(join(dir,'scene-spec.json'),spec);return p;});
 job.styleImages=styleImages;
 await stage('generate',async()=>{
  const r=await prepareSpecProject(project,spec,{id:'spec-'+job.id});
  job.generationMethod='spec-pack';job.generationModel=spec.provenance.model?`规格化 ${spec.provenance.model};网格由程序化生成器在 Engine 构建时产出`:'程序化生成器';
  job.specExport={triangles:r.plan.triangles,meshes:r.plan.meshes.length,entities:r.plan.entities.length,proxies:r.plan.report.proxies.length,covered:r.plan.report.covered.length,dropped:r.plan.report.dropped.length,errors:r.plan.report.errors.length,deferred:r.world.deferred};
  save(join(dir,'spec-export.json'),{...job.specExport,report:r.plan.report});
  if(r.plan.report.errors.length)throw Error('规格导出存在错误:'+r.plan.report.errors.slice(0,5).join(';'));
 });
 for(const [name,op] of [['export','generate'],['build','build'],['verify','verify']])await stage(name,()=>command(['bun',join(PROTO,'bin/pipeline.ts'),op]));
 const report=read(join(project,'evidence/run-report.json'));job.objectCount=job.specExport.entities;job.entityCount=job.specExport.entities;job.nativeMetrics=report.generated;
 const runtime=await stage('runtime',async()=>{
  saveJob(job);job.previewUrl=await preview(job.id);saveJob(job);const output=join(dir,'runtime');mkdirSync(output,{recursive:true});
  await command(['node',join(ROOT,'src/geometry/capture.mjs'),join(project,'game'),job.previewUrl,output],600000);
  const result=read(join(output,'runtime.json'));if(result.distManifestDigest!==report.distManifestDigest)throw Error('运行证据与构建摘要不一致');
  result.buildEvidence=job.stages.build.status==='passed';result.catalogEvidence=job.stages.verify.status==='passed';save(join(output,'runtime.json'),result);job.runtime=result;return result;
 });
 const style=await stage('judge',async()=>{
  // 主视觉/左/右/高位观察 4 张概念图 + 全部规格机位截图。
  const refs=styleImages.filter((im:any)=>/主视觉|左侧观察|右侧观察|高位观察/.test(im.caption??im.name)).slice(0,4);
  const shots=runtime.images.filter((f:string)=>f.startsWith('inspection-'));
  const images=[...refs.map((im:any)=>({path:join(UPLOADS,im.file),mime:im.mime})),...shots.map((f:string)=>({path:join(dir,'runtime',f),mime:'image/png'}))];
  mkdirSync(join(dir,'judge'),{recursive:true});
  const r=await callClaude10({system:STYLE_SYSTEM,text:JSON.stringify({scene:spec.name,conceptImages:refs.map((im:any)=>im.caption??im.name),screenshots:shots,shotLabels:read(join(project,'game/assets/scene-audit.json')).views.map((v:any)=>v.name)}),images,role:'spec-style-judge',modelSettings:{model:CLAUDE10_MODEL,reasoningEffort:'high'} as any},join(dir,'judge'),CLAUDE10_MODEL,STYLE_SCHEMA);
  const value=JSON.parse(r.text);save(join(dir,'style-review.json'),{version:STYLE_JUDGE_VERSION,model:CLAUDE10_MODEL,references:refs.map((im:any)=>im.id),screenshots:shots,...value});job.styleReview=value;return value;
 });
 await stage('gate',async()=>{
  const hard={...runtime.hard,build:runtime.buildEvidence===true,catalog:runtime.catalogEvidence===true},failed=Object.entries(hard).filter(([,v])=>!v).map(([k])=>k),sg=styleGate(style);
  job.specGate={version:SPEC_JOB_VERSION,hard,failed,fps:runtime.submittedFps,styleJudge:{version:STYLE_JUDGE_VERSION,overall:style.overall,verdict:style.verdict,passed:sg.passed,lowDimensions:sg.low,threshold:STYLE_PASS}};save(join(dir,'spec-gate.json'),job.specGate);
  job.status=failed.length?'failed':sg.passed?'passed':'needs_review';
 });
 event(job,'complete',job.status==='failed'?'规格场景运行检查未通过:'+job.specGate.failed.join(','):job.status==='passed'?`风格判分 ${style.overall} 分(${style.verdict}),整体感觉与概念图一致`:`风格判分 ${style.overall} 分(${style.verdict}),未达整体感觉门槛`);
}
