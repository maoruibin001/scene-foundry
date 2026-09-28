import type {Complexity} from '../complexity';

/** 编辑范围与最终场景预算分开；提高编辑覆盖率不放宽实体、面数或质量门槛。 */
export const LEGACY_REPAIR_BUDGET = {templates:4,parts:32,removeParts:32} as const;
export function repairBudget(level:Complexity){
 // 复杂场景的关联修复允许覆盖更多已有资产；最终面数、实例数和验收标准仍由原契约限制。
 return level==='complex'?{templates:12,parts:96,removeParts:96}:level==='medium'?{templates:4,parts:64,removeParts:64}:{...LEGACY_REPAIR_BUDGET};
}
export type RepairBudget=ReturnType<typeof repairBudget>;
