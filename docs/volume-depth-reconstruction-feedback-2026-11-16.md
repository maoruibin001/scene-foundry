# 体积雾粗台阶：真实消融复现与 Engine 修复入口

状态：**已定位，尚未完成修复**。不能把上一轮 TAA 的局部细线改善描述为整个场景锯齿已经解决。

## 冻结输入与资源边界

- 工程：`/Users/maoruibin/.codex/worktrees/hall-pipeline-adoption/scene-foundry`
- 原场景任务：`fabca1d6-2977-4a8b-a9fe-7a295215ffcb`，保留其规格、模型、机位与评分/下载包。
- 本轮证据：`/Users/maoruibin/extensions/github/critical-zerog/v42-evidence/pipeline-adoption-20261115/expert-repair-20261116/edge-artifacts-20261116`
- 原 Engine 为已安装 `@forgeax/engine 0.5.0-rc.1`。**不要修改共享安装** `/Users/maoruibin/extensions/github/scene-foundry/engine`；需要修复 Engine 时必须做独立来源、补丁和运行身份核验。
- `19879/PID17585` 与 `55472/PID1216` 未重启，未改 DATA。真实游戏工程保持只读。

## 同一场景的真实消融

1920×1168、DPR1、同一个固定 hero 机位。诊断副本仅通过公开 ECS 接口将 `VolumetricFog.extinction` 从原值切到零，再恢复；等待真实完成 GPU 帧后截图。

| 状态 | 视觉结果 | 短时提交 FPS |
| --- | --- | --- |
| 低精度雾开启 | 大环、雾交界有粗台阶 | 19.30 |
| 雾消融（extinction=0） | 粗台阶消失，模型轮廓保持 | 19.09 |
| 恢复原雾 | 粗台阶重新出现 | 18.86 |
| 更细雾配置 | 粗台阶减轻，仍未完全消除 | 17.47 |

关闭消光没有移除计算 Pass，不能用“消融仍低FPS”推断雾没有性能开销。设备上的其他用户标签页未控制，FPS只是本次短时观测。

更细配置仅改 `volumetricFog: low/48/tile16` → `high/48/tile4`。86份网格/表面二进制、world、机位、光源、雾参数完全一致。两个副本各完成正常 pipeline build/verify，未改原产物。首次 fine 预览在服务就绪前导航连接被拒，0渲染；等官方预览就绪后重入，保留该技术事实，不记作质量重跑。

更细配置未达到用户要求，且增加开销，已撤回通用默认值实验（实验提交 `53eab41` 保留可追溯）。**本轮无新质量通过结论，不合入该渲染试验，不重算或覆盖原78/68/57分。**0新模型、2次隔离构建。

## 原因分层

1. 管线配置会放大问题：`workbench/src/spec/prepare-spec.ts` 为所有规格硬指定 low/tile16。安装 SDK 的 `deriveVolumetricFogResolvedExtent` 在这个档位生成约宽高1/8的雾缓冲，粗网格被放大到展示画面。
2. 更根本的重建问题在 SDK：`@forgeax/engine-shader/src/volume/volume-integrate.wgsl` 306行附近，仅在低分辨率像素中心读取全分辨率深度并裁剪积分射线；`volume-composite.wgsl` 的 `edge_aware_resolved_volume` 先双线性读取 `center`，无条件以4倍权重加入，再按邻居处的高分辨率深度加权。**center已经混合了不同深度的雾积分，后面的邻域权重不能把错误混合撤销。**邻居双线性样本同样没有与原积分像素中心的深度严格配对。
3. TAA只能缓和输出锯齿；无法恢复已经错误混合的近、远景雾积分。更细网格只能缩小误差块。模型分段、像素锯齿和本次雾块必须分开判断；本次粗台阶随雾消融消失，不能归因于模型面数不足。

源码来源路径（只读）前缀：
`/Users/maoruibin/extensions/github/scene-foundry/engine/node_modules/@forgeax/engine/node_modules/@forgeax/`

## 下一步通用修复方案与验收门

- 在独立 SDK 候选中修复雾的深度配对重建：每个低分辨率雾 texel 使用自己的积分中心坐标、对应深度；双边拒绝完成后再插值，避免先进行跨深度的颜色混合。
- 对没有任何相近深度样本的细杆/边缘建立显式回退。不能直接选远景雾、返回假空雾，或宣称普通双线性过滤就已正确。可评估局部全分辨率边缘积分，需保存轮廓/光学误差与成本。
- 保留原雾消光、灯光、几何、镜头、天空光柱和显式预览分辨率。无需新增面数、手工重建环或关掉雾冒充成功。
- 先做近/远平面、斜线、细杆、同深度连续雾的 CPU/Shader 回放和 WGSL 编译，再以完全相同画布/机位做真实对照。不能拿更小渲染尺寸或关闭光柱的结果验收。
- 同时看两处用户标记的边缘及移动时的闪烁；记录GPU完成帧和实际像素尺寸，比较低档原版、修复版、原生参考。改善必须出现在用户标记区域，不能仅用球体细线或另一机位代替。
- 需核对实际打进 build 的 shader 摘要与 SDK来源，不能只修改安装目录里的WGSL文本就声称运行已更新。候选过门前不更新共享 SDK 或对外声称修复。

## 原始证据

`ablation.json`、`fog-on.png`、`fog-off.png`、`fog-restored.png`，以及对应 `*-right.png`；`fine.json`、`fine-fog-on.png`、`profile-delta.json`、`integrity.json`、`tests.log`。低/细配置正常构建与验证日志全部留存。
