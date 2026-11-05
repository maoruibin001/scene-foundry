/**
 * 规格化前端之一:设计文档(HTML)→ scene-spec-v1。
 * 冻结表格(对象表、生成器参数表、资产目录)确定性解析,作为 master 字段;模型(Opus 5.5)只补需要理解的部分:
 * 资产族归类与材质、推断补全的对象摆放、光照状态与机位、验收条目。合并时 master 字段以表格为准覆盖,
 * 最后 validateSceneSpec + 对账;产物交 owner 审改后再进入规格驱动的后端。
 * 用法:bun src/spec/normalize-doc.ts <doc.html> <outDir> [--effort high|xhigh]
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {callClaude10,CLAUDE10_MODEL} from '../claude10-provider';
import {findTable,parseHtmlDocument,type DocSource} from './doc-source';
import {handbookGenerators,handbookLeaves,handbookObjects,HANDBOOK_TABLES,type HandbookGenerator,type HandbookObject} from './handbook';
import {reconcileSpec} from './reconcile';
import {SCENE_SPEC_VERSION,SPEC_LIMITS,validateSceneSpec,type SceneSpec,type SpecFamily,type SpecMaterial,type SpecObject,type SpecParams} from './schema';

// ---------- 模型输出 schema(结构化输出不允许任意键,参数与材质槽用条目数组表达,合并时转回映射) ----------
const str={type:'string'},num={type:'number'},bool={type:'boolean'};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const arr=(items:any,maxItems?:number)=>({type:'array',items,...(maxItems?{maxItems}:{})});
const vec3={type:'array',items:num,minItems:3,maxItems:3};
const nullable=(s:any)=>({anyOf:[{type:'null'},s]});
const source=obj({kind:{type:'string',enum:['doc','image','prompt','inferred']},ref:str});
const param=obj({name:str,number:nullable(num),numbers:nullable(arr(num,64)),text:nullable(str),flag:nullable(bool)});
const authority={type:'string',enum:['master','aux','design_fill']};

export const FAMILIES_SCHEMA=obj({
 materials:arr(obj({id:str,label:str,baseColor:arr(num,4),metallic:num,roughness:num,emissive:nullable(vec3),emissiveIntensity:num,transmission:num,ior:num,thickness:num,clearcoat:num,clearcoatRoughness:num,sources:arr(source)}),SPEC_LIMITS.materials),
 families:arr(obj({id:str,label:str,description:str,priority:{type:'string',enum:['P0','P1','P2']},covers:arr(str),generatorId:nullable(str),generatorParams:arr(param,SPEC_LIMITS.params),materialSlots:arr(obj({slot:str,material:str}),12),authority,sources:arr(source)}),SPEC_LIMITS.families),
 excludedLeaves:arr(obj({id:str,reason:str})),
});
export const OBJECTS_SCHEMA=obj({
 objects:arr(obj({id:str,label:str,family:str,parent:nullable(str),position:vec3,rotationDeg:vec3,scale:vec3,params:arr(param,SPEC_LIMITS.params),authority,sources:arr(source),confidence:num,notes:str}),SPEC_LIMITS.objects),
 excludedMasters:arr(obj({id:str,reason:str})),
});
const light=obj({id:str,kind:{type:'string',enum:['directional','point','spot','area']},position:nullable(vec3),direction:nullable(vec3),color:vec3,intensity:num,range:nullable(num),innerConeDeg:nullable(num),outerConeDeg:nullable(num),width:nullable(num),height:nullable(num),castShadow:bool});
export const STAGING_SCHEMA=obj({
 states:arr(obj({id:str,label:str,lights:arr(light,SPEC_LIMITS.lights),ambient:obj({color:vec3,intensity:num}),background:vec3,
  post:obj({tonemap:{type:'string',enum:['aces','agx','neutral']},exposure:nullable(num),bloom:nullable(obj({threshold:num,intensity:num,radius:num})),gtao:bool,ssr:nullable(obj({maxDistance:num,thickness:num,maxRoughness:num})),fog:nullable(obj({color:vec3,density:num,anisotropy:num,boundsMin:vec3,boundsMax:vec3,light:str})),planarReflections:arr(obj({object:str,height:num,distortion:num}),4)})}),SPEC_LIMITS.states),
 defaultState:str,
 shots:arr(obj({id:str,label:str,position:vec3,target:vec3,fovDeg:num}),SPEC_LIMITS.shots),
 constraints:arr(obj({id:str,description:str,number:nullable(num),numbers:nullable(arr(num,16)),text:nullable(str),unit:str,status:{type:'string',enum:['P','frozen']},sources:arr(source)}),SPEC_LIMITS.constraints),
 acceptance:arr(obj({id:str,description:str,critical:bool,kind:{type:'string',enum:['count','position','size','clearance']},family:nullable(str),equals:nullable(num),object:nullable(str),position:nullable(vec3),size:nullable(vec3),tolerance:nullable(num),from:nullable(vec3),to:nullable(vec3),width:nullable(num),height:nullable(num)}),SPEC_LIMITS.acceptance),
});

// ---------- 上下文 ----------
export type HandbookFacts={masters:HandbookObject[];generators:HandbookGenerator[];leaves:ReturnType<typeof handbookLeaves>;assemblies:string[][]};
export function handbookFacts(doc:DocSource):HandbookFacts{
 return {masters:handbookObjects(doc),generators:handbookGenerators(doc),leaves:handbookLeaves(doc),assemblies:findTable(doc,[...HANDBOOK_TABLES.assemblies]).rows};
}
/** 全文按章节铺开,表格以制表符行内联,供模型理解语义;冻结数值另以 facts JSON 给出。 */
export function documentText(doc:DocSource){
 return doc.sections.map(s=>(s.heading?`\n## ${s.heading}\n`:'')+s.text.replace(/\[\[table:(\d+)\]\]/g,(_,i)=>{const t=doc.tables[Number(i)];return '\n'+[t.header,...t.rows].map(r=>r.join('\t')).join('\n')+'\n';}).replace(/\[\[image:(\d+)\]\]/g,(_,i)=>`[图${i}:${doc.images[Number(i)].alt}]`)).join('\n');
}

const ENGINE_FACTS=`目标引擎 ForgeaX 0.5:最多 1 盏方向光(级联软阴影);投影聚光灯最多 4 盏;点光可投影;矩形面光不投影;Camera 支持 bloom(threshold/intensity/radius)、tonemap(aces/agx/neutral)、手动或自动曝光;GTAO、屏幕空间反射(maxDistance/thickness/maxRoughness)、平面反射(水面,distortion 由法线扰动)、体积雾(绑定一盏灯产生光柱);材质为 PBR metallic-roughness + emissive(进 bloom)+ transmission/ior/thickness(玻璃、水)+ clearcoat。坐标:右手、米、Z 向上、+Y 朝大厅后方,与手册交换坐标一致。`;
const SCOPE=`本次只搭建静态场景环境与光影,不实现交互、玩法、物理、敌人、角色、AI 对话、声音、UI、特效粒子与运行时破坏。玩家、武器、敌人、触发体、出生点、纯玩法数据不进入场景对象;破坏类资产只保留完整(未破坏)外观。`;
const SYSTEM=`你是游戏关卡的技术美术与场景规格化工程师。把设计手册整理成标准化场景规格。手册中的冻结表格已由程序确定性解析为 facts,其中的 ID、坐标、尺寸、倾角、生成器参数是 master 事实,必须原样使用,不得改写、取整或换算。手册没有给出、但搭建完整大厅必需的内容,按手册的约束、预算与风格合理补全,标 authority=design_fill,并在 sources 里写依据章节;不能声称补全是测量结果。每条输出写来源(kind=doc 时 ref 写章节名或资产 ID)。全部使用中文。${SCOPE}\n${ENGINE_FACTS}`;

function paramsOf(list:{name:string;number:number|null;numbers:number[]|null;text:string|null;flag:boolean|null}[]):SpecParams{
 const out:SpecParams={};
 for(const p of list??[]){
  const v=p.number??p.numbers??p.flag??p.text;if(v===null||v===undefined)continue;
  // 模型偶尔把多个计数压进一个超长键;不合规格键名的参数降为文字备注,不让整份规格作废。
  if(/^[a-z][a-zA-Z0-9_]{0,40}$/.test(p.name))out[p.name]=v;else out.note_params=[out.note_params,`${p.name}=${JSON.stringify(v)}`].filter(Boolean).join('; ');
 }
 return out;
}

async function ask(dir:string,role:string,task:string,facts:object,doc:string,schema:any,images:{path:string;mime:string}[],effort:string,reuseMode=process.env.SPEC_REUSE_CALLS){
 mkdirSync(dir,{recursive:true});
 // 同一任务文本已有输出时直接复用:规格化每步要几十分钟,合并逻辑修改后重跑不应再花模型调用。
 const saved=join(dir,role+'-output.json'),taskHash=createHash('sha256').update(task+JSON.stringify(facts)+doc+JSON.stringify(schema)).digest('hex');
 // SPEC_REUSE_CALLS=1 只复用任务文本完全相同的输出;=force 复用已有输出(用于早于哈希记录的归档运行)。
 const reuse=reuseMode,hashFile=join(dir,role+'-task.sha256');
 if(existsSync(saved)&&(reuse==='force'||(reuse==='1'&&existsSync(hashFile)&&readFileSync(hashFile,'utf8')===taskHash))){if(reuse==='force')writeFileSync(hashFile,taskHash);return JSON.parse(readFileSync(saved,'utf8'));}
 const text=`${task}\n\n# facts(确定性解析,master 事实)\n${JSON.stringify(facts)}\n\n# 手册全文\n${doc}`;
 const r=await callClaude10({system:SYSTEM,text,images,role,modelSettings:{model:CLAUDE10_MODEL,reasoningEffort:effort} as any},dir,CLAUDE10_MODEL,schema);
 writeFileSync(saved,r.text);writeFileSync(join(dir,role+'-receipt.json'),JSON.stringify(r.receipt,null,2));writeFileSync(hashFile,taskHash);
 return JSON.parse(r.text);
}

// ---------- 合并 ----------
export function mergeFamilies(raw:any,generators:HandbookGenerator[]):{families:SpecFamily[];materials:SpecMaterial[]}{
 const materials:SpecMaterial[]=raw.materials.map((m:any)=>({...m,emissive:m.emissive??null}));
 const families:SpecFamily[]=raw.families.map((f:any)=>{
  const handbook=generators.find(g=>g.id===f.generatorId);
  // 手册生成器参数是 master:模型只能补充新键,已有键以表格为准。
  const params={...paramsOf(f.generatorParams),...(handbook?.params??{})};
  const covers=(f.covers??[]).map((id:string)=>({kind:'doc' as const,ref:'卷四 '+id}));
  return {id:f.id,label:f.label,description:f.description,priority:f.priority,generator:f.generatorId?{id:f.generatorId,params}:null,
   materialSlots:Object.fromEntries((f.materialSlots??[]).map((s:any)=>[s.slot,s.material])),authority:handbook?'master':f.authority,sources:[...(f.sources??[]),...covers]};
 });
 return {families,materials};
}

export function mergeObjects(raw:any,masters:HandbookObject[]):SpecObject[]{
 return raw.objects.map((o:any)=>{
  const m=masters.find(x=>x.id===o.id);
  const params=paramsOf(o.params);
  if(m?.size)params.size=m.size;
  const position=m?.position??o.position,rotationDeg=m?.rotationDeg??o.rotationDeg;
  return {id:o.id,label:o.label,family:o.family,parent:o.parent,transform:{position,rotationDeg,rotationOrder:'XYZ',scale:o.scale},params,
   authority:m?'master':o.authority,sources:m?[{kind:'doc',ref:m.source},...(o.sources??[])]:o.sources,confidence:m?1:o.confidence,notes:o.notes};
 });
}

export function mergeStaging(raw:any){
 const states=raw.states.map((s:any)=>({...s,post:{...s.post,exposure:s.post.exposure===null?'auto':s.post.exposure}}));
 const constraints=raw.constraints.map((c:any)=>({id:c.id,description:c.description,value:c.number??c.numbers??c.text??'',unit:c.unit,status:c.status,sources:c.sources}));
 const acceptance=raw.acceptance.map((a:any)=>{const base={id:a.id,description:a.description,critical:a.critical,kind:a.kind};
  return a.kind==='count'?{...base,family:a.family,equals:a.equals}:a.kind==='position'?{...base,object:a.object,position:a.position,tolerance:a.tolerance}:a.kind==='size'?{...base,object:a.object,size:a.size,tolerance:a.tolerance}:{...base,from:a.from,to:a.to,width:a.width,height:a.height};});
 return {lighting:{defaultState:raw.defaultState,states},shots:raw.shots,constraints,acceptance};
}

// ---------- 主流程 ----------
export async function normalizeDocument(htmlPath:string,outDir:string,effort='high',reuse?:string){
 const html=readFileSync(htmlPath,'utf8'),doc=parseHtmlDocument(html),facts=handbookFacts(doc),text=documentText(doc);
 mkdirSync(join(outDir,'style'),{recursive:true});
 writeFileSync(join(outDir,'facts.json'),JSON.stringify({docSha256:doc.sha256,...facts},null,2));
 const styleRefs=doc.images.map(img=>{const path=join(outDir,'style',`style-${String(img.index+1).padStart(2,'0')}.jpg`);writeFileSync(path,img.bytes);return {id:`style${img.index+1}`,path,caption:img.alt};});
 // 已获方向认可的主视觉基准与高位观察作为视觉证据随请求附上;其余概念图只写入 styleRefs。
 const keyImages=styleRefs.filter(r=>/主视觉基准|高位观察|左侧观察|右侧观察/.test(r.caption)).map(r=>({path:r.path,mime:'image/jpeg'}));
 const calls=join(outDir,'calls');

 const famRaw=await ask(calls,'spec-families',`任务 1/3:资产族与材质。依据卷四资产目录(facts.leaves)、装配表(facts.assemblies)与生成器参数表(facts.generators),把静态场景需要的叶资产归并为可生成的资产族:每个族给出 covers(覆盖的叶资产 ID)、生成器(手册已有的 GEN-* 原样引用其 ID;没有对应生成器的族提出 GEN-<名称>-01 并给参数)、材质槽→材质。重复的模块化构件(地板模块、墙板、栏杆立柱、散热片等)作为所属生成器的内部输出,不另立族。不需要的叶资产写进 excludedLeaves 并说明原因(范围外、纯玩法、破坏状态等)。材质依据卷二 F1 材质 P 值、卷四材质表与概念图:涂装、湿金属、抛光金属、黑色球壳、能量发光、池水(transmission+ior 1.333)、玻璃(transmission+ior 1.5)、地面等;数值在合法范围内(roughness 0..1,ior 1..2.5)。资产族数量不超过 ${SPEC_LIMITS.families}。`,facts,text,FAMILIES_SCHEMA,keyImages,effort,reuse);
 const {families,materials}=mergeFamilies(famRaw,facts.generators);

 const objRaw=await ask(calls,'spec-objects',`任务 2/3:场景对象。已确定的资产族与材质:${JSON.stringify(families.map(f=>({id:f.id,label:f.label,generator:f.generator?.id,covers:f.sources.filter(s=>s.ref.startsWith('卷四')).map(s=>s.ref)})))}。(a)facts.masters 中进入静态场景的对象逐一列出,id 原样,指定 family;位置、倾角照抄 facts(程序会再次以 facts 覆盖);纯玩法对象(触发体、出生点等)写进 excludedMasters。(b)按卷二 B1 包络与通路约束、卷三 §2 母布局、卷四数量预算补全大厅必需对象:承重柱、横梁、屋顶桁架、外围连续通路(X=±14 与 Y=±16 环,净宽≥3m)、上层步道与楼梯、左右玻璃控制室及内部陈设、节点供能线与管线、入口门斗与远端工业门、设备与电气柜等;authority=design_fill,confidence 反映把握程度,notes 写依据。只有需要独立摆放的件才是对象;对象总数不超过 ${SPEC_LIMITS.objects}。坐标在大厅包络内(X[-24,24]、Y[-27.5,27.5]、Z[-2.5,20]),对象之间不穿插、不挡主通路;rotationDeg 为绕 X、Y、Z 的度数,scale 默认 [1,1,1]。`,facts,text,OBJECTS_SCHEMA,[],effort,reuse);
 const objects=mergeObjects(objRaw,facts.masters);

 const stageRaw=await ask(calls,'spec-staging',`任务 3/3:光照、机位、约束与验收。对象清单:${JSON.stringify(objects.map(o=>({id:o.id,family:o.family,position:o.transform.position})))}。资产族:${JSON.stringify(families.map(f=>f.id))}。(a)按卷二 F1 写四种光照状态 L0 稳定故障、L1 节点关闭、L2 失重、L3 泄能,defaultState=L0;灯要有实际位置和因果(顶部斜向工业灯、核心冷白蓝、节点能量柱、控制室内灯、远端门光等),发光材质不自动照亮环境,需要照亮邻近表面处配置真实灯;池水用平面反射(object 引用水池对象,height 为水面高度);曝光不确定时 exposure 用 null 表示自动曝光。(b)机位:入口玩家视角(PLAYER_SPAWN 脚底+眼高 1.65,面向 +Y)、池边看核心、维护平台、安全屏障观察窗回看、高位总览,以及与概念图主视觉基准相近的构图。(c)约束:卷二 B1、卷三 §2/§4 中的数值,标 P 或 frozen。(d)验收:可程序检查的条目——四节点计数、三环、核心位置与直径、节点位置、主通路净宽与撤离路线净空等;critical 只用于通关因果必需项。`,facts,text,STAGING_SCHEMA,keyImages,effort,reuse);
 const staging=mergeStaging(stageRaw);

 const spec:SceneSpec={version:SCENE_SPEC_VERSION,id:'critical-zerog-hall',name:doc.title,units:'m',up:'+Z',bounds:{min:[-24,-27.5,-3],max:[24,27.5,20.5]},
  sources:[{id:'handbook',title:doc.title,kind:'doc',path:resolve(htmlPath)}],families,objects,materials,...staging,
  styleRefs:styleRefs.map(r=>({...r,path:r.path})),
  provenance:{createdAt:new Date().toISOString(),method:'normalize-doc-v1(确定性表格 + Opus 规格化)',model:CLAUDE10_MODEL}};
 const report=reconcileSpec(spec,facts,{excludedMasters:objRaw.excludedMasters,excludedLeaves:famRaw.excludedLeaves});
 writeFileSync(join(outDir,'spec.json'),JSON.stringify(spec,null,2));
 writeFileSync(join(outDir,'reconcile.json'),JSON.stringify(report,null,2));
 validateSceneSpec(spec);
 return {spec,report};
}

if(import.meta.main){
 const [html,out]=process.argv.slice(2),effort=process.argv.includes('--effort')?process.argv[process.argv.indexOf('--effort')+1]:'high';
 if(!html||!out){console.error('用法:bun src/spec/normalize-doc.ts <doc.html> <outDir> [--effort high|xhigh]');process.exit(2);}
 const {spec,report}=await normalizeDocument(html,out,effort);
 console.log(JSON.stringify({families:spec.families.length,objects:spec.objects.length,materials:spec.materials.length,states:spec.lighting.states.length,shots:spec.shots.length,acceptance:spec.acceptance.length,reconcile:report.summary},null,2));
}
