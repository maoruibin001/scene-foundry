export const GRAYBOX_REPAIR_POLICY='template-bounds-v1';
export const GRAYBOX_TEMPLATE_BOUND_EDITS=2;
export const GRAYBOX_TEMPLATE_BOUNDS_PROMPT='template-bounds-v1 本任务的局部修正另允许扩展最多2个已有模板的bounds，覆盖前述“templates必须为空”和“原bounds内”：templates每项写完整id/description/origin/bounds，新bounds必须包含原bounds（每轴min不增大、max不减小），每轴跨度不超过来源2倍；模板id、数量、预算、实体和需求仍冻结，不新增模板或实例。只扩展bounds不会产生几何，须同时用parts/groups把该模板已有部件移入或延伸到新范围；部件位移上限与编译检查按新bounds执行。共享模板的bounds与轮廓同时作用于其全部实例（含镜像实例），须检查全部使用位置。用于原图连续的立面、檐口、屋顶或围合在冻结范围外被截断、露出天空或缺口的情况，不用于把无关体量放大堵住通道或机位。';
/** Only jobs created under the policy may edit template bounds; historical repairs replay under their frozen contract. */
export function templateBoundsRule(job:any){return job?.grayboxRepairPolicy===GRAYBOX_REPAIR_POLICY;}
