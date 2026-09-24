# 从零运行 Scene Foundry（macOS）

本手册从一个**空目录**克隆公开仓库，准备固定版本的私有依赖，在独立端口启动工作台，并通过正常网页入口尝试生成、运行和验收一个场景。不要把旧工作台的 `data/`、`.env` 或已构建的依赖复制过来；它们会掩盖新装环境的问题。[2026-09-24 新目录实测记录](clean-run-validation-2026-09-24.md)显示安装与静态 Engine 模板可运行，但模型驱动的完整场景生成尚未通过；请勿把本手册的步骤当作成功认证。

## 1. 前提与边界

- macOS 上可执行 `git`、`python3`、`bun`、`node`、`corepack`、`codex`；Node 附带或另外安装 Corepack。先执行 `command -v git python3 bun node corepack codex` 检查。使用的版本以克隆仓库和 `prototype/brief.json` 固定的依赖提交为准。
- Git 凭证须能读取 `ForgeaXGame/forgeax-engine` 和 `ForgeaXGame/forgeax-ex-scene-generator` 两个私有仓库。`git ls-remote https://github.com/ForgeaXGame/forgeax-engine.git HEAD` 和对 Scene Generator 的同样检查都应成功。公开仓库本身不足以构建完整场景。
- Codex CLI 须已登录，`codex login status` 应成功。本例使用工作台模型列表中可用的 `gpt-6-luna` / `low`；若列表没有它，先选择同样支持图片的低成本模型并相应修改 `.env`，不要让程序静默改用默认的高成本模型。
- 至少留出若干 GB 磁盘空间。依赖克隆、Engine 构建和每个任务的录屏、截图都保存在本地；实际占用随依赖和场景变化。下面的 `PIPELINE_MAX_CALLS=30` 是这个新目录所有任务合计的调用上限，用于容纳一次简单样例与有限的格式纠正；它不是账号费用或订阅额度上限。

## 2. 克隆到新目录

选择一个还不存在的目录；以下命令只作示例，**不要在已经运行的 19774 工作目录中执行**：

```sh
mkdir -p ~/scene-foundry-check
cd ~/scene-foundry-check
git clone https://github.com/maoruibin001/scene-foundry.git
cd scene-foundry
git rev-parse HEAD
```

记下提交 SHA。后续所有检查都在这个克隆中进行。私有依赖位于仓库根目录旁的 `engine/`、`scene-generator/`，运行数据位于 `workbench/data/`；这些路径被 Git 忽略。

## 3. 准备固定依赖并做源码检查

```sh
python3 prototype/bin/bootstrap.py
git -C engine rev-parse HEAD
git -C scene-generator rev-parse HEAD
cd workbench
bun test ./src
cd ..
(cd prototype && bun test bin/pipeline.test.ts)
```

`bootstrap.py` 会克隆 `prototype/brief.json` 指定的两个精确提交，安装、构建 Engine 与 Scene Generator，并建立模板项目的本地 Engine 类型链接。已有但提交不符或被修改的依赖会使脚本停止；它不会私自切换已有 checkout。测试通过只证明源码和模板集成，不等于模型路由、浏览器运行或生成质量已通过。

`bun test` 请按上面的工作目录执行：生成任务会在 `workbench/data/versions/` 保存源码快照，从仓库根目录按文件名搜索测试时可能把快照里的旧测试也运行一次。

若要在调用模型前单独检查 Engine 构建链，可以运行仓库自带的固定程序化模板：

```sh
(cd prototype && bun run generate && bun run build && bun run verify)
(cd prototype && ASSET_PIPELINE_PORT=19978 bun run preview)
```

第二条命令会持续运行预览服务。另开浏览器访问 `http://localhost:19978/`，检查能看到“根界 · 微观温室检修站”的三维画面，再按 `Ctrl-C` 停止。它只验证固定模板的导出、构建、资产解析和预览；**不能代替第 5 节的模型生成验收**。

## 4. 配置模型和独立端口

先确认 `19977` 没有被其他程序占用：

```sh
lsof -nP -iTCP:19977 -sTCP:LISTEN
```

没有输出时，在仓库根目录创建仅本机使用的配置：

```sh
cat > workbench/.env <<EOF
PIPELINE_MODEL=gpt-6-luna
PIPELINE_CODEX_EFFORT=low
PIPELINE_MAX_CALLS=30
PORT=19977
EOF
```

上面的配置故意不指定提供者和启动器，以验证仓库默认使用本机已登录的 `codex` CLI，不依赖 `codex6` 等个人包装脚本。需要显式指定时，`PIPELINE_CODEX_BIN` 可填写 `PATH` 上的命令名或实际可读的绝对文件路径；服务会解析并固定启动器摘要。若使用自己的 Messages API，改用 `.env.example` 所述的 `PIPELINE_PROVIDER=messages-api`、提供商 URL、API key 和模型；这些值只写入 `.env`，不要提交到 Git。示例不配置自动生图服务，测试时上传已有 PNG。

从 `workbench/` 启动服务并保持终端打开：

```sh
cd workbench
bun run start
```

应看到 `SCENE_WORKBENCH http://127.0.0.1:19977/`。在另一个终端执行：

```sh
curl -fsS http://127.0.0.1:19977/
curl -fsS http://127.0.0.1:19977/api/state | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["budget"]["configured"], d["budget"]["model"], d["budget"]["executionRoute"])'
curl -fsS http://127.0.0.1:19977/api/models
```

首页能打开、`configured` 为 `True`、`executionRoute.providerId` 为预期提供商且模型列表包含所选模型，才进入付费生成。实际请求路由还须用一次小请求或任务回执核对；只有配置与 UI 标签不能证明上游计费模型。对 Codex CLI，可在临时空目录用同一 CLI、模型和 `low` 发一个只要求回复 `OK` 的短请求，核对 CLI 输出中的 `model`、`provider` 与 `reasoning effort` 后再继续。

## 5. 从网页完成一次生成

生成测试参考图（纯 Python 标准库，无图片服务或额外依赖）：

```sh
cd ~/scene-foundry-check/scene-foundry
mkdir -p workbench/data
python3 scripts/create-demo-reference.py workbench/data/demo-reference.png
```

1. 打开 `http://127.0.0.1:19977/`，进入“新建场景”。选择“图片 + 描述”，上传 `workbench/data/demo-reference.png`。
2. 描述填写：`海边礁石上的红白灯塔，右侧有一座蓝色检修平台；保留灯塔、礁石和平台的相对位置。` 选择“简单”和“标准生成”。手动确认模型为 `gpt-6-luna`、思考深度为 `low`，资产并发保持默认。点击“准备参考方案”。
3. 在“确认场景参考图”页检查实际上传的图片，点击“确认这些参考图”，再点击“开始场景生成”。这两步是正常产品流程，不能通过直接写任务文件跳过。
4. 在任务详情页观察阶段和“查看执行过程”。完成后检查资产与物料、Engine 运行截图、模型调用回执、质量与规范结果。`生成记录` 应能找到本次任务。质量不达标或外部条件受阻时保留实际状态与错误，不把 HTTP 200 或出现任务记录称为生成成功。

一次简单场景预计包含多次模型请求、Engine 构建和浏览器截图，耗时与调用量随模型、资产数和修复次数变化；开始前应确认账号预算。建议只提交这一个样例，不自动重试整条管线。出现明确余额、权限或模型路由阻塞时停止长流程；出现可定位代码错误时先修复再做一次受影响验证。

## 6. 验收与停止

合格的端到端证据至少包括：任务走过 `plan`、空间灰模、生成、`build`、`verify`、`runtime`、`judge`、`gate`；`workbench/data/runs/<任务 ID>/` 中有实际场景、运行截图和回执；网页可以打开最终场景或下载项目。`passed` 才表示达到本次质量门槛；`failed`、`blocked` 或 `needs_review` 都要按真实状态报告。

用 `Ctrl-C` 停止新目录里的服务。它只负责自己的 `19977`，不会停止原有的 `19774`。不要提交 `.env`、`workbench/data/`、生成物或私有依赖。需要重新试验时创建新的任务；不要通过删除失败记录伪造一次成功。
