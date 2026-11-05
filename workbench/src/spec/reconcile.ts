/**
 * 规格对账:模型参与的规格化结果必须与文档的确定性表格逐项一致。
 * master 对象(坐标/倾角/尺寸)、被引用的手册生成器参数、资产目录叶资产的去向,三类都要能解释清楚;
 * 任何缺失、不一致或去向不明都让 ok=false,规格不能进入后端。
 */
import type {HandbookGenerator,HandbookLeaf,HandbookObject} from './handbook';
import type {SceneSpec,SpecParamValue} from './schema';

type Exclusion={id:string;reason:string};
export type ReconcileReport={ok:boolean;summary:{masters:Record<string,number>;generators:Record<string,number>;leaves:Record<string,number>};
 masters:{id:string;status:'matched'|'excluded'|'missing'|'mismatched'|'unplaced';detail:string}[];
 generators:{id:string;status:'matched'|'mismatched'|'unused';detail:string}[];
 leaves:{id:string;status:'covered'|'excluded'|'unaccounted';detail:string}[]};

const same=(a:SpecParamValue|undefined,b:SpecParamValue|undefined)=>JSON.stringify(a)===JSON.stringify(b);
const near=(a:readonly number[]|null|undefined,b:readonly number[]|null|undefined)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-9);
const count=<T extends {status:string}>(rows:T[])=>rows.reduce((n,r)=>({...n,[r.status]:(n[r.status]??0)+1}),{} as Record<string,number>);

export function reconcileSpec(spec:SceneSpec,facts:{masters:HandbookObject[];generators:HandbookGenerator[];leaves:HandbookLeaf[]},exclusions:{excludedMasters?:Exclusion[];excludedLeaves?:Exclusion[]}={}):ReconcileReport{
 const excludedMasters=new Map((exclusions.excludedMasters??[]).map(x=>[x.id,x.reason]));
 const excludedLeaves=new Map((exclusions.excludedLeaves??[]).map(x=>[x.id,x.reason]));
 const masters=facts.masters.map(m=>{
  const o=spec.objects.find(x=>x.id===m.id);
  if(!o)return excludedMasters.has(m.id)?{id:m.id,status:'excluded' as const,detail:excludedMasters.get(m.id)!}:{id:m.id,status:(m.position?'missing':'unplaced') as 'missing'|'unplaced',detail:m.position?'规格缺少该 master 对象':'表格未给坐标:'+m.placement};
  const issues=[
   ...(m.position&&!near(o.transform.position,m.position)?[`位置 ${JSON.stringify(o.transform.position)} ≠ ${JSON.stringify(m.position)}`]:[]),
   ...(m.rotationDeg&&!near(o.transform.rotationDeg,m.rotationDeg)?[`倾角 ${JSON.stringify(o.transform.rotationDeg)} ≠ ${JSON.stringify(m.rotationDeg)}`]:[]),
   ...(m.size&&!near(o.params.size as number[],m.size)?[`尺寸 ${JSON.stringify(o.params.size)} ≠ ${JSON.stringify(m.size)}`]:[]),
   ...(o.authority!=='master'?['authority 不是 master']:[]),
  ];
  return {id:m.id,status:(issues.length?'mismatched':'matched') as 'mismatched'|'matched',detail:issues.join(';')};
 });
 const generators=facts.generators.map(g=>{
  const users=spec.families.filter(f=>f.generator?.id===g.id);
  if(!users.length)return {id:g.id,status:'unused' as const,detail:'没有资产族引用'};
  const issues=users.flatMap(f=>Object.entries(g.params).filter(([k,v])=>!same(f.generator!.params[k],v)).map(([k,v])=>`${f.id}.${k}=${JSON.stringify(f.generator!.params[k])} ≠ ${JSON.stringify(v)}`));
  return {id:g.id,status:(issues.length?'mismatched':'matched') as 'mismatched'|'matched',detail:issues.join(';')||users.map(f=>f.id).join(',')};
 });
 const covered=new Map<string,string>();
 for(const f of spec.families)for(const s of f.sources){const m=s.ref.match(/^卷四 ([A-Z]{3}-\d{3})$/);if(m)covered.set(m[1],f.id);}
 const leaves=facts.leaves.map(l=>covered.has(l.id)?{id:l.id,status:'covered' as const,detail:covered.get(l.id)!}:excludedLeaves.has(l.id)?{id:l.id,status:'excluded' as const,detail:excludedLeaves.get(l.id)!}:{id:l.id,status:'unaccounted' as const,detail:l.name});
 const ok=masters.every(m=>['matched','excluded','unplaced'].includes(m.status))&&generators.every(g=>g.status!=='mismatched')&&leaves.every(l=>l.status!=='unaccounted');
 return {ok,summary:{masters:count(masters),generators:count(generators),leaves:count(leaves)},masters,generators,leaves};
}
