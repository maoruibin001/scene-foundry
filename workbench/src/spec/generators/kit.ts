/**
 * 规格生成器框架:手册卷三 §3 的 GEN-* 契约——命名生成器、带默认值与合法范围的类型化参数、非法参数拒绝、
 * 同参数确定性重建。生成器只依赖 @forgeax/engine/modeling,同一份源码在 workbench 单测与游戏工程的 pack 构建里运行。
 * 局部坐标沿用 modeling:Y 向上、米制;规格的 Z 向上由场景导出在实例变换上换轴。
 */
import {model,sel,validateMesh,type Model,type ValidateOptions,type ValidationReport} from '@forgeax/engine/modeling';
import type {MeshAsset} from '@forgeax/engine/types';

export type ParamDef=
 |{type:'number';default:number;min:number;max:number;toggle?:number}
 |{type:'int';default:number;min:number;max:number;toggle?:number}
 |{type:'bool';default:boolean}
 |{type:'vec3';default:[number,number,number];min:number;max:number}
 /** 定长倍数的数列(如折线点 x,y,z,x,y,z…):长度在 minLength..maxLength 且为 stride 的倍数。 */
 |{type:'list';default:number[];min:number;max:number;minLength:number;maxLength:number;stride:number};
export type ParamDefs=Record<string,ParamDef>;
export type ParamsOf<D extends ParamDefs>={[K in keyof D]:D[K] extends {type:'list'}?number[]:D[K]['default'] extends boolean?boolean:D[K]['default'] extends number[]?[number,number,number]:number};
/** assembly:一次生成整组构件(整厅骨架、整片地面、水池、核心球),族内只放一个实例,其它对象视为它的组成部分。 */
/** adapt:把规格里常见的等价写法(区间、合并向量、包络)确定性地换成本生成器参数;只在导出时用,不改规格。 */
export type Generator<D extends ParamDefs=ParamDefs>={id:string;label:string;params:D;slots:readonly string[];assembly?:boolean;
 adapt?(raw:Record<string,ParamValue>,ctx?:AdaptContext):Record<string,ParamValue>;build(m:Model,p:ParamsOf<D>):void};
/** 适配时可见的对象信息:ID(区分同族不同部件)与规格位置(Z 向上,用于换算到绝对高度的参数)。 */
export type AdaptContext={id:string;position:[number,number,number]};
/** 读区间/向量的工具:非数字数组返回 undefined。 */
export const nums=(v:ParamValue|undefined,n?:number)=>Array.isArray(v)&&v.every(x=>typeof x==='number')&&(n===undefined||v.length===n)?v as number[]:undefined;
export type ParamValue=number|string|boolean|number[];

export function defineGenerator<D extends ParamDefs>(g:Generator<D>):Generator<D>{return g;}

/** 默认值补齐 + 范围检查 + 拒绝未知键;列表值(手册里一族多尺寸,如 11/13/15)必须在实例上选定单值。 */
export function resolveParams<D extends ParamDefs>(g:Generator<D>,values:Record<string,ParamValue>={}):{params:ParamsOf<D>;errors:string[]}{
 const errors:string[]=[],params:Record<string,unknown>={};
 for(const key of Object.keys(values))if(!(key in g.params))errors.push(`${g.id}: 未知参数 ${key}`);
 for(const [key,def] of Object.entries(g.params)){
  const input=values[key]??def.default;
  const v=(def.type==='number'||def.type==='int')&&def.toggle!==undefined&&typeof input==='boolean'?(input?def.toggle:0):input;
  if(def.type==='bool'){if(typeof v!=='boolean')errors.push(`${g.id}.${key} 须为布尔`);params[key]=v;continue;}
  if(def.type==='list'){if(!Array.isArray(v)||v.length<def.minLength||v.length>def.maxLength||v.length%def.stride||!v.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=def.min&&n<=def.max))errors.push(`${g.id}.${key} 须为 ${def.minLength}..${def.maxLength} 个数(步长 ${def.stride}),各项 ${def.min}..${def.max}`);params[key]=v;continue;}
  if(def.type==='vec3'){if(!Array.isArray(v)||v.length!==3||!v.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=def.min&&n<=def.max))errors.push(`${g.id}.${key} 须为三维向量,各分量 ${def.min}..${def.max}`);params[key]=v;continue;}
  if(Array.isArray(v)){errors.push(`${g.id}.${key} 是列表 ${JSON.stringify(v)},须在对象参数里选定单值`);continue;}
  if(typeof v!=='number'||!Number.isFinite(v)||v<def.min||v>def.max||(def.type==='int'&&!Number.isInteger(v)))errors.push(`${g.id}.${key}=${JSON.stringify(v)} 超出 ${def.min}..${def.max}${def.type==='int'?'(整数)':''}`);
  params[key]=v;
 }
 return {params:params as ParamsOf<D>,errors};
}

/** 生成一个网格:参数非法即抛错,不夹带修正;输出带 UV、加权法线、按槽名的 materialSlots。 */
export function runGenerator<D extends ParamDefs>(g:Generator<D>,values:Record<string,ParamValue>,key:string):MeshAsset{
 const {params,errors}=resolveParams(g,values);
 if(errors.length)throw Error('GENERATOR_PARAMS_INVALID:'+errors.join(';'));
 const m=model();
 // 倒角:每个方块按最短边的 6%(上限 4cm,3mm 以下不倒)切一道单段倒角——硬边接不住高光,倒角才出亮线。
 // 用 tag 标记(按 5mm 分档),不改生成器自己的 label;SPEC_BEVEL=0 关闭(对照用)。
 const widths=new Set<number>();
 if(process.env.SPEC_BEVEL!=='0'){const box=m.box.bind(m);(m as any).box=(o:any)=>{const w=Math.round(Math.min(0.04,Math.min(...o.size)*0.06)*200)/200;if(w<0.005||o.tag)return box(o);widths.add(w);return box({...o,tag:'bevel'+w});};}
 g.build(m,params);
 for(const w of widths)m.bevel(sel.toEdges(sel.tag('bevel'+w),'all'),{width:w,segments:1});
 m.uv.project({mode:'box',scale:0.5});
 const out=m.finish({key,normals:{mode:'weighted'}});
 if(!out.ok)throw Error(`GENERATOR_FAILED ${g.id}: ${out.error.code} ${out.error.expected??''} ${out.error.hint??''}`);
 const mesh=out.value[`mesh/${key}`] as MeshAsset;
 const unknown=(mesh.materialSlots??[]).map(s=>s.slotName).filter(s=>!g.slots.includes(s));
 if(unknown.length)throw Error(`GENERATOR_SLOTS_INVALID ${g.id}: 未声明的材质槽 ${unknown.join(',')}`);
 return mesh;
}

/** 非破坏性网格拓扑与几何诊断辅助:调用建模内核 validateMesh 检查半边不变量、退化面与法向翻转。 */
export type GeneratorValidationSummary={
 genId:string;
 pass:boolean;
 faces:number;
 edges:number;
 vertices:number;
 boundaryEdges:number;
 closed:boolean;
 errors:ValidationReport['issues'];
 warnings:ValidationReport['issues'];
 report:ValidationReport;
};
export function validateGeneratorAsset(genId:string,m:Model,options:ValidateOptions={}):GeneratorValidationSummary{
 const report=validateMesh(m.editMesh,m.tolerance,options);
 const errors=report.issues.filter(i=>i.severity==='error');
 const warnings=report.issues.filter(i=>i.severity==='warn');
 return {
  genId,
  pass:report.pass&&m.poisoned===undefined,
  faces:report.faces,
  edges:report.edges,
  vertices:report.vertices,
  boundaryEdges:report.boundaryEdges,
  closed:report.closed,
  errors,
  warnings,
  report,
 };
}

/** 折线点(扁平 x,y,z…)拆成三元组。 */
export const triples=(v:number[])=>Array.from({length:v.length/3},(_,i)=>[v[3*i],v[3*i+1],v[3*i+2]] as [number,number,number]);
export const deg=(r:number)=>r*180/Math.PI;
export const rad=(d:number)=>d*Math.PI/180;
