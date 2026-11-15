/**
 * 《临界：零重力》手册的冻结表格 → 结构化记录。只做确定性解析:数值原样读取,读不出就保留原文并标 null,
 * 不猜测。这些记录是规格里 master 字段的唯一来源,模型输出必须与之对账一致(见 reconcile.ts)。
 */
import {findTable,type DocSource} from './doc-source';
import type {SpecParams,Vec3} from './schema';

export const HANDBOOK_TABLES={
 objects:['ID','数量/位置（米）','朝向/包络P值','交互与限制'],
 generators:['生成器ID','输入参数：默认值P','输出','边界与禁止'],
 assemblies:['装配ID','组成与责任','数量','必须独立控制'],
 leaves:['ID','叶资产与建议实例数','细分/参数要求','优先级与验收重点'],
 leavesAlt:['ID','叶资产与建议数量','制作边界与状态','优先级与验收重点'],
 lights:['灯ID','类型','位置','方向','颜色','强度','射程','内锥角','外锥角','投影'],
 materials:['材质ID','名称','底色','金属度','粗糙度','自发光色','自发光强度','透射','清漆'],
 slots:['生成器','材质槽→材质'],
 post:['后处理项','值'],
 shots:['机位ID','说明','位置','目标','视野'],
} as const;

/** 冻结观感表(v5.1 起):灯光、材质、材质槽,数值原样作为 master;文档没有这些表时返回空。 */
const vec=(c:string)=>c==='None'||c===''?null:(JSON.parse(c) as number[]);
const optTable=(doc:DocSource,h:readonly string[])=>doc.tables.find(t=>t.header.length===h.length&&t.header.every((x,i)=>x===h[i]));
export function handbookLights(doc:DocSource){const t=optTable(doc,HANDBOOK_TABLES.lights);return (t?.rows??[]).map(([id,kind,pos,dir,color,intensity,range,inner,outer,shadow])=>({id,kind:kind as 'directional'|'point'|'spot'|'area',position:vec(pos) as Vec3|null,direction:vec(dir) as Vec3|null,color:vec(color) as Vec3,intensity:Number(intensity),range:range==='None'?null:Number(range),innerConeDeg:inner==='None'?null:Number(inner),outerConeDeg:outer==='None'?null:Number(outer),width:null,height:null,castShadow:shadow==='是'}));}
export function handbookMaterials(doc:DocSource){const t=optTable(doc,HANDBOOK_TABLES.materials);return (t?.rows??[]).map(([id,label,base,metal,rough,em,emI,trans,coat])=>({id,label,baseColor:vec(base) as number[],metallic:Number(metal),roughness:Number(rough),emissive:vec(em) as Vec3|null,emissiveIntensity:Number(emI),transmission:Number(trans),ior:1.5,thickness:0,clearcoat:Number(coat),clearcoatRoughness:0.05,sources:[{kind:'doc' as const,ref:t!.section||'F2 材质冻结表'}]}));}
export function handbookSlots(doc:DocSource){const t=optTable(doc,HANDBOOK_TABLES.slots);return Object.fromEntries((t?.rows??[]).map(([gen,map])=>[gen,JSON.parse(map) as Record<string,string>]));}

export type HandbookObject={id:string;position:Vec3|null;size:Vec3|null;rotationDeg:Vec3|null;placement:string;envelope:string;interaction:string;source:string};
export type HandbookGenerator={id:string;params:SpecParams;inputs:string[];output:string;limits:string;source:string};
export type HandbookLeaf={id:string;name:string;count:[number,number|null]|null;params:string;priority:'P0'|'P1'|'P2'|null;acceptance:string;source:string};

const TRIPLE=/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/g;
const triples=(s:string):Vec3[]=>[...s.matchAll(TRIPLE)].map(m=>[Number(m[1]),Number(m[2]),Number(m[3])]);

/** `CORE_RING_01/02/03` → CORE_RING_01、CORE_RING_02、CORE_RING_03。 */
export function expandIds(cell:string):string[]{
 const [first,...rest]=cell.split('/').map(s=>s.trim());
 const m=first.match(/^(.*?)(\d+)$/);
 if(!rest.length||!m)return [first];
 return [first,...rest.map(r=>/^\d+$/.test(r)?m[1]+r:r)];
}

/** 包络 → 米制尺寸:`48×55×20`、`2×2×3`、`0.8×0.6×0.6`、`球径8`;二维(`20×24`)补 0 高。 */
export function parseEnvelope(s:string):Vec3|null{
 const sphere=s.match(/球径\s*(\d+(?:\.\d+)?)/);if(sphere){const d=Number(sphere[1]);return [d,d,d];}
 const box=s.match(/(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)(?:\s*×\s*(\d+(?:\.\d+)?))?/);
 if(!box)return null;
 return [Number(box[1]),Number(box[2]),box[3]===undefined?0:Number(box[3])];
}

export function handbookObjects(doc:DocSource):HandbookObject[]{
 const table=findTable(doc,[...HANDBOOK_TABLES.objects]),out:HandbookObject[]=[];
 let previousEnvelope='';
 for(const [idCell,placement,envelopeCell,interaction] of table.rows){
  const ids=expandIds(idCell),envelope=envelopeCell==='同上'?previousEnvelope:envelopeCell;previousEnvelope=envelope;
  let positions=triples(placement);
  if(/^原点/.test(placement))positions=[[0,0,0]];
  if(/同核心中心/.test(placement)){const core=out.find(o=>o.id==='CORE_001');positions=core?.position?[core.position]:[];}
  const rotations=/倾角/.test(envelope)?triples(envelope):[];
  const size=rotations.length?null:parseEnvelope(envelope);
  ids.forEach((id,i)=>out.push({id,position:positions.length===ids.length?positions[i]:positions.length===1?positions[0]:null,size,rotationDeg:rotations.length===ids.length?rotations[i]:null,placement,envelope,interaction,source:`${table.section}`}));
 }
 return out;
}

/** `outer_diameter11/13/15` → [11,13,15];`size(0.8,0.6,0.6)` → 向量;`step_height目标0.17` → 0.17;无值的项是必填输入。 */
export function parseGeneratorParams(cell:string):{params:SpecParams;inputs:string[]}{
 const params:SpecParams={},inputs:string[]=[];
 for(const token of cell.split('、').map(s=>s.trim()).filter(Boolean)){
  const m=token.match(/^([a-z_]+)(.*)$/);if(!m)continue;
  const [,name,raw]=m,value=raw.trim(),key=name.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase());
  const vector=triples(value);
  if(vector.length===1)params[key]=vector[0];
  else if(/^-?\d+(\.\d+)?(\/-?\d+(\.\d+)?)+$/.test(value))params[key]=value.split('/').map(Number);
  else if(/^[^\d-]*-?\d+(\.\d+)?$/.test(value))params[key]=Number(value.replace(/^[^\d-]*/,''));
  else if(value==='是'||value==='否')params[key]=value==='是';
  else if(value==='')inputs.push(key);
  else params[key]=value;
 }
 return {params,inputs};
}

export function handbookGenerators(doc:DocSource):HandbookGenerator[]{
 const table=findTable(doc,[...HANDBOOK_TABLES.generators]);
 return table.rows.map(([id,cell,output,limits])=>({id,...parseGeneratorParams(cell),output,limits,source:table.section}));
}

/** `主承重柱，16` / `墙面基础板，40–60` / `倾斜环标准段，24起步` / `门斗壳体，1`。 */
export function parseLeafName(cell:string):{name:string;count:[number,number|null]|null}{
 const m=cell.match(/^(.*?)[，,]\s*(\d+)(?:\s*[–-]\s*(\d+)?)?\s*(起步)?/);
 if(!m)return {name:cell.trim(),count:null};
 const min=Number(m[2]),max=m[4]||(m[3]===undefined&&/[–-]\s*$/.test(cell))?null:m[3]===undefined?min:Number(m[3]);
 return {name:m[1].trim(),count:[min,max]};
}

export function handbookLeaves(doc:DocSource):HandbookLeaf[]{
 const tables=doc.tables.filter(t=>[HANDBOOK_TABLES.leaves,HANDBOOK_TABLES.leavesAlt].some(h=>t.header.length===h.length&&t.header.every((x,i)=>x===h[i])));
 return tables.flatMap(t=>t.rows.filter(r=>/^[A-Z]{3}-\d{3}$/.test(r[0])).map(([id,nameCell,params,acc])=>{
  const p=acc.match(/^(P[012])/);
  return {id,...parseLeafName(nameCell),params,priority:p?p[1] as 'P0'|'P1'|'P2':null,acceptance:acc,source:t.section};
 }));
}

export function handbookPost(doc:DocSource):Record<string,unknown>{const t=optTable(doc,HANDBOOK_TABLES.post);return Object.fromEntries((t?.rows??[]).map(([k,v])=>[k,JSON.parse(v)]));}
export function handbookShots(doc:DocSource){const t=optTable(doc,HANDBOOK_TABLES.shots);return (t?.rows??[]).map(([id,label,pos,target,fov])=>({id,label,position:JSON.parse(pos) as Vec3,target:JSON.parse(target) as Vec3,fovDeg:Number(fov)}));}
