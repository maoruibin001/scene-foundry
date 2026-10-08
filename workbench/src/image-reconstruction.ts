import {createHash} from 'node:crypto';

export const IMAGE_RECONSTRUCTION_VERSION='image-reconstruction-v1';
export const IMAGE_ATTRIBUTES=[
 {id:'subjects',label:'主体与主要结构'},
 {id:'layout',label:'布局、比例与遮挡'},
 {id:'shape',label:'主要轮廓与构造'},
 {id:'materials',label:'主要材质与色彩'},
 {id:'lighting',label:'整体光照'},
 {id:'camera',label:'参考机位与构图'},
] as const;
export type ImageAttribute=typeof IMAGE_ATTRIBUTES[number]['id'];
export type ImageDifference='close'|'minor_difference'|'major_difference'|'unverified';
const differences:ImageDifference[]=['close','minor_difference','major_difference','unverified'];
const canonical=(v:any):string=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=(v:any)=>createHash('sha256').update(canonical(v)).digest('hex');

/** A goal is derived from original uploads; generated frames are never reference inputs. */
export function freezeImageGoal(images:{id:string}[]=[],prompt=''){
 if(!images.length)return null;
 if(images.length>5||new Set(images.map(i=>i.id)).size!==images.length||images.some(i=>! /^[a-f0-9]{64}$/.test(i.id)))throw Error('原图目标需要1–5张不重复且有内容摘要的参考图');
 const goal={version:IMAGE_RECONSTRUCTION_VERSION,references:images.map((i,n)=>({referenceIndex:n+1,sha256:i.id})),promptSha256:digest(prompt.trim()),promptPriority:'explicit_user_modifications_only',attributes:IMAGE_ATTRIBUTES.map(a=>a.id),visibleOnly:true,desired:'closest_visible_match',minimum:'broadly_consistent',allowedDifferences:['局部细小比例','裂纹、磨损与零碎装饰'],majorDifferences:['关键主体或建筑结构缺失','主要空间布局、比例或遮挡关系改变','主要轮廓、材质、色彩或光照明显不同','参考机位或构图明显不同']};
 return {...goal,id:digest(goal)};
}
export function validateImageGoal(goal:any,images?:{id:string}[],prompt?:string){
 if(!goal||!Array.isArray(goal.references))throw Error('原图复刻目标缺失');
 const frozen=freezeImageGoal(goal.references.map((r:any)=>({id:r.sha256})))!;
 if(typeof goal.promptSha256!=='string'||! /^[a-f0-9]{64}$/.test(goal.promptSha256)||prompt!==undefined&&goal.promptSha256!==digest(prompt.trim()))throw Error('原图目标与原始文字修改不一致');
 const {id,...value}=frozen;void id;
 const modified={...value,promptSha256:goal.promptSha256},expected={...modified,id:digest(modified)};
 if(canonical(goal)!==canonical(expected))throw Error('冻结原图目标被修改或版本不支持');
 if(images&&canonical(goal.references.map((r:any)=>r.sha256))!==canonical(images.map(i=>i.id)))throw Error('原图目标与本次输入图片不一致');
 return goal;
}
export const IMAGE_GOAL_GUIDANCE='成品目标是尽量复现全部原始参考图，至少保持大体一致，不只是生成相同题材。用户明确的文字修改优先于冲突图片属性，其他属性继续以原图为准；模型自动扩展不属于用户修改。只描述可见物理事实，保留主体、建筑结构、布局比例、遮挡、轮廓、主要材质色彩、整体光照和参考机位。未知背面与绝对尺度只能记录推断；不得用模型概括或生成的派生图片替换原图目标。各图约束同一三维空间，不得为了某一视角改成另一套布景。允许局部裂纹、磨损和零碎装饰差异，不能用这些差异豁免主要结构变化。当前环节仍只履行既定职责：灰模只检验空间与轮廓，材质光照在成品评审中判断，不在灰模追加材质要求。';
export const IMAGE_MATCH_PROMPT='另外返回 referenceMatch，逐张覆盖 reconstructionGoal.references，每张恰好一次：[{referenceIndex,referenceSha256,frames,attributes:{subjects:{status,reason},layout:{status,reason},shape:{status,reason},materials:{status,reason},lighting:{status,reason},camera:{status,reason}}}]。referenceSha256取对应原图的冻结摘要。status只能为close、minor_difference、major_difference、unverified。close表示可见范围接近参考，并不声称像素完全相同；minor_difference仅限reconstructionGoal.allowedDifferences且不改变主体、主要布局及视觉的局部细节；major_difference表示主要属性明显不同；unverified表示遮挡、画面或依据不足，不能据题材猜测满足。每个reason用简短中文指出具体一致处或偏差。frames只引用frameNames中的真实运行图，必须包含referenceViews中属于该referenceIndex的对应机位图；额外检查机位不能代替参考机位，缺对应图时明确未核实。单独对照原始图片与originalPrompt明确指定的修改，只有用户明确改动可豁免对应属性；不得把自动扩展当成用户改动。不从已提取的需求清单或70分结果推导一致性，不以其他属性优秀抵消明显差异。未知背面不作失败项。无法完成这份对照时返回null；原有评分照常完成，不额外调用模型修补此报告。此报告不改变原有数值评分和制作规范，也不能把草稿判为完整成品。';

export function referenceViews(goal:any,runtime:any){
 validateImageGoal(goal);
 if(typeof runtime.distManifestDigest!=='string'||! /^[a-f0-9]{64}$/.test(runtime.distManifestDigest))throw Error('当前构建产物摘要缺失或无效');
 const frames=new Set(runtime.images??[]),files=new Set<string>(),viewHashes=new Map<string,number>();
 if(!Array.isArray(runtime.hashes)||runtime.hashes.length!==runtime.images?.length||runtime.hashes.some((h:any)=>typeof h!=='string'||! /^[a-f0-9]{64}$/.test(h)))throw Error('运行截图摘要缺失或无效');
 const result=(runtime.referenceFrames??[]).filter((r:any)=>r.referenceIndex!=null).map((r:any)=>{
  if(!Number.isInteger(r.referenceIndex)||r.referenceIndex<1||r.referenceIndex>goal.references.length||!frames.has(r.file)||files.has(r.file))throw Error('参考机位的帧归属无效或重复');
  const sha256=runtime.hashes[runtime.images.indexOf(r.file)];
  if(viewHashes.has(sha256)&&viewHashes.get(sha256)!==r.referenceIndex)throw Error('不同参考图不能用内容相同的重复机位截图冒充独立证据');
  files.add(r.file);viewHashes.set(sha256,r.referenceIndex);return {referenceIndex:r.referenceIndex,file:r.file,sha256};
 });
 return result;
}

/** This validates evidence attribution, not the correctness of the model's visual judgement. */
export function imageReconstructionReport(goal:any,rows:any,runtime:any,partial=false){
 validateImageGoal(goal);
 if(!Array.isArray(rows)||rows.length!==goal.references.length||new Set(rows.map(r=>r.referenceIndex)).size!==rows.length)throw Error('原图对照必须逐张覆盖全部参考图，不得遗漏或重复');
 const views=referenceViews(goal,runtime),frames=new Set(runtime.images??[]),attributes=IMAGE_ATTRIBUTES.map(a=>a.id).sort();
 const references=goal.references.map((reference:any)=>{
  const row=rows.find(r=>r.referenceIndex===reference.referenceIndex);
  if(row?.referenceSha256!==reference.sha256)throw Error('逐图对照的原图摘要不匹配');
  if(!row||!Array.isArray(row.frames)||!row.frames.length||new Set(row.frames).size!==row.frames.length||row.frames.some((f:any)=>typeof f!=='string'||!frames.has(f)))throw Error('原图对照引用了缺失、重复或不存在的运行帧');
  if(!row.attributes||canonical(Object.keys(row.attributes).sort())!==canonical(attributes))throw Error('原图对照必须检查全部视觉属性');
  for(const id of attributes){const finding=row.attributes[id];if(!finding||!differences.includes(finding.status)||typeof finding.reason!=='string'||!finding.reason.trim())throw Error('原图属性判定或依据无效：'+id);}
  const sameCamera=views.some(v=>v.referenceIndex===reference.referenceIndex&&row.frames.includes(v.file));
  const findings=attributes.map(id=>row.attributes[id].status),major=findings.includes('major_difference'),uncertain=!sameCamera||findings.includes('unverified');
  return {...reference,frames:[...row.frames],frameHashes:row.frames.map((file:string)=>({file,sha256:runtime.hashes[runtime.images.indexOf(file)]})),attributes:structuredClone(row.attributes),sameCamera,status:major?'failed':uncertain?'needs_review':'passed',level:major?'major_differences':uncertain?'unverified':findings.includes('minor_difference')?'broadly_consistent':'close'};
 });
 const major=references.some((r:any)=>r.status==='failed'),uncertain=partial||references.some((r:any)=>r.status==='needs_review');
 return {version:IMAGE_RECONSTRUCTION_VERSION,goalId:goal.id,distManifestDigest:runtime.distManifestDigest??null,status:major?'failed':uncertain?'needs_review':'passed',level:major?'major_differences':uncertain?'unverified':references.some((r:any)=>r.level==='broadly_consistent')?'broadly_consistent':'close',scope:partial?'partial':'complete',references,reasons:[...(partial?['资产未齐，只能作为草稿对照，不能声明成品还原通过']:[]),...references.flatMap((r:any)=>[...(!r.sameCamera?['参考图'+r.referenceIndex+'缺少对应参考机位证据']:[]),...IMAGE_ATTRIBUTES.filter(a=>['major_difference','unverified'].includes(r.attributes[a.id].status)).map(a=>'参考图'+r.referenceIndex+' · '+a.label+'：'+r.attributes[a.id].reason)])],limitation:'仅检查原图可见区域；视觉判断仍来自模型。证据归属校验不等于已校准还原准确率，接近参考不代表像素完全一致。'};
}

/** Reporting gaps never discard the scene or request another paid model correction. */
export function assessImageReconstruction(job:any,review:any,runtime:any){
 if(!job.reconstructionGoal)return {};
 try{validateImageGoal(job.reconstructionGoal,job.images??[],job.prompt??'');return {imageReconstruction:imageReconstructionReport(job.reconstructionGoal,review.referenceMatch,runtime,!!job.partialOutput||job.assessmentScope==='partial')};}
 catch(error){return {imageReconstruction:{version:IMAGE_RECONSTRUCTION_VERSION,goalId:job.reconstructionGoal.id,distManifestDigest:runtime.distManifestDigest??null,status:'needs_review',level:'unverified',scope:job.partialOutput||job.assessmentScope==='partial'?'partial':'complete',references:[],reasons:['原图对照未核实：'+String(error)],limitation:'已有生成输出和原始评分保留；未追加模型请求或宣称原图一致。'}};}
}

export function imageMatchSchema(){
 const str={type:'string'},obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
 return {anyOf:[{type:'null'},{type:'array',items:obj({referenceIndex:{type:'integer',minimum:1,maximum:5},referenceSha256:str,frames:{type:'array',items:str},attributes:obj(Object.fromEntries(IMAGE_ATTRIBUTES.map(a=>[a.id,obj({status:{type:'string',enum:differences},reason:str})])))})}]};
}
