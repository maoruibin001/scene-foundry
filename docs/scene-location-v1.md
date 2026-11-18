# Scene Foundry 地点接入 V1

从 Scene Foundry 仓库执行。请求中的路径相对于请求文件。消费项目应已安装 `@forgeax/engine@0.5.0`。

```sh
bun scripts/scene-location-v1.ts preflight /path/to/location-request.json
bun scripts/scene-location-v1.ts export /path/to/location-request.json
```

预检返回项目身份、实装 SDK、采取的路径、源 SHA-256 和缺失条件。退出码 0 表示该路径可用，1 表示请求或输入校验失败，2 表示缺少模型生成前提。导出写入新目录并返回 `location.json` 的 SHA-256。保存此回执，作为接入记录和下次更新的输入。

## 最小体素请求

```json
{
  "version": "scene-foundry-location-v1",
  "project": { "id": "@local/my-game", "root": "./game" },
  "sdk": "0.5.0",
  "input": { "kind": "voxel", "path": "./courtyard.voxel.json" },
  "location": {
    "id": "town-courtyard",
    "placement": { "pivotSourceMeters": [14, 12, 0], "worldAnchorEngine": [155, 24, 52] },
    "boundsEngine": { "min": [141, 23, 41], "max": [166, 36, 64] },
    "roads": [ { "id": "town-road", "positionEngine": [155, 24, 42], "widthMeters": 4.5 } ],
    "anchors": { "bell": { "positionEngine": [161.125, 26.375, 51.125], "partId": "town_courtyard_bell" } },
    "dependencies": []
  },
  "voxel": {
    "colliderLimit": 340,
    "coverParts": ["town_awning"],
    "wetBindings": [
      { "partId": "town_awning", "materialId": "roof", "hostMaterialKey": "weather-roof" }
    ]
  },
  "output": "./courtyard-r1"
}
```

用真实制作源中的部件和材质 ID 替换示例值。边界、锚点、道路接点均为宿主 Engine 坐标，单位为米。使用 `dependencies` 的 `{id, sha256}` 冻结宿主提供的相邻包或参考数据，宿主接入时对照其实际文件。几何编译检查整个输出位于给定边界内。可通过 `input.plan` 提供现有需求文件。原模型任务带参考机位时，`input.images` 提供原图路径及原顺序。编译会核对参考机位并记录图片哈希。

- **体素源**接受 `voxel-scene-v1` 或 `voxel-grid-v2`。预检执行相同网格和表面约束检查。颜色合并规则、占用格、操作和几何预算沿用编译器。碰撞有独立的宿主上限，超限会给出错误。
- **普通源**用 `"kind": "ordinary"` 导出 `scene-v1` 或 `geometry-v1` 的现有可编辑几何。带贴图的几何使用 `input.textures` 传入已经验证的 `textureId → TextureBundle` JSON。
- **规格源**用 `"kind": "spec"` 导出 `scene-spec-v1` 的原生 Pack。使用零 pivot 和零 world anchor，按已有 Pack/续作桥接在宿主布置。预检需要 Workbench 可解析与宿主一致的 0.5.0 SDK。Poly Haven 规格用 `input.pbrDir` 指定现有目录，导出记录相关依赖文件。已有大厅规格/外观回接继续用 [现有游戏接续](existing-game-continuation-2026-11-15.md) 和 [已评审外观回接](pipeline-reviewed-game-adoption-2026-11-16.md)。

## 接入与第二次更新

1. 在消费项目的副本核对 `location.json` 的项目、SDK、地域与依赖。普通和体素源用 `native-meshes.json` 替换同一地点的网格输入，保持宿主原 GUID/source key、玩法和根插件。网格仍用源米制右手坐标，换轴是 `[x,z,-y]`，先减 source pivot，再换轴，加 world anchor。
2. 体素 `voxel-surfaces.json` 引用同一版网格 SHA-256。每个碰撞盒含部件 ID 和 Engine 世界边界，按实体占用格划分，不跨部件合并。遮雨数据为所选部件与实际可见向上面对应的矩形及材质 ID。垂直雨线使用适用矩形的最高面，能区分门洞、檐下和露天。用 `wetBindings` 的部件/源材质 ID 在原材质槽中选择宿主的湿润材质键。宿主负责摄影视线、斜雨、动态实体、角色控制和世界环境。
3. 将几何、派生物和回执作为同一次宿主变更接入。以后只准备该地点的制作源，在请求中填 `"previous": {"manifest":"./courtyard-r1/location.json","sha256":"<导出回执中的 SHA-256>"}`，改用新输出目录，再预检和导出。管线校验基线所有文件、项目和地点，保持放置、区域和道路合同。旧锚点允许随对应部件更新位置。删除部件时在 `previous.retirePartIds` 显式列出被删除的 ID，宿主同时核对相关绑定。
4. 在正常入口检查走过开口、雨中走入和走出遮雨区，以及原互动或摄影。运行宿主原有检查和构建。保存采用的 manifest SHA、游戏候选、额外适配及其余包和绑定的前后哈希。回滚时重新选用旧 manifest 对应的网格和全套派生物。
5. 复用整包用 `"input": {"kind":"reuse","manifest":"./courtyard-r1/location.json","sha256":"<已接入 SHA-256>"}`。保留完整地点合同。命令验证已封存文件并回报复用，不再编译。

## 原图生成与费用

`input.kind: "reference"` 的预检接受 `route: "ordinary" | "voxel"`、`images: []` 和可选 `prompt`。普通入口至少要有描述或原图，体素常规入口需要 1–5 张原图。返回现有工作台的兼容路线和具体缺失条件。V1 的地点入口目前无法核验工作台实例和预算账本属于哪个消费项目，因而只给出生成准入诊断。具备项目独享实例、明确授权及模型预算的操作者可以使用该实例的普通/体素工作台入口，再把已保存的制作源交给本命令。保留原 job ID、固定产物哈希、每次请求回执及独立账本；预算上限和返还 token 用量不能推导实际收费。

本地预检、编译与复用的 worker 调用数及模型费用均为 0。这个范围只覆盖本次命令，已有文件的上游模型费用如果无原始回执则为未知。普通/体素网格交付不要求启动工作台。所有操作针对本地显式输入和新输出目录。
