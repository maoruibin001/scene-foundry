import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit} from '../codex-tools';
import {SPACE_PROMPT,spacePlanningSchema} from './layout-stages';

export const SPACE_CONSTRUCTION='space-checkpoint-v1';
const MAX_WRITES=12,MAX_SECTION_CHARS=262144;
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
export function spaceCoreSchema(ids?:string[]){
 const schema=spacePlanningSchema(ids);schema.properties.version.enum=['scene-space-core-v1'];
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
export function spaceConstructionPrompt(instructions:string){
 return '这是初始空间规划。先用 save_space_core 保存核心布局，再分别保存开口和连接约束；本步骤不生成几何、材质或图片。只使用本轮空间工具，最终选择真实完整规划摘要。'+SPACE_PROMPT.slice(SPACE_PROMPT.indexOf('\n'))+'\n'+instructions;
}

/** Same-job construction only. Partial declarations never enter the accepted layout path. */
export function createSpaceConstruction(options:{folder:string;jobId:string;rootJobId:string;inputKey:string;requirementIds:string[];signal:AbortSignal;validate:(value:any)=>any}){
 const {folder,jobId,rootJobId,inputKey,signal,validate}=options;
 check(!!jobId&&!!rootJobId&&hash(inputKey),'缺少任务身份或冻结输入摘要');
 const file=join(folder,'checkpoint.json'),history=join(folder,'revisions'),coreSchema=spaceCoreSchema(options.requirementIds),properties=spacePlanningSchema(options.requirementIds).properties;
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
  const value=planOf(row),before=stable(value),checked=validate(value);
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
 check(proof.version===SPACE_CONSTRUCTION&&proof.jobId===source.id&&proof.rootJobId===(source.executionRecoveryRoot??source.id),'已选规划来源身份不符');
 check(proof.selectionSha256===digest(stable(selection))&&proof.spaceSha256===selection?.selectedSpaceSha256&&proof.spaceSha256===digest(stable(proof.value)),'原始选择与已保存规划摘要不符');
 check(hash(proof.checkpointSha256),'所选检查点身份无效');
 const checkpoint=read(join(root,'revisions',proof.checkpointSha256+'.json'));assertChecksum(checkpoint);
 check(checkpoint.checksum===proof.checkpointSha256&&checkpoint.jobId===proof.jobId&&checkpoint.rootJobId===proof.rootJobId&&checkpoint.inputKey===proof.inputKey&&complete(checkpoint),'已选规划检查点不完整或来源不符');
 check(stable({...proof.value,version:'scene-space-plan-v2',spatialRelations:undefined})===stable(planOf(checkpoint)),'已选规划与原始分步数据不符');
 return proof.value;
}
