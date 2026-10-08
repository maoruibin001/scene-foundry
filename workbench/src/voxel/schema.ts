import { lightingSchema } from "../geometry/lighting";
import { VOXEL_LIMITS, VOXEL_VERSION } from "./program";
const str = { type: "string" }, num = { type: "number" }, bool = { type: "boolean" };
const machineId={type:'string',pattern:'^[a-zA-Z][a-zA-Z0-9_-]{0,48}$'};
const vec = { type: "array", items: num, minItems: 3, maxItems: 3 };
const gridVec = { ...vec, items: { type: "integer", minimum: 0, maximum: VOXEL_LIMITS.dimension } };
const arr = (items: any) => ({ type: "array", items });
const choice = (...values: string[]) => ({ type: "string", enum: values });
const obj = (properties: any) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export function voxelSchema(requirements?: string[]) {
  return obj({ version: choice(VOXEL_VERSION), name: str, size: gridVec, cellSize: num,
    palette: arr(obj({ id: machineId, color: { type: "string", pattern: "^#[a-fA-F0-9]{6}$" } })),
    entities: arr(obj({ id: machineId, label: str, category: str, role: choice("subject", "context", "ground"), requirementIds: arr(requirements?.length ? choice(...requirements) : str),
      operations: arr(obj({ action: choice("fill", "erase", "paint"), shape: choice("box", "ellipsoid", "ramp"), min: gridVec, size: gridVec, palette: { type: ["string", "null"] }, slopeAxis: choice("x", "y"), reverse: bool,overlap:choice('reject','keep-existing','replace') })) })),
    cameras: arr(obj({ name: str, referenceIndex: { type: ["integer", "null"] }, position: vec, target: vec, projection: choice("perspective", "orthographic"), fov: num, orthographicHeight: { type: ["number", "null"] } })),
    lighting: lightingSchema(), assumptions: arr(str) });
}
export const VOXEL_PROMPT = `根据所有原始体素参考图与冻结需求生成真正的三维体素场景，仅返回 voxel-scene-v1 JSON，不写代码。各图是同一空间，最终从对应机位看应保留原图主体、轮廓、布局、颜色、空隙和遮挡。不能把整张图片做成薄面板，不能为通过检查增加无关物体。作者水印、作品标题和网页界面不属于三维场景，不生成文字面板来复制它们。\n
size 是整个三维网格的 [宽X,深Y,高Z]，Z向上，各维1–192，乘积不超过200万；cellSize为每格 .02–1 米，建议 .1–.25。所有实体 operations 的 min/size 为全局非负整数格坐标，min包含、max=min+size不包含；范围须完全在网格内。palette为最多64个颜色的唯一ID和 #RRGGBB；颜色是sRGB。palette.id与实体id均为英文机器ID：英文字母开头，只含字母、数字、下划线和横线，最多49字符；中文放在label/category。实体id最多49字符，category用中文；一个完整物体一个实体，配件属于同一实体的操作，不拆开以凑数量。ground也可为体素实体。每个critical需求须有对应实体绑定；明确数量按实体计数。\n
operations按顺序执行：fill填充，erase只挖空本实体已有格，paint只修改本实体已有格颜色。一个格子最终只能有一个实体拥有者。fill 的 overlap 必须显式选择：reject遇到别的实体格立即报错；keep-existing把实体并入剩余空格，保留已有对象，适用于结构拼接和地形接触；replace明确以本实体替换交叠格，适用于嵌入的表面细节或水道，不能把其他关键主体整体覆盖。erase/paint只针对本实体已有格，不影响其他实体。完全被覆盖或没有体素的实体不能通过校验。主体 fill 部件若被异色环境的 keep-existing 全部跳过也不能通过：底座还在不代表上部建筑已生成。原图中的主体嵌入山体时，应明确用 replace 保留主体的实际形体和颜色，或先为主体留出有依据的空间。box填满范围；ellipsoid取范围内椭球；ramp是沿X或Y逐格升高的阶梯体，slopeAxis选择轴，reverse翻转坡向，用于有依据的台阶、屋顶和斜体。shape不是平滑曲面，每个占用格都是方块。erase的palette填null，其他操作引用palette.id；每种操作均填slopeAxis和reverse（不适用时x/false）。总操作≤512，最多50万占用格；程序删除内部面并合并同色外表面，仍受全场景25万三角形预算。不用大量随机色点。仅细化确实可见的体素轮廓。\n
camera位置、target和orthographicHeight同样使用格单位。每张原图必须恰有一个referenceIndex=1..N机位，另设至少一个referenceIndex=null的不同位置真实观察机位，总数2–6。等距/无透视图片用orthographic并给垂直覆盖格数；透视用perspective且orthographicHeight=null。fov用弧度 .3–2.2，即便正交也填 .785 作为合法保留值；正交覆盖由orthographicHeight决定。相机转为米后position/target每轴须在±100内。lighting采用Z向上的方向光、环境光与可选点光，遵守输入；纯色方块是有依据的体素材质，不是假装恢复照片纹理。assumptions用中文明确不可见部分和尺度推断。`;
