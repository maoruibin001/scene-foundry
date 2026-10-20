import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit} from '../codex-tools';
import {SPACE_PROMPT,spacePlanningSchema} from './layout-stages';
import {assertLatticeVector,validateVoxelLattice,validateVoxelSpace,voxelSpaceGrid} from '../voxel/scene-lattice';
import {validateVoxelLandmarkCoverage,voxelComponentRequirements} from '../voxel/landmark-coverage';
import {VOXEL_LIMITS} from '../voxel/limits';
import {ASSET_STEP_LIMITS} from './surface-part-budget';

export const SPACE_CONSTRUCTION='space-checkpoint-v1';
/** Strict voxel planning saves the shared skeleton, then landmark component groups. */
export const SPACE_CONSTRUCTION_GROUPED='space-checkpoint-v2';
export const SPACE_CONSTRUCTION_VERSIONS=[SPACE_CONSTRUCTION,SPACE_CONSTRUCTION_GROUPED] as const;
const MAX_WRITES=12,MAX_WRITES_GROUPED=32,MAX_SECTION_CHARS=262144;
const hash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const check=(v:any,message:string)=>{if(!v)throw Error('空间检查点：'+message);};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const reply=(v:any)=>({content:[{type:'text' as const,text:JSON.stringify(v)}]});
type Sections={core:any|null;spatialOpenings:any[]|null;spatialContacts:any[]|null};
type State=Sections&{version:string;jobId:string;rootJobId:string;inputKey:string;writes:number;checksum:string};
function signed<T extends object>(value:T){return {...value,checksum:digest(stable(value))};}
function assertChecksum(value:any){const {checksum,...body}=value;check(hash(checksum)&&checksum===digest(stable(body)),'记录摘要已改变');}
function planOf(state:Sections){return {...state.core,version:'scene-space-plan-v2',spatialOpenings:state.spatialOpenings??[],spatialContacts:state.spatialContacts??[]};}
function complete(state:Sections){return state.core!==null&&state.spatialOpenings!==null&&state.spatialContacts!==null;}
export function spaceCoreSchema(ids?:string[],options:{strictVoxel?:boolean}={}){
 const schema=spacePlanningSchema(ids,options);schema.properties.version.enum=['scene-space-core-v1'];
 // Old perspective-only checkpoints keep their original camera declaration.
 const camera=schema.properties.cameras.items;camera.required=camera.required.filter((k:string)=>!['projection','orthographicHeight'].includes(k));
 for(const key of ['spatialOpenings','spatialContacts']){delete schema.properties[key];schema.required=schema.required.filter((k:string)=>k!==key);}
 return schema;
}
/** Tool JSON strings must retain the declared field contract; semantic limits use validateSpace. */
function assertShape(value:any,schema:any,path='core'){
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 check(types.some((type:string)=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isInteger(value):typeof value===type),'字段类型无效：'+path);
 if(schema.enum)check(schema.enum.includes(value),'字段枚举无效：'+path);
 if(schema.type==='object'){
  check((schema.required??[]).every((k:string)=>Object.hasOwn(value,k)),'缺少字段：'+path);
  check(Object.keys(value).every(k=>Object.hasOwn(schema.properties,k)),'存在未声明字段：'+path);
  for(const [key,item] of Object.entries(value))assertShape(item,schema.properties[key],path+'.'+key);
 }
 if(schema.type==='array')for(const [i,item] of value.entries())assertShape(item,schema.items,path+'['+i+']');
}
export function spaceConstructionPrompt(instructions:string,version:string=SPACE_CONSTRUCTION){
 if(version===SPACE_CONSTRUCTION_GROUPED)return '这是初始空间规划。先用 save_space_skeleton 保存共享格网、模板和机位，再按原图地标分组用 save_space_component_group 逐组保存实例、实体及绑定，全部地标覆盖后分别保存开口和连接约束；本步骤不生成几何、材质或图片。只使用本轮空间工具，最终选择真实完整规划摘要。'+SPACE_PROMPT.slice(SPACE_PROMPT.indexOf('\n'))+'\n'+instructions;
 return '这是初始空间规划。先用 save_space_core 保存核心布局，再分别保存开口和连接约束；本步骤不生成几何、材质或图片。只使用本轮空间工具，最终选择真实完整规划摘要。'+SPACE_PROMPT.slice(SPACE_PROMPT.indexOf('\n'))+'\n'+instructions;
}

/** Same-job construction only. Partial declarations never enter the accepted layout path. */
export function createSpaceConstruction(options:{folder:string;jobId:string;rootJobId:string;inputKey:string;requirementIds:string[];signal:AbortSignal;strictVoxel?:boolean;observation?:any;validate:(value:any)=>any}){
 const {folder,jobId,rootJobId,inputKey,signal,validate}=options;
 check(!!jobId&&!!rootJobId&&hash(inputKey),'缺少任务身份或冻结输入摘要');
 const file=join(folder,'checkpoint.json');
 // An interrupted single-core checkpoint resumes under its original contract.
 if(options.strictVoxel&&options.observation&&!(existsSync(file)&&read(file)?.version===SPACE_CONSTRUCTION))return createGroupedSpaceConstruction({...options,observation:options.observation});
 const history=join(folder,'revisions'),coreSchema=spaceCoreSchema(options.requirementIds,options),properties=spacePlanningSchema(options.requirementIds,options).properties;
 mkdirSync(history,{recursive:true});
 const initial=signed({version:SPACE_CONSTRUCTION,jobId,rootJobId,inputKey,writes:0,core:null,spatialOpenings:null,spatialContacts:null});
 let state:State=existsSync(file)?read(file):initial,persisted=existsSync(file);
 const verify=(row:State)=>{
  assertChecksum(row);check(row.version===SPACE_CONSTRUCTION&&row.jobId===jobId&&row.rootJobId===rootJobId&&row.inputKey===inputKey,'恢复身份或冻结输入发生变化');
  check(Number.isInteger(row.writes)&&row.writes>=0&&row.writes<=MAX_WRITES,'保存计数无效');
  if(row.core===null){check(row.writes===0&&row.spatialOpenings===null&&row.spatialContacts===null,'未保存核心布局不能存在构造约束');return;}
  assertShape(row.core,coreSchema);
  for(const key of ['spatialOpenings','spatialContacts'] as const)if(row[key]!==null)assertShape(row[key],properties[key],key);
  // Empty arrays are temporary validation scaffolding only. Null is kept on disk until explicitly declared.
  const value=planOf(row),before=stable(value);validateVoxelSpace(value,{required:options.strictVoxel});const checked=validate(value);
  check(stable(value)===before,'校验不得改写原始规划');
  check(stable({...checked,version:'scene-space-plan-v2',spatialRelations:undefined})===stable(value),'完成关系推导不得更改布局、机位或构造约束');
 };
 verify(state);
 const current=()=>{signal.throwIfAborted();check(existsSync(file)===persisted&&(!persisted||stable(read(file))===stable(state)),'当前记录已由其他执行修改');verify(state);return state;};
 const summary=()=>{
  const s=current();return {draftSha256:s.checksum,saved:{core:s.core!==null,spatialOpenings:s.spatialOpenings!==null,spatialContacts:s.spatialContacts!==null},writes:s.writes,maximumWrites:MAX_WRITES,complete:complete(s),spaceSha256:complete(s)?digest(stable(validate(planOf(s)))):null,quality:'not-assessed',data:structuredClone({core:s.core,spatialOpenings:s.spatialOpenings,spatialContacts:s.spatialContacts}),scope:'仅规划检查点；全部声明完成后仍须独立 Engine 灰模验收'};
 };
 const commit=(sections:Sections)=>{
  if(stable(sections)===stable({core:state.core,spatialOpenings:state.spatialOpenings,spatialContacts:state.spatialContacts}))return reply({...summary(),unchanged:true});
  check(state.writes<MAX_WRITES,'保存次数上限已到，重试不会重置');
  const next=signed({version:SPACE_CONSTRUCTION,jobId,rootJobId,inputKey,writes:state.writes+1,...sections});verify(next);
  // A failed write can leave history, but the atomically replaced pointer alone commits the new state.
  save(join(history,next.checksum+'.json'),next);save(file,next);state=next;persisted=true;return reply(summary());
 };
 const kit:CodexToolKit={
  version:SPACE_CONSTRUCTION,
  instructions:'先决定并立即用 save_space_core 保存共享模板、实例、机位、语义及地标绑定；暂不推演完整开口/连接采样点。coreJson 契约为 scene-space-core-v1，不含 spatialRelations、spatialOpenings、spatialContacts。随后使用 save_space_constraints 分别声明 spatialOpenings 和 spatialContacts，即使没有也必须显式保存 []。两者沿已保存的局部坐标检查，不重写整个布局。若确需修改核心布局，所有旧构造声明立即失效，必须重新声明。expectedDraftSha256 使用最新状态。inspect_space_draft 可读回全部已保存信息；失败修改不覆盖旧状态。最终只输出 selectedSpaceSha256 和中文 reason；选取的必须是全部声明完成后的当前 spaceSha256。这里只保存规划，不证明还原质量，不能跳过后续灰模独立验收。仍使用同一次模型执行及已有有界重试，检查点不增加模型调用、修正轮数、时间或预览额度。',
  outputSchema:obj({selectedSpaceSha256:sha,reason:{type:'string',minLength:1}}),
  definitions:[
   {name:'save_space_core',description:'先保存可校验核心布局。改动核心会使此前开口和连接声明失效。',inputSchema:obj({expectedDraftSha256:sha,coreJson:{type:'string',maxLength:MAX_SECTION_CHARS,description:'核心布局 JSON：'+JSON.stringify(coreSchema)}}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
   {name:'save_space_constraints',description:'保存开口或连接之一；依据已保存核心布局校验身份、局部坐标和边界。',inputSchema:obj({expectedDraftSha256:sha,section:{type:'string',enum:['spatialOpenings','spatialContacts']},itemsJson:{type:'string',maxLength:MAX_SECTION_CHARS,description:'对应数组契约：'+JSON.stringify({spatialOpenings:properties.spatialOpenings,spatialContacts:properties.spatialContacts})}}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
   {name:'inspect_space_draft',description:'读取本次规划检查点和完整已存数据，不渲染、不评分。',inputSchema:obj({}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  ],
  continuation:()=>({text:JSON.stringify(summary()),images:[]}),
  resolveOutput:(selection:any)=>{
   const s=current();check(complete(s),'核心、开口和连接尚未全部声明');
   check(hash(selection?.selectedSpaceSha256)&&typeof selection.reason==='string'&&selection.reason.trim(),'须选择真实完整规划摘要并说明依据');
   const value=validate(planOf(s)),spaceSha256=digest(stable(value));check(selection.selectedSpaceSha256===spaceSha256,'选择摘要与当前完整规划不符');
   save(join(folder,'selected.json'),signed({version:SPACE_CONSTRUCTION,jobId,rootJobId,inputKey,checkpointSha256:s.checksum,selectionSha256:digest(stable(selection)),spaceSha256,value}));
   return value;
  },
  async call(name,args){
   const s=current();if(name==='inspect_space_draft')return reply(summary());
   check(hash(args?.expectedDraftSha256)&&args.expectedDraftSha256===s.checksum,'基线摘要不符，请读取最新检查点');
   if(name==='save_space_core'){
    check(typeof args.coreJson==='string'&&args.coreJson.length<=MAX_SECTION_CHARS,'核心布局 JSON 无效或过大');
    const core=JSON.parse(args.coreJson);assertShape(core,coreSchema);
    // Re-sending the identical core must not invalidate completed declarations or consume a write.
    return commit({core,spatialOpenings:stable(core)===stable(s.core)?s.spatialOpenings:null,spatialContacts:stable(core)===stable(s.core)?s.spatialContacts:null});
   }
   if(name==='save_space_constraints'){
    check(s.core!==null,'必须先保存核心布局');check(['spatialOpenings','spatialContacts'].includes(args.section),'构造约束名称无效');
    check(typeof args.itemsJson==='string'&&args.itemsJson.length<=MAX_SECTION_CHARS,'构造约束 JSON 无效或过大');
    const items=JSON.parse(args.itemsJson);assertShape(items,properties[args.section],args.section);
    return commit({core:s.core,spatialOpenings:s.spatialOpenings,spatialContacts:s.spatialContacts,[args.section]:items});
   }
   throw Error('未知空间检查点工具');
  },
 };
 return {kit,summary,snapshot:()=>structuredClone(current())};
}

/** Completed tool selections can be reused by the existing same-input recovery path.
 * The raw response remains a selection; no historical response is rewritten as geometry. */
export function selectedSpaceValue(folder:string,selection:any,source:{id:string;executionRecoveryRoot?:string}){
 const root=join(folder,'space-construction'),proof=read(join(root,'selected.json'));assertChecksum(proof);
 check(SPACE_CONSTRUCTION_VERSIONS.includes(proof.version)&&proof.jobId===source.id&&proof.rootJobId===(source.executionRecoveryRoot??source.id),'已选规划来源身份不符');
 check(proof.selectionSha256===digest(stable(selection))&&proof.spaceSha256===selection?.selectedSpaceSha256&&proof.spaceSha256===digest(stable(proof.value)),'原始选择与已保存规划摘要不符');
 check(hash(proof.checkpointSha256),'所选检查点身份无效');
 const checkpoint=read(join(root,'revisions',proof.checkpointSha256+'.json'));assertChecksum(checkpoint);
 check(checkpoint.version===proof.version&&checkpoint.checksum===proof.checkpointSha256&&checkpoint.jobId===proof.jobId&&checkpoint.rootJobId===proof.rootJobId&&checkpoint.inputKey===proof.inputKey&&complete(checkpoint),'已选规划检查点不完整或来源不符');
 check(stable({...proof.value,version:'scene-space-plan-v2',spatialRelations:undefined})===stable(planOf(checkpoint)),'已选规划与原始分步数据不符');
 return proof.value;
}

type Group={groupId:string;landmarkIds:string[];instances:any[];entities:any[];observedBindings:any[]};
type GroupedState=Sections&{version:string;jobId:string;rootJobId:string;inputKey:string;writes:number;skeleton:any|null;groups:Group[];checksum:string};
export function spaceSkeletonSchema(ids?:string[],options:{strictVoxel?:boolean}={}){
 const schema=spaceCoreSchema(ids,options);schema.properties.version.enum=['scene-space-skeleton-v1'];
 for(const key of ['entities','observedBindings']){delete schema.properties[key];schema.required=schema.required.filter((k:string)=>k!==key);}
 const program=schema.properties.program;delete program.properties.instances;program.required=program.required.filter((k:string)=>k!=='instances');
 return schema;
}
export function spaceComponentGroupSchema(ids?:string[],options:{strictVoxel?:boolean}={}){
 const core=spaceCoreSchema(ids,options);
 return obj({groupId:{type:'string',pattern:'^[A-Za-z0-9_.-]{1,64}$'},landmarkIds:{type:'array',minItems:1,items:{type:'string'}},instances:core.properties.program.properties.instances,entities:core.properties.entities,observedBindings:core.properties.observedBindings});
}

/** Strict voxel space: the shared skeleton and each landmark group are separate checkpoints.
 * The accepted core is derived deterministically once every observed landmark is covered. */
function createGroupedSpaceConstruction(options:{folder:string;jobId:string;rootJobId:string;inputKey:string;requirementIds:string[];signal:AbortSignal;strictVoxel?:boolean;observation:any;validate:(value:any)=>any}){
 const {folder,jobId,rootJobId,inputKey,signal,validate,observation}=options;
 const file=join(folder,'checkpoint.json'),history=join(folder,'revisions'),coreSchema=spaceCoreSchema(options.requirementIds,options),skeletonSchema=spaceSkeletonSchema(options.requirementIds,options),groupSchema=spaceComponentGroupSchema(options.requirementIds,options),properties=spacePlanningSchema(options.requirementIds,options).properties;
 const landmarks:any[]=observation.landmarks??[],landmarkIds=landmarks.map(l=>l.id),required=voxelComponentRequirements(observation),limit=VOXEL_LIMITS.entities;
 mkdirSync(history,{recursive:true});
 const covered=(groups:Group[])=>new Set(groups.flatMap(g=>g.landmarkIds));
 const assemble=(skeleton:any,groups:Group[])=>{
  const {version:_version,...rest}=skeleton,bindings=groups.flatMap(g=>g.observedBindings);
  return {...rest,version:'scene-space-core-v1',program:{...skeleton.program,instances:groups.flatMap(g=>g.instances)},entities:groups.flatMap(g=>g.entities),observedBindings:landmarkIds.filter(id=>bindings.some(b=>b.landmarkId===id)).map(id=>bindings.find(b=>b.landmarkId===id))};
 };
 // Remaining critical objects/components each still need one exclusive instance before the final cap;
 // an existing instance not yet owned by a covered object/component can still serve one of them.
 const budget=(groups:Group[])=>{
  const done=covered(groups),bindings=groups.flatMap(g=>g.observedBindings),instances=groups.flatMap(g=>g.instances);
  const owned=new Set(landmarks.filter(l=>done.has(l.id)&&['object','component'].includes(l.geometryScope)).flatMap(l=>bindings.find(b=>b.landmarkId===l.id)?.instanceIds??[]));
  const remaining=required.filter(r=>!done.has(r.landmarkId)).length;
  return {used:instances.length,remaining,reserve:Math.max(0,remaining-instances.filter(i=>!owned.has(i.id)).length)};
 };
 const derivedCore=(skeleton:any,groups:Group[])=>skeleton&&landmarkIds.every(id=>covered(groups).has(id))?assemble(skeleton,groups):null;
 const assertSkeleton=(skeleton:any)=>{
  assertShape(skeleton,skeletonSchema,'skeleton');const lattice=validateVoxelLattice(skeleton.voxelLattice),templates=skeleton.program.templates;
  check(templates.length>0&&new Set(templates.map((t:any)=>t.id)).size===templates.length,'骨架需要唯一模板');
  for(const t of templates){assertLatticeVector(t.bounds?.min,lattice,'模板 '+t.id+'.bounds.min');assertLatticeVector(t.bounds?.max,lattice,'模板 '+t.id+'.bounds.max');check(t.bounds.max.every((n:number,k:number)=>n>t.bounds.min[k]),'模板 '+t.id+'的边界必须有正跨度');}
 };
 /** Every problem in the cumulative draft is returned together; one save never hides the next conflict. */
 const assertGroups=(skeleton:any,groups:Group[])=>{
  const problems:string[]=[],claimed=new Map<string,string>(),owner=new Map<string,string>(),templates=new Set(skeleton.program.templates.map((t:any)=>t.id));
  if(new Set(groups.map(g=>g.groupId)).size!==groups.length)problems.push('组件组ID重复');
  for(const g of groups){
   assertShape(g,groupSchema,'group '+g?.groupId);
   if(new Set(g.landmarkIds).size!==g.landmarkIds.length)problems.push(g.groupId+'：地标重复');
   for(const id of g.landmarkIds){if(!landmarkIds.includes(id))problems.push(g.groupId+'：未知原图地标 '+id);else if(claimed.has(id))problems.push(g.groupId+'：地标 '+id+' 已属于组 '+claimed.get(id));else claimed.set(id,g.groupId);}
   const bound=g.observedBindings.map(b=>b.landmarkId);
   if(bound.length!==g.landmarkIds.length||new Set(bound).size!==bound.length||!g.landmarkIds.every(id=>bound.includes(id)))problems.push(g.groupId+'：observedBindings须对本组每个地标恰好绑定一次');
   for(const i of g.instances){if(owner.has(i.id))problems.push(g.groupId+'：实例 '+i.id+' 已由组 '+owner.get(i.id)+' 创建');else owner.set(i.id,g.groupId);if(!templates.has(i.template))problems.push(g.groupId+'：实例 '+i.id+' 引用骨架中不存在的模板 '+i.template);}
   const own=g.instances.map(i=>i.id),entities=g.entities.map(e=>e.instanceId);
   if(entities.length!==own.length||new Set(entities).size!==entities.length||!own.every(id=>entities.includes(id)))problems.push(g.groupId+'：entities须与本组实例一一对应');
   for(const id of own)if(!g.observedBindings.some(b=>b.instanceIds.includes(id)))problems.push(g.groupId+'：新实例 '+id+' 未被本组任何地标绑定');
  }
  for(const g of groups)for(const b of g.observedBindings)for(const id of b.instanceIds)if(!owner.has(id))problems.push(g.groupId+'：地标 '+b.landmarkId+' 引用不存在或已移除的实例 '+id);
  const instances=groups.flatMap(g=>g.instances),{remaining,reserve}=budget(groups);
  if(instances.length>limit)problems.push('全部实例最多'+limit+'个（含ground、context、subject），当前 '+instances.length);
  else if(instances.length+reserve>limit)problems.push('实例预算不足：已用 '+instances.length+'，尚有 '+remaining+' 个关键object/component未覆盖，至少还需 '+reserve+' 个独立实例，最终上限 '+limit+'；请合并同一区域的重复块为一个实例内的构造，不能删除关键组件');
  const details:any={problems};
  if(instances.length){
   const partial=assemble(skeleton,groups);
   try{voxelSpaceGrid(partial);}catch(error){details.lattice=String((error as Error).message??error);}
   try{validateVoxelLandmarkCoverage(partial,observation,{partial:true});}catch(error){if(Array.isArray((error as any).violations))details.semanticOwnershipViolations=(error as any).violations;else details.coverage=String((error as Error).message??error);}
  }
  if(problems.length||details.lattice||details.coverage||details.semanticOwnershipViolations)check(false,'组件组未通过累计检查（已列出全部问题，旧状态保留）：'+JSON.stringify(details));
 };
 const initial=signed({version:SPACE_CONSTRUCTION_GROUPED,jobId,rootJobId,inputKey,writes:0,skeleton:null,groups:[],core:null,spatialOpenings:null,spatialContacts:null});
 let state:GroupedState=existsSync(file)?read(file):initial,persisted=existsSync(file);
 const verify=(row:GroupedState)=>{
  assertChecksum(row);check(row.version===SPACE_CONSTRUCTION_GROUPED&&row.jobId===jobId&&row.rootJobId===rootJobId&&row.inputKey===inputKey,'恢复身份或冻结输入发生变化');
  check(Number.isInteger(row.writes)&&row.writes>=0&&row.writes<=MAX_WRITES_GROUPED,'保存计数无效');check(Array.isArray(row.groups),'组件组记录无效');
  if(row.skeleton===null){check(row.writes===0&&!row.groups.length&&row.core===null&&row.spatialOpenings===null&&row.spatialContacts===null,'未保存骨架不能存在组件或约束');return;}
  assertSkeleton(row.skeleton);if(row.groups.length)assertGroups(row.skeleton,row.groups);
  check(stable(row.core)===stable(derivedCore(row.skeleton,row.groups)),'核心布局必须由骨架和组件组确定推导');
  if(row.core===null){check(row.spatialOpenings===null&&row.spatialContacts===null,'地标尚未全部覆盖时不能存在构造约束');return;}
  assertShape(row.core,coreSchema);
  for(const key of ['spatialOpenings','spatialContacts'] as const)if(row[key]!==null)assertShape(row[key],properties[key],key);
  const value=planOf(row),before=stable(value);validateVoxelSpace(value,{required:true});const checked=validate(value);
  check(stable(value)===before,'校验不得改写原始规划');
  check(stable({...checked,version:'scene-space-plan-v2',spatialRelations:undefined})===stable(value),'完成关系推导不得更改布局、机位或构造约束');
 };
 verify(state);
 const current=()=>{signal.throwIfAborted();check(existsSync(file)===persisted&&(!persisted||stable(read(file))===stable(state)),'当前记录已由其他执行修改');verify(state);return state;};
 const summary=()=>{
  const s=current(),done=covered(s.groups),used=s.groups.reduce((n,g)=>n+g.instances.length,0);
  return {version:SPACE_CONSTRUCTION_GROUPED,draftSha256:s.checksum,saved:{skeleton:s.skeleton!==null,groups:s.groups.length,core:s.core!==null,spatialOpenings:s.spatialOpenings!==null,spatialContacts:s.spatialContacts!==null},writes:s.writes,maximumWrites:MAX_WRITES_GROUPED,complete:complete(s),spaceSha256:complete(s)?digest(stable(validate(planOf(s)))):null,
   groups:s.groups.map(g=>({groupId:g.groupId,landmarkIds:g.landmarkIds,instanceIds:g.instances.map(i=>i.id)})),remainingLandmarkIds:landmarkIds.filter(id=>!done.has(id)),remainingRequiredComponents:required.filter(r=>!done.has(r.landmarkId)).map(r=>({landmarkId:r.landmarkId,label:r.label,geometryScope:r.geometryScope})),
   instanceBudget:{used,maximum:limit,reservedForRemaining:budget(s.groups).reserve},templateBudget:{used:s.skeleton?.program.templates.length??0,maximum:ASSET_STEP_LIMITS.templates},quality:'not-assessed',fullData:'inspect_space_draft',scope:'仅规划检查点；全部声明完成后仍须独立 Engine 灰模验收'};
 };
 const commit=(next:{skeleton:any;groups:Group[];spatialOpenings:any[]|null;spatialContacts:any[]|null},extra:any={})=>{
  const body={...next,core:next.skeleton?derivedCore(next.skeleton,next.groups):null};
  if(stable(body)===stable({skeleton:state.skeleton,groups:state.groups,core:state.core,spatialOpenings:state.spatialOpenings,spatialContacts:state.spatialContacts}))return reply({...summary(),unchanged:true});
  check(state.writes<MAX_WRITES_GROUPED,'保存次数上限已到，重试不会重置');
  const row=signed({version:SPACE_CONSTRUCTION_GROUPED,jobId,rootJobId,inputKey,writes:state.writes+1,...body});verify(row);
  save(join(history,row.checksum+'.json'),row);save(file,row);state=row;persisted=true;return reply({...summary(),...extra});
 };
 const parse=(text:any,label:string)=>{check(typeof text==='string'&&text.length<=MAX_SECTION_CHARS,label+' JSON 无效或过大');try{return JSON.parse(text);}catch{check(false,label+' JSON 无法解析');}};
 const kit:CodexToolKit={
  version:SPACE_CONSTRUCTION_GROUPED,
  instructions:'先用 save_space_skeleton 保存 scene-space-skeleton-v1：voxelLattice、全部共享模板 bounds（最多'+ASSET_STEP_LIMITS.templates+'个，同形或同类物体共用模板）、机位、program 名称和 assumptions，不含实例、实体或绑定。随后按原图地标分组调用 save_space_component_group：每组声明 landmarkIds，并给出本组新建的 instances、一一对应的 entities，以及对本组每个地标恰好一条 observedBindings；绑定可引用已保存组的实例（例如 void 引用承载墙体），但每个新实例必须被本组地标绑定。每次保存会累计核对共同格网、实例总上限'+VOXEL_LIMITS.entities+'个（尚未覆盖的关键 object/component 预留独立实例）及独立拥有关系，并一次列出全部冲突；失败不覆盖旧状态。同一 groupId 再保存即替换该组，remove_space_component_group 删除一组，被其他组绑定引用的实例不能移除。所有地标覆盖后程序确定推导核心布局，再用 save_space_constraints 分别保存 spatialOpenings 和 spatialContacts（无则显式 []）。修改组件组或使旧组失效的骨架变更会清除已存约束。expectedDraftSha256 使用最新状态；返回摘要列出剩余地标与实例预算，inspect_space_draft 读回完整数据。最终只输出 selectedSpaceSha256 和中文 reason；须为全部声明完成后的当前 spaceSha256。这里只保存规划，不证明还原质量，不能跳过后续灰模独立验收；检查点不增加模型调用、修正轮数、时间或预览额度。',
  outputSchema:obj({selectedSpaceSha256:sha,reason:{type:'string',minLength:1}}),
  definitions:[
   {name:'save_space_skeleton',description:'保存共享格网、模板、机位等骨架。若已有组件组在新骨架下失效，则全部组件组和约束一起清除。',inputSchema:obj({expectedDraftSha256:sha,skeletonJson:{type:'string',maxLength:MAX_SECTION_CHARS,description:'骨架 JSON：'+JSON.stringify(skeletonSchema)}}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
   {name:'save_space_component_group',description:'保存或按 groupId 替换一个地标组件组；累计检查全部组并一次列出所有冲突。',inputSchema:obj({expectedDraftSha256:sha,groupJson:{type:'string',maxLength:MAX_SECTION_CHARS,description:'组件组 JSON：'+JSON.stringify(groupSchema)}}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
   {name:'remove_space_component_group',description:'删除一个组件组；其实例若仍被其他组绑定则拒绝。',inputSchema:obj({expectedDraftSha256:sha,groupId:{type:'string'}}),annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
   {name:'save_space_constraints',description:'全部地标覆盖后保存开口或连接之一；依据推导核心布局校验。',inputSchema:obj({expectedDraftSha256:sha,section:{type:'string',enum:['spatialOpenings','spatialContacts']},itemsJson:{type:'string',maxLength:MAX_SECTION_CHARS,description:'对应数组契约：'+JSON.stringify({spatialOpenings:properties.spatialOpenings,spatialContacts:properties.spatialContacts})}}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
   {name:'inspect_space_draft',description:'读取本次规划检查点摘要及完整骨架、组件组与约束，不渲染、不评分。',inputSchema:obj({}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  ],
  // Fresh attempts get the compact state; full sections stay on disk behind inspect_space_draft.
  continuation:()=>({text:JSON.stringify(summary()),images:[]}),
  resolveOutput:(selection:any)=>{
   const s=current();check(complete(s),'骨架、全部组件组、开口和连接尚未全部声明');
   check(hash(selection?.selectedSpaceSha256)&&typeof selection.reason==='string'&&selection.reason.trim(),'须选择真实完整规划摘要并说明依据');
   const value=validate(planOf(s)),spaceSha256=digest(stable(value));check(selection.selectedSpaceSha256===spaceSha256,'选择摘要与当前完整规划不符');
   save(join(folder,'selected.json'),signed({version:SPACE_CONSTRUCTION_GROUPED,jobId,rootJobId,inputKey,checkpointSha256:s.checksum,selectionSha256:digest(stable(selection)),spaceSha256,value}));
   return value;
  },
  async call(name,args){
   const s=current();if(name==='inspect_space_draft')return reply({...summary(),data:structuredClone({skeleton:s.skeleton,groups:s.groups,spatialOpenings:s.spatialOpenings,spatialContacts:s.spatialContacts})});
   check(hash(args?.expectedDraftSha256)&&args.expectedDraftSha256===s.checksum,'基线摘要不符，请读取最新检查点');
   if(name==='save_space_skeleton'){
    const skeleton=parse(args.skeletonJson,'骨架');assertSkeleton(skeleton);
    // Checked on save, not in verify: a skeleton saved before this check still loads, and fails only when the plan completes.
    const templateCount=skeleton.program.templates.length;
    check(templateCount<=ASSET_STEP_LIMITS.templates,'骨架模板最多 '+ASSET_STEP_LIMITS.templates+' 个，当前 '+templateCount+' 个；完整规划会因此被拒绝。同形或同类物体共用一个模板，用实例的位置、scale 与朝向区分，不能删除地标');
    if(stable(skeleton)===stable(s.skeleton))return reply({...summary(),unchanged:true});
    let groups=s.groups,dropped:string[]=[];
    if(groups.length){try{assertGroups(skeleton,groups);}catch(error){dropped=groups.map(g=>g.groupId);groups=[];}}
    return commit({skeleton,groups,spatialOpenings:null,spatialContacts:null},dropped.length?{droppedGroupIds:dropped,dropReason:'新骨架下旧组件组不再成立'}:{});
   }
   if(name==='save_space_component_group'){
    check(s.skeleton!==null,'必须先保存骨架');const group=parse(args.groupJson,'组件组');assertShape(group,groupSchema,'group');
    const index=s.groups.findIndex(g=>g.groupId===group.groupId),groups=index<0?[...s.groups,group]:s.groups.map((g,i)=>i===index?group:g);
    assertGroups(s.skeleton,groups);const same=index>=0&&stable(s.groups[index])===stable(group);
    return commit({skeleton:s.skeleton,groups,spatialOpenings:same?s.spatialOpenings:null,spatialContacts:same?s.spatialContacts:null});
   }
   if(name==='remove_space_component_group'){
    check(s.groups.some(g=>g.groupId===args?.groupId),'组件组不存在：'+args?.groupId);const groups=s.groups.filter(g=>g.groupId!==args.groupId);
    if(groups.length)assertGroups(s.skeleton,groups);
    return commit({skeleton:s.skeleton,groups,spatialOpenings:null,spatialContacts:null});
   }
   if(name==='save_space_constraints'){
    check(s.core!==null,'全部原图地标覆盖后才能保存构造约束；剩余 '+landmarkIds.filter(id=>!covered(s.groups).has(id)).join(','));check(['spatialOpenings','spatialContacts'].includes(args.section),'构造约束名称无效');
    const items=parse(args.itemsJson,'构造约束');assertShape(items,properties[args.section],args.section);
    return commit({skeleton:s.skeleton,groups:s.groups,spatialOpenings:s.spatialOpenings,spatialContacts:s.spatialContacts,[args.section]:items});
   }
   throw Error('未知空间检查点工具');
  },
 };
 return {kit,summary,snapshot:()=>structuredClone(current())};
}
