import {BLOCKOUT_PART_LIMIT} from './blockout-contract';
export const GRAYBOX_REPAIR_POLICY='template-bounds-v1';
/** template-bounds-v1 plus group rebuilds sized by the frozen brief instead of the first-pass blockout cap. */
export const GRAYBOX_GROUP_PARTS_POLICY='template-bounds-group-parts-v1';
export const GRAYBOX_GROUP_PART_LIMIT=16;
export const GRAYBOX_TEMPLATE_BOUND_EDITS=2;
export const GRAYBOX_TEMPLATE_BOUNDS_PROMPT='template-bounds-v1 本任务的局部修正另允许扩展最多2个已有模板的bounds，覆盖前述“templates必须为空”和“原bounds内”：templates每项写完整id/description/origin/bounds，新bounds必须包含原bounds（每轴min不增大、max不减小），每轴跨度不超过来源2倍；模板id、数量、预算、实体和需求仍冻结，不新增模板或实例。只扩展bounds不会产生几何，须同时用parts/groups把该模板已有部件移入或延伸到新范围；部件位移上限与编译检查按新bounds执行。共享模板的bounds与轮廓同时作用于其全部实例（含镜像实例），须检查全部使用位置。用于原图连续的立面、檐口、屋顶或围合在冻结范围外被截断、露出天空或缺口的情况，不用于把无关体量放大堵住通道或机位。';
/** Voxel spaces admit only on-lattice bounds; the lattice check rejects off-grid edits instead of rounding them. */
export const GRAYBOX_TEMPLATE_BOUNDS_VOXEL_PROMPT=(cellSize:number)=>`体素场景扩展bounds时，min/max每轴必须是cellSize=${cellSize}米的整数倍（共同格网origin=[0,0,0]），使全部实例的世界边界仍在格网上；新增范围内的部件仍用voxelVolume构造，dimensions随之扩展；不在格网上会被拒绝，不自动取整。`;
export const GRAYBOX_GROUP_PARTS_PROMPT=`${GRAYBOX_GROUP_PARTS_POLICY} 本任务的groups重建覆盖前述“每模板1–8个部件”：每个重建模板最多使用groupPartLimits中该模板的部件数（不少于8，不超过${GRAYBOX_GROUP_PART_LIMIT}且不超过冻结简报maxParts），parts局部修改仍为原额度。额外部件用于原图中一个模板覆盖的多座远楼、多层招牌或连续立面需要前后错落、逐渐缩小的层次时：把厚大整体块拆成有空隙的递远粗体量、细塔与退台，保留天际线缺口和视廊。不得用额外部件堵塞通道、铺背景板或做逐窗逐叶细节；共享模板仍作用于全部实例，总预算、bounds和接触照常检查。`;
/** Only jobs created under the policy may edit template bounds; historical repairs replay under their frozen contract. */
export function templateBoundsRule(job:any){return [GRAYBOX_REPAIR_POLICY,GRAYBOX_GROUP_PARTS_POLICY].includes(job?.grayboxRepairPolicy);}
/** The group part cap a job's repairs were created under; earlier jobs keep the first-pass blockout cap. */
export function grayboxGroupParts(job:any){return job?.grayboxRepairPolicy===GRAYBOX_GROUP_PARTS_POLICY?GRAYBOX_GROUP_PART_LIMIT:BLOCKOUT_PART_LIMIT;}
/** A diagnosed ordinary continuation adopts the brief-sized rebuild cap; every other job keeps its source's frozen policy. */
export function grayboxRepairPolicyFor(sceneKind:string,diagnosed:boolean,source:any){return diagnosed&&sceneKind!=='voxel'?GRAYBOX_GROUP_PARTS_POLICY:source?source.grayboxRepairPolicy??null:GRAYBOX_REPAIR_POLICY;}
/** Per-template cap: the brief's own budget, never below the first-pass cap a source group may already use. */
export function groupPartLimit(brief:{maxParts:number},groupParts:number){return groupParts>BLOCKOUT_PART_LIMIT?Math.max(BLOCKOUT_PART_LIMIT,Math.min(groupParts,brief.maxParts)):BLOCKOUT_PART_LIMIT;}
