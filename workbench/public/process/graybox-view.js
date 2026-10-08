const escape = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function displayFrames(data) {
  const frames = data.artifacts.filter(a => a.stage === "runtime" && !a.path.endsWith(".webm"));
  const scene = frames.filter(a => a.kind !== "graybox");
  return scene.length ? scene : frames;
}

export function referenceFrame(frames, index) {
  return frames.find(a => a.referenceIndex === index + 1 ||
    (a.kind !== "graybox" && a.label === `reference-view-${index + 1}.png`)) ?? null;
}

export function grayboxSummary(graybox) {
  if (!graybox) return "";
  const verdict = graybox.status === "passed" ? "空间验收已通过；成品验收尚未完成" :
    graybox.status === "not_met" ? "空间验收未通过" : "空间验收待完成";
  return `<div class="notice"><strong>${graybox.retained ? "已保留灰模" : "当前已生成灰模"} · 第 ${graybox.round + 1} 轮</strong><br>${escape(verdict)}${Number.isFinite(graybox.score) ? ` · 空间评分 ${escape(graybox.score)}/5${Number.isFinite(graybox.threshold) ? ` · 门槛 ${escape(graybox.threshold)}/5` : ""}` : ""}<br>${escape(graybox.limitation)}</div>`;
}

export function grayboxView(data, imageCard) {
  if (!data.graybox) return "";
  const g = data.graybox, frames = data.artifacts.filter(a => a.kind === "graybox" && a.round === g.round);
  return `<div class="section"><h2>${g.retained ? "已保留" : "当前"}灰模与 Engine 实拍 · 第 ${g.round + 1} 轮</h2>${grayboxSummary(g)}${g.gate?.review?.summary ? `<p class="body-copy">${escape(g.gate.review.summary)}</p>` : ""}<p class="muted compact">以下布局与画面来自同一灰模轮次；图片是已保存的真实 Engine 采集结果。</p><div class="gallery">${frames.map(imageCard).join("")}</div><details><summary>查看灰模来源与空间评审</summary><pre>${escape(JSON.stringify({ ...g.source, runtimeDigest: g.runtimeDigest, spatialReview: g.gate }, null, 2))}</pre></details></div>`;
}
