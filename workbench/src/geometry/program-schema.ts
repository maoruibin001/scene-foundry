import {RANGE} from './constraints';
const num={type:'number'},str={type:'string'},positive={type:'number',minimum:RANGE.positiveMin,maximum:RANGE.max},unit={type:'number',minimum:0,maximum:1},nonnegative={type:'number',minimum:0,maximum:RANGE.max},segments={type:'integer',minimum:RANGE.segmentsMin,maximum:RANGE.segmentsMax};
const arr=(items:any)=>({type:'array',items});
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const tag=(value:string)=>({type:'string',enum:[value]});
const vector={type:'array',items:{type:'number',minimum:-RANGE.max,maximum:RANGE.max},minItems:3,maxItems:3};
const positiveVector={...vector,items:positive};
const pose={position:vector,rotation:{...vector,items:{type:'number',minimum:-Math.PI*2,maximum:Math.PI*2}},scale:positiveVector};
const primitives=()=>[
  obj({type:tag('box'),size:positiveVector,radius:nonnegative}),
  obj({type:tag('lathe'),profile:{...arr({type:'array',items:num,minItems:2,maxItems:2}),minItems:2,maxItems:RANGE.profileMax},segments,arc:{type:['number','null'],minimum:.001,maximum:Math.PI*2},start:{type:['number','null'],minimum:-Math.PI*2,maximum:Math.PI*2}}),
  obj({type:tag('extrusion'),outline:{...arr({type:'array',items:vector.items,minItems:2,maxItems:2}),minItems:3,maxItems:RANGE.profileMax},depth:positive}),
  obj({type:tag('tube'),from:vector,to:vector,radius:positive,endRadius:nonnegative,segments}),
  obj({type:tag('grid'),points:{...arr(vector),maxItems:RANGE.gridMax},rows:{type:'integer',minimum:2,maximum:512},columns:{type:'integer',minimum:2,maximum:512},doubleSided:{type:'boolean'}}),
 ];
export function geometryProgramSchema(requirementIds?:string[]){return obj({
 version:tag('geometry-v1'),name:str,
 materials:arr(obj({id:str,color:{type:'array',items:unit,minItems:4,maxItems:4},roughness:unit,metallic:unit,textureId:{type:['string','null']}})),
 templates:arr(obj({id:str,parts:arr(obj({id:str,material:str,...pose,uvScale:{type:'array',items:{type:'number',minimum:RANGE.uvMin,maximum:RANGE.max},minItems:2,maxItems:2},shape:{anyOf:[...primitives(),
  obj({type:tag('scatter'),element:{anyOf:primitives()},count:{type:'integer',minimum:1,maximum:RANGE.scatterMax},seed:{type:'integer',minimum:0,maximum:4294967295},volume:{type:'string',enum:['box','ellipsoid']},size:positiveVector,rotationRange:{...vector,items:{type:'number',minimum:0,maximum:Math.PI*2}},scaleRange:{type:'array',items:positive,minItems:2,maxItems:2}}),
 ]}}))})),
 instances:arr(obj({id:str,label:str,template:str,...pose,requirementIds:arr(requirementIds?.length?{type:'string',enum:requirementIds}:str)})),
 });}
export const GEOMETRY_RULES=`按图中实际比例、轮廓和风格建模，不默认低模，不因构造能力有限而省略关键需求。
数值约束：尺寸、挤出厚度 depth、tube.radius、scale 必须在 ${RANGE.positiveMin}..${RANGE.max}；零厚度或低于下限的污渍薄片不允许，可用材质或有合法厚度的几何表达。box.radius 需在 0..最短尺寸的一半，tube.endRadius 允许为 0；lathe 的半径 0..100、高度 -100..100 且至少有一个正半径；分段为 ${RANGE.segmentsMin}..${RANGE.segmentsMax} 的整数，uvScale 为 ${RANGE.uvMin}..${RANGE.max}。grid 的 rows/columns 为至少 2 的整数，乘积与 points 数量一致且不超过 ${RANGE.gridMax}；这些约束不可因视觉效果而忽略。
先识别多图中同一结构，再安排空间锚点，最后拆分几何部件。templates 表示可复用物体，由 parts 组合；instances 引用模板并定位。物体类别不受预制列表限制。不同视角共享同一套几何，不为每张图另造布景，不把参考图贴到整面板上冒充场景。
所有坐标以米为单位，Z 向上。position 为局部原点偏移，rotation 为绕 X、Y、Z 依次旋转的弧度，scale 为正数缩放。部件先变换，再应用实例变换。名称、标签使用中文；ID 用字母开头的字母数字下划线。requirementIds 仅引用给出的原始需求。
可组合五类操作：box 以中心为原点，size 是宽深高，radius 为圆角半径或 0；lathe 用 [半径,高度] 连续轮廓绕 Z 旋转，闭合底面或顶面需要轮廓含半径 0；extrusion 用 XY 平面的简单非自交 outline 沿 +Z 挤出 depth，可用凹轮廓表达真实缺口；tube 连接任意 from/to 端点，radius/endRadius 表示两端半径；grid 用按行排列的 points 构造 rows×columns 曲面，可表示布面、起伏表面，doubleSided 明确是否双面。
lathe 还支持 arc/start：arc 是旋转弧长（弧度，0.001..2π），start 是起始角（-2π..2π），null 分别表示完整一圈和 0。可用局部旋转表达连续弧形结构、缺口曲面，保留完整区域而不是拆成几块平直花瓣；内外壁可用同一连续轮廓表达，端面与厚度按实际需要补齐。局部弧度不能改变共享布局的尺度和朝向。
还可使用scatter将一个基础构造element确定性地散布成真正的三维细节：element只能是上述五种基础构造，不能嵌套scatter。count为1..${RANGE.scatterMax}，seed为0..4294967295的固定整数；volume为box或ellipsoid，size表示以原点为中心的分布空间完整宽深高；element的局部原点均匀分布在该体积中，元素自身尺寸可能超出分布空间。rotationRange为各轴在正负给定弧度内随机旋转，scaleRange为从小到大的正数范围、对单个元素作均匀缩放。外层部件变换再作用于整组。适用于有图像依据的细碎或自然重复结构，不能用无关堆叠满足复杂度，也不能把有明确数量的独立主体藏进散布中绕过实体计数。每个元素使用同一局部UV，uvScale作用于每个元素；需要不同材质时拆成少量有依据的组。单个大片实心表面不能替代原图中透光、有空隙的细碎结构。散布会按count乘以element实际几何估算三角形，仍受全场景总预算约束，不增加预算。
不要用一整块箱体填满门洞或结构空隙。斜撑、厚度、圆角和轮廓必须体现在几何里。避免相互穿插和悬浮；承重与放置关系用实际坐标保证。不可见部分只能作为推断补全，不能保证精确恢复。
uvScale 表示整个表面在 U/V 方向重复贴图的次数，而不是每米次数；默认 [1,1]。extrusion 的两个端面按轮廓 XY 包围盒归一化到 0..1，侧面各自为 0..1；box 各面与 grid 整面也为 0..1。根据真实纹理覆盖尺寸计算重复次数，避免把表面米数重复相乘。主体图案、标签或单幅画通常只映射一次。
纹理像素左上角对应 UV(0,0)，V 向图片下方增加。以下方向均按部件局部坐标，之后才应用部件变换：extrusion 端面 U 向 +X、V 向 -Y；box 侧面 V 向 -Z，+X/-X 面的 U 分别向 +Y/-Y，+Y/-Y 面的 U 分别向 -X/+X；box 顶面 U 向 +X、V 向 -Y。加圆角不改变各面的贴图方向。grid 第一行对应图片顶边，最后一行对应底边，列从左到右。图片 quad 四角依次映射贴图左上、右上、右下、左下，选择裁切次序时必须匹配这些局部方向，不能靠旋转几何掩盖图案倒置。
材质 color 使用线性 RGBA，roughness/metallic 使用 0..1。不能捏造贴图路径或 URL。真实材质缺失会影响质量评分，不得把纯色称为写实贴图。
最多 64 个模板、每模板 128 个部件、256 个实例、128 个材质，展开后最多 2048 部件、250000 三角形。旋转和连接结构分段 3..64，轮廓最多 128 点，曲面最多 1024 点。优先结构准确和关键轮廓，不为用满预算堆砌细节。`;
export const GEOMETRY_PROMPT=`把冻结需求和所有参考图转换成统一的三维构造数据，只返回 geometry-v1 JSON，不生成代码。textureId 只能引用输入中已验证的可用贴图 ID，没有匹配纹理就填 null。\n${GEOMETRY_RULES}`;
