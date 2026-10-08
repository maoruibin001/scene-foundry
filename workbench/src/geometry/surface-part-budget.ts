import {COMPLEXITIES,type Complexity} from '../complexity';

export const ASSET_STEP_LIMITS={templates:16,parts:64};

/** A geometry part has one material. Required source slots across all instances
 * therefore impose a minimum after the independent surface plan is known. */
export function assetPartCapacity(layout:any,brief:any){
 const requiredMaterialIds=[...new Set<string>(layout.program.instances.filter((i:any)=>i.template===brief.id).flatMap((i:any)=>(i.surfaceOverrides??[]).map((b:any)=>b.sourceMaterialId)))];
 const maxParts=Math.max(brief.maxParts,requiredMaterialIds.length);
 if(!Number.isInteger(maxParts)||maxParts<1||maxParts>ASSET_STEP_LIMITS.parts)throw Error('SURFACE_PART_CAPACITY_EXCEEDED：'+brief.id+' 的必需材质槽需要 '+requiredMaterialIds.length+' 个部件，超过单资产上限 '+ASSET_STEP_LIMITS.parts);
 return {templateId:brief.id,plannedMaxParts:brief.maxParts,requiredMaterialIds,minimumParts:requiredMaterialIds.length,maxParts};
}

/** Reconcile the two stages within the unchanged scene ceiling, before assets
 * are dispatched. This derives capacity; it never edits the frozen spatial plan. */
export function surfacePartBudget(layout:any,level:Complexity){
 const templates=layout.program.templates.map((t:any)=>({...assetPartCapacity(layout,t),instances:layout.program.instances.filter((i:any)=>i.template===t.id).length}));
 const before=templates.reduce((n:number,t:any)=>n+t.plannedMaxParts*t.instances,0),after=templates.reduce((n:number,t:any)=>n+t.maxParts*t.instances,0),limit=COMPLEXITIES[level].maxParts;
 if(after>limit)throw Error('SURFACE_PART_CAPACITY_EXCEEDED：必需材质槽合并后的展开部件预算 '+after+' 超过场景上限 '+limit+'；请协调材质槽与几何规划，不删除可见材质差异或放宽总上限');
 return {version:'surface-part-budget-v1',before,after,limit,templates,adjustments:templates.filter((t:any)=>t.maxParts!==t.plannedMaxParts),spatialPlanUnchanged:true};
}
