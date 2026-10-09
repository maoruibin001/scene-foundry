import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit} from '../codex-tools';
import {ASSET_PROMPT,assetSchema,type AssetGeometry,type AssetBrief,type SceneLayout} from './layout';
import {assetPartCapacity} from './surface-part-budget';
import {validateAllocatedAssetParts} from './asset-validation';
import type {Texture} from './program';

const VERSION='asset-parts-checkpoint-v1',CHUNK_PARTS=8,MAX_JSON_CHARS=1500000;
const id=(v:any):v is string=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,55}$/.test(v);
const hash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const check=(condition:any,message:string)=>{if(!condition)throw Error(message);};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const ids={type:'array',items:str,maxItems:CHUNK_PARTS};
const annotations={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const reply=(value:any)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
type State={version:string;contract:string;writes:number;assetSha256:string;parts:{id:string;sha256:string}[];checksum:string};

export function assetConstructionPrompt(instructions:string){
 return '根据全部参考图、冻结布局和当前简报，仅用本轮资产工具逐块构造当前 template；不输出程序代码、其他模板或整个场景。说明使用中文。最终按工具契约选择真实资产摘要。'+ASSET_PROMPT.slice(ASSET_PROMPT.indexOf('\n'))+'\n'+instructions;
}

/** Incremental drafts belong to one job/asset invocation. They never enter geometry.json,
 * the completed-asset cache, or scene assembly until the unchanged final validator passes. */
export function createAssetConstruction(options:{
 folder:string;jobId:string;rootJobId:string;inputKey:string;brief:AssetBrief;layout:SceneLayout;
 textures:Record<string,Texture>;signal:AbortSignal;revision?:any;review?:CodexToolKit;
 validateFinal:(value:AssetGeometry)=>AssetGeometry;
}){
 const {folder,brief,layout,textures,signal,review,validateFinal}=options;
 check(typeof options.jobId==='string'&&options.jobId.length>0&&typeof options.rootJobId==='string'&&options.rootJobId.length>0&&hash(options.inputKey),'资产分块缺少执行身份或冻结输入摘要');
 const maxParts=assetPartCapacity(layout,brief).maxParts,maxWrites=Math.max(8,maxParts*2);
 const contract=digest(stable({version:VERSION,jobId:options.jobId,rootJobId:options.rootJobId,inputKey:options.inputKey,brief,layout,revision:options.revision??null,reviewVersion:review?.version??null}));
 const file=join(folder,'checkpoint.json'),blobDir=join(folder,'parts'),historyDir=join(folder,'revisions');
 for(const dir of [folder,blobDir,historyDir])mkdirSync(dir,{recursive:true});
 const asset=(parts:any[]):AssetGeometry=>({version:'asset-geometry-v1',template:{id:brief.id,parts}});
 const signed=(row:Omit<State,'checksum'>):State=>({...row,checksum:digest(stable(row))});
 const initial=signed({version:VERSION,contract,writes:0,assetSha256:digest(stable(asset([]))),parts:[]});
 let state:State=existsSync(file)?read(file):initial;
 let persisted=existsSync(file),busy=false;
 const valueOf=(row:State):AssetGeometry=>{
  const {checksum,...body}=row;
  check(checksum===digest(stable(body)),'资产分块检查点记录已改变');
  check(row.version===VERSION&&row.contract===contract,'资产分块恢复身份或冻结输入发生变化');
  check(Number.isInteger(row.writes)&&row.writes>=0&&row.writes<=maxWrites&&Array.isArray(row.parts)&&row.parts.length<=maxParts,'资产分块检查点计数无效');
  check(row.parts.every(p=>id(p.id)&&hash(p.sha256))&&new Set(row.parts.map(p=>p.id)).size===row.parts.length,'资产分块检查点部件身份无效');
  const value=asset(row.parts.map(p=>{
   const part=read(join(blobDir,p.sha256+'.json'));
   check(part.id===p.id&&digest(stable(part))===p.sha256,'资产分块部件摘要变化：'+p.id);
   return part;
  }));
  check(hash(row.assetSha256)&&digest(stable(value))===row.assetSha256,'资产分块整体摘要变化');
  return value;
 };
 const restored=valueOf(state);
 if(restored.template.parts.length)validateAllocatedAssetParts(restored,brief,layout,textures);
 else check(state.writes===0,'已保存的资产分块不能为空');
 const current=()=>{
  signal.throwIfAborted();
  check(existsSync(file)===persisted&&(!persisted||stable(read(file))===stable(state)),'资产分块检查点已由其他执行修改，请重新读取当前状态');
  return valueOf(state);
 };
 const summary=()=>{
  const value=current();
  return {draftSha256:state.assetSha256,parts:value.template.parts.map((p,i)=>({id:p.id,shape:p.shape.type,material:p.material,sha256:state.parts[i].sha256})),writes:state.writes,maximumWrites:maxWrites,maximumParts:maxParts,maximumPartsPerWrite:CHUNK_PARTS,complete:false,quality:'not-assessed',scope:'仅保存当前资产部件草稿；开口、连接、全部材质槽、程序化传递和重要资产预览仍须最终校验'};
 };
 const expected=(args:any)=>{check(hash(args?.expectedDraftSha256)&&args.expectedDraftSha256===state.assetSha256,'资产分块基线摘要不符；先 inspect_asset_parts 获取当前摘要');};
 const full=(value:AssetGeometry)=>{
  const before=stable(value),checked=validateFinal(value);
  check(stable(checked)===before&&stable(value)===before,'最终校验不得静默改写分块几何');
  return checked;
 };
 const kit:CodexToolKit={
  version:review?'asset-checkpoint-preview-v1':'asset-checkpoint-v1',
  instructions:`使用 save_asset_parts 分块保存当前资产，每次最多 ${CHUNK_PARTS} 个完整部件；未列出的部件保持原样，不用重写整份资产。先保存关键结构，再补细节。expectedDraftSha256 必须使用最新工具状态中的 draftSha256。可以用 inspect_asset_parts 查看摘要或最多 ${CHUNK_PARTS} 个已存部件。只改明确有问题的部件，removePartIds 仅显式移除本资产部件。校验失败不改变已保存草稿；成功保存也不代表资产完成。用 check_asset 检查全部冻结要求。`+
   (review?' 最终选择前必须调用 preview_saved_asset，用当前摘要查看真实 Engine 预览；仍最多两个候选，重试不重置额度。可选择已成功预览的任一候选，不能凭草稿摘要编造已看过。前两张为辅助照明的独立检查；若有第三张则是原机位中的当前资产与已验收灰模邻居，不代表完整成品或最终评分。':' 最终只能选择当前已保存、满足全部结构约束的资产摘要；此阶段不提供视觉合格保证。')+
   ' 最终只输出 selectedAssetSha256 和中文 reason，说明依据与残留，不输出整份几何。超时重试会收到已保存状态，检查点只在相同任务、资产与冻结输入内恢复，不自动增加模型调用、修正或预览额度。',
  outputSchema:obj({selectedAssetSha256:sha,reason:str}),
  definitions:[
   {name:'save_asset_parts',description:'校验并原子保存当前资产的有限部件草稿。没有完整性或质量通过含义。',inputSchema:obj({expectedDraftSha256:sha,partsJson:{type:'string',description:'JSON 数组，每项为完整部件，最多 '+CHUNK_PARTS+' 项；部件契约：'+JSON.stringify(assetSchema().properties.template.properties.parts.items)},removePartIds:ids}),annotations},
   {name:'inspect_asset_parts',description:'读取本资产草稿摘要；partIds 为空返回清单，非空返回这些部件的完整数据。',inputSchema:obj({partIds:ids}),annotations:{...annotations,readOnlyHint:true}},
   {name:'check_asset',description:'检查当前草稿的全部资产结构和分配预算；不渲染、不评分、不声称完成。',inputSchema:obj({expectedDraftSha256:sha}),annotations:{...annotations,readOnlyHint:true}},
   ...(review?[{name:'preview_saved_asset',description:'按摘要预览已保存的资产；先做完整结构与预算校验，再沿正常 Engine 预览路径取图。',inputSchema:obj({expectedDraftSha256:sha}),annotations}]:[]),
  ],
  continuation:()=>{
   const context=review?.continuation?.();
   return {text:JSON.stringify({checkpoint:summary(),preview:context?.text??null}),images:context?.images??[]};
  },
  resolveOutput:(selection:any)=>{
   current();check(hash(selection?.selectedAssetSha256)&&typeof selection.reason==='string'&&selection.reason.trim().length>0,'须选择真实资产摘要并说明依据');
   if(review)return full(review.resolveOutput!(selection));
   check(selection.selectedAssetSha256===state.assetSha256,'最终资产摘要与当前检查点不符');
   return full(current());
  },
  async call(name,args){
   const value=current();check(!busy,'当前资产预览仍在进行，不能并发修改');
   if(name==='inspect_asset_parts'){
    check(Array.isArray(args?.partIds)&&args.partIds.length<=CHUNK_PARTS&&args.partIds.every(id)&&new Set(args.partIds).size===args.partIds.length,'待查询部件身份无效');
    check(args.partIds.every((key:string)=>value.template.parts.some(p=>p.id===key)),'待查询部件不存在');
    return reply({...summary(),data:args.partIds.map((key:string)=>value.template.parts.find(p=>p.id===key))});
   }
   expected(args);
   if(name==='save_asset_parts'){
    check(typeof args.partsJson==='string'&&args.partsJson.length<=MAX_JSON_CHARS,'分块 JSON 无效或过大');
    const upserts=JSON.parse(args.partsJson),removes=args.removePartIds;
    check(Array.isArray(upserts)&&upserts.length<=CHUNK_PARTS&&upserts.every(p=>p&&id(p.id))&&new Set(upserts.map(p=>p.id)).size===upserts.length,'新增或替换部件身份无效或数量超限');
    check(Array.isArray(removes)&&removes.length<=CHUNK_PARTS&&removes.every(id)&&new Set(removes).size===removes.length,'删除部件身份无效');
    check(removes.every((key:string)=>value.template.parts.some(p=>p.id===key)),'不能删除不存在的部件');
    check(!upserts.some(p=>removes.includes(p.id)),'同一部件不能同时替换和删除');
    const replacements=new Map(upserts.map(p=>[p.id,p]));
    const parts=value.template.parts.filter(p=>!removes.includes(p.id)).map(p=>replacements.get(p.id)??p);
    parts.push(...upserts.filter(p=>!value.template.parts.some(old=>old.id===p.id)));
    const next=asset(parts),serialized=stable(next);
    check(serialized.length<=MAX_JSON_CHARS,'整份资产超过原有 JSON 大小上限');
    const measured=validateAllocatedAssetParts(next,brief,layout,textures),assetSha256=digest(serialized);
    if(assetSha256===state.assetSha256)return reply({...summary(),unchanged:true});
    check(state.writes<maxWrites,'本资产分块保存上限已到，不得通过重试重置');
    const rows=parts.map(p=>({id:p.id,sha256:digest(stable(p))}));
    for(let i=0;i<parts.length;i++){
     const blob=join(blobDir,rows[i].sha256+'.json');
     if(existsSync(blob))check(digest(stable(read(blob)))===rows[i].sha256,'既有部件内容摘要不符');
     else save(blob,parts[i]);
    }
    const nextState=signed({version:VERSION,contract,writes:state.writes+1,assetSha256,parts:rows});
    // Blobs/history may survive a failed save, but only the atomically replaced pointer is accepted.
    const history=join(historyDir,nextState.checksum+'.json');
    if(!existsSync(history))save(history,nextState);
    save(file,nextState);state=nextState;persisted=true;
    return reply({...summary(),triangles:measured.triangles,triangleBudget:measured.budget,bounds:measured.bounds});
   }
   if(name==='check_asset'){full(value);return reply({draftSha256:state.assetSha256,structure:'passed',quality:'not-assessed',scope:'仍须选择摘要、完成所需预览和独立场景验收'});}
   if(name==='preview_saved_asset'&&review){
    full(value);busy=true;
    try{return await review.call('preview_asset',{assetJson:JSON.stringify(value)});}finally{busy=false;}
   }
   throw Error('未知资产分块工具');
  },
 };
 return {kit,summary};
}
