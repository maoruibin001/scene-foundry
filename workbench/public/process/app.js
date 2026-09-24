import { consoleHTML, mountConsole, hideConsole } from "./call-console.js";
const $ = (s) => document.querySelector(s);
const E = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const A = (v) => (Array.isArray(v) ? v : []);
const statusNames = {
  met: "已满足",
  partial: "部分满足",
  missing: "未满足",
  passed: "已完成",
  reused: "已复用",
  failed: "失败",
  blocked: "受阻",
  cancelled: "已取消",
  needs_review: "待复核",
  running: "记录执行中",
  queued: "等待执行",
  waiting: "等待上游",
  pending: "未开始",
  unknown: "暂无数据",
  timed_out: "超时",
  completed: "调用结束",
  interrupted: "已中断",
  reused: "已复用",
};
const stamp = (v) =>
  v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "暂无时间记录";
const duration = (v) =>
  v === null || v === undefined
    ? "未知"
    : v < 1000
      ? `${Math.round(v)} 毫秒`
      : v < 60000
        ? `${(v / 1000).toFixed(1)} 秒`
        : `${Math.floor(v / 60000)} 分 ${Math.floor((v % 60000) / 1000)} 秒`;
const stageDuration = (s) => {
  if (Number.isFinite(s.durationMs)) return s.durationMs;
  if (s.start === null || s.start === undefined) return null;
  const end = s.end ?? (["running", "queued"].includes(s.status) ? Date.now() : null);
  return end === null ? null : Math.max(0, end - s.start);
};
const badge = (s) =>
  `<span class="status ${E(s)}">${E(statusNames[s] ?? s ?? "暂无数据")}</span>`;
const json = (name, value) =>
  `<details><summary>${E(name)}</summary><pre>${E(JSON.stringify(value ?? null, null, 2))}</pre></details>`;
const empty = (s) => `<div class="empty">${E(s)}</div>`;
const list = (items) =>
  `<ul class="list">${A(items)
    .map((x) => `<li>${E(typeof x === "object" ? JSON.stringify(x) : x)}</li>`)
    .join("")}</ul>`;
let index = null,
  data = null,
  key = "",
  stage = "",
  tab = "outputs",
  signature = "",
  sequence = 0,
  busy = false,
  compareIndex = 0;
let filters = { q: "", type: "all" };
const tabs = [
  ["outputs", "阶段产物"],
  ["requirements", "输入与需求"],
  ["layout", "空间与关系"],
  ["assets", "资产与物料"],
  ["compare", "参考对照"],
  ["review", "评估问题"],
  ["calls", "模型调用"],
];
function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  key = p.get("job") ?? "";
  stage = p.get("stage") ?? "";
  tab = tabs.some((t) => t[0] === p.get("tab")) ? p.get("tab") : "outputs";
}
function url() {
  history.replaceState(
    null,
    "",
    "#" + new URLSearchParams({ job: key, stage, tab }),
  );
  parent.postMessage({type:"scene-process-route",job:key,stage,tab},location.origin);
}
function pick(next) {
  $("#main").innerHTML = empty("正在读取所选记录…");
  key = next;
  stage = "";
  tab = "outputs";
  signature = "";
  compareIndex = 0;
  url();
  void refreshDetail();
  renderHistory();
}
async function get(path) {
  const r = await fetch(path, { signal: AbortSignal.timeout(8000) });
  const body = await r.json();
  if (!r.ok) throw Error(body.error ?? r.status);
  return body;
}
function renderHistory() {
  if (!index) return;
  const historyScroll = $("#history").scrollTop;
  $("#total").textContent = index.total;
  $("#live").textContent = index.warnings.length
    ? "部分数据不可读 · 执行状态未确认"
    : index.active
      ? `记录执行中 / 等待：${index.active} 条`
      : `当前无记录执行中的任务${index.unknown ? " · " + index.unknown + " 条状态未确认" : ""}`;
  const items = index.items.filter(
    (j) =>
      (filters.type === "all" ||
        (filters.type === "active" &&
          ["running", "queued"].includes(j.status)) ||
        (filters.type === "failed" &&
          ["failed", "blocked", "timed_out", "interrupted"].includes(
            j.status,
          )) ||
        (filters.type === "passed" && j.status === "passed") ||
        (filters.type === "diagnostic" && j.kind === "diagnostic")) &&
      `${j.name} ${j.id} ${j.version?.label ?? ""}`
        .toLowerCase()
        .includes(filters.q.toLowerCase()),
  );
  $("#history").innerHTML =
    items
      .map(
        (j) =>
          `<button class="record ${j.key === key ? "selected" : ""}" data-key="${E(j.key)}" aria-current="${j.key === key ? "true" : "false"}"><strong>${E(j.name)}</strong><div class="sub">${E(j.kind === "diagnostic" ? "诊断 · 非完整生成" : (j.version?.label ?? "历史版本"))}</div><div class="record-bottom">${badge(j.status)}<span>${E(j.createdAt ? new Date(j.createdAt).toLocaleDateString("zh-CN") : j.id.slice(0, 8))}${j.score !== null ? " · " + E(j.score) + " 分" : ""}</span></div></button>`,
      )
      .join("") || empty("没有匹配的记录");
  $("#history").scrollTop = historyScroll;
}
function imageCard(a) {
  return `<button class="image-card" data-media="${E(a.path)}"><img loading="lazy" src="${E(a.url)}" alt="${E(a.label)}"><span>${E(a.label)}</span></button>`;
}
const refs = () => data.artifacts.filter((a) => a.stage === "input");
const renders = () =>
  data.artifacts.filter(
    (a) => a.stage === "runtime" && !a.path.endsWith(".webm"),
  );
function sourceLabel(s) {
  return s === "image"
    ? ["图中观察", ""]
    : s === "prompt"
      ? ["用户要求", ""]
      : ["推断 / 来源未细分", "inferred"];
}
function requirements() {
  const req = A(data.plan?.requirements);
  return `<div class="section"><h2>原始输入</h2><p class="body-copy">${E(data.job.prompt || "没有文本输入")}</p><div class="gallery">${refs().map(imageCard).join("")}</div></div><div class="section"><h2>冻结需求 <span class="muted">${req.length || "暂无"} 项</span></h2><p class="muted compact">来源标签为生成器记录；“图中观察”仍需人工核对，不代表几何已重建。</p>${
    req.length
      ? req
          .map((r) => {
            const [label, cls] = sourceLabel(r.source);
            return `<article class="requirement"><div class="row"><span class="tag">${E(r.id)}</span><span class="origin ${cls}">${label}</span>${r.critical ? '<span class="status waiting">关键约束</span>' : ""}</div><p>${E(r.text)}</p><small>${E(A(r.evidence).join("；"))}</small>${r.count !== null && r.count !== undefined ? `<small>明确数量：${E(r.count)}</small>` : ""}</article>`;
          })
          .join("")
      : empty("需求尚未产出")
  }<h3>推断与不可观察区域</h3>${A(data.plan?.assumptions).length ? list(data.plan.assumptions) : '<p class="muted">暂无推断说明；不能据此认定全部来自观察。</p>'}${json("需求原始数据", data.plan)}</div>`;
}
function layoutData() {
  const layout =
    data.scene ??
    data.layout ??
    data.space ??
    data.files["reference-layout.json"] ??
    data.job.sceneIR ??
    data.files["scene-ir.json"];
  const legacy =
    Boolean(data.files["reference-layout.json"]) &&
    !data.scene &&
    !data.layout &&
    !data.space;
  const items = A(layout?.program?.instances).length
    ? layout.program.instances
    : legacy
      ? [...A(layout.architecture), ...A(layout.assets)]
      : A(layout?.entities);
  return {
    layout,
    items: items.slice(0, 180),
    cameras: A(layout?.cameras),
    legacy,
  };
}
function layoutView() {
  const { layout, items, cameras } = layoutData(),
    observations = data.files["reference-observations.json"];
  if (!layout)
    return `<div class="section"><h2>空间与关系</h2>${empty("暂无空间布局产物。规划调用开始不等于布局已生成。")}</div>`;
  const points = [...items, ...cameras].filter(
    (x) => A(x.position).length === 3 && x.position.every(Number.isFinite),
  );
  let minX = Math.min(...points.map((x) => x.position[0]), -1) - 2,
    maxX = Math.max(...points.map((x) => x.position[0]), 1) + 2,
    minY = Math.min(...points.map((x) => x.position[1]), -1) - 2,
    maxY = Math.max(...points.map((x) => x.position[1]), 1) + 2;
  const scale = Math.min(480 / (maxX - minX), 310 / (maxY - minY)),
    x = (v) => 45 + (v - minX) * scale,
    y = (v) => 350 - (v - minY) * scale;
  const boxes = items
    .filter((i) => A(i.position).length === 3)
    .map((i) => {
      const w = Math.max(5, Math.min(160, Number(i.size?.[0] ?? 1) * scale)),
        h = Math.max(5, Math.min(150, Number(i.size?.[1] ?? 1) * scale));
      return `<g class="object" data-object="${E(i.id)}" tabindex="0" role="button" aria-label="${E(i.label ?? i.id)}"><title>${E(i.label ?? i.id)} · 规划位置</title><rect x="${x(i.position[0]) - w / 2}" y="${y(i.position[1]) - h / 2}" width="${w}" height="${h}"></rect><text x="${x(i.position[0]) + 4}" y="${y(i.position[1]) - 5}">${E((i.label ?? i.id ?? "").slice(0, 13))}</text></g>`;
    })
    .join("");
  const cams = cameras
    .filter((c) => A(c.position).length === 3)
    .map(
      (c) =>
        `<g><line x1="${x(c.position[0])}" y1="${y(c.position[1])}" x2="${x(c.target?.[0] ?? c.position[0])}" y2="${y(c.target?.[1] ?? c.position[1])}"></line><circle class="camera" cx="${x(c.position[0])}" cy="${y(c.position[1])}" r="5"></circle><text x="${x(c.position[0]) + 8}" y="${y(c.position[1]) + 14}">${E(c.name ?? c.id ?? "相机")}</text></g>`,
    )
    .join("");
  return `<div class="section"><h2>布局投影与参考机位</h2><p class="muted compact">Z 向上 · XY 平面示意。位置来自已保存规划；矩形仅表示尺寸或定位标记，未绘制旋转与真实几何。</p><div class="layout-wrap"><svg class="map" viewBox="0 0 600 390" aria-label="场景布局与相机二维投影">${boxes}${cams}</svg><div class="object-list">${items.map((i) => `<button data-object="${E(i.id)}">${E(i.label ?? i.id)}<small>规划位置 ${E(JSON.stringify(i.position ?? "未知"))} · ${i.source === "image" ? "图中观察" : i.source === "inferred" ? "推断补全" : "来源未细分"}</small></button>`).join("")}</div></div><div id="object-detail" class="source-footer">点击对象查看坐标、绑定需求与来源；位置可视化不等于资产已生成。</div>${json("相机位置与朝向", cameras)}<h3>空间关系与推断说明</h3>${list(observations?.topology ?? layout?.relations ?? layout?.relationships ?? [])}${list(layout?.assumptions ?? data.plan?.assumptions ?? [])}${json("布局原始数据", layout)}</div>`;
}
function assets() {
  const textures = data.artifacts.filter((a) => a.stage === "materials");
  const textureById = new Map(textures.map((a) => [a.label.replace(/\.(png|jpg|jpeg)$/i, ""), a]));
  const { layout } = layoutData();
  const materials = A(layout?.program?.materials ?? layout?.materials);
  const swatch = (m) => {
    const color = A(m?.color).slice(0, 3).map((n) => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 255));
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" fill="rgb(${color.join(",")})"/></svg>`;
  };
  const material = (m, compact = false) => {
    const texture = textureById.get(m.textureId);
    return `<span class="material-chip ${compact ? "compact-chip" : ""}">${texture ? `<img loading="lazy" src="${E(texture.url)}" alt="">` : swatch(m)}<span><b>${E(m.id)}</b>${!compact ? `<small>${texture ? `贴图 ${E(m.textureId)}` : "纯色材质"} · 粗糙度 ${E(m.roughness ?? "未知")} · 金属度 ${E(m.metallic ?? "未知")}</small>` : ""}</span></span>`;
  };
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const previewUrl = (id) => "/api/process/asset-preview?" + new URLSearchParams({ key, asset: id });
  const assetCards = data.assets.map((s) => {
    const ids = A(s.materialIds);
    return `<article class="asset-card"><div class="asset-card-top">${s.previewAvailable ? `<button class="asset-visual" data-asset="${E(s.id)}" aria-label="放大查看 ${E(s.label ?? s.id)}"><img loading="lazy" src="${E(previewUrl(s.id))}" alt="${E(s.label ?? s.id)}的已保存几何形状"></button>` : `<div class="asset-visual pending-visual">${s.status === "waiting" || s.status === "pending" ? "等待生成" : "没有可预览的几何工件"}</div>`}<div><h3>${E(s.label ?? s.id)}</h3>${badge(s.status)}<p class="muted compact">${E(s.id)} · ${E(s.checkpoint?.triangles ?? "未知")} 个三角形 · ${s.status==="reused"?"本次 0 秒（历史复用）":duration(s.checkpoint?.durationMs)}</p><p class="muted compact">${s.previewAvailable ? "真实几何的等轴投影；贴图效果以右侧材质图和 Engine 画面为准。" : "仅展示已保存的工件，不推测未生成的形状。"}</p></div></div>${ids.length ? `<div class="asset-materials"><strong>使用材质 ${ids.length} 种</strong><div class="material-list">${ids.map((id) => material(materialById.get(id) ?? { id, color: [.55,.65,.59,1] }, true)).join("")}</div></div>` : ""}${s.checkpoint?.error ? `<p class="status failed">${E(s.checkpoint.error)}</p>` : ""}${json("资产简报与完成回执", s)}</article>`;
  });
  return `<div class="section"><h2>资产与物料总览</h2><p class="muted compact">随任务工件保存进度自动更新。逐资产预览显示已保存的真实几何形状；最终外观请看 Engine 渲染。点击图片可放大。</p><div class="inventory-counts"><span>参考图 <b>${refs().length}</b></span><span>逐资产几何 <b>${data.assets.filter((s) => s.previewAvailable).length} / ${data.assets.length || "未知"}</b></span><span>材质定义 <b>${materials.length}</b></span><span>贴图 <b>${textures.length}</b></span><span>Engine 画面 <b>${renders().length}</b></span></div></div><div class="section"><h2>逐资产形状与所用材质</h2>${assetCards.length ? `<div class="asset-grid">${assetCards.join("")}</div>` : empty("暂无逐资产几何工件。旧版整体生成若未保存单资产文件，无法还原单资产形状。")}${data.job.objectCount ? `<p class="muted compact">旧记录另报告 ${E(data.job.objectCount)} 个几何对象；这不是已生成资产数。</p>` : ""}</div><div class="section"><h2>材质定义与贴图 <span class="muted">${materials.length} 种</span></h2>${materials.length ? `<div class="material-grid">${materials.map((m) => material(m)).join("")}</div>` : empty("尚无材质定义")}${json("材质参数与颜色", materials)}</div><div class="section"><h2>已生成的贴图文件 <span class="muted">${textures.length} 张</span></h2>${textures.length ? `<div class="gallery">${textures.map(imageCard).join("")}</div>` : empty("尚无材质图片工件")}${json("材质来源与摘要", data.files["materials/texture-provenance.json"] ?? { status: "暂无逐贴图来源回执；仅展示已有文件" })}</div><div class="section"><h2>输入参考图 <span class="muted">${refs().length} 张</span></h2>${refs().length ? `<div class="gallery">${refs().map(imageCard).join("")}</div>` : empty("这条记录没有参考图片")}</div><div class="section"><h2>Engine 实际画面 <span class="muted">${renders().length} 张</span></h2>${renders().length ? `<div class="gallery">${renders().map(imageCard).join("")}</div>` : empty("尚无 Engine 运行截图")}</div>`;
}
function comparison() {
  const reference = refs(),
    frames = renders();
  const index = Math.min(compareIndex, Math.max(reference.length, 1) - 1),
    ref = reference[index];
  const named = frames.find(
    (a) => a.label === `reference-view-${index + 1}.png`,
  );
  const matched = named ?? (reference.length === 1 ? frames[0] : null);
  return `<div class="section"><div class="compare-head"><h2>参考图 / Engine 实际渲染</h2><select id="compare-view" aria-label="参考视角">${reference.map((a, i) => `<option value="${i}" ${i === index ? "selected" : ""}>参考视角 ${i + 1}</option>`).join("") || "<option>没有参考图</option>"}</select></div><p class="muted compact">${named ? "对应关系来自 reference-view 文件名；非像素配准。" : matched ? "单图与首帧并列展示；未确认相机匹配。" : "没有可核验的对应帧，不自动配对不同机位。"}</p><div class="grid"><div><h3>原始参考</h3>${ref ? imageCard(ref) : empty("无参考图")}</div><div><h3>实际渲染</h3>${matched ? imageCard(matched) : empty("此视角暂无对应的 Engine 渲染")}</div></div></div><div class="section"><h2>已保存的 Engine 运行画面</h2>${frames.length ? `<div class="gallery">${frames.map(imageCard).join("")}</div>` : empty("尚未运行或尚无截图")}<p class="muted compact">这些是历史采集结果，不代表当前正在运行。</p></div>`;
}
function review() {
  const q = data.job.quality ?? data.files["quality.json"],
    r = data.job.review ?? data.files["review.json"];
  const issues = [
    ...A(r?.requirements).filter((x) => !["met", "passed"].includes(x.status)),
    ...A(q?.dimensions).filter(
      (x) => x.score < (q?.policy?.dimensionFloor ?? 3),
    ),
    ...A(r?.specRules).filter((x) => x.status !== "passed"),
  ];
  return `<div class="section"><h2>视觉评估 ${q?.score !== undefined ? `<span class="status ${E(q.status)}">${E(q.score)} 分 · ${E(q.grade)}</span>` : ""}</h2>${
    !r
      ? empty("尚无视觉评估回执；可构建或可预览不能记为视觉通过。")
      : `<p class="body-copy">${E(r.summary ?? "")}</p><p class="muted compact">记录门槛：${E(q?.policy?.score ?? data.job.policy?.score ?? "未知")} 分 · 维度底线 ${E(q?.policy?.dimensionFloor ?? data.job.policy?.dimensionFloor ?? "未知")} · 置信度 ${E(r.confidence ?? q?.confidence ?? "未知")}</p>${list(q?.reasons)}<div class="issues">${issues
          .map(
            (i) =>
              `<article class="issue"><h3>${E(i.label ?? i.id)} ${badge(i.status ?? "failed")}${i.score !== undefined ? " · " + E(i.score) + "/5" : ""}</h3><p>${E(i.reason ?? i.evidence ?? "暂无摘要")}</p>${A(
                i.frames,
              )
                .map((f) => {
                  const a = renders().find((a) => a.label === f);
                  return a
                    ? `<button data-media="${E(a.path)}">定位引用画面 · ${E(f)}</button>`
                    : "";
                })
                .join("")}</article>`,
          )
          .join(
            "",
          )}</div><p class="muted compact">问题仅定位到评估引用的需求 / 画面；没有区域框时不伪造像素定位。</p>${json("完整评估与质量门槛", { review: r, quality: q })}`
  }</div>`;
}
function calls() {
  return `${consoleHTML(key,data.calls)}<div class="section"><h2>模型调用与活动</h2><p class="muted compact">以下为执行回执和活动计数。进程存在、标准错误输出或初始请求头均不证明模型正在有效生成。没有上游回执时用量未知。</p>${data.calls.length ? `<div class="calls">${data.calls.map((c) => `<article class="call"><div class="call-title"><h3>${E(c.id)}</h3>${badge(c.status)}</div><p><strong>${E(c.model ?? "模型未知")}</strong> / ${E(c.reasoning ?? "思考档位未知")}</p><dl class="kv"><dt>开始时间</dt><dd>${stamp(c.start)}</dd><dt>结束时间</dt><dd>${stamp(c.end)}</dd><dt>耗时 / 等待</dt><dd data-call-duration="${E(c.id)}">${duration(c.durationMs ?? (c.status === "running" && c.start ? Date.now() - c.start : null))}</dd><dt>最后活动</dt><dd>${stamp(c.lastActivity)}</dd><dt>输出字节</dt><dd>${E(c.stdoutBytes ?? "未知")}</dd><dt>日志字节</dt><dd>${E(c.stderrBytes ?? "未知")}（含请求头）</dd><dt>已知用量</dt><dd>${c.usage ? E(JSON.stringify(c.usage)) : "未知：无完成用量回执"}</dd><dt>路由证据</dt><dd>${c.cliModel ? "CLI 头：" + E(c.cliModel) : "暂无 CLI 模型回执"} · 上游返回模型：${E(c.returnedModel ?? "未知")}</dd></dl>${c.error ? `<p class="status failed">${E(c.error)}</p>` : ""}${json("执行 / 完成 / 失败回执", { execution: c.execution, receipt: c.receipt, failure: c.failure })}</article>`).join("")}</div>` : empty("旧版本未保存独立调用回执或调用尚未开始")}${json("阶段活动记录（最多展示最后 100 条）", A(data.job.events).slice(-100))}</div>`;
}
function safePreview(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(u.hostname) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function preview() {
  const u = safePreview(data.job.previewUrl);
  const recording = data.artifacts.find((a) => a.path.endsWith(".webm"));
  return `<div class="section"><h2>ForgeaX Engine 场景</h2><p class="muted compact">现有预览地址来自任务记录。只打开现有 Engine 页面，不启动 / 重启预览；地址失效时查看已保存画面。</p>${u ? `<button id="open-engine" data-url="${E(u)}">加载已有 Engine 预览</button> <a href="${E(u)}" target="_blank" rel="noopener">新标签打开现有预览 ↗</a><div id="engine"></div>` : empty("记录中没有现存 Engine 预览地址")} ${recording ? `<details><summary>播放已有 Engine 场景录屏</summary><video controls preload="none" src="${E(recording.url)}"></video></details>` : ""}</div>`;
}
function outputs() {
  const stageData = selectedStage(),
    id = stageData?.id ?? stage;
  if (id === "input" || id === "plan") return requirements();
  if (["space", "layout", "surface"].includes(id)) return layoutView();
  if (["materials", "assets"].includes(id) || id.startsWith("asset:"))
    return assets();
  if (["judge", "spec", "gate"].includes(id)) return review() + preview();
  if (id === "runtime") return preview() + comparison();
  return `<div class="section"><h2>已保留产物</h2><p class="body-copy">${E(data.plan?.summary ?? "产物将在生成器保存后逐步出现。")}</p><div class="milestones"><span class="${data.plan ? "done" : ""}">需求 ${A(data.plan?.requirements).length || "暂无"} 项</span><span>布局 ${layoutData().layout ? "已保存" : "暂无"}</span><span>材质图片 ${data.artifacts.filter((a) => a.stage === "materials").length}</span><span>Engine 画面 ${renders().length}</span></div><div class="detail-links"><button data-tab="requirements">查看需求</button><button data-tab="layout">查看布局</button><button data-tab="assets">查看资产</button><button data-tab="compare">参考对照</button><button data-tab="calls">调用活动</button></div></div>${preview()}`;
}
function selectedStage() {
  return [...data.stages, ...data.children].find((s) => s.id === stage);
}
function stageDetail() {
  const s = selectedStage();
  if (!s) return "";
  const id = s.id;
  const outputKeys = Object.keys(data.files).filter((f) =>
    id === "scene-repair-plan"
      ? /repair-(?:goals|history)\.json$/.test(f)
      : id === "plan"
      ? f === "plan.json"
      : id === "space"
        ? f.endsWith("space.json")
        : id === "surface"
          ? f.endsWith("surface.json")
          : id === "assets" || id.startsWith("asset:")
            ? f.includes("assets/")
            : id === "materials"
              ? f.includes("materials/")
              : id === "generate" || id === "assembly"
                ? /scene|layout|checkpoints/.test(f)
                : id === "judge" || id === "gate" || id === "spec"
                  ? /review|quality/.test(f)
                  : false,
  );
  const inputs =
    id === "input"
      ? data.job.prompt
      : id === "plan"
        ? data.job.prompt
        : id === "space" || id === "generate"
          ? data.plan
          : id === "surface"
            ? data.space
            : id === "assets" || id.startsWith("asset:")
              ? data.layout
              : null;
  return `<div class="detail"><div class="detail-grid"><div><h3>${E(s.label)} ${badge(s.status)}</h3><dl class="kv"><dt>依赖</dt><dd>${E([...data.stages, ...data.children].find((x) => x.id === s.dependsOn)?.label ?? s.dependsOn ?? "原始输入")}</dd><dt>开始</dt><dd>${stamp(s.start)}</dd><dt>结束</dt><dd>${stamp(s.end ?? (s.start && s.durationMs !== null && s.durationMs !== undefined ? s.start + s.durationMs : null))}</dd><dt>耗时</dt><dd data-stage-duration="${E(s.id)}">${duration(stageDuration(s))}</dd><dt>状态依据</dt><dd>${E(s.evidence ?? "生成检查点；未发生步骤以契约预期显示")}</dd></dl></div><div><h3>输入、约束与输出</h3><p class="compact">${E(s.inputSummary ?? (id === "input" ? "用户原始文字与图片" : id === "plan" ? "从输入冻结需求与来源" : s.dependsOn ? "依赖上一步真实产物；没有产物时不视为执行完成" : "原始输入与冻结需求"))}</p><p class="muted compact">${E(data.job.kind === "diagnostic" ? data.job.kind + ": " + (data.job.stopConditions ?? []).join("；") : `${A(data.plan?.requirements).filter((r) => r.critical).length} 项关键需求 · 质量门槛 ${data.job.policy?.score ?? "未知"} 分`)}</p><p class="compact">已保存输出：${s.outputSummary ? E(s.outputSummary) : outputKeys.length ? outputKeys.map(E).join("、") : id === "runtime" ? renders().length + " 张运行截图" : "暂无可展示结构化输出；请查看调用或阶段记录"}</p></div></div>${s.error ? `<div class="alert">${E(s.error)}</div>` : ""}${json("展开阶段输入 / 输出", { input: inputs, output: Object.fromEntries(outputKeys.map((k) => [k, data.files[k]])), record: s })}</div>`;
}
function render() {
  if (!data) return;
  const j = data.job;
  if (![...data.stages, ...data.children].some((s) => s.id === stage))
    stage =
      data.children.find((s) =>
        ["failed", "timed_out", "running", "interrupted"].includes(s.status),
      )?.id ??
      j.stage ??
      data.stages[0]?.id ??
      "";
  url();
  $("#main").innerHTML =
    `<div class="hero-title"><div><div class="eyebrow">${j.kind === "diagnostic" ? "DIAGNOSTIC / 诊断记录 · 非完整生成" : "SCENE PIPELINE / 场景生成"}</div><h1>${E(j.plan?.name ?? j.id)}</h1><div class="hero-id">${E(j.pipelineVersion?.label ?? "历史版本")} · ${E(j.generationMethod ?? "方法未记录")} · ${E(j.id)}</div></div><div class="hero-status">${badge(j.status)}</div></div>${data.error ? `<div class="alert"><strong>${data.terminal ? "已停止 · 保留以下产物" : "当前错误"}</strong><br>${E(data.error)}</div>` : ""}${data.source.replay ? '<div class="notice"><strong>测试回放 · 合成工件 · 非实时生成</strong>。仅用于验证进行中、等待、取消等状态，不计入真实生成。</div>' : ""}${j.kind === "diagnostic" ? `<div class="notice">独立诊断，不计入正常场景生成成功率或质量通过。来源任务 ${E(j.sourceJob)}。</div>` : ""}<div class="metrics"><div class="metric"><span>当前 / 最后阶段</span><strong>${E(data.currentLabel)}</strong><small id="activity-summary">${E(data.activity)}</small></div><div class="metric"><span>阶段耗时 / 总耗时</span><strong id="duration">${duration(data.stageElapsed)}</strong><small id="total-duration">总计 ${duration(data.totalMs)}${data.end ? " · 已结束" : ""}</small></div><div class="metric"><span>已完成资产 / 已知总数</span><strong>${data.count.completed ?? "未知"} / ${data.count.total ?? "未知"}</strong><small>${E(data.count.source)}</small></div><div class="metric"><span>最后活动时间</span><strong class="activity-time">${stamp(data.lastActivity)}</strong><small id="activity-age">${data.lastActivity ? "距今 " + duration(Date.now() - data.lastActivity) : "旧记录没有活动回执"}</small></div></div><div class="milestones">${[
      ["planned", "已规划"],
      ["generated", "几何已生成"],
      ["built", "场景已构建"],
      ["visual", "视觉已通过"],
    ]
      .map(
        ([k, l]) =>
          `<span class="${data.milestones[k] ? "done" : ""}">${data.milestones[k] ? "●" : "○"} ${l}${data.milestones[k] ? "" : " · 未确认"}</span>`,
      )
      .join(
        "",
      )}</div>${data.warnings.length || index?.warnings.length ? `<div class="notice">读取提示：${[...data.warnings, ...(index?.warnings ?? [])].map(E).join("；")}</div>` : ""}<section class="section"><div class="section-head"><h2>执行路径</h2><p>点击阶段回看 · 灰色步骤尚无执行记录</p></div><div class="timeline">${data.stages.map((s, i) => `<button class="stage ${s.id === stage ? "selected" : ""}" data-stage="${E(s.id)}" aria-pressed="${s.id === stage}"><span class="step">${String(i + 1).padStart(2, "0")} ${s.dependsOn ? "← 依赖上游" : ""}</span><b>${E(s.label)}</b>${badge(s.status)}</button>`).join("") || '<p class="muted">暂无阶段记录</p>'}</div>${data.children.length ? `<div class="substeps">${data.children.map((s) => `<button class="${stage === s.id ? "selected" : ""}" data-stage="${E(s.id)}">${E(s.label)} · ${badge(s.status)}</button>`).join("")}</div>` : ""}${stageDetail()}</section><div class="tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" aria-selected="${id === tab}" data-tab="${id}" class="${id === tab ? "selected" : ""}">${label}</button>`).join("")}</div><div id="content">${{ outputs, requirements, layout: layoutView, assets, compare: comparison, review, calls }[tab]()}</div><footer class="provenance">观测数据 ${E(data.source.observedAt)} · 适配器 ${E(data.source.adapterVersion)}<br>来源：${E(data.source.root)}/${E(data.source.record)}<br>管线摘要：${E(data.source.pipeline?.id ?? "未知")}${json("数据来源、内容摘要与读取开销", { ...data.source, io: data.io })}<p>只读模式 · 取消 / 重试 / 新建生成未接入。上游细粒度事件缺失时显示未知，不推测隐藏推理。</p></footer>`;
  if (tab === "calls") mountConsole(); else hideConsole();
}
async function refreshIndex() {
  index = await get("/api/process/index");
  renderHistory();
  if (!key && index.items.length) pick(index.items[0].key);
}
async function refreshDetail() {
  if (!key) return;
  const token = ++sequence,
    requested = key;
  try {
    const next = await get("/api/process/detail?key=" + encodeURIComponent(key));
    if (token !== sequence || requested !== key) return;
    const sig = JSON.stringify([
      next.job,
      next.files,
      next.warnings,
      next.artifacts,
    ]);
    data = next;
    $("#connection").textContent =
      "已连接 · " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
    if (signature !== sig) {
      signature = sig;
      render();
    } else {
      if ($("#activity-summary"))
        $("#activity-summary").textContent = data.activity;
      for (const element of document.querySelectorAll("[data-call-duration]")) {
        const call = data.calls.find(
          (c) => c.id === element.dataset.callDuration,
        );
        if (call)
          element.textContent = duration(
            call.durationMs ??
              (call.status === "running" && call.start
                ? Date.now() - call.start
                : null),
          );
      }
      for (const element of document.querySelectorAll("[data-stage-duration]")) {
        const step = [...data.stages, ...data.children].find(s => s.id === element.dataset.stageDuration);
        if (step) element.textContent = duration(stageDuration(step));
      }
      if ($("#duration"))
        $("#duration").textContent = duration(data.stageElapsed);
      if ($("#total-duration"))
        $("#total-duration").textContent =
          "总计 " + duration(data.totalMs) + (data.end ? " · 已结束" : "");
      if ($("#activity-age"))
        $("#activity-age").textContent = data.lastActivity
          ? "距今 " + duration(Date.now() - data.lastActivity)
          : "没有活动回执";
    }
    $("#stale")?.remove();
  } catch (e) {
    if (token !== sequence) return;
    $("#connection").textContent = "读取中断";
    if (!data || data.source.key !== requested)
      $("#main").innerHTML =
        `<div class="alert">${E(e.message)}<p>不会把读取失败记为生成失败。请刷新重试。</p></div>`;
    else {
      let n = $("#stale");
      if (!n) {
        n = document.createElement("div");
        n.id = "stale";
        n.className = "notice";
        $("#main").prepend(n);
      }
      n.textContent = "数据暂不可读，保留上次快照：" + e.message;
    }
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    await refreshDetail();
  } catch (e) {
    $("#connection").textContent = "读取中断：" + e.message;
  } finally {
    busy = false;
  }
}
$("#refresh").onclick = refresh;
$("#search").oninput = (e) => {
  filters.q = e.target.value;
  renderHistory();
};
$("#filter").onchange = (e) => {
  filters.type = e.target.value;
  renderHistory();
};
function showMedia(path) {
  const a = data.artifacts.find((a) => a.path === path);
  if (!a) return;
  $("#viewer-title").textContent = a.label;
  $("#viewer-content").innerHTML =
    `<img src="${E(a.url)}" alt="${E(a.label)}">`;
  $("#viewer").showModal();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(
    "[data-key],[data-stage],[data-tab],[data-media],[data-asset],[data-object],#open-engine",
  );
  if (!b) return;
  if (b.dataset.key) {
    pick(b.dataset.key);
    return;
  }
  if (b.dataset.stage) {
    stage = b.dataset.stage;
    tab = "outputs";
    url();
    render();
    return;
  }
  if (b.dataset.tab) {
    tab = b.dataset.tab;
    url();
    render();
    return;
  }
  if (b.dataset.media) {
    if (b.classList.contains("image-card")) {
      b.setAttribute("aria-expanded", String(b.classList.toggle("expanded")));
    } else showMedia(b.dataset.media);
    return;
  }
  if (b.dataset.asset) {
    const asset = data.assets.find((item) => item.id === b.dataset.asset && item.previewAvailable);
    if (!asset) return;
    const card = b.closest(".asset-card");
    const expanded = card.classList.toggle("expanded");
    b.setAttribute("aria-expanded", String(expanded));
    b.setAttribute("aria-label", `${expanded ? "收起" : "放大查看"} ${asset.label ?? asset.id}`);
    return;
  }
  if (b.dataset.object) {
    const item = layoutData().items.find((i) => i.id === b.dataset.object);
    const observation = A(
      data.files["reference-observations.json"]?.items,
    ).find((i) => i.id === item?.id);
    $("#object-detail").innerHTML =
      `<strong>${E(item?.label ?? item?.id)}</strong><p>来源：${E(item?.source ?? "未细分；不可把规划当作已观察几何")}</p>${observation ? "<p>有对应图像观察；三维位置与隐藏部分仍需验证。</p>" + json("图像观察、置信度与原图区域", observation) : ""}${json("坐标、尺寸、需求绑定与原始字段", item)}`;
    return;
  }
  if (b.id === "open-engine") {
    const u = safePreview(b.dataset.url);
    if (u) {
      $("#engine").innerHTML =
        `<p class="muted compact">现有 Engine 页面 ${E(u)}。服务不可达时不会自动启动；可切换到已保存画面。</p><iframe title="已有 ForgeaX Engine 场景" src="${E(u)}" allow="fullscreen"></iframe>`;
      b.disabled = true;
    }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "compare-view") {
    compareIndex = Number(e.target.value);
    $("#content").innerHTML = comparison();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".object")) {
    e.preventDefault();
    e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
window.addEventListener("hashchange", () => {
  route();
  signature = "";
  void refreshDetail();
  renderHistory();
});
route();
void refresh();
setInterval(() => {
  if (!document.hidden) void refreshDetail();
}, 5000);
setInterval(() => {
  if (!document.hidden && !document.body.classList.contains("embedded"))
    void refreshIndex().catch(
      (e) => ($("#connection").textContent = "列表读取中断：" + e.message),
    );
}, 15000);

new ResizeObserver(()=>parent.postMessage({type:"scene-process-size",height:document.body.scrollHeight},location.origin)).observe(document.body);
