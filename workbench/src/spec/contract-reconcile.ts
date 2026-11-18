/**
 * 规格内容 → 生成器契约的确定性归一。
 *
 * 背景：normalize 阶段只把「参数名」注入模型目录，模型于是把 number 写成布尔、把 vec3 写成
 * 中文描述、把区间写成数组、把包络写成 "48×55×20"。导出器把这类值判为「关键参数无解」，
 * 对象整只退化成灰模代理。本模块把规格里的语义参数按生成器 ParamDef 真实映射成可执行的
 * 契约参数，而不是放宽检查或伪造几何。
 *
 * 三条硬约束：
 * 1. 纯函数，不改入参；历史规格按内容寻址，绝不原地重写。
 * 2. 每个动作都进 report，可逐项审查；无法解析的描述性文本显式归入 descriptive，
 *    用契约默认值兜底，不假装语义已落地。
 * 3. 归一结果必须能通过 resolveParams；归一后所有对象应走真实生成器，不再产生代理。
 */
import {GENERATORS} from './generators/index';
import {resolveParams,type AdaptContext,type Generator,type ParamDef,type ParamValue} from './generators/kit';
import type {SceneSpec} from './schema';

export const RECONCILE_VERSION='spec-contract-reconcile-v1';

export type ReconcileActionKind=
 'kept'|'clamp'|'coerce'|'parse'|'translate'|'pick'|'default'|'descriptive'|'drop'|'constraint';

export type ReconcileAction={
 family:string;object:string|null;key:string;from:unknown;to?:unknown;target?:string;
 action:ReconcileActionKind;note:string;
};

export type DescriptiveItem={
 family:string;object:string|null;key:string;text:string;fallback:string;
};

export type ReconcileReport={
 version:string;
 actions:ReconcileAction[];
 counts:Record<ReconcileActionKind,number>;
 descriptive:DescriptiveItem[];
 familyCount:number;
 objectCount:number;
 generatorMissing:{family:string;generator:string}[];
};

type Coerce={ok:true;value:ParamValue;action:ReconcileActionKind;note:string}|{ok:false;action:ReconcileActionKind;note:string};

const NUM_RE=/-?\d+(?:\.\d+)?/g;
const STRUCTURAL_RE=/^(size|envelope|path|position|rotation|scale|dimensions|footprint)$/i;

/** 从数值 / 数值数组 / 中文描述("48×55×20"、"宽沿Y3、厚沿X0.05、高3")里提取数字，不做单位换算。 */
function numbersOf(v:unknown):number[]{
 if(typeof v==='number')return Number.isFinite(v)?[v]:[];
 if(Array.isArray(v))return v.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x));
 if(typeof v==='string')return (v.match(NUM_RE)??[]).map(Number).filter(Number.isFinite);
 return [];
}

function clampTo(n:number,def:ParamDef):number{
 const min=(def as {min?:number}).min??-Infinity;
 const max=(def as {max?:number}).max??Infinity;
 const c=Math.min(max,Math.max(min,n));
 return def.type==='int'?Math.round(c):c;
}

function asVec3(n:number[]):number[]{
 if(n.length>=3)return n.slice(0,3);
 if(n.length===2)return [n[0]!,n[1]!,0];
 return [n[0]!,n[0]!,n[0]!];
}

/** 单个值 → 契约参数值。区间数组按族内对象序号确定性选一个，不取平均、不静默夹带修正。 */
function coerce(value:unknown,def:ParamDef,index:number):Coerce{
 // 布尔猜测值落在非布尔契约上：false 表示「禁用」，true 表示「启用但没给尺寸」。
 // 尤其 poolCutout:false 若回退到默认 [20,24,0] 会把水池洞打开，属于语义反转。
 if(typeof value==='boolean'&&def.type!=='bool'){
  const min=(def as {min?:number}).min??-Infinity;
  if(!value&&min<=0&&def.type==='vec3'){
   return {ok:true,value:[0,0,0],action:'coerce',note:'布尔 false 表示禁用，置零尺寸向量'};
  }
  if(!value&&min<=0&&(def.type==='number'||def.type==='int')){
   return {ok:true,value:0,action:'coerce',note:'布尔 false 表示禁用，置零'};
  }
  return {ok:false,action:'default',note:'布尔猜测值没有可用数值语义，改用契约默认值'};
 }
 if(def.type==='bool'){
  if(typeof value==='boolean')return {ok:true,value,action:'kept',note:''};
  if(typeof value==='number')return {ok:true,value:value!==0,action:'coerce',note:'数值按非零转布尔'};
  const n=numbersOf(value);
  if(n.length)return {ok:true,value:n.some(x=>x!==0),action:'parse',note:'由文本/数组中的数值转布尔'};
  return {ok:false,action:'descriptive',note:'描述文本没有布尔语义'};
 }
 if(def.type==='vec3'){
  const n=numbersOf(value);
  if(!n.length)return {ok:false,action:'descriptive',note:'描述文本没有可解析的三维尺寸'};
  const v=asVec3(n).map(x=>clampTo(x,def));
  const changed=Array.isArray(value)&&value.length===3?value.some((x,i)=>x!==v[i]):true;
  return {ok:true,value:v,action:changed?'coerce':'kept',note:n.length<3?'按向量语义补全/广播分量':'按契约范围夹取'};
 }
 if(def.type==='list'){
  const n=Array.isArray(value)?numbersOf(value):typeof value==='number'?[]:numbersOf(value);
  const stride=(def as {stride:number}).stride||1;
  const minLength=(def as {minLength:number}).minLength,maxLength=(def as {maxLength:number}).maxLength;
  const usable=n.length>=minLength&&n.length<=maxLength&&n.length%stride===0
   ?n.map(x=>clampTo(x,def)):null;
  if(usable)return {ok:true,value:usable,action:'coerce',note:'数值序列按契约步长/范围归一'};
  return {ok:false,action:'descriptive',note:`描述文本不能构成 ${minLength}..${maxLength} 个(步长 ${stride})折线点`};
 }
 // number / int
 if(typeof value==='number'){
  const c=clampTo(value,def);
  return {ok:true,value:c,action:c===value?'kept':'clamp',note:c===value?'':`超出契约范围，夹到 ${c}`};
 }
 if(typeof value==='boolean')return {ok:false,action:'default',note:'布尔猜测值没有数值语义，改用契约默认值'};
 if(Array.isArray(value)){
  const n=numbersOf(value);
  if(n.length){
   const picked=n[index%n.length]!;
   return {ok:true,value:clampTo(picked,def),action:'pick',note:`区间按族内序号 ${index} 取 ${picked}`};
  }
  return {ok:false,action:'default',note:'数组里没有可用数值'};
 }
 const n=numbersOf(value);
 if(n.length)return {ok:true,value:clampTo(n[0]!,def),action:'parse',note:'由文本数值解析'};
 return {ok:false,action:'descriptive',note:'描述文本没有可解析的数值'};
}

/**
 * 规格里 size/envelope/dimensions 这类结构性写法 → 该生成器真实拥有的尺寸参数。
 * 显式表优先（语义不能靠猜），其余走通用规则；返回值仍会再过一次契约夹取。
 */
const STRUCTURAL_TARGETS:Record<string,(n:number[])=>Record<string,ParamValue>>={
 'GEN-CORE-01':n=>({diameter:n[0]!}),
 'GEN-HALL-01':n=>({width:n[0]!,length:n[1]??n[0]!,height:n[2]??n[1]??n[0]!}),
 'GEN-FLOOR-01':n=>({width:n[0]!,length:n[1]??n[0]!}),
 'GEN-POOL-01':n=>({width:n[0]!,length:n[1]??n[0]!}),
 'GEN-WALK-01':n=>({length:n[0]!,width:n[1]??n[0]!}),
 'GEN-GLASS-01':n=>({width:n[0]!,thickness:n[1]??0.05,height:n[2]??n[0]!}),
 'GEN-NODEBEAM-02':n=>({height:n[2]??n[0]!}),
 'GEN-NODE-01':n=>({width:n[0]!,depth:n[1]??n[0]!,height:n[2]??n[0]!}),
 'GEN-ENTRY-01':n=>({doorClearWidth:n[0]!}),
 'GEN-CARRIER-01':n=>({length:n[0]!,width:n[1]??n[0]!}),
 'GEN-MECH-ACTUATOR-01':n=>({width:n[0]!,height:n[2]??n[0]!}),
 'GEN-WORKSTATION-01':n=>({width:n[0]!,depth:n[1]??n[0]!}),
 'GEN-LUMINAIRE-01':n=>({size:[n[0]!,n[1]??n[0]!,n[2]??n[0]!]}),
};

function structuralTarget(gen:Generator,n:number[]):Record<string,ParamValue>{
 const own=(k:string)=>k in gen.params;
 const specific=STRUCTURAL_TARGETS[gen.id];
 if(specific)return specific(n);
 if(own('size')&&gen.params.size!.type==='vec3')return {size:asVec3(n)};
 if(own('width')&&own('length')&&own('height'))return {width:n[0]!,length:n[1]??n[0]!,height:n[2]??n[1]??n[0]!};
 if(own('width')&&own('depth')&&own('height'))return {width:n[0]!,depth:n[1]??n[0]!,height:n[2]??n[1]??n[0]!};
 if(own('width')&&own('height'))return {width:n[0]!,height:n[2]??n[1]??n[0]!};
 if(own('length')&&own('width'))return {length:n[0]!,width:n[1]??n[0]!};
 if(own('diameter'))return {diameter:n[0]!};
 if(own('radius'))return {radius:n[0]!};
 if(own('height'))return {height:n[2]??n[0]!};
 return {};
}

type RawParams=Record<string,ParamValue>;

/**
 * 导出器把「族参数」和「对象参数」分别 adapt 后再合并，生成器 adapt 里的跨参数修复
 * （如 GEN-ENTRY-01 的「门斗必须容下门洞 + 两侧门框」）会在对象级覆盖某个尺寸后失效：
 * 对象只写了 doorClearWidth=6，族里的 vestibuleWidth=6 没被重新放大，build 阶段直接抛错。
 * 这里对合并后的「真正生效参数」再跑一次同一个 adapt，把修复值显式写回，规则与生成器同源。
 */
function applyAdaptConstraints(
 params:RawParams,familyBase:RawParams,gen:Generator,
 meta:{family:string;object:string|null;index:number},ctx:AdaptContext|undefined,report:ReconcileReport,
):RawParams{
 const effective={...familyBase,...params} as RawParams;
 const adjusted=(gen.adapt?gen.adapt(effective,ctx):effective) as RawParams;
 const out={...params};
 for(const [key,value] of Object.entries(adjusted)){
  // 只写回 adapt 真正改动过的键：把 adapt 的全部输出灌回规格会凭空增加一堆等于默认值的参数。
  if(JSON.stringify(effective[key])===JSON.stringify(value))continue;
  const def=gen.params[key];
  if(!def)continue;
  const c=coerce(value,def,meta.index);
  if(!c.ok)continue;
  const prev=out[key];
  if(JSON.stringify(prev)!==JSON.stringify(c.value)){
   out[key]=c.value;
   report.actions.push({...meta,key,from:effective[key],to:c.value,action:'constraint',note:'合并族级与对象级参数后重跑生成器 adapt，修复跨参数约束'});
  }
 }
 return out;
}

function reconcileParams(
 raw:RawParams,gen:Generator,meta:{family:string;object:string|null;index:number},report:ReconcileReport,
):RawParams{
 const out:RawParams={};
 for(const [key,value] of Object.entries(raw??{})){
  const def=gen.params[key];
  if(def){
   const r=coerce(value,def,meta.index);
   if(r.ok){
    out[key]=r.value;
    report.actions.push({...meta,key,from:value,to:r.value,action:r.action,note:r.note});
   }else{
    // 契约默认值兜底：不写入该键，resolveParams 会用 def.default；语义未落地显式登记。
    if(r.action==='descriptive')report.descriptive.push({
     ...meta,key,text:String(value),
     fallback:`${key}=${JSON.stringify(def.default)}${def.type==='list'?'（契约默认折线）':''}`,
    });
    report.actions.push({...meta,key,from:value,to:(def as {default?:unknown}).default,action:r.action,note:r.note});
   }
   continue;
  }
  const n=numbersOf(value);
  if(STRUCTURAL_RE.test(key)&&n.length){
   const targets=structuralTarget(gen,n);
   const translated:RawParams={};
   for(const [tk,tv] of Object.entries(targets)){
    const td=gen.params[tk];
    if(!td||td.type==='list')continue;
    const r=coerce(tv,td,meta.index);
    if(r.ok){translated[tk]=r.value;out[tk]=r.value;}
   }
   if(Object.keys(translated).length){
    report.actions.push({...meta,key,from:value,to:translated,target:Object.keys(translated).join(','),action:'translate',note:'结构性尺寸映射到生成器真实参数'});
   }else{
    report.descriptive.push({...meta,key,text:String(value),fallback:'该生成器没有可承接的尺寸参数'});
    report.actions.push({...meta,key,from:value,action:'descriptive',note:'结构性尺寸无法映射'});
   }
  }else if(STRUCTURAL_RE.test(key)){
   report.descriptive.push({...meta,key,text:String(value),fallback:'保留契约默认值'});
   report.actions.push({...meta,key,from:value,action:'descriptive',note:'纯描述文本，无可执行几何'});
  }else{
   report.actions.push({...meta,key,from:value,action:'drop',note:'生成器没有这个非结构性参数（不改变几何要求）'});
  }
 }
 return out;
}

/**
 * 把一份规格归一为「可被生成器契约直接执行」的新规格。返回新对象，不改入参。
 * 归一后的 spec 可直接传给 prepareExportPlacements / specPrecheck。
 */
export function reconcileSpec(spec:SceneSpec):{spec:SceneSpec;report:ReconcileReport}{
 const report:ReconcileReport={
  version:RECONCILE_VERSION,actions:[],
  counts:{kept:0,clamp:0,coerce:0,parse:0,translate:0,pick:0,default:0,descriptive:0,drop:0,constraint:0},
  descriptive:[],familyCount:0,objectCount:0,generatorMissing:[],
 };
 const next:SceneSpec=JSON.parse(JSON.stringify(spec));
 const byFamily=new Map<string,{index:number}>();
 report.familyCount=next.families.length;
 report.objectCount=next.objects.length;

 for(const family of next.families){
  const genId=family.generator?.id;
  const gen=genId?GENERATORS[genId]:undefined;
  if(family.generator&&!gen){
   report.generatorMissing.push({family:family.id,generator:genId!});
   continue;
  }
  if(!gen)continue;
  const meta:{family:string;object:string|null;index:number}={family:family.id,object:null,index:0};
  const normalized=reconcileParams(family.generator!.params as RawParams,gen,meta,report);
  family.generator!.params=applyAdaptConstraints(normalized,normalized,gen,meta,undefined,report);
 }

 // 族内序号用于区间数组的确定性选值；顺序与导出器一致（按 id 排序前的自然顺序按导出器为准，这里只保证稳定）。
 for(const object of next.objects){
  const family=next.families.find(f=>f.id===object.family);
  const genId=family?.generator?.id;
  const gen=genId?GENERATORS[genId]:undefined;
  if(!gen)continue;
  const cursor=byFamily.get(object.family)??{index:0};
  const index=cursor.index++;
  byFamily.set(object.family,cursor);
  const meta:{family:string;object:string|null;index:number}={family:object.family,object:object.id,index};
  const normalized=reconcileParams(object.params as RawParams,gen,meta,report);
  const familyBase=(family?.generator?.params??{}) as RawParams;
  const position=(object.transform?.position??[0,0,0]) as [number,number,number];
  object.params=applyAdaptConstraints(normalized,familyBase,gen,meta,{id:object.id,position},report);
 }

 for(const a of report.actions)report.counts[a.action]++;
 return {spec:next,report};
}

/** 归一结果自检：所有已实现的生成器参数都能通过 resolveParams。 */
export function reconcileErrors(spec:SceneSpec):string[]{
 const errors:string[]=[];
 for(const family of spec.families){
  const gen=family.generator?GENERATORS[family.generator.id]:undefined;
  if(!gen)continue;
  const merged={...(family.generator?.params??{}),...Object.fromEntries(
   spec.objects.filter(o=>o.family===family.id).flatMap(o=>Object.entries(o.params??{})),
  )} as RawParams;
  const {errors:errs}=resolveParams(gen,merged);
  errors.push(...errs.map(e=>`${family.id}: ${e}`));
 }
 return errors;
}

/** 供工作台/报告展示的一行摘要。 */
export function reconcileSummary(r:ReconcileReport):string{
 return `归一 ${r.actions.length} 项：映射 ${r.counts.translate}、夹取 ${r.counts.clamp}、区间取值 ${r.counts.pick}、类型归一 ${r.counts.coerce+r.counts.parse}、契约默认 ${r.counts.default}、跨参数约束修复 ${r.counts.constraint}；描述性语义 ${r.descriptive.length} 项已显式登记（未伪造几何）。`;
}
