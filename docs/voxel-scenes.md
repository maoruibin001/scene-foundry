# 体素场景运行说明

体素模式与普通场景并存。浏览器打开工作台后，点击侧栏“体素场景”，或访问 `http://127.0.0.1:19774/voxel/`。上传同一个场景的 1–5 张体素图片，选择本机 Codex 模型和生成方式，点击“开始生成体素场景”。不需要再人工确认图片：程序记录图片摘要和描述，将它们自动冻结为本次生成与验收的共同目标。这个记录标记为 `uploaded-image-goal`，不会伪称用户做过额外确认。

## 准备与启动

先按 [从零运行手册](../README.md) 安装固定版本的 Engine、Scene Generator、Python 图像环境和固定材质目录。默认模型提供方式仍为本机普通 `codex`；自定义启动器必须显式配置。体素与普通模式共用已有构建、运行采集、原图对照和独立评分环节。单进程启动仍使用原来的命令：

```sh
cd workbench
PORT=19774 PIPELINE_PROVIDER=codex-cli PIPELINE_CODEX_BIN=codex bun src/server.ts
```

模型和思考深度由页面选择并保存到任务。`PIPELINE_MODEL` 可调整推荐模型，`PIPELINE_MAX_CALLS` 控制累计调用数；预算包含技术重试、格式纠正和独立验收。基础 70 分、80 分等既有标准继续由服务配置决定，体素模式不会替场景加分或放宽运行检查。

如果普通场景 worker 正在进行冻结实验，可以使用新的独立数据目录启动体素 worker，然后只更新界面代理：

```sh
# 独立目录同样需要 Python 环境和固定材质目录；不能借用别的 worker 的任务账本。
PIPELINE_DATA_DIR=/absolute/path/to/voxel-data PORT=19874 \
  PIPELINE_PROVIDER=codex-cli PIPELINE_CODEX_BIN=codex bun src/server.ts

# 原场景后端不变；网页入口仍为 19774。
UI_PORT=19774 UI_UPSTREAM=http://127.0.0.1:19873 \
  VOXEL_UPSTREAM=http://127.0.0.1:19874 bun src/ui-server.ts
```

`/api/voxel/`、`/voxel/files/` 和 `/voxel/process/` 会转发到体素后端。普通 `/api/` 路由仍去原后端。两个 worker 的任务、队列、模型预算和运行目录分开；体素记录在体素入口查看。端口数值只是部署例子，启动前须确认没有被占用。

## 管线与产物

1. 从原图提取有图像依据的需求，冻结主体、布局、风格和不确定部分。
2. 模型输出 `voxel-scene-v1` 数据：整数格子范围、颜色表、实体填充/挖空/改色操作、原图机位和额外检查机位。等距作品使用真正的正交相机。
3. 程序执行操作形成占用格，拒绝越界、未声明的实体重叠、无效颜色、缺失关键需求和超预算数据。实体组合须声明保留已有格或替换交叠格，记录实际组合格数；未声明的冲突会返回具体实体、操作和坐标。生成外露面，去除内部面并合并同色共面面片，转换为固定 Engine 的真实三维网格。
4. 使用已有 Engine 构建、验证、浏览器运行采集和录屏。独立评审同时读取原图与实际渲染画面，给出还原差距；有限修正继续修改体素数据，最多两轮。
5. 保存 `voxel-program.json`、`voxel-metrics.json`、可编辑 `scene.vox`、运行工程、真实截图、录屏和评审证据。选择最佳候选时这些产物一起恢复，导出包也包含它们。

体素详情页展示原图、Engine 画面、颜色表和所有实体的过程入口，支持打开真实三维预览、下载 `.vox` 和运行包。执行过程里的模型输出是只读订阅，关闭页面不会中断生成。

## 边界

离散格子让结构和颜色更容易约束，也更容易编辑与审计。但一张图片不能确定被遮挡的背面，模型仍可能误判比例、空间关系和机位；`.vox` 合法不代表图片还原通过。当前只支持静态、不透明、纯色体素，格子各轴最多 192、总范围最多 200 万格、占用最多 50 万格、颜色最多 64 种，导出仍受全场景 25 万三角形预算。照片级场景继续使用普通模式。

验证参考图来自真实作品作者 [Thibault Simar / Voxelmade](https://voxelmade.com/gallery/)，例如 [Aztec temple](https://www.voxelmade.com/portfolio-item/aztec-temple/) 和 [Lost Temple](https://www.voxelmade.com/portfolio-item/lost-temple/)。作者作品只用于本地输入验证；仓库不重新分发图片。导出格式依据 [MagicaVoxel 官方 VOX 格式](https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt)。网页支持和格式验证、真实运行通过、图片还原达标是三个独立的验证结果。
