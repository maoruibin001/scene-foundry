# 体素场景"精修阶段"实现方案（交接文档）

状态：**待实现**，交由其他 agent 完成。日期：2026-10-13。
目标读者：接手体素管线的 agent。本文给出根因、设计、精确的代码落点、测试与验证约束，使其无需重新调查即可实现。

代码基线：公共仓库 `main`（当前 `fb575f4`）。所有路径相对 `workbench/`。相关背景见 [普通管线总览](scene-pipeline-overview.md) 与 [体素运行说明](voxel-scenes.md)。

---

## 1. 问题与证据

体素场景产出"太过简陋"：一次真实渲染是一坨方块糊在底板上，几乎看不出场景。已完成体素作业的实测用量（预算在 `src/voxel/limits.ts`，`VOXEL_LIMITS`）：

| 预算项 | 上限 | 实测（多份作业） |
|---|---|---|
| entities | 64 | 9–10 |
| operations | 512 | ~40–50 |
| filledCells | 500000 | 13k–40k（2.6%–8%） |
| boxesPerEntity | 128 | 很少 |
| cellSize | 可选 0.025–1 米 | 多为 0.2 米（偏粗） |

预算用了不到十分之一。

## 2. 根因

**体素管线缺少普通管线的"逐资产精修"阶段**，整个多实体场景由**一次**模型调用全部产出。

- 入口：`src/geometry/run.ts` 第 96 行（主路径）与第 209 行（视觉修正）各调用 `generateVoxelScene(...)` **一次**。
- `src/voxel/generate.ts` 的 `generateVoxelScene`：单次 `callValidated({role:'voxel-scene', maxTokens:18000, ...})` 产出整份 `VoxelProgram`（全部 entities 及其 operations），随后 `compileVoxelScene` 直接编译为最终几何。文件里那个"逐实体"循环（第 24–30 行）只是把已生成的 program 打包成资产条目，**不是精修**。

对比普通管线（`src/geometry/run.ts` 的 `assets` 阶段）：细节来自**每个模板一次聚焦的模型调用** `generateOneAsset`（`src/geometry/generate.ts:94`），带独立预览/评审。体素没有这一步，一次调用要画完所有实体，模型只能粗粗带过 → 简陋。

## 3. 目标与验收标准

给体素补上"逐实体（或逐组件组）精修"阶段。验收：

- **预算利用显著提升**：entities 匹配规划所需独立组件数；operations/filledCells/boxes 用量相对基线（9–10 / 40–50 / 13–40k）大幅提高且在 `VOXEL_LIMITS` 内。
- **视觉**：渲染不再是单块糊团，能看出各实体结构、开口、层次。
- **门槛不回退**：体素灰模空间门槛（空间≥3.5、关键≥3、置信≥0.6）与原图对照不比精修前差。
- **策略开关 + 向后兼容**：仅新体素任务启用；普通任务与历史体素任务行为不变；`compileVoxelScene` 的 64 实体/各项预算/单一所有者校验仍然生效。

## 4. 设计：逐实体精修阶段

在"单次全场景生成"与"编译"之间插入阶段，镜像普通管线的 assets 阶段：

```
coarse 全场景规划 → 冻结每实体格对齐 bounds/所有权 + 共同格距 + 调色板
   → 逐实体聚焦精修（每实体一次调用，受冻结 bounds 约束，用满该实体预算）
   → 合并为 VoxelProgram → compileVoxelScene 全场景校验（重叠/预算/占用）
   → 现有编译/scene.vox/metrics/assets → 现有预览/runtime/judge/视觉修正
```

1. **Coarse（复用现有调用，改语义为"粗规划"）**：保留 `voxel-scene` 调用，但其产物只需定义：entities（id/label/role/requirementIds）、每实体**格对齐 bounds**（世界边界，整数倍 cellSize，含共同格网约束）、palette、cameras、lattice，以及**最小 operation 草图**（占位体量）。给 coarse 一个小的 per-entity 操作预算。
2. **冻结**：按共同格网冻结每实体 bounds 与所有权区域、`cellSize`、palette。复用 `src/voxel/geometry-lattice.ts` 的格对齐与 `src/voxel/program.ts` 的所有权逻辑。
3. **逐实体精修**：对每个实体（或按 `requirementIds`/区域分组）一次聚焦调用：
   - 新 role `voxel-entity`（见第 6 节 schema/prompt），输出该实体的完整 `operations[]`（fill/erase/paint × box/ellipsoid/ramp），**坐标限制在该实体的冻结格 bounds 内**，用到该实体的 operation/box/filled 份额（`boxesPerEntity=128` 等）。
   - 输入：原图（可裁到该实体在各参考机位的投影框）、实体 label/role/bounds、coarse 场景上下文、共同格距、冻结 palette。
   - `validateFinal`：对该实体做"局部编译"校验——所有格落在冻结 bounds 内、不与已冻结的其他实体所有权冲突、不越预算。
   - 并发：复用 `src/geometry/asset-workers.ts` 的 `collectAssetWorkers`（有界并发）。
4. **合并与全场景校验**：把各实体 operations 合入 `VoxelProgram`，调用现有 `compileVoxelScene(program, plan, imageCount)`（`src/voxel/program.ts`）做最终校验：跨实体单一所有者、`overlap` 规则、`filledCells≤500000`、每实体非空、主体不被整体遮没。
5. 其后与现状一致：`voxel-metrics.json`/`scene.vox`/assets，再走体素预览→runtime→judge→（现有整场景）视觉修正。

## 5. 要镜像的现有模式（普通 assets 阶段锚点）

- 逐资产调度：`src/geometry/run.ts` assets 阶段用 `collectAssetWorkers(pending, concurrency, signal, worker, stopOn, {partialOnTimeout})`。
- 单资产生成：`generateOneAsset(ctx, layout, brief, textures)`（`src/geometry/generate.ts:94`）——聚焦 prompt + 该资产证据 + `validateFinal` + 可选预览评审（`createAssetReview`）。
- 重点挑选/预览名额：`prioritizeAssets` / `selectAssetPreviews`（`src/geometry/asset-priority.ts`）。
- 体素几何指导：`voxelGeometryGuidance(lattice)` 与 `src/voxel/construction-guidance.ts` 的 `VOXEL_STRICT_SPACE_GUIDANCE` / 组件组指导字符串（可据此派生 per-entity 精修指导）。

## 6. 具体实现步骤

1. **Schema/role**：在 `src/model-schema.ts` 加 role `voxel-entity`，返回"单实体 operations"schema（复用 `src/voxel/schema.ts` 的 operation 结构，但限定在传入 bounds 内、不含 entities 数组）。在 `normalizeModelValue` 按需透传。
2. **构造指导**：在 `src/voxel/construction-guidance.ts` 新增 `VOXEL_ENTITY_DETAIL_GUIDANCE`——要求在冻结 bounds 内用有序 fill/erase/repeat 表达体量/斜坡/厚度/开口/层次，用满该实体预算，不得越界、不得改格距、不得封堵净空。
3. **生成流程**：改 `src/voxel/generate.ts`：
   - 抽出 coarse 调用与 per-entity 精修两段。
   - 按策略分支：有 `job.voxelDetailPolicy` 走新流程；否则保持当前单次调用（历史/未开启不变）。
   - per-entity 用 `collectAssetWorkers` 并发；每实体 `callValidated({role:'voxel-entity', schemaContext:{bounds, cellSize, palette, requirementIds}, ...}, dir, validateEntity)`。
   - 合并后调用现有 `compileVoxelScene` 做权威校验（不要绕过）。
4. **局部校验器**：在 `src/voxel/program.ts`（或新 `voxel/entity-detail.ts`）加 `compileEntityDetail(entity, frozenOwners, bounds, lattice, palette)`，供 per-entity `validateFinal`；跨实体合并仍以 `compileVoxelScene` 为准。
5. **预算拆分**：coarse 小预算；per-entity 份额合计不超过 `VOXEL_LIMITS`（operations 512、boxes 2048、filledCells 500000）。在合并处断言总量。
6. **策略开关**：`src/runner.ts createJob` 为新体素任务（`parsed.sceneKind==='voxel'`）设 `job.voxelDetailPolicy='voxel-detail-v1'`（source 继承、普通任务为 null、历史无此字段）。放在现有 `voxelConstructionVersion=` 一带，遵循既有 `job.*Policy` 模式。
7. **进度/事件**：精修阶段发 `generation-progress` 事件（phase + completed/total），与普通管线一致，便于网页观察。

## 7. 向后兼容与策略门控

- 新 role、新 guidance、新流程**只在 `job.voxelDetailPolicy` 存在时生效**；历史体素任务（无此字段）走原单次调用，重放不变。普通（非体素）任务完全不受影响。
- `compileVoxelScene` 作为最终权威校验保持不变——64 实体/预算/所有权/非空等硬约束继续兜底。

## 8. 测试

- **单元（`bun test ./src`，纯/可离线）**：
  - `compileEntityDetail` 的 bounds 约束、跨实体冲突、预算上限。
  - 合并后 `compileVoxelScene` 对新路径产物仍通过既有断言。
  - 预算拆分断言（coarse + 各实体 ≤ VOXEL_LIMITS）。
  - 策略开关：有/无 `voxelDetailPolicy` 分别走新/旧路径（可用 mock 的 `callValidated` 注入假 program/entity 输出）。
  - role `voxel-entity` 的 schema 形状。
- **E2E（唯一算数的验收路径 = 网页用户路径）**：隔离服务 + 独立 DATA，用一个体素参考图场景走完整流程，核对第 3 节验收标准（预算利用、渲染非糊团、灰模/原图门槛不回退）。

## 9. 验证与环境约束（务必遵守）

- **离线只能验证机制，验证不了"变精细了"**；"精细"必须真实模型 + Engine 跑网页流程才算数。
- **本地 codex 订阅额度有限**：每次验证最多少量场景（历史约定 ≤3），需用户显式同意再消耗；网络曾中断过，先确认模型可达。
- **不要动正在跑的体素服务**：worker 在 `127.0.0.1:19874`（独立进程/独立 DATA）。验证要用**自己的隔离 worktree + 独立 DATA/ledger/控制文件 + 独立端口**（可参照本会话 r11 的隔离起法：`git worktree add --detach`，补 `engine`/`scene-generator` 软链，plain `codex`，PIPELINE_DATA_DIR 指向独立 /tmp 目录）。历史体素 DATA 只读。
- 公开默认模型入口保持 plain `codex`；不要把个人启动器/路径/凭证写进仓库或默认值。
- 仅本地提交 + 推送需用户确认；不要擅自合入主干——改动大且需真实验证后再谈合入。

## 10. 风险与非目标

- **成本**：per-entity 多次调用，成本随实体数上升——必须有界（限制实体/分组数、并发、超时），并与额度约束协调。
- **跨实体冲突**：各实体独立精修后合并可能产生所有权冲突；合并处必须用 `compileVoxelScene` 校验并把冲突回喂重修（参考既有 64 实体/所有权冲突一次性反馈机制）。
- **与严格共格机制的衔接**：`voxel-lattice-v1`（共同格网 + 分组规划）目前卡在空间规划阶段；per-entity bounds 必须尊重冻结的共同格网。若选择在其之上做精修，需先让分组空间规划跑通（原"方案 C"）。
- **非目标**：不解决材质颜色/原图像素还原；不引入 CLIP/LPIPS；不改普通管线评分与结构。

## 11. 待定决策（实现前与用户确认）

- **粒度**：逐实体 vs 逐组件组（按 `requirementIds` 聚合）——组件组更省调用，实体级更细。
- **是否先修 `voxel-lattice-v1` 分组空间规划**（方案 C）再加精修，还是在当前（非严格）体素路径上先加精修验证收益。
- **每实体是否带独立预览/评审**（像普通 assets 的重点资产预览），还是先只做"精修 + 全场景一次预览"。
