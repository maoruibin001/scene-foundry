import {bindingGeometryIssues} from './binding-geometry';
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
/** A targeted correction cannot replace the asset or shrink its path to evade a geometry diagnostic. */
export function validateGeometryCorrection(current:SceneSpec,issues:ReturnType<typeof bindingGeometryIssues>,delta:any){
 const length=(p:number[])=>{let n=0;for(let i=3;i<p.length;i+=3)n+=Math.hypot(...p.slice(i,i+3).map((v,k)=>v-p[i-3+k]));return n;};
 for(const b of delta.bindings??[])for(const id of b.objects){
  const o=current.objects.find(o=>o.id===id),prior=o?.geometryBinding,allowed=new Set(issues.filter(q=>q.object===id).map(q=>q.key));
  if(!prior||!allowed.size||b.generator!==prior.id)throw Error('PARAMETER_CORRECTION_INVALID：不得替换资产生成器');
  const params=Object.fromEntries(b.params.map((p:any)=>[p.key,p.number??p.numbers??p.flag]));
  for(const key in prior.params)if(!allowed.has(key)&&JSON.stringify(prior.params[key])!==JSON.stringify(params[key]))throw Error('PARAMETER_CORRECTION_INVALID：修改了未诊断参数 '+key);
  if(allowed.has('path')){const before=prior.params.path,after=params.path;if(!Array.isArray(before)||!Array.isArray(after)||Math.abs(length(before)-length(after))>Math.max(.01,length(before)*.001))throw Error('PARAMETER_CORRECTION_INVALID：不得通过缩短路径逃避边界校验');}
 }
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
 let answer=JSON.parse(result.text),applied=applyParameterBindings(source,answer);const geometryIssues=bindingGeometryIssues(applied.spec);let correction:any=null;
 if(geometryIssues.length){
  const ids=[...new Set(geometryIssues.map(q=>q.object))],system='你是通用生成器参数的几何契约校验修正器。只修正已列出的诊断，不能改变对象ID、族、原参数、位置、旋转、缩放，也不能删对象。输出每个待修对象的完整合法生成器参数，basis=design_fill并说明依据。所有 path/endPoint 点均为局部引擎坐标 +Y向上，规格世界坐标 +Z向上：局部点 [x,y,z] 在未旋转时对应规格 [x,-z,y]。先按给定旋转/缩放换算，再平移，世界端点必须在 bounds 中；显式 placement 两点连接必须命中另一世界点。适配器指出的 expected 数值必须直接成为显式参数，不依赖适配器暗改。不能用零长度路径或改变对象变换绕过诊断。只返回列出对象，给齐每个生成器参数；其他绑定不动。只能修改诊断列出的参数键；生成器ID及其他参数原样保留。修正路径的坐标轴时保留原路径总长度，不能缩短。';
  const text=JSON.stringify({bounds:source.bounds,issues:geometryIssues,objects:applied.spec.objects.filter(o=>ids.includes(o.id)),generators:Object.values(GENERATORS).filter(g=>applied.spec.objects.some(o=>ids.includes(o.id)&&o.geometryBinding?.id===g.id)).map(g=>({id:g.id,label:g.label,params:g.params}))}),folder=join(dir,'geometry-correction'),cache=join(DATA,'specs','parameter-bindings',hash({system,text,model}));mkdirSync(folder,{recursive:true});mkdirSync(cache,{recursive:true});
  const file=join(cache,'answer.json');if(existsSync(file)){correction=JSON.parse(readFileSync(file,'utf8'));correction.reused=true;}else{correction=await callSpecNode({role:'spec-parameter-correction',system,text,signal},folder,model,parameterRepairSchema(ids));writeFileSync(file,JSON.stringify({...correction,sourceCallDir:folder}));}
  writeFileSync(join(folder,'answer.json'),JSON.stringify(correction,null,2));const delta=JSON.parse(correction.text);validateGeometryCorrection(applied.spec,geometryIssues,delta);
  answer={bindings:[...answer.bindings.map((b:any)=>({...b,objects:b.objects.filter((id:string)=>!ids.includes(id))})).filter((b:any)=>b.objects.length),...delta.bindings],unresolved:delta.unresolved};applied=applyParameterBindings(source,answer);
 }
 const receipt={...applied.receipt,reused,sourceCallDir:result.sourceCallDir??dir,model,route:result.receipt,geometryIssuesBeforeCorrection:geometryIssues,correctionRoute:correction?.receipt??null,correctionReused:correction?.reused??false,before:{unresolved:before.unresolved.length,proxies:before.proxies.length}};
 writeFileSync(join(dir,'parameter-resolution.json'),JSON.stringify(receipt,null,2));if(bindingGeometryIssues(applied.spec).length)throw Error('PARAMETER_GEOMETRY_UNRESOLVED：一次定向修正后仍有几何契约矛盾；保留依据，不继续构建');return {...applied,receipt};
}
