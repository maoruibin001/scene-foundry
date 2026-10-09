import {CROWN_RULES} from './branch-crown';
import {compactBlockoutSchema,COMPACT_BLOCKOUT_RULES} from './blockout-contract';
import {spatialRejectedFeedback,assertNotRejectedSpatialScene} from './spatial-rejected-attempt';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated} from '../contracts';
import {read,save,digest} from '../store';
import {spaceSchema} from './layout-stages';
import {prepareVisibilityEvidence} from './visibility-evidence';
import {ensureProjectionEvidence} from './projection-evidence';
import {VISIBILITY_PROMPT} from './visibility';
import {createGrayboxSpacePreview} from './graybox-space-preview';
import {validateScene} from './scene-contract';
import {spatialInstances} from './spatial-order';
import {grayboxPartEditSchema,applyGrayboxLocalParts,buildGrayboxPartScene} from './graybox-local-parts';
import {referenceComposition} from './reference-composition';

export const GRAYBOX_SPACE_REPAIR='graybox-space-repair-v7';
const object=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const subset=(properties:any,keys:string[])=>Object.fromEntries(keys.map(k=>[k,properties[k]]));
const list=(items:any,maxItems:number)=>({type:'array',items,maxItems});
/** Derive coordinates and brief fields from the full space contract; identities remain frozen. */
export function grayboxSpaceRepairSchema(){
 const full=spaceSchema().properties,p=full.program.properties;
 return object({version:{type:'string',enum:[GRAYBOX_SPACE_REPAIR]},reason:{type:'string',minLength:20,maxLength:1800},
  instances:list(object(subset(p.instances.items.properties,['id','position','rotation','scale'])),12),
  templates:{...list(object(subset(p.templates.items.properties,['id','description','origin','bounds'])),0)},
  parts:grayboxPartEditSchema(),
  groups:list(object({templateId:{type:'string'},parts:compactBlockoutSchema().properties.templates.items.properties.parts}),3),
  cameras:list({...object(subset(full.cameras.items.properties,['name','position','target','fov'])),properties:{...subset(full.cameras.items.properties,['name','position','target','fov']),orthographicHeight:full.cameras.items.properties.orthographicHeight}},6),
  contacts:list(object(subset(full.spatialContacts.items.properties,['id','points'])),8),
  checks:{...list(object({relationIds:{type:'array',items:{type:'string'},minItems:1},evidence:{type:'string',minLength:10},expectedChange:{type:'string',minLength:10}}),6),minItems:1}});
}
const fail=(ok:any,message:string)=>{if(!ok)throw Error('灰模局部修正：'+message);};
function keys(value:any,allowed:string[],label:string){
 fail(value&&typeof value==='object'&&!Array.isArray(value),label+'须为对象，必需字段='+JSON.stringify(allowed));
 const missing=allowed.filter(k=>!Object.hasOwn(value,k)),extra=Object.keys(value).filter(k=>!allowed.includes(k));
 fail(!missing.length&&!extra.length,label+'字段不符：缺少='+JSON.stringify(missing)+'；未允许='+JSON.stringify(extra)+'；必需字段='+JSON.stringify(allowed));
}
const vector=(v:any)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
function rows(value:any,max:number,label:string){fail(Array.isArray(value)&&value.length<=max,label+'超出本次局部补丁额度');}
/** The patch cannot delete objects, relabel requirements, change relationships or lower budgets. */
export function applyGrayboxSpaceRepair(space:any,patch:any,validate:(space:any)=>any){
 keys(patch,['version','reason','instances','templates','parts','cameras','contacts','checks',...(Object.hasOwn(patch,'groups')?['groups']:[])],'补丁');
 if(patch.groups!==undefined){fail([GRAYBOX_SPACE_REPAIR,'graybox-space-repair-v6','graybox-space-repair-v5','graybox-space-repair-v4'].includes(patch.version),'历史局部补丁不能重建组群');rows(patch.groups,3,'组群');}
 fail([GRAYBOX_SPACE_REPAIR,'graybox-space-repair-v6','graybox-space-repair-v5','graybox-space-repair-v4','graybox-space-repair-v3','graybox-space-repair-v2'].includes(patch.version),'版本无效');fail(typeof patch.reason==='string'&&patch.reason.trim().length>=20&&patch.reason.length<=1800,'需写明可见差距与修正依据');
 fail(patch.version!=='graybox-space-repair-v2'||!patch.parts?.some(p=>Object.hasOwn(p,'shape')),'旧姿态契约不能替换轮廓');
 rows(patch.instances,12,'实例');rows(patch.templates,0,'模板');rows(patch.parts,24,'部件');rows(patch.cameras,6,'机位');rows(patch.contacts,8,'连接');rows(patch.checks,6,'检查');
 if(![GRAYBOX_SPACE_REPAIR,'graybox-space-repair-v6'].includes(patch.version)&&[...(patch.parts??[]),...(patch.groups??[]).flatMap(g=>g.parts??[])].some(p=>p.shape?.type==='grid'))throw Error('历史灰模补丁契约不支持粗曲面grid');
 const next=structuredClone(space),changed:any={instances:[],templates:[],cameras:[],contacts:[]};
 for(const [name,source,idKey,allowed] of [['instances',next.program.instances,'id',['id','position','rotation','scale']],['templates',next.program.templates,'id',['id','description','origin','bounds']],['cameras',next.cameras,'name',['name','position','target','fov']],['contacts',next.spatialContacts??[],'id',['id','points']]] as const){
  const seen=new Set();for(const edit of patch[name]){
   const fields=[...allowed,...(name==='cameras'&&patch.version===GRAYBOX_SPACE_REPAIR&&Object.hasOwn(edit,'orthographicHeight')?['orthographicHeight']:[])];
   keys(edit,fields,name);const id=edit[idKey];fail(!seen.has(id),name+'身份重复：'+id);seen.add(id);
   const matches=source.filter(x=>x[idKey]===id);fail(matches.length===1,'只能修改已有'+name+'：'+id);const current=matches[0],before=JSON.stringify(current);
   if(name==='instances'){for(const k of ['position','rotation','scale'])fail(vector(edit[k]),'实例坐标必须为有限三元组');fail(edit.scale.every((n,k)=>n/current.scale[k]>=.5&&n/current.scale[k]<=2),'单轮实例尺度须为来源的0.5至2倍');}
   if(name==='templates'){
    fail([edit.description,edit.origin].every(v=>typeof v==='string'&&v.trim()&&v.length<=1800),'模板需保留简洁轮廓与原点依据');keys(edit.bounds,['min','max'],'bounds');
    fail(vector(edit.bounds.min)&&vector(edit.bounds.max),'模板边界坐标无效');
    fail(edit.bounds.max.every((n,k)=>{const span=n-edit.bounds.min[k],old=current.bounds.max[k]-current.bounds.min[k];return span>.001&&span/old>=.5&&span/old<=2;}),'单轮局部边界跨度须为来源的0.5至2倍');
   }
   if(name==='cameras')fail(vector(edit.position)&&vector(edit.target)&&Number.isFinite(edit.fov),'机位参数无效');
   if(name==='cameras'&&Object.hasOwn(edit,'orthographicHeight')){
    if(current.projection==='orthographic')fail(Number.isFinite(edit.orthographicHeight)&&edit.orthographicHeight>0&&edit.orthographicHeight/current.orthographicHeight>=.5&&edit.orthographicHeight/current.orthographicHeight<=2,'正交覆盖高度须为来源的0.5至2倍');
    else fail(edit.orthographicHeight===null,'透视机位不能借覆盖高度切换投影类型');
   }
   if(name==='contacts')fail(Array.isArray(edit.points)&&edit.points.length===current.points.length&&edit.points.every(vector),'连接采样数必须保留，局部点须为有限三元组');
   for(const k of fields)if(k!==idKey)current[k]=structuredClone(edit[k]);if(JSON.stringify(current)!==before)changed[name].push(id);
  }
 }
 fail(Object.values(changed).some((r:any)=>r.length)||patch.parts.length||patch.groups?.length,'NO_ACTIONABLE_CHANGE：补丁没有实际修改，不重跑原画面');
 fail(patch.checks.length>0,'至少一项有依据的预期检查');
 for(const check of patch.checks){keys(check,['relationIds','evidence','expectedChange'],'检查');fail(check.relationIds?.length&&new Set(check.relationIds).size===check.relationIds.length&&check.relationIds.every(id=>space.spatialRelations.some(r=>r.id===id)),'检查只能引用冻结关系');fail([check.evidence,check.expectedChange].every(v=>typeof v==='string'&&v.trim().length>=10),'检查需说明实际画面与预期变化');}
 return {value:validate(next),changes:changed,sourceSpaceSha256:digest(JSON.stringify(space)),spaceSha256:digest(JSON.stringify(next))};
}

export const GRAYBOX_REPAIR_PROMPT=CROWN_RULES+`
依据原始参考图、实际Engine灰模、实例编号图和独立关系评分，只输出graybox-space-repair-v7补丁。编号图是编译几何定位证据，不是参考图分割或质量分；不能用编号图颜色解释原图材质。检查机位帮助辨别深度，仍以referenceIndex对应的实拍判断构图。
先把具体关系差距对应到实例和已有冠体/框架部件；用实例position/rotation/scale或参考相机校正占幅、左右、前后、通道和遮挡。最多改12实例、6机位、8连接；空数组表示保留。templates必须为空，模板简报和预算冻结。parts最多修改4个模板的24个已有部件，含templateId/partId/position/rotation/scale及可选shape；shape省略/null保留来源。最多2模板6部件可替换为完整契约的粗轮廓box/tube/lathe/extrusion/cushion/grid，最多12轮廓点/分段、cushion最多8分段；grid限定每轴2..9、总点数<=81，保持真实曲面边界和闭合需要；不使用scatter或手工逐叶逐花。另可用groups:[{templateId,parts}]重建最多3个失败模板的内部结构，每模板1–8个部件，使用同一灰模契约的box/tube/lathe/extrusion/cushion/branchCrown/grid，不强制包含任何场景类别专属几何；按冻结简报重建真实承托、连接、轮廓和空隙，建筑/家具/机械结构可由框架或封闭体组合，植物才按需要使用连接枝冠。每部件完整id/position/rotation/scale/shape，系统填灰材质。groups与parts不得同时修改同一模板。新部件可重排，但实体/模板id、原bounds、数量、需求、总预算和机位证据保持约束。不要保留已经错误的孤立大块只换文字；也不能用无关密度堵住通道。仅姿态不能表达已确认的过粗或断续轮廓时，依据原图更换这些已有部件的轮廓；共享模板会同时影响其全部实例，必须检查其全部使用位置和不同深度，不能假装只影响单个实例。UV/材质/身份数量、原bounds、开口和总几何上限仍保持来源。依据原图调整部件连接、尺度层次及局部空隙，不用大块填满画幅或封堵通道。模板id/label/maxParts、实体语义、数量、需求和关键关系由系统保留，不能新增删除实体或模板、降低关键性或用机位隐藏主体。未列出的字段和对象逐字保留。
实例及部件尺度每轴每轮仅允许来源的0.5到2倍；部件位移每轴不超过冻结bounds跨度的一半，全部实际编译几何仍须在原bounds内，单位米、Z向上、rotation为XYZ弧度。机位name、projection不改，referenceIndex与画幅由系统保留。正交投影的占幅由orthographicHeight决定，fov不影响正交画面；可以在相机补丁中显式调整覆盖高度为来源的0.5至2倍，省略则保持来源。透视机位使用fov，不能借orthographicHeight改变投影类型。接触points属aId局部坐标，数量保留；移动连接双方时一起检查冻结开口和接触点不能脱离边界。需要更大结构变化应在reason说明未解决，不能绕过校验。
branchCrown由系统构造枝叶，模型仅选结构参数；不手工逐叶、材质或细节规划。按本次独立评审指出的真实失败关系同时看连接、空隙和轮廓，不以外接框改善替代实拍判断。reason说明原图差距、实际网格的定位依据和改动；checks引用原关系id，描述实拍证据与下一轮可见预期。不能声称尚未渲染的补丁已经通过。`;

export async function repairGrayboxSpace(space:any,ctx:any,sourceFolder:string,feedback:any,folder:string,validate:(space:any)=>any){
 mkdirSync(folder,{recursive:true});
 const runtime=read(join(sourceFolder,'runtime/runtime.json')),source=read(join(sourceFolder,'render-scene.json'));
 const frameNames=runtime.referenceFrames.map(f=>f.file);
 const projection=await ensureProjectionEvidence(source,ctx.images,ctx.images.map((i:any)=>digest(readFileSync(i.path))),sourceFolder,runtime,folder,ctx.signal);
 const evidence=prepareVisibilityEvidence(source,{},folder,projection.sourceFolder,projection.runtime,frameNames);
 const composition=referenceComposition(source,ctx.observation,read(join(folder,'visibility.json')));
 save(join(folder,'reference-composition.json'),composition);
 const canonical=read(join(sourceFolder,'scene.json')),rejected=spatialRejectedFeedback(ctx,sourceFolder,folder);
 const buildScene=(next:any,patch:any)=>assertNotRejectedSpatialScene(rejected.attempts,buildGrayboxPartScene(canonical,next,patch,ctx.plan,ctx.images.length));
 const preview=createGrayboxSpacePreview({space,sourceScene:canonical,observation:ctx.observation,images:ctx.images,folder:join(folder,'preview'),signal:ctx.signal,schema:grayboxSpaceRepairSchema(),
  apply:patch=>applyGrayboxSpaceRepair(space,patch,validate),
  buildScene});
 const result=await callValidated({role:'scene-space',modelSettings:ctx.job.modelSettings,signal:ctx.signal,maxTokens:6500,schemaContext:{grayboxRepair:true},
  tools:preview.kit,
  images:[...ctx.images,...frameNames.map(f=>({path:join(sourceFolder,'runtime',f),mime:'image/png'})),...rejected.images,...evidence.images],
  system:GRAYBOX_REPAIR_PROMPT+'\n'+COMPACT_BLOCKOUT_RULES+'\n'+VISIBILITY_PROMPT+'\n'+preview.kit.instructions+'\n若输入有rejectedCandidates，额外图片在来源Engine画面之后、编号图之前，按rejectedEngineFrames排列。它们是已独立失败的改动和实拍，不是来源或新参考目标；比较其具体退步与当前较好来源，避免重复那些几何。只在当前来源上修正，不能累积失败候选或采信它的成功宣称。完全相同的失败几何和机位将在测量/渲染前拒绝。',
  text:JSON.stringify({input:ctx.job.prompt,plan:ctx.plan,previousSpace:space,actualGraybox:source.program,observation:ctx.observation,referenceComposition:composition,feedback,rejectedCandidates:rejected.context,visibility:evidence.context,
   diagnosedStrategy:ctx.job.spatialDiagnosis?.reason??null,imageOrder:{references:ctx.images.length,engineFrames:runtime.referenceFrames,rejectedEngineFrames:rejected.attempts.flatMap(a=>a.frames.map(f=>({jobId:a.jobId,round:a.round,file:f.file,referenceIndex:f.referenceIndex,sha256:f.sha256}))),diagnosticMaps:evidence.context.diagnosticImages},
   source:{spaceSha256:digest(JSON.stringify(space)),renderSceneSha256:digest(readFileSync(join(sourceFolder,'render-scene.json'))),runtimeDigest:runtime.distManifestDigest}})},folder,patch=>{applyGrayboxSpaceRepair(space,patch,validate);preview.assertReviewed(patch);return patch;});
 const applied=applyGrayboxSpaceRepair(space,result.value,validate),local=applyGrayboxLocalParts(canonical,applied.value,result.value.parts,result.value.groups??[]),scene=buildScene(applied.value,result.value);
 if(!Object.values(applied.changes).some((r:any)=>r.length)&&!local.changed.length)throw Error('NO_ACTIONABLE_CHANGE：部件姿态也没有实际修改');
 applied.changes.parts=local.changed;save(join(folder,'patch.json'),result.value);save(join(folder,'applied-space.json'),applied.value);save(join(folder,'reviewed-scene.json'),scene);
 save(join(folder,'repair-receipt.json'),{contract:GRAYBOX_SPACE_REPAIR,...applied,value:undefined,sourceFolder,sourceEngineFrames:evidence.context.diagnosticImages,preview:preview.assertReviewed(result.value),modelReceipt:result.receipt});
 return {value:applied.value,scene,folder,receipt:result.receipt,changes:applied.changes};
}
