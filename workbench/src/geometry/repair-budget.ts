import {COMPLEXITIES,type Complexity} from '../complexity';
import {validateGeometryProgram,shapeTriangles,GEOMETRY_LIMITS,type GeometryProgram} from './program';

/** 编辑范围与最终场景预算分开；提高编辑覆盖率不放宽实体、面数或质量门槛。 */
export const LEGACY_REPAIR_BUDGET = {templates:4,parts:32,removeParts:32} as const;
export function repairBudget(level:Complexity){
 // 复杂场景的关联修复允许覆盖更多已有资产；最终面数、实例数和验收标准仍由原契约限制。
 return level==='complex'?{templates:12,parts:96,removeParts:96}:level==='medium'?{templates:4,parts:64,removeParts:64}:{...LEGACY_REPAIR_BUDGET};
}
export type RepairBudget=ReturnType<typeof repairBudget>;
/** 两种修正入口共享实际占用与剩余额度，避免只报三角形而遗漏展开部件上限。 */
export function repairGeometryBudget(program:GeometryProgram,level:Complexity){
 const current=validateGeometryProgram(program),policy=COMPLEXITIES[level],maxParts=Math.min(GEOMETRY_LIMITS.expandedParts,policy.maxParts),maxMaterials=Math.min(GEOMETRY_LIMITS.materials,policy.maxMaterials);
 const consumers=program.templates.map(t=>{const instances=program.instances.filter(i=>i.template===t.id).length;return {templateId:t.id,instances,expandedParts:t.parts.length*instances,estimatedTriangles:t.parts.reduce((n,p)=>n+shapeTriangles(p.shape),0)*instances};}).filter(t=>t.instances).sort((a,b)=>b.estimatedTriangles-a.estimatedTriangles);
 return {currentEstimatedTriangles:current.triangles,maxEstimatedTriangles:GEOMETRY_LIMITS.triangles,remainingEstimatedTriangles:GEOMETRY_LIMITS.triangles-current.triangles,currentExpandedParts:current.parts,maxExpandedParts:maxParts,remainingExpandedParts:maxParts-current.parts,currentMaterials:program.materials.length,maxMaterials,remainingMaterials:maxMaterials-program.materials.length,largestGeometryConsumers:consumers.slice(0,8),instructions:'占用按全部模板实例展开计算；网格仅排除编译器本来就不输出的退化面，其他构造保守估算。三角形、部件和材质上限同时生效。优先替换已有低质部件，新增必须有剩余额度；不得靠删除关键结构或不可见隐藏规避上限。'};
}
