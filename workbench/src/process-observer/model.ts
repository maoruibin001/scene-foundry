import { validateProgress } from "./progress-contract";
// Adapter contract: frozen rc.22 runner + generation files. Unknown keys remain visible.
export const LABELS: Record<string, string> = {
  input: "接收输入",
  plan: "提取需求",
  generate: "旧版生成总阶段",
  observe: "图片观察与跨视角对应",
  graybox: "空间灰模与关系验收",
  space: "空间与机位",
  surface: "材质与光照",
  layout: "共享布局",
  materials: "提取材质",
  assets: "逐资产生成",
  assembly: "组装场景",
  export: "导出 Engine 资源",
  build: "Engine 构建",
  verify: "资源校验",
  runtime: "运行与采集",
  judge: "视觉评估",
  spec: "规范检查",
  gate: "最终判定",
  repair: "局部修复",
};
export const labels: Record<string, string> = {
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
};
export const active = (s: string) => ["running", "queued"].includes(s);
export const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
export const timestamp = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
export function jobTiming(job: any) {
  const terminal = ["passed", "failed", "blocked", "cancelled", "needs_review", "timed_out", "interrupted"].includes(job.status);
  const completed = arr(job.events)
    .filter((e) => ["complete", "error", "cancel", "blocked"].includes(e.type))
    .at(-1);
  const start = timestamp(job.createdAt ?? job.startedAt),
    end =
      timestamp(job.endedAt ?? completed?.at) ??
      (terminal && Number.isFinite(job.durationMs) && start !== null
        ? start + job.durationMs
        : null);
  return {start,end};
}
export function normalize(
  job: any,
  files: Record<string, any>,
  now = Date.now(),
) {
  const diagnostic = job.kind === "diagnostic",
    events = arr(job.events),
    terminal = [
      "passed",
      "failed",
      "blocked",
      "cancelled",
      "needs_review",
      "timed_out",
      "interrupted",
    ].includes(job.status);
  const {start,end} = jobTiming(job);
  const executionKeys = Object.keys(files).filter((k) =>
    k.endsWith("-execution.json"),
  );
  const calls = Object.keys(files)
    .filter(
      (k) =>
        /-(execution|receipt|failure)\.json$/.test(k) &&
        !/-input-receipt/.test(k) &&
        (!k.endsWith("-receipt.json") ||
          files[k]?.requestedModel ||
          files[k]?.provider),
    )
    .reduce((map: any, k) => {
      const prefix = k.replace(/-(execution|receipt|failure)\.json$/, "");
      map[prefix] ??= { id: prefix };
      map[prefix][k.match(/-(execution|receipt|failure)\.json$/)![1]] =
        files[k];
      return map;
    }, {});
  for (const c of Object.values(calls) as any[]) {
    const e = c.execution ?? {},
      r = c.receipt ?? {},
      f = c.failure ?? {};
    Object.assign(c, {
      model:
        r.requestedModel ??
        f.requestedModel ??
        job.modelSettings?.model ??
        job.profile?.model ??
        null,
      reasoning:
        r.requestedReasoning ??
        f.requestedReasoning ??
        job.modelSettings?.reasoningEffort ??
        null,
      status: e.status ?? (c.failure ? "failed" : (r.stopReason ?? "unknown")),
      start: timestamp(e.startedAt),
      end: timestamp(e.endedAt),
      lastActivity: timestamp(e.lastActivityAt),
      durationMs: e.durationMs ?? r.durationMs ?? f.durationMs ?? null,
      stdoutBytes: e.stdoutBytes ?? null,
      stderrBytes: e.stderrBytes ?? null,
      usage: r.usage ?? null,
      error: f.error ?? e.error ?? null,
      returnedModel: r.returnedModel ?? null,
      cliModel: r.cliModel ?? null,
    });
    if (terminal && c.status === "running") c.status = "interrupted";
  }
  const checkpoints =
    files["generation/checkpoints.json"] ?? files["checkpoints.json"];
  const inherited=new Set(arr(files["generation/resumed-from.json"]?.assets).map(a=>a.id));
  const steps = arr(checkpoints?.steps).map((s) => ({
    ...s,
    status:inherited.has(s.id)?"reused":s.status,
    checkpoint:
      files[`generation/assets/${s.id}/checkpoint.json`] ??
      files[`assets/${s.id}/checkpoint.json`] ??
      null,
  }));
  const count = steps.length
    ? {
        completed: steps.filter((s) => ["passed","reused"].includes(s.status)).length,
        total: steps.length,
        source: "资产检查点",
      }
    : job.generationProgress?.total > 0
      ? {
          completed: job.generationProgress.completed,
          total: job.generationProgress.total,
          source: "生成进度记录",
        }
      : { completed: null, total: null, source: "暂无逐资产检查点" };
  const stageRecords = job.stages ?? {},
    keys = Object.keys(stageRecords);
  const knownOrder = [
    "input",
    "plan",
    ...(job.stageTrackingVersion === "exclusive-stages-v1" ? ["observe","space","graybox","surface","materials","assets","assembly"] : ["generate"]),
    "export",
    "build",
    "verify",
    "runtime",
    "judge",
    "spec",
    "gate",
  ];
  const normalContract =
    ["3.0", "4.0", "5.0", "5.1", "5.2", "5.3", "5.4"].includes(
      String(job.profile?.version),
    ) &&
    keys.length > 0 &&
    keys.every((k) => knownOrder.includes(k) || k === "repair");
  let stageIds = diagnostic
    ? keys
    : normalContract
      ? [
          ...knownOrder.filter(
            (k) =>
              k !== "spec" ||
              stageRecords.spec ||
              Number(job.profile?.version) >= 5,
          ),
          ...keys.filter((k) => !knownOrder.includes(k)),
        ]
      : keys;
  if (normalContract && stageRecords.repair) {
    stageIds = stageIds.filter((k) => k !== "repair");
    const at = timestamp(stageRecords.repair.startedAt);
    const pos = stageIds.findIndex(
      (k) => at !== null && (timestamp(stageRecords[k]?.startedAt) ?? -1) > at,
    );
    stageIds.splice(pos < 0 ? stageIds.length : pos, 0, "repair");
  }
  const stageEnd = (id: string, s: any) =>
    timestamp(s.endedAt) ??
    (s.startedAt != null && Number.isFinite(s.durationMs)
      ? timestamp(s.startedAt)! + s.durationMs
      : null) ??
    timestamp(
      events.find((e) => e.type === "stage" && e.message === id + " 完成")?.at,
    ) ??
    (terminal && id === job.stage ? end : null);
  const stages = stageIds.map((id: string, index: number) => {
    const s = stageRecords[id];
    return {
      id,
      label: LABELS[id] ?? id,
      status:
        s?.status ??
        (stageIds.slice(index + 1).some((k) => stageRecords[k])
          ? "unknown"
          : terminal
            ? "pending"
            : "waiting"),
      start: timestamp(s?.startedAt),
      end: s ? stageEnd(id, s) : null,
      durationMs: s?.durationMs ?? null,
      error: s?.error ?? null,
      evidence: s ? "阶段记录" : "管线契约预期；尚无执行记录",
      dependsOn: normalContract && index ? stageIds[index - 1] : null,
    };
  });
  for (const s of stages) {
    if (terminal && active(s.status))
      s.status = job.status === "cancelled" ? "cancelled" : "interrupted";
    if (s.id === "gate" && terminal) s.status = job.status;
  }
  const get = (...names: string[]) => names.map((n) => files[n]).find(Boolean);
  const space = get("generation/space.json", "space.json"),
    surface = get("generation/surface.json", "surface.json"),
    layout = get("generation/layout.json", "layout.json"),
    scene = get("generated-scene.json");
  const children: any[] = [];
  const method = job.generationMethod ?? "",
    split =
      method === "general-geometry-v3" ||
      Boolean(space) ||
      Object.keys(files).some((k) => k.includes("scene-space-"));
  const splitV2 = method === "general-geometry-v2" || Boolean(layout);
  const callStage = (
    id: string,
    label: string,
    prefix: string,
    artifact: any,
  ) => {
    const related = (Object.values(calls) as any[]).filter((c) =>
      c.id.split("/").at(-1)?.startsWith(prefix),
    );
    const c = related.at(-1);
    children.push({
      id,
      label,
      status: artifact
        ? "passed"
        : c
          ? c.status === "completed"
            ? "needs_review"
            : c.status
          : terminal
            ? "pending"
            : "waiting",
      start: c?.start ?? null,
      end: c?.end ?? null,
      durationMs: c?.durationMs ?? null,
      error: c?.error ?? null,
      dependsOn: children.at(-1)?.id ?? "plan",
      evidence: artifact
        ? "已保存且通过生成器契约的工件"
        : c
          ? "模型调用记录"
          : "管线契约预期；尚无执行记录",
    });
  };
  if (split && !job.refineScene) {
    callStage("space", LABELS.space, "scene-space", space);
    callStage("surface", LABELS.surface, "scene-surface", surface);
  } else if (splitV2)
    callStage("layout", LABELS.layout, "scene-layout", layout);
  if ((split || splitV2) && !job.reuseSceneFrom) {
    children.push({
      id: "materials",
      label: LABELS.materials,
      status: files["materials/texture-provenance.json"]
        ? "passed"
        : steps.length
          ? "unknown"
          : terminal
            ? "pending"
            : "waiting",
      dependsOn: children.at(-1)?.id,
    });
    children.push({
      id: "assets",
      label: LABELS.assets,
      status: steps.some((s) => s.status === "failed")
        ? "failed"
        : steps.length && steps.every((s) => ["passed","reused"].includes(s.status))
          ? "passed"
          : steps.some((s) => s.status === "running")
            ? terminal
              ? "interrupted"
              : "running"
            : terminal
              ? "pending"
              : "waiting",
      dependsOn: "materials",
    });
    for (const [i, s] of steps.entries())
      children.push({
        id: `asset:${s.id}`,
        label: s.label ?? s.id,
        status: terminal && active(s.status) ? "interrupted" : s.status,
        dependsOn: "materials",
        start: s.status === "reused" ? null : (
          timestamp(s.checkpoint?.startedAt) ??
          calls[`generation/assets/${s.id}/geometry-asset`]?.start ??
          calls[`assets/${s.id}/geometry-asset`]?.start ?? null),
        durationMs: s.status === "reused" ? 0 : s.checkpoint?.durationMs ?? null,
        error: s.checkpoint?.error ?? null,
        evidence: "资产检查点",
      });
    children.push({
      id: "assembly",
      label: LABELS.assembly,
      status: scene ? "passed" : terminal ? "pending" : "waiting",
      dependsOn: steps.length ? `asset:${steps.at(-1).id}` : "assets",
    });
  }
  if (Object.keys(calls).some(k => k.includes("scene-repair-plan"))) {
    const latest = (Object.values(calls) as any[]).filter(c => c.id.split("/").at(-1) === "scene-repair-plan").sort((a,b) => (a.start ?? 0) - (b.start ?? 0)).at(-1);
    const goals = latest ? files[latest.id.replace(/scene-repair-plan$/, "repair-goals.json")] : null;
    callStage("scene-repair-plan", "选择修正目标", "scene-repair-plan", goals?.version === "scene-repair-goals-v1" && arr(goals.goals).length ? goals : null);
  }
  if (Object.keys(calls).some(k => k.includes("scene-refine"))) callStage("scene-refine", "视觉反馈修正", "scene-refine", null);
  if (Object.keys(calls).some(k => k.includes("scene-spatial-refine"))) callStage("scene-spatial-refine", "修正空间与构图", "scene-spatial-refine", null);
  if (Object.keys(calls).some(k => k.includes("scene-alignment"))) callStage("scene-alignment", "观测参考机位对应点", "scene-alignment", null);
  const declared = validateProgress(files["observer-progress.json"], job);
  if (declared) {
    stages.splice(
      0,
      stages.length,
      ...declared.stages.map((s) => ({
        ...s,
        label: s.label,
        error: s.error ?? null,
        start: timestamp(s.startedAt),
        end: timestamp(s.endedAt),
        durationMs:
          s.startedAt && s.endedAt
            ? Date.parse(s.endedAt) - Date.parse(s.startedAt)
            : null,
        status: terminal && active(s.status) ? "interrupted" : s.status,
        evidence: "生产者 scene-progress-v1 事件快照",
        dependsOn: s.dependsOn.join("、"),
      })),
    );
    children.splice(0);
  }
  const lastActivity =
    Math.max(
      ...events.map((e) => timestamp(e.at) ?? 0),
      ...executionKeys.map((k) => timestamp(files[k]?.lastActivityAt) ?? 0),
      0,
    ) || null;
  const currentCall = (Object.values(calls) as any[]).find(
    (c) => c.status === "running",
  );
  if (diagnostic) {
    for (let i = children.length - 1; i >= 0; i--)
      if (["assembly", "materials"].includes(children[i].id))
        children.splice(i, 1);
    const asset = children.find((s) => s.id === "assets");
    if (asset) {
      asset.label = "单资产诊断";
      asset.dependsOn = split ? "surface" : "layout";
    }
    if (children.length) {
      stages.splice(0, stages.length, ...children);
      children.splice(0);
    }
  }
  const current =
    children.find(
      (s) =>
        s.id.startsWith("asset:") &&
        ["running", "failed", "interrupted"].includes(s.status),
    ) ??
    children.find((s) =>
      ["running", "timed_out", "failed", "interrupted"].includes(s.status),
    ) ??
    stages.find((s) => s.id === job.stage);
  const stageStart = current
    ? (current.start ?? null)
    : timestamp(stageRecords[job.stage]?.startedAt);
  const stageStop = current?.end ?? (terminal ? end : null);
  const stageElapsed = Number.isFinite(current?.durationMs)
    ? current.durationMs
    : stageStart !== null && (stageStop !== null || active(job.status))
      ? Math.max(0, (stageStop ?? now) - stageStart)
      : null;
  const plan = job.plan ?? files["plan.json"];
  return {
    job,
    adapterWarnings:
      files["observer-progress.json"] && !declared
        ? ["生产者阶段快照与任务版本不匹配或格式不合法；未采用该快照"]
        : [],
    terminal,
    start,
    end,
    totalMs:
      start !== null && (end !== null || active(job.status))
        ? Math.max(0, (end ?? now) - start)
        : null,
    lastActivity,
    stageElapsed,
    currentLabel:
      current?.label ?? LABELS[job.stage] ?? job.stage ?? "暂无阶段记录",
    stages,
    children,
    calls: Object.values(calls),
    assets: steps.map((s) => ({
      ...s,
      status: terminal && active(s.status) ? "interrupted" : s.status,
    })),
    count,
    plan,
    space,
    surface,
    layout,
    scene,
    activity: terminal
      ? "任务已结束"
      : job.status === "unknown"
        ? "执行状态未确认：缺少终态回执"
        : job.status === "queued"
          ? "已排队，尚未执行"
          : lastActivity === null
            ? "执行状态未确认：没有活动记录"
            : now - lastActivity > 60000
              ? "等待新活动：无法确认上游是否有效生成"
              : currentCall?.stdoutBytes === 0
                ? "近期仅有调用活动，尚无模型输出"
                : "近期有记录更新，生成进度以工件为准",
    milestones: {
      planned: Boolean(plan),
      generated: Boolean(
        scene || job.sceneIR || job.stages?.generate?.status === "passed",
      ),
      built: job.stages?.build?.status === "passed",
      visual: job.status === "passed" && job.quality?.status === "passed",
    },
    error: job.error ?? arr(job.quality?.reasons).join("；") ?? null,
  };
}
