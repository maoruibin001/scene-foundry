# Engine 2d6b522 升级候选与阻断（2026-10-09）

状态：最新 Engine 源码已获取，升级候选已准备；Engine 安装/构建、消费者3.0迁移和新版本真实运行未完成。19774实际仍使用旧Engine，未把候选PIN或下载成功当作部署完成。该分支不是已验证的运行版本，不能合入main代替当前工作版本。

## 固定来源

- 上游：`https://github.com/ForgeaXGame/forgeax-engine.git`，默认分支main。
- 最新候选：`2d6b522660d4e4bdea6bc660e00fdf4a47f506e7`，2026-10-09 10:24:14 UTC复核远端HEAD/main一致。
- 隔离源码：`/Users/maoruibin/extensions/github/scene-foundry-engine-20261009`；跟踪源码干净，没有Engine源码补丁。
- 当前运行Engine：`f2eb6c0893f1df2310514b95e76dad24c6d2fc0d`。
- Scene Generator保持 `c3943a5026fc5f32f1b4993d542e1f372656049c`。
- 消费者候选分支：`feat/engine-2d6b522-upgrade`，从 `13b0aa9c60f152da00ad7afbe0e4551553c659b7` 派生。此分支只固定新PIN及补充工具链检查；下列3.0迁移尚未实现。

## 已确认的环境阻断

最新Engine的 `packages/dawn-node/README.md` 和 `scripts/prepare-native.mjs:76` 要求macOS完整Xcode，源码生产使用：

`/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`

本机该路径不存在；`xcode-select -p` 返回 `/Library/Developer/CommandLineTools`，`xcodebuild -version` 返回 requires Xcode，当前可用SDK位于CommandLineTools下。只设置另一个DEVELOPER_DIR不保证满足源码中的固定路径。没有静默回退旧Dawn二进制或跳过原生生产。

已停止本任务安装进程组58791；保存安装输出与部分官方原生源码缓存供恢复，不修改共享旧Engine、19774服务或生成账本。后续安装/构建只能在工具链条件确实改变后恢复。

候选 `prototype/bin/bootstrap.py` 已在原生准备前检查上述前提。正常入口验证返回明确的Xcode缺失信息，安装/构建未启动；这是阻断复现，不是安装通过。Node当前v24.14.1符合Engine的>=22.13要求，SDK缺失是此轮构建前提问题。费用没有计量；本轮模型调用0。

## 已确认的消费者迁移

1. `prototype/game/forge.json` 仍为2.0.0/defaultScene/plugins；新Engine `packages/project/src/schema.ts:21–28` 仅接受严格3.0.0/roots。新root GUID必须对应真实PluginAsset输出，不能抄模板GUID。
2. `workbench/src/geometry/prepare.ts` 仍使用 `cfg.plugins.unshift`；native/prepare.ts、reconstruction/prepare.ts同样复制旧模板，需要统一进入原生root组合。
3. 相机模板依赖已删除的 `gameHost.defaultSceneRoot`。普通camera-v3.txt、native/camera.txt、prototype camera.plugin.ts及由native模板派生的体素控制器都需要显式场景服务。
4. 新版模板 `templates/game-3d/assets/world/world.pack.ts` 示范SceneAsset加载、allocSharedRef、instantiate、提供gameScene服务、安装子插件与逆序释放；camera/camera.pack.ts和ui/ui.pack.ts示范显式PluginAsset和frontend根。reflection组件仍需在场景实例化前注册。
5. 上游project migrate主动拒绝defaultSceneRoot源码访问，不能仅执行自动迁移或换PIN宣称完成。Pack源码版本仍2.0.0，与project schema3.0.0不同；现有几何不需因为项目配置变化而全部重写。

## 恢复与验收

先恢复完整Xcode前提，然后按固定Engine源码完成 `pnpm install --frozen-lockfile` 和 `pnpm build:engine`。`FORGEAX_SKIP_HARNESS_SYNC=1` 是允许的可选Harness同步跳过，不跳过原生构建；View和私有资产不应成为这次Engine消费构建的隐含依赖。

在独立消费者候选完成3.0 roots、Scene owner、相机/UI/反射生命周期迁移后，固定提交，先运行相关源码检查，再做零模型的普通3D和体素场景导出→Engine绑定→project check/build→catalog/GUID→asset verify/resolve→正常Preview及真实画面/相机/UI检查。浏览器开启chromiumSandbox，不能用沙箱绕行换取通过。

核对 `node_modules/.cache/forgeax-build/engine-provenance.json`、CLI/devkit摘要、shared-build-inputs、消费者engine status的resolved.root和实际dist manifest来自同候选。通过之后才合入main、切换依赖并重启19774对应worker冻结新版本。历史任务的Engine SHA、画面和评分原样保留，新Engine重建产生新证据，不借旧评分宣称新质量或稳定性通过。

本地证据：`/Users/maoruibin/extensions/test/scene-foundry-engine-upgrade-20261009/result.json`、install.log及bootstrap-preflight.log。官方CI同SHA产物查询没有返回可解析JSON，产物可用性未确认，没有据此宣称产物不存在或使用其他候选替代。
