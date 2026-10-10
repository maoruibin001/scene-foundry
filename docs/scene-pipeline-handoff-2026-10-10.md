# 普通图片和体素图片转场景交接

交接对象：接手普通场景、体素场景和共享 Engine 升级的 agent。状态核对时间：**2026 年 10 月 10 日 09:40，北京时间**。本次只整理交接，没有新增模型调用、构建、测试、生成任务或服务重启。

**最终目标是输入几张同一场景的图片，自动生成尽量一致的三维场景，最低要求为主要可见属性大体一致。普通场景已产出基础合格成品，但原图还原仍未达标；体素的新共享管线仍卡在空间规划与质量闭环。两者都尚未证明稳定成品率。**

## 接手时先看这五件事

1. 19774 是统一网页入口。体素可访问；普通 API 当前返回 502，因为 UI 代理仍指向已退出的19875，普通后端实际上已在19877运行。本次没有调整代理。
2. 公共代码运行基线是 `13b0aa9c60f152da00ad7afbe0e4551553c659b7`。普通最新研究候选 rc227 尚未同步进该公共基线；外层仓库Git状态干净不能证明研究目录已提交。
3. 体素已部署64实体前置检查，但这项修复尚未重新进行真实模型生成验证。保存的86实例核心不能作为合法交付检查点继续。
4. Engine 升级候选已推送，但没有合入或部署。缺完整Xcode，且消费者需要迁移到项目schema3.0和PluginAsset根。
5. 接手先做源码与证据核对、相称的零模型检查；形成新机制并固定候选、调用上限、时限与停止条件后，才做新的正常网页生成验证。数字上的剩余额度和历史unlimited配置不表示本次交接授权付费续跑。

## 仓库与来源

公开仓库：[maoruibin001/scene-foundry](https://github.com/maoruibin001/scene-foundry)。仓库默认模型入口仍是本机 `PATH` 上的普通 `codex`，个人验证启动器通过本地环境显式配置，不能把它变成公开默认值。

| 用途 | 本机位置与身份 |
| --- | --- |
| 公共主仓库 | `/Users/maoruibin/extensions/github/scene-foundry`，分支main，交接前代码基线 `13b0aa9c60f152da00ad7afbe0e4551553c659b7` |
| 体素运行源码 | `/Users/maoruibin/extensions/github/scene-foundry-voxel-20261008`，分支 `feat/voxel-scenes`，同一代码基线13b0aa9 |
| 普通最新研究源码 | `/Users/maoruibin/.codex/worktrees/49fb/forgeax-studio/.forgeax-harness/research/asset-pipeline/workbench-sealed-fallback-20261009`，冻结版本rc227；目录没有独立Git仓库 |
| 普通前一候选 | 同一研究根下的 `workbench-unlimited-validation-20261009`，供差异追溯，不是当前服务来源 |
| Engine升级消费者候选 | `/Users/maoruibin/extensions/github/scene-foundry-engine-migration-20261009`，分支 `feat/engine-2d6b522-upgrade`，提交 `ddcb7fa09d11e1a9c4babe35983b83155bd37397` |
| Engine升级源码 | `/Users/maoruibin/extensions/github/scene-foundry-engine-20261009`，固定 `2d6b522660d4e4bdea6bc660e00fdf4a47f506e7`，2026-10-09核对的main候选，未构建 |

普通研究代码处于外层Git忽略的 `.forgeax-harness` 内。它与公开基线存在165个源/UI/spec文件的双向差异，与前一unlimited候选有16个差异；这些是文件来源对比，**不是165个Git未提交文件**。以 `DATA/versions/<版本ID>/manifest.json` 和 `snapshot/` 的文件摘要为普通候选的版本依据。不能整目录覆盖公共主仓库，否则会覆盖体素改动、公开默认设置及其他会话的工作。

本交接文档的后续docs提交不改变上述运行代码基线，也不构成新生成、部署或质量验证。

## 当前服务与数据

| 服务 | 入口和核对结果 | 来源 |
| --- | --- | --- |
| 统一UI | `http://127.0.0.1:19774/` 页面200；普通 `/api/state` 为502；体素 `/api/voxel/state` 为200 | UI PID74937，`/Users/maoruibin/extensions/test/scene-foundry-voxel-20261008/ui-overlay/serve.ts` |
| 普通UI | `http://127.0.0.1:19772/` | PID35728，当前普通研究候选 |
| 普通API | `http://127.0.0.1:19877/api/state` 为200，无运行/排队任务 | supervisor PID35673，worker PID35727，rc227 |
| 体素入口 | `http://127.0.0.1:19774/voxel/` | 代理到19874，worker PID50223，rc20，无运行/排队任务 |
| 普通旧API | 19875未监听，旧PID25033不存在 | 不要按旧记录重启它 |
| 市场灰模Preview | `http://localhost:19775/`，当前保留的第1轮预览；仅IPv6 localhost监听，127.0.0.1不可达 | PID37879，父进程35727；不是完整成品 |

PID和端口会变化，执行操作前重新核对。普通worker受supervisor管理，单独结束worker可能被旧配置重新拉起。19774由独立 `ui-overlay` 提供，并非普通worktree中的UI。恢复普通入口，应先与UI/体素集成负责人协调并核对当前候选及UI兼容性，再把普通代理指向19877；这一动作由接手agent执行，不需要重跑生成来证明代理有效。

**普通DATA**：`/Users/maoruibin/.codex/worktrees/49fb/forgeax-studio/.forgeax-harness/research/asset-pipeline/workbench/data`。

**体素DATA**：`/Users/maoruibin/extensions/test/scene-foundry-voxel-20261008/data`。

两套数据、模型账本和控制文件独立。不要把普通任务复制到体素目录，或者用另一套账本抵消已用次数。`ui-overlay/serve.ts` 的普通目标默认19875，体素目标19874；UI还使用只读体素observer。修改代理不能顺带修改任务、预算或冻结生成源码。

当前冻结版本：

- 普通 `v1-rc.227`：`1e5b37e3f815dcd4b9b025fad922ccd72fb007a8e9192dad7d06ed762b88ba27`，candidate，未发布稳定版。
- 体素 `v1-rc.20`：`78829c0f0619ecaede2cc1fe497e6a88aed82ae389a0aed7bb08ea363fca5c77`，candidate，未发布稳定版。
- 实际Engine均为 `f2eb6c0893f1df2310514b95e76dad24c6d2fc0d`；Generator均为 `c3943a5026fc5f32f1b4993d542e1f372656049c`。

## 共同目标与生成流程

图片顺序、内容摘要及用户明确的文字修改自动冻结为 `reconstruction-goal.json`。不增加人工确认目标；不把派生图片、模型概括或未知背面推断替换原图。所有参考图约束同一个空间。详细依据见[原图目标与验收说明](image-reconstruction-goal.md)。

共享流程为：冻结原图目标 → 多图观察及关系 → 空间、组件与机位规划 → 真实Engine灰模 → 空间验收和有界修正 → 材质计划及逐资产制作 → 组装 → Engine完整运行及独立评审 → 保存选中候选、原图对照和下载包。体素分支在制作与最终运行之间使用原生体积、共同格网和可编辑VOX导出；普通分支使用一般几何、纹理与PBR材质。二者共享目标、流程和验收依据，不给体素额外加分。

公共仓库中的主要入口如下。除明确标出的 `prototype/` 外，表内路径均相对于 `workbench/src/`：

| 范围 | 仓库内文件 |
| --- | --- |
| 调度、任务与版本 | `server.ts`、`runner.ts`、`concurrency.ts`、`versions.ts` |
| 原图目标、逐图对照 | `image-reconstruction.ts`、`judge-request.ts`、`assessment.ts` |
| 观察和空间初稿 | `geometry/reference-observations.ts`、`geometry/generate.ts`、`geometry/space-construction.ts` |
| 灰模与局部修正 | `geometry/blockout.ts`、`geometry/graybox-space-repair.ts`、`geometry/graybox-space-preview.ts` |
| 几何与详细制作 | `geometry/run.ts`、`geometry/program.ts`、`geometry/asset-workers.ts`、`geometry/surface-mapping.ts` |
| 真实Engine导出与画面 | `geometry/prepare.ts`、`geometry/export.ts`、`geometry/capture.mjs`、`geometry/repair-preview-capture.mjs`、`prototype/bin/pipeline.ts` |
| 体素身份与格网 | `voxel/landmark-coverage.ts`、`voxel/scene-lattice.ts`、`voxel/geometry-lattice.ts`、`voxel/limits.ts` |
| 体素转换与文件 | `voxel/voxelize.ts`、`voxel/native-raster.ts`、`voxel/program.ts`、`voxel/projection.ts` |
| 判定与交付 | `quality.ts`、`delivery-standard.ts`、`output-delivery.ts`、`geometry/candidate-selection.ts` |
| 统一网页与过程观察 | `ui-server.ts`、`process-observer/routes.ts`、`process-observer/live-output.ts`、`process-observer/asset-preview.ts`；页面资源在 `workbench/public/` |

先使用代码导航确认对应研究候选的同名文件，再修改；不能假定公开基线和rc227的内容一致。

## 普通图片转场景

最近四个固定原始输入的结果如下；候选选择、回执和原图对照都保存在普通DATA内。分数为当前记录的综合分，不等于原图相似度。

| 输入 | 根任务 | 已有结果 | 原图目标 |
| --- | --- | --- | --- |
| 哥特式书房 | `fa1282b2-98ce-4863-8701-2ac60807994b` | 完整场景，81.1，basic70通过 | strict及原图还原未通过 |
| 叶片遮阳棚游乐场 | `c05f8660-164a-40ec-9307-8e0af41ff65d` | 完整场景，84.7，basic70通过 | strict及原图还原未通过 |
| 玻璃雨棚地铁入口 | `64c927db-b573-44a6-947d-da0d7fc03022` | 完整场景，83.1，basic70通过 | strict及原图还原未通过 |
| 市场 | `b356e125-23cb-4974-b523-8cdf758c276c` | 灰模；续修 `9e4efd45-b290-4d79-984f-e2120d1a465a` 两轮空间3.2→3.1，noGain=2停止 | 未形成可评分完整成品 |

**该批完整成品/basic70为3/4；三例完整成品的原图对照失败，市场未完成成品。没有原图还原达标案例，不能称稳定复刻。**更早咖啡馆基础通过不属于这四输入，不能并入分母报4/4。原批实际模型执行119次，市场同根续修4次，共123次；相应全局账本快照844。累计墙钟约7小时20分，不能据此承诺任意图片两小时交付。

当前服务升级rc227没有新增fresh任务或新评分。rc227的sealed fallback修复封存了已有真实渲染对应的空间评审，防止回退选中缺评审的前置twin。保存证据包含53项定向测试、真实产物回放及当前选中输出的正常UI检查；此前故障的foreign-basis fallback分支没有正常UI强制进入证明，`fallbackMetadataBranchNormalUiE2E=false`。它修正证据归属，不证明新的质量收益。市场仍停在灰模，不能借回退元数据修复重新开启相同提分循环。

### 普通接手任务

先核对rc227冻结源码及配置，把可移植改动逐项同步到公共项目。与独立 `ui-overlay` 的UI/体素集成负责人协调恢复19774普通API代理，再分别核对普通和体素正常入口。保留公开默认codex、体素分支和历史证据。代码同步与代理验证独立于新付费生成。

质量工作的下一项机制应围绕**多参考机位与全局空间骨架联合拟合**：同一几何的顶面、柱列、连接点、开口和远景比例需要在多个参考机位同时匹配。已有证据确认共享接点进入真实调用、几何确实落盘；不能继续把未改善归因于“提示没有传进去”。先用固定跨结构案例核对修正范围、遮挡和可恢复性，再冻结新机制并做有界正常入口验证。该联合拟合机制尚未实现或验收。

## 体素图片转场景

| 任务 | 状态与证据 | 不能据此声称的结果 |
| --- | --- | --- |
| `91cba757-b45c-4358-8cad-bf7a08470763` | failed/graybox；旧体素机制，两轮空间3.3/5，桥2.9→2.5、附着簇2.3→2.5 | 未过3.5门槛，未放行详细资产 |
| `9becbc90-7d10-4c4b-bdc7-c66b5b3f1ea9` | blocked/space；新观察完成，组件所有权冲突，随后600秒超时，没有合法核心 | 没有新灰模、评分或成品 |
| `e94fbd04-bfd7-46b8-af63-d9ff7bc46208` | cancelled/space；保存16模板、86实例、48绑定、0.125米格距；发现最终64实体上限遗漏后正常页面取消 | 86实例不能完成最终导出；开口/连接未完成，无灰模或成品 |

已落地的机制包括：初始共同格网；单位尺度、90度旋转和共格边界；原生voxelVolume填充、挖空、重复；独立组件身份和全部所有权冲突反馈；同一64实体上限前移到请求与保存检查；严格转换不静默重采样或粗化。模板复用不减少实例计数，ground/context/subject都计入64。固定预算还包括192轴长、200万范围格、50万占用格。

新鲜严格体素任务通过 `voxelConstructionVersion='voxel-lattice-v1'` 启用共同格网与前置实体检查。普通场景及没有格网声明的旧空间保持原契约，不被静默升级。最终体素64上限原本已存在，本轮修复把同一限制前移到严格空间制作阶段。

9bec保存的观察含48个地标，其中39个关键object/component要求独立槽位。数字39是此次模型观察的覆盖要求，不是人工标定真值，也不证明几何体量正确。e94的原始检查点保持不变，新门禁会拒绝其86实例；不能手工删几个实体后伪装为原模型成功输出。

公共13b0aa9完整源回归证据为1216通过、0失败。新64上限有64合法、65拒绝、普通/历史契约不受影响，以及真实86核心只读回放的证明；**没有64上限修复后的新模型生成证据**。

零模型小型体素技术诊断有3实体、824占用格、144三角形、4实际Engine机位及7项门洞/板缝/桥下空域PNG检查通过，fallback=0、浏览器错误0。它不是Lost Temple成品，不能作为复杂原图还原或成品率的证据。不同旧模型、旧体素制作机制和灰模/成品评分不能混算。

### 体素接手任务

先设计并验证**分组件或组件组的初始空间检查点**：在总实例≤64、已有独立组件要求和共同格网内逐组补位置、边界及体量，保存可校验的有效段。当前save_space_core仍要求一次提交整个核心，分组生产尚未实现。优先修改 `geometry/space-construction.ts`、`geometry/generate.ts` 与 `voxel/`，维护普通路径兼容；使用原始观察作诊断依据，不重写原图目标。

完成零模型契约和跨组接点检查后，再固定新候选与有限调用窗口，从正常入口验证一个复杂原图能否完成空间、详细资产、VOX和最终图像对照；随后才能扩展固定样本。不要仅换提示词、改名字或原样恢复旧失败任务。

## Engine升级是共享任务

升级候选为 `feat/engine-2d6b522-upgrade / ddcb7fa09d11e1a9c4babe35983b83155bd37397`；候选PIN2d6b522仅是2026-10-09核对的main提交，接手时重新核对远端，不称它为永久最新。候选只保存PIN、Xcode安装前检查及迁移报告，没有完成兼容迁移或部署。

2026-10-10再次核对：本机仅CommandLineTools，`xcodebuild`明确requires Xcode，Engine原生生产脚本要求的 `/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk` 不存在。依赖该条件的安装已停止，不能拿旧Dawn库或跳过生产冒充同候选构建。工具链由用户或系统环境负责人恢复。

消费者需要一次迁移：`forge.json 2.0/plugins/defaultScene` → `3.0/roots`；Scene owner负责加载和实例化、提供场景服务、安装相机/UI子插件与释放；相机不能继续访问已删除的gameHost.defaultSceneRoot。反射组件需在实例化前注册。普通、原生重建与体素控制器均受影响。

项目配置与Pack格式是两个版本：新版项目使用3.0，但Scriptable Pack仍为 `schemaVersion:'2.0.0'`，Generator继续固定c3943a5。不要顺带升级Generator或把所有Pack改成3.0。具体差异见[Engine候选迁移说明](https://github.com/maoruibin001/scene-foundry/blob/ddcb7fa09d11e1a9c4babe35983b83155bd37397/docs/engine-upgrade-20261009.md)。

迁移参照新版Engine的 `templates/game-3d/assets/world/world.pack.ts`、`shared/scene-refs.ts`、`camera/camera.pack.ts`、`ui/ui.pack.ts` 和 `packages/project/src/schema.ts`。源码、CLI/devkit、shared-build-inputs、Engine构建provenance、消费者resolved.root与实际dist须来自同一固定候选。真实普通/体素fixture运行通过后才切换运行源、PIN并重启对应worker冻结新版本。不能仅热改brief：runner缓存PIN，而prepare每次读磁盘，会造成新旧身份混用。

## 模型与预算

| 范围 | 当前记录 | 接手要求 |
| --- | --- | --- |
| 公开项目默认 | 本机普通codex；自定义启动器可显式配置 | 不把个人codex6包装器、路径或凭证写为公共默认 |
| 普通研究 | Astra OpenAI别名；simple/medium推荐high，complex推荐xhigh，四个固定输入均保存xhigh，阶段按冻结策略降档；全局账本844，历史unlimited配置 | 已停任务不能因unlimited自动恢复；新验证设有限预算，保留实际模型/阶段/路由证据 |
| 体素研究 | Astra OpenAI别名、选择xhigh，阶段策略可降档；全局60/140；启动器控制32/55 | 23剩余额度是控制器余量；此前50分钟窗口已结束，不是新的运行授权 |

当前普通实际控制文件是普通DATA下 `diagnostics/pipeline-stability-repair-20261007/unlimited-validation-control-20261009.json`；`followup.json`仍有旧three-fresh路径，不能按旧字段判断live配置。体素控制是 `/Users/maoruibin/extensions/test/scene-foundry-voxel-delivery-20261009/acceptance-control.json`，全局账本为体素DATA下 `model-budget-codex-concurrent.json`。普通服务配置见相同diagnostics目录的 `service-config.json`。

调用数包含失败、纠正、预检和评审，不代表供应商计费金额。本地路由标签不证明上游实际计费模型；不要打印完整.env或复制凭证。历史模型路线和原图策略必须在对比中保持，任何改变都单独标明比较边界。

## 验收和停止条件

灰模composition-v3门槛：总体≥3.5/5、关键关系≥3/5、置信度≥0.6；必须使用当前几何的真实Engine画面。

基础70分交付：综合分及原始维度加权分均≥70，完整结构、运行检查、没有已确认的关键缺失及规范失败；资产不齐、低置信度或证据矛盾不得当成通过。strict80、basic70、原图“大体一致”是不同判定，不能用一个替代另一个。最终目标还要求每张原图的主体结构、布局遮挡、形态、材质色彩、光照和机位构图均有有效对照，主要差异不可由平均分抵消。

稳定版本需要冻结配置、代表性固定输入、独立评审标定、终态失败与耗时/调用量统计。当前代码发布门禁包括三复杂度、各输入模式至少30例、成功率0.9及总体95% Wilson下界0.8，并要求标定；图片/体素专项认证方案需要明确与该门禁的关系。当前没有完成相应稳定认证，诊断续作不能计为新独立样本。

遵守用户跨项目AGENTS规则：失败重试需要已改变的条件或可验证新机制；确认预算/权限/工具链外部硬阻断即停止依赖路径。预算按整个任务累计；连续两轮无有效改善停止原机制。保留原错误、输入、评分、候选和账本，不换凭证、充值、降低门槛或复活已取消任务。正常用户路径才算E2E，API/文件回放仅算诊断。仅清理本任务拥有的资源。

## 建议的协作分工

| 角色 | 首个交付物 | 所有权和依赖 |
| --- | --- | --- |
| 普通agent | rc227到公共仓库的来源差异清单及可移植提交；19774普通代理恢复；联合空间/机位拟合方案和零模型证据 | 普通独立worktree/DATA；触及共享geometry、版本、服务时先与其他agent协调 |
| 体素agent | ≤64实体的分组空间骨架和检查点；普通兼容及跨组接点证据；随后一个完整原图验证 | voxel目录及明确划分的空间制作模块；不得改共享Engine或普通账本 |
| Engine agent | 工具链恢复、3.0项目与插件迁移、同候选构建身份及普通/体素实拍验证 | engine升级候选分支，协调所有prepare/camera模板；通过后提供新固定Engine基线 |

这只是可分配任务，没有向其他用户会话派单。多人各用独立worktree与有限账本，不同时修改同一prepare/generate/space-construction、PIN或19774进程。普通候选的 `.env` 指向当前live DATA和历史控制文件；复制源码后，隔离验证必须显式设置独立DATA、账本和控制路径，历史目录只读，避免服务初始化或版本冻结写回现有数据。指定一个集成负责人合并共享文件、冻结版本和切换服务。Engine阻断期间可推进不依赖新版运行的普通/体素源码工作，不反复启动失败的Engine构建。

### 可直接发给普通agent

> 阅读本交接文档。先只读核对rc227冻结源码、当前19877服务、207个历史任务及四输入的完整产物/原图对照；保留已停止市场根与全部账本。使用独立worktree和显式隔离的DATA/账本/控制路径梳理普通研究代码向公共main的可移植差异，保护体素和公开codex默认。与独立ui-overlay的集成负责人协调恢复19774普通代理，分别验证普通与体素正常入口。随后针对多机位与全局空间骨架联合拟合提出并实现可验证新机制，先做相称零模型检查。付费生成前固定候选、原图、模型、标准、累计有限预算和停止条件。不用基础70通过冒充原图复刻，不原样续跑市场失败路径。

### 可直接发给体素agent

> 阅读本交接文档。以公共运行代码13b0aa9及体素rc20为基线，在独立worktree设计分组件/组件组的空间检查点，使既有观察覆盖、全场格网与≤64实体同时满足。e94的86实例仅作被拒绝的失败证据，不能手工压缩后冒充合法模型结果。先验证分段保存、跨组开口/接点、普通兼容和最终格预算；再固定新的有限模型验证窗口，从正常网页完成一个复杂原图的灰模、资产、VOX和最终对照。原图/门槛/模型路线/历史调用不变；不把fixture、导出或测试通过称为稳定产出。

### 可直接发给Engine agent

> 阅读本交接文档和engine升级候选分支的docs/engine-upgrade-20261009.md。重新核对上游main精确SHA，确认完整Xcode及实际SDK条件恢复后才安装/构建。完成项目schema3.0根、Scene owner、相机/UI/反射生命周期迁移，保留普通和体素几何/原图目标。核对源码与CLI/devkit/shared inputs/provenance/dist同候选，再执行零模型普通和体素实拍及输入/机位检查。先完成候选再合入和切换19774，保护当前服务、任务、缓存账本和旧Engine证据；不热改PIN或绕过原生生产。

## 证据和恢复入口

普通证据目录：普通DATA下 `diagnostics/pipeline-stability-repair-20261007/`。先读 `pipeline-bounded-validation-final.json`、`pipeline-quality-remaining-assessment.json`、`sealed-fallback-normal-ui-verification.json`、`service-config.json`；真实任务位于 `DATA/runs/<UUID>/job.json`，源码快照位于 `DATA/versions/<versionID>/`。[普通最终报告](http://127.0.0.1:19772/files/diagnostics/pipeline-stability-repair-20261007/index.html) 是本机报告入口。

体素证据：`/Users/maoruibin/extensions/test/scene-foundry-voxel-delivery-20261009/lattice-optimization/`，先读 `report.md`、`final-result.json`、`entity-cap-diagnostic.json`、`entity-cap-full-tests.log`、`final-grid/result.json`。任务和输入位于体素DATA；Lost Temple原输入为 `/Users/maoruibin/extensions/test/scene-foundry-voxel-three-20261009/lost-temple.jpg`，SHA `7ba1e0842cbbcfcb069da83dc9e32102117964b07acdbb3c9245c9096330d8dd`。原作者图片只用于本地验证，不随公开仓库分发。

Engine证据：`/Users/maoruibin/extensions/test/scene-foundry-engine-upgrade-20261009/`，先读 `report.md`、`result.json`、`bootstrap-preflight.log`、`install.log`。原生准备进程已停止，源码及未完成缓存保留；没有Engine新版实拍或模型质量验证。

本次交接的只读服务快照：`/Users/maoruibin/extensions/test/scene-foundry-handoff-20261010/live-snapshot.json`。日志和源码指针只用于接手核验，不包含公开仓库中的凭证、上传图像或历史任务数据。

接手初检可执行以下只读命令，先看输出再决定操作：

```sh
git -C /Users/maoruibin/extensions/github/scene-foundry status --short --branch
git -C /Users/maoruibin/extensions/github/scene-foundry rev-parse HEAD
lsof -nP -iTCP:19774 -sTCP:LISTEN
lsof -nP -iTCP:19877 -sTCP:LISTEN
lsof -nP -iTCP:19874 -sTCP:LISTEN
curl -fsS 'http://127.0.0.1:19877/api/state?compact=1'
curl -fsS 'http://127.0.0.1:19874/api/state?compact=1'
```

安装及完整新目录入口见[从零运行手册](run-from-zero.md)；体素格式与边界见[体素运行说明](voxel-scenes.md)和[共同格网验证](voxel-lattice-validation-20261009.md)。这些记录的旧成功只在原候选和覆盖范围内成立，不免除新Engine、新几何或新模型路线的受影响验收。
