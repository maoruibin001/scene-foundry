import {GEOMETRY_LIMITS,shapeTriangles,type GeometryProgram} from './program';
import {assetPartCapacity} from './surface-part-budget';
/** Allocate the expanded budget across all repeated templates, before parallel generation. */
export function assetTriangleBudget(layout:any,brief:any){
 const count=layout.program.instances.filter((i:any)=>i.template===brief.id).length;
 const weight=layout.program.instances.reduce((n:number,i:any)=>n+assetPartCapacity(layout,layout.program.templates.find((t:any)=>t.id===i.template)).maxParts,0);
 const maximum=Math.floor(GEOMETRY_LIMITS.triangles*.95*assetPartCapacity(layout,brief).maxParts/weight);
 return {maximum,instances:count,expandedMaximum:maximum*count,sceneMaximum:GEOMETRY_LIMITS.triangles};
}
export function estimateTriangles(p:GeometryProgram){return p.instances.reduce((n,i)=>n+p.templates.find(t=>t.id===i.template)!.parts.reduce((v,x)=>v+shapeTriangles(x.shape),0),0);}
/** Compatibility recovery for already generated assets. Preserve every instance/part/pose/material;
 * only procedural scatter density may be reduced. Every change is reported, never called quality success. */
export function fitAssemblyBudget(program:GeometryProgram){
 const before=estimateTriangles(program),limit=GEOMETRY_LIMITS.triangles;
 if(before<=limit)return {program,report:{before,after:before,limit,changes:[]}};
 const next=structuredClone(program),changes:any[]=[];
 const counts=new Map(next.templates.map(t=>[t.id,next.instances.filter(i=>i.template===t.id).length]));
 const scatters=next.templates.flatMap(t=>t.parts.filter(p=>p.shape.type==='scatter').map(p=>({template:t.id,part:p,instances:counts.get(t.id)!})));
 const scatterTotal=scatters.reduce((n,s)=>n+shapeTriangles(s.part.shape)*s.instances,0),fixed=before-scatterTotal;
 const ratio=(limit*.95-fixed)/scatterTotal;
 if(!(ratio>0&&ratio<1))throw Error('ASSEMBLY_BUDGET_UNRECOVERABLE：固定结构已超预算，不能删除结构或放宽上限；保留空间草稿');
 for(const s of scatters){const shape=s.part.shape as any,old=shape.count;shape.count=Math.max(1,Math.floor(old*ratio));if(old!==shape.count)changes.push({templateId:s.template,partId:s.part.id,from:old,to:shape.count,instances:s.instances});}
 const after=estimateTriangles(next);if(after>limit)throw Error('ASSEMBLY_BUDGET_UNRECOVERABLE：密度调整仍不足，保留空间草稿');
 return {program:next,report:{before,after,limit,changes,reason:'旧产物实例展开超出总三角形预算；只降低程序化散布密度，原资产保留；画面与质量需重新验收'}};
}
