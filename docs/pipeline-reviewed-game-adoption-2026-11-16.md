# 已评审外观增量回接原游戏

状态：实现及正常原游戏流程通过；已按用户授权合入 main（代码提交 d973260），未发布共享 Engine，未重新评分。

## 通用机制

`adopt-reviewed-appearance-into-game.ts` 验证基础与已评审规格、预期结果 SHA 后，只允许材质、灯光和环境效果增量。物体、几何、机位、约束及来源必须不变，材质 ID 保持一致。124 对象的结果通过增量桥接装入已有游戏；不从模板重建，不手写一份替代场景。

运行时构建发现并修复两个桥接缺陷：render profile 需要独立稳定包身份，避免与网格包 GUID 冲突；组件按名称与 schema 合并，不能按 JS 对象身份去重，否则真实 SDK 标准化后会重复声明 Camera 等组件。

## 当前实际结果

原工程：`/Users/maoruibin/extensions/github/critical-zerog/hall-v42-graybox`。
管线源任务：`fabca1d6-2977-4a8b-a9fe-7a295215ffcb`。
冻结规格：`95c4264b1dcf80e61a443e4a463cd0c3c1d4aa14ff711865c189ce90d3f3bc42`。
接续：`reviewed-hall-r3`，132/132 实体、124 网格对象，2725 构建资产，未产出/未知/未物化均 0。

正常 `project check`、相关测试、typecheck、build 和真实 `project play` 完成。24 步正常入口操作、15 机位、32 截图，包括门、检修、核心观察、返回提交、控制室、重载。console/page/input/layout 无错误。保留原交互与脚本、原未提交工作；游戏未自行提交或上传。

独立 live dev verify 仍记录一次 live-not-ready 失败；不以静态预览替代该检查。静态浏览入口为官方 project preview 已构建产物，真实流程依据独立 project play。

## 浏览与验收边界

<http://127.0.0.1:55472/#records> 顶部是最新回接游戏，<http://localhost:19786/> 可直接进入。55472 是只读浏览实例，拒绝写入、不初始化模型路由、不领取协调器、不自动恢复；不替换旧在线生成服务。原两份任务 JSON SHA 未变，历史评分不改。

原任务历史 78 / 68 / 57 不是当前补丁版的重新评审。当前没有新增视觉裁判调用。完整装配与正常流程通过不代表最终美术定稿或性能通过；控制室部分布景为 TRIAL、两个检查机位曝光/构图问题待处理，性能由用户暂缓。

证据目录：`/Users/maoruibin/extensions/github/critical-zerog/v42-evidence/pipeline-adoption-20261115/expert-repair-20261116/engine-volume-depth-20261116/continued`，同站 report 含真实截图、操作视频、汇总和回执。
