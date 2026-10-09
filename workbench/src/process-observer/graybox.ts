import { Reader } from "./reader";
import { realpathSync } from "node:fs";

const list = (value: any): any[] => Array.isArray(value) ? value : [];
const roundId = (value: any) => Number.isSafeInteger(value) && value >= 0;
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const instances = (scene: any) => list(scene?.program?.instances).map(({ surfaceOverrides, ...pose }) => pose);
const imageName = (value: any) => typeof value === "string" && /^[\w.-]+\.(png|jpg|jpeg)$/.test(value);
const digest = (value: any) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Observe the producer's retained round. Never re-rank rounds or promote a draft. */
export function grayboxSnapshot(job: any, base: string, reader: Reader, session: ReturnType<Reader["session"]>, files: Record<string, any>) {
  const blockout = job.blockout, basis = blockout?.repairBasis;
  const round = basis ? basis.round : blockout?.currentRound;
  if (!blockout || !roundId(round)) return { value: null, warnings: [] };
  // A diagnosed continuation retains a foreign source as its basis, not as this job's own output.
  if(basis?.jobId!==undefined&&basis.jobId!==job.id&&job.spatialRepairSource?.jobId===basis.jobId&&job.spatialRepairSource?.round===round&&job.spatialDiagnosis?.sourceJobId===basis.jobId&&job.spatialDiagnosis?.sourceRound===round)return {value:null,warnings:[]};
  const folder = `generation/blockout/${round}`, prefix = `${base}/${folder}`;
  try {
    if (basis && (basis.jobId !== job.id || typeof basis.folder !== "string" ||
      realpathSync(basis.folder) !== reader.path(prefix))) throw Error("选优来源不属于当前任务和轮次");
    const load = (name: string) => {
      const key = `${folder}/${name}`, value = session.json(`${base}/${key}`);
      if (value) files[key] = value;
      return value;
    };
    const space = load("space.json"), scene = load("scene.json"), gate = load("gate.json");
    const runtime = load("runtime/runtime.json"), report = load("project/evidence/run-report.json");
    const manifest = load("project/game/dist/forgeax-dist.json");
    if (!space || !scene || !runtime || !report || !manifest) {
      if (basis) throw Error("保留灰模的布局或 Engine 证据不完整");
      return { value: null, warnings: [] };
    }
    if (space.version !== "scene-space-v1" || scene.version !== "scene-v1" ||
      !Array.isArray(scene.program?.templates) || !Array.isArray(scene.program?.instances) ||
      !same(instances(space), instances(scene)) || !same(space.cameras, scene.cameras)) throw Error("布局和灰模几何不属于同一空间与机位");
    const runtimeDigest = reader.digest(`${prefix}/project/game/dist/forgeax-dist.json`);
    if (!digest(runtimeDigest) || runtime.distManifestDigest !== runtimeDigest || report.distManifestDigest !== runtimeDigest ||
      typeof job.profile?.engineSha !== "string" || typeof job.profile?.generatorSha !== "string" ||
      report.engineSha !== job.profile?.engineSha || report.generatorSha !== job.profile?.generatorSha ||
      ["engine-build", "asset-verify", "asset-ready", "engine-status"].some(key => report.stages?.[key]?.status !== "passed") ||
      !runtime.hard?.runtime || !runtime.hard?.noErrors || !runtime.hard?.entitiesLoaded) throw Error("Engine 构建、运行或来源摘要不匹配");
    if (basis) {
      const rows = list(blockout.rounds).filter(row => row.round === round), retained = gate?.selection?.retained;
      if (!gate || rows.length !== 1 || !same(rows[0], gate) || !gate.selection?.eligible || !gate.selection?.changed ||
        retained?.jobId !== job.id || retained?.round !== round ||
        retained?.score !== basis.score || retained?.passed !== basis.passed || retained?.runtimeDigest !== basis.runtimeDigest ||
        gate.review?.score !== basis.score || gate.passed !== basis.passed || gate.runtimeDigest !== basis.runtimeDigest ||
        runtimeDigest !== basis.runtimeDigest || !Number.isFinite(basis.score) || typeof basis.passed !== "boolean" ||
        !list(gate.frames).length || !list(gate.frames).every(file => list(runtime.images).includes(file))) throw Error("选优记录、空间评分与保留画面不匹配");
    }
    const names = list(runtime.images), hashes = list(runtime.hashes);
    if (!names.length || names.length > 80 || names.length !== hashes.length || new Set(names).size !== names.length ||
      !names.every(imageName) || !hashes.every(digest)) throw Error("Engine 截图回执不完整");
    const frames = names.map((file, index) => {
      const path = `${prefix}/runtime/${file}`;
      if (reader.mediaDigest(path) !== hashes[index]) throw Error("Engine 截图摘要不匹配");
      const refs = list(runtime.referenceFrames).filter(entry => entry.file === file && Number.isSafeInteger(entry.referenceIndex) && entry.referenceIndex > 0 && entry.referenceIndex <= list(job.images).length);
      // Ambiguous bindings remain unknown; no pairing based on display labels.
      const referenceIndex = refs.length === 1 && list(runtime.referenceFrames).filter(entry => entry.referenceIndex === refs[0].referenceIndex).length === 1 ? refs[0].referenceIndex : null;
      return { file, path, referenceIndex };
    });
    const status = basis ? basis.passed ? "passed" : "not_met" : "unreviewed";
    return { value: {
      kind: "graybox", round, folder, retained: Boolean(basis), status,
      score: basis ? basis.score : null, threshold: basis ? gate.threshold?.space ?? null : null,
      scene, space, gate: basis ? gate : null, frames, runtimeDigest,
      source: { jobId: job.id, scene: `${folder}/scene.json`, layout: `${folder}/space.json`, runtime: `${folder}/runtime/runtime.json`, gate: basis ? `${folder}/gate.json` : null },
      limitation: "空间灰模；详细资产和成品验收尚未完成，空间评分不代表成品评分",
    }, warnings: [] };
  } catch (error) {
    return { value: null, warnings: [`灰模第 ${round + 1} 轮资料未核实：${String(error)}`] };
  }
}
