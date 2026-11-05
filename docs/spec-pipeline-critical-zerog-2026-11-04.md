# 规格管线(spec-pack)与《临界：零重力》大厅复刻 · 2026-11-04

> 目的：把这一阶段做成的东西、怎么用、卡在哪里、下一步做什么记下来，方便后续接着做。
> 分支 `feat/spec-pipeline`(未提交)。过程数据归档在 `~/scene-foundry-verify/archive/critical-zerog/`。

## 1. 一句话现状

设计文档 → **Opus 5.5 规格化** → 标准场景规格 `scene-spec-v1` → **27 个程序化生成器**出全部资产(0 灰盒)→ 引擎 0.5 构建 → 真实 Engine 采集 6 机位 → **Opus 风格判分**(对照概念图)。全流程在工作台里以「规格场景」任务运行、记录和展示。

画面：主体(黑色六边形核心球 + 三道铆接钢环 + 吊杆、玻璃能量柱、玻璃控制室、圆形水池倒影、多层回廊)已成立；风格判分稳定在 **57–64 / 100，结论「部分一致」**，主要扣分在**画面密度**和**整体质感**(见 §6)。

## 2. 怎么用

| 入口 | 做法 |
|---|---|
| 工作台新建页 | 「设计文档」标签：上传手册 `.html`(先规格化，约 70 分钟，按文档缓存模型输出)或 `scene-spec-v1` 规格 `.json`(直接生成) |
| API | `POST /api/specs {spec, styleDir}` → `{id}`；`POST /api/spec-jobs {specId}`；`POST /api/spec-uploads`(multipart，.html/.json) |
| 迭代修订 | 改**规格修订**而不是改导出结果：`bun src/spec/revise.ts <spec.json> <revision.json> <out.json>`，再用 `~/scene-foundry-verify/archive/critical-zerog/submit-spec.sh <spec> <outdir>` 提交工作台(会重启 19890 加载新代码) |
| 命令行快速实验(不进工作台) | `~/scene-foundry-verify/archive/critical-zerog/hall-m1/variants/render.sh <spec> <outdir> <port>` |
| 重启工作台 | `~/scene-foundry-verify/e2e-cal/start-19890.sh`(数据目录 `e2e-cal/data`，与原进程环境一致) |

修订补丁类型(`src/spec/revise.ts`)：`material / family / familyParam / object / addObject / removeObject / addFamily / state / post / light / addLight / shot`。每条必须写 `reason`；master(手册冻结)对象的变换不能改、不能删；被验收条目引用的对象不能删。

## 3. 代码地图(workbench/src)

| 文件 | 作用 |
|---|---|
| `spec/schema.ts` | `scene-spec-v1` 类型与校验(对象/族/材质/光照态/机位/约束/验收/风格参照)；材质可选 `surface`(程序化纹样或 `polyhaven:<资产>`)；后处理可选 `reflectionProbe`、`gi` |
| `spec/normalize-doc.ts` | 文档规格化：手册冻结表格确定性解析为 master + Opus 3 次调用(族与材质 / 对象 / 光照机位验收)；`SPEC_REUSE_CALLS=1` 复用同任务文本输出 |
| `spec/handbook.ts` `reconcile.ts` `doc-source.ts` | 手册表格解析与对账(21/21 主控对象、10/10 生成器) |
| `spec/export-pack.ts` | 规格 → spec.pack：整组生成器(assembly)、多实例展开(`positions`/`yPositions`)、世界坐标点换局部、材质槽兜底、贴图(程序化 + Poly Haven)、GI 距离场 |
| `spec/world-emitter.ts` | 光照态 → 场景实体：方向/点/聚光/面光、bloom、tonemap、曝光、GTAO、SSR、解析高度雾、全厅反射探针、平面反射插件 |
| `spec/prepare-spec.ts` | 规格 → 可构建工程(异步，含 Poly Haven 下载)；GI 构建插件 |
| `spec/generators/*` | 27 个生成器(见 §4)、`parts.ts` 杆件/折线工具、`textures.ts` 程序化贴图 |
| `spec/pbr-library.ts` | Poly Haven CC0 贴图下载/解码/缓存(`data/pbr/<资产>`) |
| `spec/render-profile.ts` | GI(irradiance-field)参数与 build 插件 |
| `spec-run.ts` | 工作台任务：normalize → plan → generate → export/build/verify → runtime → judge(Opus 风格判分)→ gate |
| `../prototype/bin/pipeline.ts` | `brief.generator==='spec-pack'` 分支 |
| `../prototype/bin/compose-host.ts` | schema-2 插件列表 → 0.5 roots；新增 `realm:'build'` → `roots.build` |

## 4. 生成器库(27 个，全部 `@forgeax/engine/modeling`)

结构：HALL(骨架/墙板/檩条/立管/格栅天窗)、FLOOR(防滑板/椭圆池洞/池边平台/水渍)、POOL(矩形或圆形+环形扶手)、WALK(直/弧/高层回廊灯带)、STAIR、ENTRY、INDUSTRIALDOOR、CONTROLROOM、GLASS、CRANERAIL。
主体：CORE(Goldberg 六边形面板)、RING(结构截面按手册 + 环平面内铆接钢带)、RINGMOUNT(挂点/核心吊杆)、NODE、NODEBEAM(金属基座 + 通长玻璃管 + 立筋)、SOCKET、BRACE、CARRIER。
设施与道具：PIPE、CABLETRAY、CABLE、DISCHARGE、PROP、CABINET、CONSOLE、DRESSING、LUMINAIRE。
每个生成器都有默认/边界/非法三组参数测试；`adapt` 把规格里的等价写法(区间、合并向量、包络)确定性换成生成器参数。

## 5. 渲染能力状态(引擎 0.5.0-rc.1)

| 能力 | 状态 |
|---|---|
| 方向光 CSM、聚光阴影(≤4)、点光、矩形面光、bloom、AgX/ACES、手动曝光、GTAO | ✅ 已用 |
| 平面反射(水面) | ✅ 需运行时 RenderTarget 插件(inject `executionBootstrapHost`)+ 材质 pack 烘焙 `planarReflection`；**每相机只能 1 个平面**；高度必须等于水面绝对高度(-0.35) |
| 全厅静态反射探针 | ✅ 金属有环境可映；强度 0.5 |
| 解析高度雾 `Fog`(独立实体) | ✅ 代替体积雾 |
| 程序化贴图 / Poly Haven 真实 PBR | ✅ 墙板、地面、混凝土、格栅、结构钢已换真实贴图 |
| SSR | ✅ 按引擎开发反馈与平面反射配合：水面用平面反射，地面用 SSR(`maxRoughness 0.18`，只作用于光滑湿斑；粗糙面有碎条纹，靠粗糙度上限避开) |
| **漫反射 GI** | ❌ **本机不可用**：需构建插件(已接)+ 延迟渲染 + 关 IBL + 不许面光(已自动换聚光)+ 每网格距离场与 Card(已在 pack 生成，高面数退回可见性距离场)；最后卡在 GPU 需要 `primitive-index` 特性。采集用的是 Playwright 自带 Chromium(Chrome for Testing 153)，可能是浏览器版本问题，owner 在装新版验证；已报引擎会话 forgeax-engine-33 |
| **体积雾光柱** | ❌ 需 3D 密度纹理资产，pack 数据声明不了 |

## 6. 卡点与差距(给后续和引擎同学)

**引擎侧需要确认/支持**(一律发给本机会话 `forgeax-engine-33`，不自己改引擎仓；1、4、6 已发，2、5 它正在做)：
1. 漫反射 GI 在 Apple/Chrome(无 `primitive-index`)上的降级路径(screen-probe / baked 是否可用？)；
2. 体积雾的均匀密度快捷方式或 pack 内程序化 3D 纹理的写法；
3. ~~平面反射多平面~~ → 引擎开发答复：一个面 + SSR，已按此实现；
4. irradiance-field GI 不接受矩形面光；
5. modeling `inset` 非法 `region` 值被静默接受(应报错)；
6. 高面数网格几何距离场"closest-point preparation budget exhausted"。

**我们这边(画面优先)：** 评判已稳定指出的差距——
- 主体近景质感：核心球、三环、能量柱、控制室内部(成排显示器工位)需要**逐个打磨**(Opus 写细节建模代码 + 近景单独评审)；
- 画面密度：墙面机组、回廊、楼梯、地面线缆/设备箱需要**细节模块化铺量**；
- 空间尺度：手册冻结 48×55×20m，比概念图画的大厅小，尺度感有上限；
- 判分器噪声约 ±5 分，同一画面可在 57–64 间波动；判"进步"要看多轮或对比，不看单次。

## 7. 迭代记录(全部是工作台记录，状态 needs_review)

| 轮次 | 主要改动 | 风格分 |
|---|---|---|
| look-8 | 低调曝光、六边形核心、粗玻璃柱、水面倒影、控制室朝向 | 50 |
| look-9 | 青蓝能量色、暖橙点光、深色雾、多层环廊、墙面管线 | 60 |
| look-10/11 | 控制室落地、去池边护栏、机位避开立柱、四面回廊 | 57 / 57 |
| look-12/13 | 反射探针、亮钢环、墙面檩条立管、纵深冷却柱阵、去地面护栏、关 SSR | 64 / 64 |
| look-14/15 | 环外铆接钢带(先错为轴向，后改径向) | 52 / 60 |
| look-16 | 控制室冷白蓝屏、回廊琥珀灯带、入口道具 | 62 |
| look-17 | 程序化表面贴图 | 57 |
| look-18/19 | 圆形水池 + 环形扶手、核心去检修环带 | 57 / 62 |
| look-20 | Poly Haven 真实 PBR(墙/地/混凝土/格栅/结构钢) | 57 |
| look-21 | 水面平面反射 + 地面 SSR | 57 |

## 8. 下一步(按画面收益排序)

1. 主体逐个打磨：核心球 → 三环 → 能量柱 → 控制室内部 → 尽头大门；每个出近景特写对照概念图单独评审，过了再进场景。
2. 细节模块(墙面机组、管线簇、设备堆)沿墙/回廊批量铺放，提高密度。
3. 等引擎侧答复后接 GI / 体积光柱。
4. 判分：同一画面跑 2 次取平均，减少噪声。

## 9. 最小验证：问题到底在哪(2026-11-04 晚)

只放一根能量柱，舞台 24×20m，同一套灯光，对照概念图里的柱子局部(工作台记录 0b15fc4d；数据在 `archive/critical-zerog/minimal-check/`)：

| 变量 | 结果 |
|---|---|
| 简单柱 vs 精细柱(GEN-NODEBEAM-02，手工细化：底座箱体、双层玻璃舱、法兰螺栓、竖向发光管、机械鼓、外挂竖管、琥珀灯) | 同样光照下，**精细柱能被认出是概念图的柱子，简单柱认不出**(评审原话) |
| 暗调 vs 亮调(高曝光 + 乳白雾) | 亮调更糟，画面发白发灰；暗调更接近 |
| 发光强度 7–12 → 2.5，玻璃加深 | 细节"露出来"了；之前大厅里发光体过亮，泛光把玻璃和金属糊成一片白 |
| 背景 | 单柱场景的密度仍只有 2 分：墙面空、栈道简单、没有楼梯和近景道具 |

**结论**：主要问题是**内容**，不是引擎上限。① 主体资产的几何细节不够(权重最大)；② 发光和玻璃参数过曝，掩盖了细节；③ 背景和近景缺少填充物。引擎在金属、玻璃、小灯、反射上表现正常；GI 和体积光影响的是氛围这一层，不是"完全不像"的主因。
另：系统 Chrome 157 已支持 `primitive-index`，GI 越过了这个卡点，下一个卡点是可见性距离场需要 cook 产物的完整性信息(高面数核心球的几何距离场超预算)。

**路线**：主体逐个按这个"小舞台"方式打磨，过了再进场景；然后用细节模块堆背景密度。发光强度全局收敛。

## 10. 第一条跑通：能量柱(2026-11-05)

**工作台记录 da49bb2f：风格判分 73 / 100，判定「match(整体感觉一致)」，任务状态 passed。** 这是第一个通过风格门槛(≥70，且没有一维低于 2)的规格场景。

| 维度 | 分数 |
|---|---|
| 光影 / 材质 / 氛围 / 构图 / 主体 / 密度 | 3.5 / 3.5 / 3 / 4 / 4 / 3 |

做法(以后每个主体照这套复制)：
1. **小舞台**：只放一个主体，加上概念图里它周围的配套(这里是两侧楼梯、三层环廊、柱底机柜、墙面横竖管线、琥珀壁灯、设备箱、湿地面)；风格参照只给概念图里这个主体的局部裁图。
2. **主体用手工细化的生成器**(GEN-NODEBEAM-02)：底座箱体、双层玻璃舱、法兰螺栓、竖向发光管、机械鼓、外挂铜管和卡箍、线缆。
3. **发光收敛**：能量发光 2.5(大厅里原来是 7–12)，玻璃加深；曝光 0.38；用墙面洗墙灯和低强度环境光代替整体提亮。
4. **材质槽显式指定**：走道的 frame/endCap/kickPlate 之前兜底成了琥珀/铜色，整片泛橙；改成深钢后基调对了。
5. 迭代 3 轮，用命令行快速出图(不进工作台)；满意了再提交工作台判分。

舞台规格生成脚本：`archive/critical-zerog/minimal-check/make-stage.py`；规格 `stage-r3.json`。
剩余扣分(下一轮可做)：柱芯溢光和体积光、栏杆颜色偏黄(概念图偏冷灰)、柱顶多层机械冠、墙面细节、暗部偏死黑。

### 能量柱继续打磨(2026-11-05)

| 轮次 | 改动 | 分数 |
|---|---|---|
| r3 | 第一次过线 | 73 match |
| r5 | 柱顶三层机械冠、阀门箱、柱底散件、墙面线槽和挂柜、冷灰栏杆、雾 | 74 match |
| r7 | 压暗四周(环境光 0.08、洗墙灯降)、柱子独亮、深色发光管基底、湿地面 + 地面平面反射、哑光栏杆 | **76 match** |
| r8 | 透明玻璃、发光管变细 + 深色芯轴、铜管加粗 | **76 match** |
| r9 | 发光调暗、雾改中性 | 70 partial(倒退：玻璃更像乳白板、远处死黑) |

**最好的是 r7/r8(76 分)**，结论：惨白的主因是雾太浓太亮 + 环境光平铺；"四周压暗、柱子独亮"一步提升最大。
**卡住的地方**：玻璃舱始终读成"乳白发光板"——发光管在玻璃里贴得太近，透射玻璃把它们糊成一片；铜管体积感不足。单调参数已经在 70–76 来回(判分噪声约 ±5)，再往上要改**资产结构**(玻璃内外分层、发光管离玻璃壁更远、玻璃上加窗框分隔)和**表面贴图**(墙面锈蚀/油污/磨损)，不是继续调灯。
