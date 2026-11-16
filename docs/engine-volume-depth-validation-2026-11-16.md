# 体积雾深度重建：隔离真实验证与当前交付

当前状态：**v2 标记区域粗台阶修复已通过同场景真实对照，完整大厅已回接原游戏并通过正常入口流程；性能未通过，按用户要求暂缓。尚未合入 main，未更新共享 SDK 或在线生成服务。**

## 当前可复核结果

- 固定同场景、hero / near、1920×1168、DPR1，保留原光柱、雾、模型、材质和机位。v2 通过共同 witness 的 shader 注册修正后正常启动，实际提交的 shader 与私有 SDK 补丁匹配。
- 最后有效配对：原版 hero / near 为 25.24 / 24.05 FPS，v2 为 20.88 / 20.12 FPS。粗雾台阶改善，但性能退步，不能称性能验收通过，也不能保证全屏 60 FPS。
- v3 / v4 / v5 性能实验没有进入当前交付；源码已撤回到 v2，实验与撤回提交均保留。用户要求先完成场景，性能后续专项处理。
- 私有 SDK：`engine-volume-depth-20261116/continued/engine-private`；版本仍为 0.5.0-rc.1 加本地两文件补丁，不是官方 Engine 新版本。共享安装保持原 SHA。
- 原游戏通过通用管线接续 `reviewed-hall-r3`：124 对象材质、灯光与效果回接，132/132 实体装配。正常 `project play` 24 步、15 机位、32 PNG，硬件后端，console/page/input/layout 无错误。原交互和脚本保留。
- 原生 dev verify 曾因 live-not-ready 失败，不能记为通过；独立的 project play 通过。用户浏览采用正常 `project preview` 已构建产物。
- 历史评分 78 / 68 / 57 和原任务 needs_review 状态保留；本次 Engine / 游戏回接没有新增视觉评分，不宣称已重新过 70 分门。

## 当前入口与证据

- 最新管线浏览：<http://127.0.0.1:55472/#records>。只读模式不探测模型、不占协调器、不恢复或创建任务。
- 当前游戏：<http://localhost:19786/>。官方预览绑定 localhost，不能改写为仅监听失败的 IPv4 地址。
- 同站证据：<http://127.0.0.1:55472/files/diagnostics/hall-game-complete-20261116/index.html>。
- 主证据目录：`/Users/maoruibin/extensions/github/critical-zerog/v42-evidence/pipeline-adoption-20261115/expert-repair-20261116/engine-volume-depth-20261116/continued`。
- `original-build-identity.json`、`original-play-report.json`（report 内）、`original-adoption-receipt.json`、`game-preservation-audit.json`、`latest-observer-verified.json` 分别保留构建来源、实际流程、管线回接、旧工作保护和浏览边界。

尚未完成：最终美术定稿、全厅净空/穿插验收、完整零重力/破坏/疏散玩法；控制室部分布景仍 TRIAL，core-top 检查机位过曝，A14-top 机位贴墙。现有装配完整不能替代这些验收。

## 早期验证记录（历史快照，不代表当前交付状态）

# 体积雾深度重建：隔离候选与真实验证

状态：**未验收，不合入 main**。本轮不修改共享 Engine、在线任务、原场景或历史评分。

证据目录：`/Users/maoruibin/extensions/github/critical-zerog/v42-evidence/pipeline-adoption-20261115/expert-repair-20261116/engine-volume-depth-20261116`。

## 已证明的机制和结果

旧 SDK 在粗分辨率像素中心按场景深度截断体积积分，再把不同深度的结果双线性混合。此前同一场景关消光/恢复的真实消融已证明，用户标记的粗台阶主要随体积雾出现。TAA 和增加环的面数不能恢复混合前丢失的深度关系。

本轮固定同一大厅、hero 和 near 机位、1920×1168 / DPR1、同一模型/材质/光照/雾参数。只在私有 SDK 修改积分 shader 与 renderer runtime。0 新模型调用、3 次隔离 SDK 构建；更早的两次消融/配置构建保留在累计记录。

| 实际构建 | 结果 | hero FPS / p95 ms | near FPS / p95 ms |
| --- | --- | --- | --- |
| 原版，与 v1 配对 | 正常运行，有粗台阶 | 21.48 / 见 capture | 19.65 / 见 capture |
| v1，`438b656` | 标记区域粗台阶消除，光柱与雾保留；性能不合格 | 5.58 / 见 capture | 6.98 / 见 capture |
| 原版，最后一次配对 | 正常运行 | 20.69 / 54.13 | 19.40 / 56.73 |
| v2，`e83cdfd` | 正常启动失败，无有效画面与 FPS | 未测得 | 未测得 |
| v2 入口修订，`9c449aa` | 正常启动仍失败，无有效画面与 FPS | 未测得 | 未测得 |

这些是本机短时真实浏览器提交帧观测，不是跨设备性能保证。失败启动不能用原版 FPS 填充，v1 的改善不能归于 v2。

v1 全屏轮廓积分开销过高。v2 保留一次粗积分，先核对各粗样本自己的真实深度，拒绝跨深度样本后再归一化插值；没有相容样本的细杆/边缘才走真实光学射线积分，不借用背景雾或返回假空雾。使用只读 storage texture，维持原 16 个采样纹理限制。

## 最后启动失败及已完成的代码修正

真实错误：`rhi-not-available: shader module 'volume_integrate_coarse' is still pending`。

两个计算入口应共享已注册的 `volume_integrate` 模块，而保持不同的 pipeline entry。`9c449aa` 只覆盖了创建计算入口时的模块请求；`prepareVolumePrograms` 完成后的 witness 复核仍请求未注册名称，所以正常启动继续失败。

最新源码在共同 `witness` 函数统一模块名映射，同时保留实际入口标签。定向测试直接执行补丁中的准备函数与 witness，先复现旧版本复核失败，再验证修正版本。**11 pass / 0 fail / 29 assertions**。最新修正尚未构建或做真实 GPU 验证；不得称第二版已修好。

本轮预记录的 3 次 SDK 构建已完成，不继续追加长测。最后真实包对应 `9c449aa`，不是最新离线修正。`artifact-proof-v2.json` 保存交付 shader 与离线编译字节一致性、私有 SDK 双文件 SHA、dist 摘要；不能把它沿用为新源码的运行证明。

## 安全边界与恢复入口

- 补丁：`patches/engine-volume-depth-v1/`，清单 ID 为 `engine-volume-depth-v2`；目录名保留追溯。
- 应用工具：`scripts/apply-volume-depth-patch.ts`。显式私有 SDK admission、两文件 exact SHA、真实路径边界，全部校验后才写入；不允许修改共享安装或重复应用。
- 共享 SDK：`/Users/maoruibin/extensions/github/scene-foundry/engine`，本轮 before SHA 核验未变。
- 在线 19879 的 PID17585 / owner `7c0fccfb-55c7-41cd-a5fa-3a430ef9b14e` 未变。55472 在本轮开始时已离线，未重启。
- 本轮拥有的 19780/19781/19782 静态预览均已停止；测试浏览器已退出。
- 原场景输入、机位与 89 份 `.bin`（含原 86 份网格/表面二进制和辅助二进制）逐文件相同。历史 78/68/57 分及原保留产物未改。

下一次有价值的步骤是用**最新源码**从未修改 SDK 创建新的私有副本、应用补丁并保存 before/after 证据，再走正常 pipeline build / verify / preview。不要直接把新补丁覆盖到最后真实包，也不要把旧 artifact proof 复制为新通过证据。

```sh
bun test scripts/apply-volume-depth-patch.test.ts patches/engine-volume-depth-v1/reference.test.ts
# 私有 SDK 需按工具要求准备 admission，源目录保持只读。
bun scripts/apply-volume-depth-patch.ts <new-private-sdk>
ASSET_PIPELINE_ROOT=<new-fixed-scene-copy> PIPELINE_ENGINE_ROOT=<new-private-sdk> bun prototype/bin/pipeline.ts build
ASSET_PIPELINE_ROOT=<new-fixed-scene-copy> PIPELINE_ENGINE_ROOT=<new-private-sdk> bun prototype/bin/pipeline.ts verify
ASSET_PIPELINE_ROOT=<new-fixed-scene-copy> PIPELINE_ENGINE_ROOT=<new-private-sdk> ASSET_PIPELINE_PORT=<free-preview-port> bun prototype/bin/pipeline.ts preview
```

先核对正常启动和实际交付 shader/runtime 来源，再做原分辨率两机位与移动闪烁/FPS对照。光柱和雾不能关闭，不能降低分辨率掩盖成本，不能跳过注册/渲染门禁。第二版视觉改善与性能均待真实验证；未过门前不合入 main、不部署在线服务。
