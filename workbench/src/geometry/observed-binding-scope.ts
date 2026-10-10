export const OBSERVED_BINDING_POLICY='critical-view-exclusive-v1';
export const OBSERVED_BINDING_GUIDANCE='critical-view-exclusive-v1 地标绑定规则：每个关键地标在其每张参考图中，至少需要一个不被该图任何其他地标（含非关键地标）绑定的真实实例；同一地标在同一图有多个观察框时，独有实例数不少于框数。门楼横梁/山花/浮雕、高顶斜顶/高窗带/檐带拱口等原图分开记录的关键部件，须拆为可独立摆放的实例（可各用小模板或复用同类模板），不能全部绑定同一个整体实例；沿立面分布的灯组、亮带等集合地标应绑定自己的构成实例，不能借用宿主墙体或屋顶别名。实例总数、模板数和部件预算上限不变：为拆分腾出名额时合并非关键地标的实例或复用模板，不删除地标或降低关键性。此规则只保证后续构图测量能区分各关键目标，不证明还原质量。';
export type ObservedBindingViolation={landmarkId:string;referenceIndex:number;instanceIds:string[];sharedWith:Record<string,string[]>;boxes:number;exclusiveInstanceIds:string[];requiredAction:string};

export class ObservedBindingScopeError extends Error{
 readonly violations:ObservedBindingViolation[];
 constructor(violations:ObservedBindingViolation[]){
  super('OBSERVED_BINDING_SCOPE: '+JSON.stringify({policy:OBSERVED_BINDING_POLICY,violations,guidance:'一次修正全部冲突后重新保存；同类模板可复用，实例总数和模板数仍受原上限约束'}));
  this.name='ObservedBindingScopeError';this.violations=structuredClone(violations);
 }
}

/** Only jobs created under the policy are checked; historical spaces replay under their original contract. */
export function observedBindingRule(job:any){return job?.observedBindingPolicy===OBSERVED_BINDING_POLICY;}

/** Static precondition for per-view measurement: each critical view owns enough instances that no other landmark on that camera binds. */
export function validateCriticalViewExclusive(space:any,observation:any){
 const bindings=new Map<string,string[]>((space?.observedBindings??[]).map((b:any)=>[b.landmarkId,[...new Set<string>(b.instanceIds??[])]]));
 const violations:ObservedBindingViolation[]=[];
 for(const landmark of observation?.landmarks??[]){
  if(!landmark.critical)continue;
  const ids=bindings.get(landmark.id)??[];
  for(const referenceIndex of [...new Set<number>((landmark.views??[]).map((v:any)=>v.referenceIndex))].sort((a,b)=>a-b)){
   const boxes=landmark.views.filter((v:any)=>v.referenceIndex===referenceIndex).length,sharedWith:Record<string,string[]>={};
   for(const other of observation.landmarks)if(other.id!==landmark.id&&other.views?.some((v:any)=>v.referenceIndex===referenceIndex))
    for(const id of bindings.get(other.id)??[])if(ids.includes(id))(sharedWith[id]??=[]).push(other.id);
   const exclusive=ids.filter(id=>!sharedWith[id]).sort();
   if(exclusive.length>=boxes)continue;
   violations.push({landmarkId:landmark.id,referenceIndex,instanceIds:ids,sharedWith,boxes,exclusiveInstanceIds:exclusive,
    requiredAction:'split-shared-instance: 为该关键地标在第'+referenceIndex+'张图创建至少'+boxes+'个独有实例，或让共用它的其他地标改绑自己的构成实例；不得删除地标或改冻结关系'});
  }
 }
 if(violations.length)throw new ObservedBindingScopeError(violations);
 return space;
}
