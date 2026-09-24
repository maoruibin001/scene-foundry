import { callLog } from "./call-log";
import { Reader, safeId } from "./reader";
import { normalize, arr, timestamp, active, jobTiming } from "./model";
import { statSync } from "node:fs";
import { assetPreviewSvg } from "./asset-preview";
const FIXED = [
  "observer-progress.json",
  "generation/resumed-from.json",
  "plan.json",
  "scene-ir.json",
  "generated-scene.json",
  "reference-layout.json",
  "reference-observations.json",
  "structure.json",
  "quality.json",
  "review.json",
  "generation-brief.json",
  "materials/texture-provenance.json",
];
const FILE =
  /^(?:[a-zA-Z0-9_-]+-(?:execution|receipt|failure)\.json|space\.json|surface\.json|layout\.json|checkpoints\.json|repair-(?:goals|history)\.json)$/;
export class Source {
  reader: Reader;
  indexCache: any;
  indexAt = 0;
  detailCache = new Map<string, { at: number; value: any }>();
  constructor(root: string, private mediaPath = "/api/process/media") {
    this.reader = new Reader(root);
  }
  index(force = false) {
    if (!force && this.indexCache && Date.now() - this.indexAt < 15000)
      return this.indexCache;
    const r = this.reader.session(),
      items: any[] = [];
    try {
      this.reader.path("runs");
    } catch {
      throw Error("任务来源目录不可读，执行状态未确认");
    }
    const runs = this.reader.list("runs", 512),
      diagnostics = this.reader.list("diagnostics", 128);
    for (const id of runs) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      const j = r.json(`runs/${id}/job.json`);
      if (!j || typeof j !== "object") continue;
      items.push(this.row(j, `run:${id}`, "generation"));
    }
    for (const id of diagnostics) {
      if (!safeId(id)) continue;
      const p = r.json(`diagnostics/${id}/preflight.json`);
      if (!p?.candidate || !p?.sourceJob) continue;
      const result = r.json(`diagnostics/${id}/result.json`);
      let diagnosticStatus = result?.status;
      if (!diagnosticStatus) {
        const traces = this.reader
          .list(`diagnostics/${id}`, 96)
          .filter((f) => f.endsWith("-execution.json"))
          .map((f) => r.json(`diagnostics/${id}/${f}`))
          .filter(Boolean)
          .sort(
            (a, b) =>
              (timestamp(a.startedAt) ?? 0) - (timestamp(b.startedAt) ?? 0),
          );
        const last = traces.at(-1);
        diagnosticStatus =
          last?.status === "running"
            ? "running"
            : ["timed_out", "failed", "cancelled"].includes(last?.status)
              ? last.status
              : "unknown";
      }
      items.push(
        this.row(
          {
            ...p,
            ...result,
            id,
            createdAt: p.startedAt,
            status: diagnosticStatus,
            plan: { name: id },
            pipelineVersion: {
              id: p.candidate,
              label: `诊断 · ${p.candidate.slice(0, 8)}`,
            },
          },
          `diagnostic:${id}`,
          "diagnostic",
        ),
      );
    }
    items.sort(
      (a, b) => (timestamp(b.createdAt) ?? 0) - (timestamp(a.createdAt) ?? 0),
    );
    this.indexAt = Date.now();
    this.indexCache = {
      items,
      observedAt: new Date().toISOString(),
      active: items.filter((j) => active(j.status)).length,
      unknown: items.filter((j) => j.status === "unknown").length,
      total: items.length,
      warnings: [
        ...new Set([
          ...r.warnings,
          ...(runs.length >= 512
            ? ["任务目录达到 512 条上限；列表可能不完整"]
            : []),
          ...(diagnostics.length >= 128
            ? ["诊断目录达到 128 条上限；列表可能不完整"]
            : []),
        ]),
      ],
      io: r.stats(),
    };
    return this.indexCache;
  }
  row(j: any, key: string, kind: string) {
    return {
      key,
      id: j.id,
      kind,
      name:
        j.plan?.name ??
        j.sceneIR?.name ??
        (j.prompt?.slice(0, 36) || "未命名场景"),
      status: j.status ?? "unknown",
      stage: j.stage,
      createdAt: j.createdAt,
      ...jobTiming(j),
      version: j.pipelineVersion ?? null,
      score: j.quality?.score ?? null,
      error: j.error ?? null,
    };
  }
  locate(key: string) {
    const [kind, id, ...rest] = key.split(":");
    if (
      rest.length ||
      !safeId(id ?? "") ||
      !["run", "diagnostic"].includes(kind)
    )
      throw Error("无效记录");
    return {
      kind,
      id,
      base: `${kind === "run" ? "runs" : "diagnostics"}/${id}`,
    };
  }
  detail(key: string) {
    const cached = this.detailCache.get(key);
    if (cached && Date.now() - cached.at < 4000) return cached.value;
    const { kind, id, base } = this.locate(key),
      r = this.reader.session(),
      files: Record<string, any> = {};
    let job: any;
    if (kind === "run") job = r.json(`${base}/job.json`);
    else {
      const p = r.json(`${base}/preflight.json`),
        result = r.json(`${base}/result.json`);
      if (!p?.candidate || !p.sourceJob) throw Error("无诊断来源");
      const parent = r.json(`runs/${p.sourceJob}/job.json`);
      job = {
        ...p,
        ...result,
        id,
        kind: "diagnostic",
        prompt: parent?.prompt ?? "",
        images: parent?.images ?? [],
        plan: r.json(`${base}/plan.json`),
        createdAt: p.startedAt,
        modelSettings: p.model,
        pipelineVersion: {
          id: p.candidate,
          label: `诊断 · ${p.candidate.slice(0, 8)}`,
        },
        status: result?.status ?? "unknown",
        stages: {},
        events: [],
        sourceJob: p.sourceJob,
      };
    }
    if (!job) throw Error("记录暂不可读，稍后刷新");
    for (const name of FIXED) {
      const value = r.json(`${base}/${name}`);
      if (value) files[name] = value;
    }
    for (const folder of ["", "generation/", "generation/refinement/", "generation/blockout/0/", "generation/blockout/1/", "generation/blockout/2/", "generation/space-repair-1/", "generation/space-repair-2/", "generation/iteration-1/refinement/", "generation/iteration-2/refinement/"])
      for (const f of this.reader.list(`${base}/${folder}`, 96)) {
        if (FILE.test(f)) {
          const rel = folder + f,
            value = r.json(`${base}/${rel}`);
          if (value) files[rel] = value;
        }
      }
    const checkpoint =
      files["generation/checkpoints.json"] ?? files["checkpoints.json"];
    for (const s of arr(checkpoint?.steps).slice(0, 32)) {
      if (!safeId(s.id)) continue;
      for (const folder of ["generation/assets/", "assets/"]) {
        for (const f of [
          "checkpoint.json",
          "input.json",
          "geometry-asset-execution.json",
          "geometry-asset-receipt.json",
          "geometry-asset-failure.json",
        ]) {
          const rel = `${folder}${s.id}/${f}`,
            value = r.json(`${base}/${rel}`);
          if (value) files[rel] = value;
        }
      }
    }
    if (kind === "diagnostic") {
      const calls = Object.entries(files)
        .filter(([f]) => /-execution\.json$/.test(f))
        .sort(
          (a, b) =>
            (timestamp(a[1].startedAt) ?? 0) - (timestamp(b[1].startedAt) ?? 0),
        );
      for (const [f, e] of calls) {
        const stage = f.includes("scene-space")
          ? "space"
          : f.includes("scene-surface")
            ? "surface"
            : f.replace(/-execution\.json$/, "");
        job.stages[stage] = {
          ...e,
          status: e.status === "completed" ? "passed" : e.status,
        };
        job.stage = stage;
      }
      if (!job.stage) job.stage = "unknown";
      if (!r.json(`${base}/result.json`)) {
        const last = calls.at(-1)?.[1];
        job.status =
          last?.status === "running"
            ? "running"
            : ["timed_out", "failed", "cancelled"].includes(last?.status)
              ? last.status
              : "unknown";
      }
    }
    const model = normalize(job, files),
      artifacts: any[] = [];
    for (const asset of model.assets) {
      if (!safeId(asset.id)) continue;
      const rel = `${base}/generation/assets/${asset.id}/geometry.json`;
      const geometry = r.json(rel);
      asset.previewAvailable = geometry?.version === "asset-geometry-v1" && geometry.template?.id === asset.id;
      asset.materialIds = asset.previewAvailable
        ? [...new Set((geometry.template.parts ?? []).map((part: any) => part.material).filter((id: any) => typeof id === "string" && safeId(id)))]
        : [];
    }
    const add = (rel: string, label: string, stage: string, media = false) => {
      try {
        const st = statSync(this.reader.path(rel));
        if (st.isFile())
          artifacts.push({
            path: rel,
            label,
            stage,
            media,
            bytes: st.size,
            url: `${this.mediaPath}?path=${encodeURIComponent(rel)}`,
          });
      } catch {}
    };
    for (const im of arr(job.images ?? (job.image ? [job.image] : [])).slice(
      0,
      12,
    ))
      if (/^[a-f0-9]{64}\.(png|jpg|jpeg)$/.test(im.file))
        add(`uploads/${im.file}`, im.name ?? "参考图", "input", true);
    const runtimeImages = [...new Set([
      ...arr(job.runtime?.images),
      ...this.reader.list(`${base}/runtime`, 80).filter((f) => /\.(png|jpg|jpeg)$/.test(f)),
    ])].slice(0, 80);
    for (const f of runtimeImages)
      if (/^[\w.-]+\.(png|jpg|jpeg)$/.test(f))
        add(`${base}/runtime/${f}`, f, "runtime", true);
    for (const f of this.reader.list(`${base}/materials`, 80))
      if (/^[\w.-]+\.(png|jpg|jpeg)$/.test(f))
        add(`${base}/materials/${f}`, f, "materials", true);
    if (/^[\w.-]+\.webm$/.test(job.runtime?.video ?? ""))
      add(
        `${base}/runtime/${job.runtime.video}`,
        "Engine 场景录屏",
        "runtime",
        true,
      );
    const artifactsMeta = Object.keys(files).map((path) => ({
      path,
      sha256: this.reader.digest(`${base}/${path}`),
    }));
    const value = {
      ...model,
      files,
      artifacts,
      source: {
        replay: job.validationKind === "observer-test-replay",
        root: this.reader.root,
        key,
        record: `${base}/${kind === "run" ? "job.json" : "result.json"}`,
        recordSha256: this.reader.digest(
          `${base}/${kind === "run" ? "job.json" : "result.json"}`,
        ),
        pipeline: job.pipelineVersion,
        artifactDigests: artifactsMeta,
        observedAt: new Date().toISOString(),
        adapterVersion: "scene-observer-v1",
      },
      warnings: [...new Set([...r.warnings, ...model.adapterWarnings])],
      io: r.stats(),
    };
    if (this.detailCache.size >= 12)
      this.detailCache.delete(this.detailCache.keys().next().value!);
    this.detailCache.set(key, { at: Date.now(), value });
    return value;
  }
  call(key: string, call: string, stream: string) {
    const detail = this.detail(key);
    if (!detail.calls.some((entry: any) => entry.id === call)) throw Error("调用不属于当前记录");
    const { base } = this.locate(key);
    return { key, call, observedAt: new Date().toISOString(), ...callLog(this.reader, base, call, stream) };
  }
  assetPreview(key: string, assetId: string) {
    if (!safeId(assetId)) throw Error("无效资产");
    const { kind, base } = this.locate(key);
    if (kind !== "run") throw Error("诊断记录没有独立资产预览");
    const detail = this.detail(key);
    const asset = detail.assets.find((entry: any) => entry.id === assetId);
    if (!asset?.previewAvailable) throw Error("此资产尚无已保存的几何工件");
    const geometry = this.reader.session().json(`${base}/generation/assets/${assetId}/geometry.json`);
    if (geometry?.version !== "asset-geometry-v1" || geometry.template?.id !== assetId)
      throw Error("资产几何工件暂不可读");
    return assetPreviewSvg(geometry.template, detail.layout?.program?.materials ?? []);
  }
  // Media allowlist is derived from the selected record, never an arbitrary /files proxy.
  media(rel: string) {
    const found = [...this.detailCache.values()].some((c) =>
      c.value.artifacts.some((a: any) => a.path === rel),
    );
    if (!found) throw Error("请先打开对应任务");
    if (!/\.(png|jpg|jpeg|webm)$/.test(rel)) throw Error("不支持的媒体格式");
    const path = this.reader.path(rel),
      st = statSync(path);
    if (st.size > 40 * 1024 * 1024) throw Error("媒体超过 40 MiB 限额");
    return path;
  }
}
