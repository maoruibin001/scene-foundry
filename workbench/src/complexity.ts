import {GENERATION_REFERENCE} from './spec';
/** One contract for the selector, generation brief and acceptance budget. */
export const COMPLEXITIES = {
 simple: {id:'simple',label:'简单',minEntities:1,maxEntities:8,minKinds:1,maxParts:192,maxMaterials:32,description:'突出主体，少量环境；优先快速验证。',guidance:'围绕原始要求生成主体和少量必要环境。避免无意义堆砌，优先保证轮廓、空间关系和画面可读性。'},
 medium: {id:'medium',label:'中等',minEntities:8,maxEntities:16,minKinds:3,maxParts:384,maxMaterials:64,description:'增加环境层次和配套设施。',guidance:'保留原始主体，增加至少两组符合主题的环境或配套设施，形成前中后景。使用至少三类语义构件，避免用重复箱子凑数量。'},
 complex: {id:'complex',label:'复杂',minEntities:17,maxEntities:28,minKinds:4,maxParts:512,maxMaterials:128,description:'形成完整环境，增加分区与细节；耗时和失败风险更高。',guidance:'保留原始主体，构成有意义的完整环境：规划三组以上符合主题的区域或设施，提供前中后景、通行留白与细节，使用至少四类语义构件。主体仍需在全程巡航中清晰可辨。不要机械重复物体凑数，也不要引入未支持的角色、动画或交互。'},
} as const;
export type Complexity=keyof typeof COMPLEXITIES;
export function complexityOf(value:unknown):Complexity {
 if(value===undefined)return 'simple';
 if(typeof value!=='string'||!Object.hasOwn(COMPLEXITIES,value))throw Error('复杂度须为 simple、medium 或 complex');
 return value as Complexity;
}
export function generationBrief(prompt:string,level:Complexity){const p=COMPLEXITIES[level];return {
 version:'complexity-v2-zh',language:'zh-CN',engine:'ForgeaX Engine',reference:{id:GENERATION_REFERENCE.id,sha256:GENERATION_REFERENCE.sha256},originalPrompt:prompt,complexity:level,label:p.label,
 addedDirection:p.guidance,
 planningMethod:{order:['识别主体、比例、空间锚点与遮挡关系','先安排大结构及留白，再添加环境和配件','依宿主尺寸检查支撑和边界','从多个方向检查主体与整体可读性'],zones:level==='complex'?'至少三个有主题和功能的分区，先分配总实体预算再布局；各区需有不同职责和可辨层次。':level==='medium'?'至少两组服务于主体的配套环境，数量和尺度受当前预算约束。':'主体和必要支撑优先；只补与原始要求相关的少量环境。',distribution:'关键地标单独定位；配件按功能和宿主布置，避免均匀随机散布和机械复制。先修复空间错误，再补装饰。',scale:'前中后景是当前场景尺度内的相对层次，不照搬外部文档的距离、第一人称玩法或写实材质要求。',evidence:'未由原始输入确认的补全是设计推断，不是用户关键需求；实际画面与规则检查决定是否通过。'},
 budget:{nonGroundEntities:[p.minEntities,p.maxEntities],minimumKinds:p.minKinds,maximumMeshParts:p.maxParts,maximumMaterials:p.maxMaterials},
 preservation:'原始文字和参考图中的主体、明确数量、颜色及空间关系优先；新增环境属于设计选择，不能伪装成用户关键需求。若所选档位与明确要求冲突，应报告失败，不能删改原始要求或悄悄降档。三个档位使用相同制作规范与质量门槛。',
 };}
export function exportBudget(level:Complexity,base:any){return {...base,maxMaterials:COMPLEXITIES[level].maxMaterials};}
export function inspectComplexity(ir:any,recipe:any,level:Complexity){const p=COMPLEXITIES[level],entities=ir.entities.filter((e:any)=>e.role!=='ground'),kinds=[...new Set(entities.map((e:any)=>e.kind))];
 const checks=[{id:'entityBudget',passed:entities.length>=p.minEntities&&entities.length<=p.maxEntities,actual:entities.length,expected:[p.minEntities,p.maxEntities]},
 {id:'kindVariety',passed:kinds.length>=p.minKinds,actual:kinds.length,expected:p.minKinds},
 {id:'partBudget',passed:recipe.objects.length<=p.maxParts,actual:recipe.objects.length,expected:p.maxParts}];
 return {level,label:p.label,passed:checks.every(c=>c.passed),entityCount:entities.length,kindCount:kinds.length,kinds,partCount:recipe.objects.length,checks,method:'实体数量、类型与网格部件预算；构图和语义丰富度仍需实际画面的视觉验收。'};
}
