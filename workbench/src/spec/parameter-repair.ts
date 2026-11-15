import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {GENERATORS} from './generators';
import {resolveParams,type ParamValue} from './generators/kit';
import {inspectSpecParameters} from './export-pack';
import {callSpecNode,type NodeModel} from './node-models';
import {DATA} from '../store';
import type {SceneSpec} from './schema';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function parameterRepairSchema(ids:string[]){return {type:'object',additionalProperties:false,required:['bindings','unresolved'],properties:{bindings:{type:'array',items:{type:'object',additionalProperties:false,required:['objects','generator','params','basis','reason'],properties:{objects:{type:'array',minItems:1,items:{type:'string',enum:ids}},generator:{type:'string',enum:Object.keys(GENERATORS)},params:{type:'array',items:{type:'object',additionalProperties:false,required:['key','number','numbers','flag'],properties:{key:{type:'string'},number:{type:['number','null']},numbers:{anyOf:[{type:'array',items:{type:'number'}},{type:'null'}]},flag:{type:['boolean','null']}}}},basis:{type:'string',enum:['source','design_fill']},reason:{type:'string'}}}},unresolved:{type:'array',items:{type:'string'}}}};}
/** A model may propose explicit, typed local geometry. It cannot delete objects, move them or hide the source. */
export function applyParameterBindings(source:SceneSpec,answer:any){
 const report=inspectSpecParameters(source),pending=new Set(report.proxies.map(x=>x.object));
 const spec=structuredClone(source),seen=new Set<string>(),decisions:any[]=[];
 for(const b of answer.bindings??[]){
  const gen=GENERATORS[b.generator];if(!gen||!['source','design_fill'].includes(b.basis)||typeof b.reason!=='string'||b.reason.trim().length<12)throw Error('PARAMETER_REPAIR_INVALID: 缺少有效生成器或依据');
  const params:Record<string,ParamValue>={};for(const p of b.params){if(p.key in params)throw Error('PARAMETER_REPAIR_INVALID: 重复参数');const values=[p.number,p.numbers,p.flag].filter(x=>x!==null&&x!==undefined);if(values.length!==1)throw Error('PARAMETER_REPAIR_INVALID: 参数值不唯一');params[p.key]=values[0];}
  const checked=resolveParams(gen,params);if(checked.errors.length)throw Error('PARAMETER_REPAIR_INVALID: '+checked.errors.join(';'));
  // Bindings must specify every geometric parameter: omitted fields cannot quietly use defaults.
  if(Object.keys(gen.params).some(k=>!(k in params)))throw Error('PARAMETER_REPAIR_INVALID: 必须显式给齐生成器参数');
  for(const id of b.objects){if(!pending.has(id)||seen.has(id))throw Error('PARAMETER_REPAIR_INVALID: 非待决或重复对象 '+id);seen.add(id);
   const o=spec.objects.find(x=>x.id===id)!;const family=spec.families.find(f=>f.id===o.family)!;
   if(gen.assembly)throw Error('PARAMETER_REPAIR_INVALID: 对象绑定不能改为整组生成器');
   decisions.push({object:id,sourceFamily:o.family,generator:gen.id,params,basis:b.basis,reason:b.reason,sourceParams:o.params});o.geometryBinding={id:gen.id,params,basis:b.basis,reason:b.reason};
  }
 }
 return {spec,receipt:{version:'spec-parameter-binding-v1',sourceSha256:hash(source),effectiveSha256:hash(spec),decisions,unresolved:answer.unresolved??[],remaining:inspectSpecParameters(spec)}};
}
export async function repairSpecParameters(source:SceneSpec,dir:string,model:NodeModel,signal?:AbortSignal){
 const before=inspectSpecParameters(source);if(!before.proxies.length)return {spec:source,receipt:null};
 const ids=before.proxies.map(x=>x.object),objects=source.objects.filter(o=>ids.includes(o.id));
 const system='你是通用三维规格的参数契约修复器。输入是冻结规格，不是某个固定案例。只能为待决对象选择库内生成器并明确给齐其所有参数。保留每个对象ID、位置、旋转、缩放、数量；不以默认值或删除来清零。把尺寸同义词、开关/厚度、描述性路径转换为真实数值几何。显式数字/变换优先；描述有歧义时允许作最小设计补全，但必须标basis=design_fill并中文说明选择与未精确还原的内容；不能说是测量。路径为对象局部引擎坐标(Y向上)，每3个数一点，至少两点，不能用零长度路径；可依据全场布局选择最小连接路径。使用现有族材质；生成器形状应匹配部件语义。每个参数值只能填number/numbers/flag之一，另两个为null。所有尺寸合法，弧段半径大于半宽；检查所有相互约束。无法合理解决的放unresolved，不编造已解决。只输出结构化结果。';
 const text=JSON.stringify({bounds:source.bounds,pending:before.unresolved,objects,families:source.families.filter(f=>objects.some(o=>o.family===f.id)),context:source.objects.map(o=>({id:o.id,label:o.label,family:o.family,transform:o.transform})),constraints:source.constraints,generators:Object.values(GENERATORS).map(g=>({id:g.id,label:g.label,params:g.params,slots:g.slots,assembly:g.assembly??false}))});
 mkdirSync(dir,{recursive:true});const cache=join(DATA,'specs','parameter-bindings',hash({system,text,model}));mkdirSync(cache,{recursive:true});
 const cached=join(cache,'answer.json');let result:any,reused=false;
 if(existsSync(cached)){result=JSON.parse(readFileSync(cached,'utf8'));reused=true;}else{result=await callSpecNode({role:'spec-parameter-repair',system,text,signal},dir,model,parameterRepairSchema(ids));writeFileSync(cached,JSON.stringify({...result,sourceCallDir:dir}));}
 writeFileSync(join(dir,'answer.json'),JSON.stringify({...result,reused},null,2));
 const applied=applyParameterBindings(source,JSON.parse(result.text));const receipt={...applied.receipt,reused,sourceCallDir:result.sourceCallDir??dir,model,route:result.receipt,before:{unresolved:before.unresolved.length,proxies:before.proxies.length}};
 writeFileSync(join(dir,'parameter-resolution.json'),JSON.stringify(receipt,null,2));return {...applied,receipt};
}
