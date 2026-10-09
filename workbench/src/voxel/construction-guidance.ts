import type {VoxelLattice} from './scene-lattice';
import {VOXEL_VOLUME_RULES} from '../geometry/voxel-volume';

export const VOXEL_SPACE_GUIDANCE=`这是体素参考图的共享空间规划。根据原图为场景选择一致的格步长，模板局部范围、实例位置和主要构造尺寸尽量用该步长的整数倍表达；并不强制改动不属于网格对齐的真实原图结构。优先依原图判断正交或透视机位、主体横向占幅与基座/平台层高，然后安排构造。门窗是有厚度的贯通空隙，桥必须同时表达两端接触、桥板之间的间隙及桥下跨空；水道必须留出原机位可见的宽度和上下层关系。相机不能掩盖这些缺陷。所有原图观察、需求与共享空间契约保持不变，不新增假设物体或虚构关系。`;

export const VOXEL_STRICT_SPACE_GUIDANCE=`本次是新的严格共格体素规划，必须保存voxelLattice:{version:"voxel-lattice-v1",cellSize:选定格距,origin:[0,0,0]}。cellSize仅可选0.025、0.05、0.1、0.125、0.2、0.25、0.5、1米，选取依据是原图最小关键开口与全场景尺度，不能在后续转换中改格距掩盖超限。所有模板bounds.min/max及实例position每轴必须是该格距的整数倍，instance.scale固定[1,1,1]，rotation每轴只用schema中的90度整数转弧度枚举；实际尺寸写在冻结bounds和后续整数构造里，不能用任意缩放或倾斜父体积破坏格子。可倾斜结构要通过格内阶梯、挖空和填充形成，不能随意旋转整个格网。相机position/target/fov及orthographicHeight继续允许连续数值，以匹配原图机位；相机不属于几何格网。程序将在核心规划首次保存时核对变换后的全世界边界，含每侧一个边缘格后每轴不超过192格、乘积不超过2000000格。请共同选择合理单位、格距和比例，不能单独钳制坐标、丢弃物体、修改原图关系或靠后期重采样补救。门窗贯通、板桥两端接触、板缝与桥下跨空、水道可见宽度仍按原图规划；格网合法不代表图像或空间已验收。`;

export const VOXEL_GEOMETRY_GUIDANCE=VOXEL_VOLUME_RULES+`
当前生成体素风格资产，优先以一个或少量voxelVolume表达填充、挖空和重复构造，不逐个输出方块，也不以一个实心大箱体替代门窗、桥板或通道。来源坐标仍为米、Z向上，voxelVolume内部操作使用整数格坐标；origin是格子边界，cellSize将格坐标映射到局部米制范围。保留冻结bounds及真实连接，不能修改需求、实例或机位。粗阶段每轴最多64格、总131072格、48个构造操作；先表达主要构造、留空及层次，实际表面和总几何预算仍检查。已验收的原生体素构造随后逐字传递到资产制作，仅更换材质并添加不封堵净空的有依据细节。`;

export const VOXEL_SURFACE_GUIDANCE=`当前参考是体素作品，材质规划采用原图有依据的少量纯色表。textures与textureReuse必须为空，不从斜视方块作品裁取带阴影的片段后再次铺到方块上；仍保留全部模板材质绑定、实例表面覆盖和原图光照关系。materials的color仍为线性RGBA，不能直接将显示sRGB当线性反射颜色；roughness/metallic沿真实原图选择，不为凑材质添加无关颜色。块面阶梯、石缝、缺口与植物块簇依实际几何构造，照明和阴影由Engine产生。颜色分布与最终明暗仍需原图验收，不能因纯色或体素格式而宣称还原通过。`;

export function voxelGeometryGuidance(lattice?:VoxelLattice){return VOXEL_GEOMETRY_GUIDANCE+(lattice?`
本场景已冻结共同格网cellSize=${lattice.cellSize}米、origin=[0,0,0]。所有灰模、部件草稿与修复只允许voxelVolume，cellSize逐字保持；shape.origin及part.position是该格距的整数倍，scale固定[1,1,1]，rotation仅90度整数转。用dimensions和有序fill/erase/repeat表达尺寸、斜坡与厚度，不能用缩放薄化桥板或改变格距，不能用连续box/grid/scatter替代。每个独立组件必须实际构造；桥板宽厚、板缝、跨空及墙面附着簇的体量与区域覆盖继续依据原图，不因格网通过而称图像验收通过。总实际展开占用上界须不超过500000格，不能用重复交叠返还预算。`:'' );}
