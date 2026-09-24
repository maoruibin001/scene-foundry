import type {Complexity} from '../complexity';

/** 编辑范围与最终场景预算分开；提高编辑覆盖率不放宽实体、面数或质量门槛。 */
export const LEGACY_REPAIR_BUDGET = {templates:4,parts:32,removeParts:32} as const;
export function repairBudget(level:Complexity){
 return level==='complex'?{templates:6,parts:96,removeParts:96}:level==='medium'?{templates:4,parts:64,removeParts:64}:{...LEGACY_REPAIR_BUDGET};
}
export type RepairBudget=ReturnType<typeof repairBudget>;
