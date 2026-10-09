import {SURFACE_DETAIL_GUIDANCE} from './surface-detail';
import {MATERIAL_EMISSION_GUIDANCE} from './material-emission';
import {CATALOG_GUIDANCE} from './material-catalog';
import {LIGHTING_RULES} from './lighting';
import {surfaceOverridesSchema} from './program-schema';
import type {SurfaceOverride} from './program';
import {CONTACTS_PROMPT} from './contacts';
import {OPENINGS_PROMPT} from './openings';
import {layoutSchema,validateLayout,validateLayoutStructure,LAYOUT_COORDINATE_RULES,type SceneLayout,type AssetBrief} from './layout';
import type {Complexity} from '../complexity';
export type SpaceLayout=Omit<SceneLayout,'version'|'textures'|'lighting'|'textureReuse'|'program'>&{version:'scene-space-v1';program:Omit<SceneLayout['program'],'materials'|'templates'>&{templates:Omit<AssetBrief,'materialIds'>[]}};
export type SurfacePlan={textureReuse?:SceneLayout['textureReuse'];version:'scene-surface-v1';materials:SceneLayout['program']['materials'];textures:SceneLayout['textures'];lighting:SceneLayout['lighting'];bindings:{templateId:string;materialIds:string[]}[];instanceSurfaces?:{instanceId:string;surfaceOverrides:SurfaceOverride[]}[];assumptions:string[]};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
function omit(s:any,keys:string[]){for(const key of keys)delete s.properties[key];s.required=s.required.filter((k:string)=>!keys.includes(k));}
export function spaceSchema(ids?:string[]){const s=layoutSchema(ids);s.properties.version.enum=['scene-space-v1'];omit(s,['textures','lighting','textureReuse']);s.properties.spatialRelations={type:'array',minItems:1,maxItems:24,items:obj({id:{type:'string'},description:{type:'string'},critical:{type:'boolean'},instanceIds:{type:'array',items:{type:'string'}}})};s.required.push('spatialRelations','observedBindings');s.properties.observedBindings={type:'array',items:obj({landmarkId:{type:'string'},instanceIds:{type:'array',items:{type:'string'}}})};omit(s.properties.program.properties.instances.items,['surfaceOverrides']);omit(s.properties.program,['materials']);omit(s.properties.program.properties.templates.items,['materialIds']);return s;}
/** The model chooses the layout; frozen observed relations are assembled locally. */
export function spacePlanningSchema(ids?:string[]){const s=spaceSchema(ids);s.properties.version.enum=['scene-space-plan-v2'];omit(s,['spatialRelations']);return s;}
export function surfaceSchema(){const s=layoutSchema().properties;return obj({version:{type:'string',enum:['scene-surface-v1']},textureReuse:s.textureReuse,materials:s.program.properties.materials,textures:s.textures,lighting:s.lighting,bindings:{type:'array',items:obj({templateId:{type:'string'},materialIds:{type:'array',items:{type:'string'}}})},instanceSurfaces:{type:'array',items:obj({instanceId:{type:'string'},surfaceOverrides:surfaceOverridesSchema()})},assumptions:s.assumptions});}
export function validateSpace(space:SpaceLayout,plan:any,references:number,level:Complexity){if(space?.version!=='scene-space-v1')throw Error('空间规划版本无效');validateLayoutStructure(space,plan,references,level);return space;}
export function applySurface(space:SpaceLayout,surface:SurfacePlan,plan:any,references:number,level:Complexity):SceneLayout{
 if(surface?.version!=='scene-surface-v1'||!Array.isArray(surface.bindings)||surface.bindings.length!==space.program.templates.length||new Set(surface.bindings.map(b=>b.templateId)).size!==surface.bindings.length||surface.bindings.some(b=>!space.program.templates.some(t=>t.id===b.templateId)))throw Error('每个冻结模板必须且只能绑定一次材质');
 if(surface.instanceSurfaces!==undefined&&(!Array.isArray(surface.instanceSurfaces)||surface.instanceSurfaces.length!==space.program.instances.length||new Set(surface.instanceSurfaces.map(b=>b.instanceId)).size!==space.program.instances.length||surface.instanceSurfaces.some(b=>!space.program.instances.some(i=>i.id===b.instanceId))))throw Error('每个冻结实例必须且只能声明一次表面配置');
 if(!Array.isArray(surface.assumptions)||surface.assumptions.some(x=>typeof x!=='string'))throw Error('材质推断说明无效');
 return validateLayout({...space,version:'scene-layout-v1',program:{...space.program,instances:space.program.instances.map(i=>surface.instanceSurfaces?{...i,surfaceOverrides:surface.instanceSurfaces.find(b=>b.instanceId===i.id)!.surfaceOverrides}:i),materials:surface.materials,templates:space.program.templates.map(t=>({...t,materialIds:surface.bindings.find(b=>b.templateId===t.id)!.materialIds}))},textures:surface.textures,textureReuse:surface.textureReuse??[],lighting:surface.lighting,assumptions:[...space.assumptions,...surface.assumptions]},plan,references,level);
}
export const SPACE_PROMPT=`这是通用场景生成的空间规划步骤。根据全部参考图和冻结需求，输出 scene-space-plan-v2。只决定物体模板、实例位置、尺度、朝向和参考机位；材质、贴图片段、光照和逐部件几何由后续独立步骤完成，此步不要推演它们的完整构造。不要调用工具，不输出程序代码。
${LAYOUT_COORDINATE_RULES}
全部图片属于同一个空间。单位为米，Z向上，rotation是绕XYZ依次旋转的弧度，scale为正值。templates最多16个；同形物体共用模板，不同位置用instances。模板包含id、中文label、简洁description、origin、bounds.min/max、maxParts。origin明确本体局部原点与朝向，bounds给出完整物体在局部坐标下的外包络；真实开口在description说明，后续几何不能填死。每个description只描述最重要的轮廓和开口，不写施工长文。每模板maxParts为1..64，是空间阶段的部件预估；独立材质规划完成后会按实际必需材质槽核对最少部件数，但不提高单资产及场景总上限。所有实例的模板maxParts相加不得超过输入的部件预算。
每个实例含id、中文label、template、position、rotation、scale、requirementIds。关键需求至少有一个对应实例绑定，明确数量按完整物体计数，不让配件重复计数。entities与instances一一对应，instanceId、role(subject/context/ground)和自由定义的category表示语义，不局限预制类别。category使用中文类别名称（1至56字符，无首尾空白或控制字符），同类实体使用相同名称；它不是资产ID或路径。复杂度的数量和种类预算必须满足，不添加无关物体凑数。
observedBindings 为每个已观察地标绑定 instanceIds，每个实例必须有地标依据，禁止新增未观察物体。输入 observation.relations 已经冻结，必须据此安排主体的前后左右、大小比例、遮挡、通道和纵深。不要在输出中重复 spatialRelations：程序将逐字保留原关系 id、description、critical，并依据 observedBindings 确定地展开 instanceIds；不能删除关系或降低关键性。不可见关系写入 assumptions，不冒充观察。全部原关系随后仍须用 Engine 灰模截图逐项验收，验收不通过不会开始资产生成。
每张参考图恰好一个referenceIndex为1..图片总数的相机。场景至少两个不同位置，最多六个，额外检查机位的referenceIndex为null。相机name用中文，position、target与物体共用Z向上坐标，fov为垂直视场弧度。projection 选择 perspective 或 orthographic；等距作品采用 orthographic，orthographicHeight 为米制垂直覆盖高度，perspective时为null。机位靠图中透视和遮挡估计，不能远距离俯视掩盖细节。
不可观察的背面、尺度及相机估计放入中文assumptions。当前仅规划，不能称为几何已生成、已符合质量门槛。完全根据当前输入设计，不依赖固定场景坐标或专用物件。
${OPENINGS_PROMPT}
${CONTACTS_PROMPT}`;
export const SURFACE_PROMPT=`这是通用场景生成的材质与光照规划步骤。根据全部参考图和已经冻结的空间规划，仅输出scene-surface-v1：materials、textures、lighting、bindings、instanceSurfaces和assumptions。不要更改实例、模板ID、尺寸或相机，不生成几何或代码，不调用工具。
materials是共享PBR材质列表：id、线性RGBA color、roughness/metallic(0..1)、textureId(无贴图填null)。bindings必须为每个模板恰好提供一次templateId与非空materialIds；材质ID只能引用本次定义。若输入有 reusableTextures，可通过 textureReuse:[{textureId,assetId,reason}] 选择已经存在且语义、颜色、尺度适合的材质；textureId 仍指向 textures 中的局部表面声明，assetId 只能取候选 ID。复用时采用资源库原像素，quad 只标注参考中对应表面的位置，不再次裁图。没有合适候选填 []；不能仅因有缓存就接受不匹配材料。若有 previousSurface，保留已被几何引用的材质 ID，可修正其参数和纹理绑定，不删除原有材质。additionalFrames 是当前生成截图，用来识别材质拉伸、暗部重复光照和颜色失真；它们不是新的参考原图。
每个对象应有足够的材料区别，不把明显不同的表面归成一种纯色。instanceSurfaces 为每个实例恰好一项 {instanceId,surfaceOverrides}，无覆盖填空数组。surfaceOverrides 每项 {sourceMaterialId,targetMaterialId,uvScale,uvTransform}：源材质是模板实际构造时的材质槽，目标是当前实例应使用的共享材质。相同几何而颜色或材质不同，必须通过此配置分别绑定，不能仅把多种材质列入允许列表。源材质须在模板 materialIds 内，目标须存在于 materials；每个源材质最多覆盖一次，并且后续资产必须实际使用所有被覆盖的源材质。一个几何部件只能绑定一个源材质，独立表面槽至少需要同等数量的部件；合并实例后仍须满足已有场景部件总预算。不要为颜色差异复制几何。uvTransform 可按原图为不同实例指定偏移、旋转和翻转，避免相同磨损图案机械重复；没有依据时为null，不随机改变明确装饰图案。
uvScale 为当前实例该表面整体 U/V 方向重复次数；null 保留部件原比例。结合模板 bounds 与实例 scale 得到最终米制尺寸，依据参考图中纹理覆盖面积计算重复次数，不能把局部裁切默认整张铺满大型表面。颜色变化而尺度不变时填 null；同材质但尺寸变化时可 sourceMaterialId=targetMaterialId 并调整重复次数。主体彩绘或标签不能重复平铺。
textures最多24个局部片段：id、referenceIndex、quad、size、description。referenceIndex从1开始；quad为完整原图上的四角归一化坐标，顺序左上、右上、右下、左下，不自交，面积大于0.00005且小于等于0.3；size仅256或512。选择清晰无遮挡的真实表面，不含水印、黑边或标注，不使用整图面板代替三维。照片颜色保留拍摄光照，不称为纯反射率；无图片时textures为空，不能捏造路径。已贴图材质color通常用[1,1,1,1]，后续几何使用UV控制纹理尺度。
${SURFACE_DETAIL_GUIDANCE}
${MATERIAL_EMISSION_GUIDANCE}
${CATALOG_GUIDANCE}
lighting包含一个direction/color/intensity、ambientColor/ambientIntensity以及最多16个points，每点给出position/color/intensity/range。坐标Z向上，与冻结布局一致。按输入匹配方向、层次和明暗，关键对象保持可辨。assumptions用中文标注不可确认的材料、曝光和补光估计。
${LIGHTING_RULES}
当前只是材质计划；片段随后从当前输入提取并校验，不能把尚未提取的纹理称为已验证资源。最终还原质量由真实Engine画面判断。`;
