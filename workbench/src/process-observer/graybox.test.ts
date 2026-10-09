import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync, truncateSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Source } from "./source";
import { displayFrames, referenceFrame, grayboxSummary, grayboxView } from "../../public/process/graybox-view.js";

const roots: string[] = [], id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(passed = false) {
  const root = mkdtempSync(join(tmpdir(), "graybox-observer-")); roots.push(root);
  const base = `runs/${id}`, rounds: any[] = [];
  const save = (file: string, data: any) => {
    const path = join(root, base, file); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  };
  const space = { version: "scene-space-v1", program: { instances: [{ id: "wall", template: "tpl_wall", position: [0, 2, 0] }] }, cameras: [{ name: "参考机位", position: [0, -4, 2], target: [0, 2, 0] }] };
  const scene = { ...space, version: "scene-v1", program: { ...space.program, templates: [{ id: "tpl_wall", parts: [] }], materials: [] } };
  for (let round = 0; round < 3; round++) {
    const folder = `generation/blockout/${round}`, manifest = { round, engine: "engine-pin" }, hash = sha(JSON.stringify(manifest));
    const basis = { jobId: id, round, folder: join(root, base, folder), score: round === 1 ? passed ? 3.8 : 3.4 : 3.2, passed: round === 1 && passed, runtimeDigest: hash };
    const gate = { round, path: folder, passed: basis.passed, runtimeDigest: hash, frames: ["reference-1.png"], threshold: { space: 3.5 }, review: { score: basis.score, summary: "主体关系尚待核对" }, selection: { eligible: true, changed: true, retained: basis } };
    rounds.push(gate); save(`${folder}/gate.json`, gate); save(`${folder}/space.json`, space); save(`${folder}/scene.json`, scene);
    save(`${folder}/project/game/dist/forgeax-dist.json`, manifest);
    save(`${folder}/project/evidence/run-report.json`, { engineSha: "engine-pin", generatorSha: "generator-pin", distManifestDigest: hash,
      stages: Object.fromEntries(["engine-build", "asset-verify", "asset-ready", "engine-status"].map(name => [name, { status: "passed" }])) });
    save(`${folder}/runtime/runtime.json`, { distManifestDigest: hash, hard: { runtime: true, noErrors: true, entitiesLoaded: true },
      images: ["reference-1.png", "inspection-2.png"], hashes: [sha(`reference-${round}`), sha(`inspection-${round}`)], referenceFrames: [{ file: "reference-1.png", referenceIndex: 1 }, { file: "inspection-2.png", referenceIndex: null }] });
    writeFileSync(join(root, base, folder, "runtime/reference-1.png"), `reference-${round}`);
    writeFileSync(join(root, base, folder, "runtime/inspection-2.png"), `inspection-${round}`);
  }
  const job: any = { id, status: "failed", stage: "graybox", profile: { version: "5.4", engineSha: "engine-pin", generatorSha: "generator-pin" },
    images: [{ name: "原图" }], events: [], stages: {}, generationMethod: "general-geometry-v3", blockout: { status: "stopped", currentRound: 2, repairBasis: rounds[1].selection.retained, rounds } };
  save("job.json", job);
  return { root, base, job, save, source: new Source(root), key: `run:${id}` };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("retained round owns layout, frames and score; newer failed rounds cannot replace it", () => {
  const f = fixture(), before = readFileSync(join(f.root, f.base, "job.json"), "utf8"), d = f.source.detail(f.key);
  expect(d.graybox?.round).toBe(1); expect(d.graybox?.score).toBe(3.4); expect(d.graybox?.status).toBe("not_met");
  expect(d.graybox?.source.layout).toBe("generation/blockout/1/space.json");
  expect(d.graybox?.scene.cameras).toEqual(d.graybox?.space.cameras);
  expect(d.artifacts).toHaveLength(2); expect(d.artifacts.every(a => a.path.includes("/blockout/1/"))).toBe(true);
  expect(d.milestones.grayboxGenerated).toBe(true); expect(d.milestones.generated).toBe(false); expect(d.milestones.visual).toBe(false);
  expect(d.count.completed).toBeNull(); expect(d.count.total).toBeNull();
  expect(readFileSync(join(f.root, f.base, "job.json"), "utf8")).toBe(before);
  expect(f.source.media(d.artifacts[0].path)).toBe(realpathSync(join(f.root, d.artifacts[0].path)));
  expect(() => f.source.media(`${f.base}/generation/blockout/2/runtime/reference-1.png`)).toThrow();
});

test("unchanged graybox polling reads no new JSON or screenshot bytes", () => {
  const f = fixture(), first = f.source.detail(f.key);
  expect(first.io.mediaReadBytes).toBeGreaterThan(0);
  f.source.detailCache.clear(); const second = f.source.detail(f.key);
  expect(second.io.readBytes).toBe(0); expect(second.io.mediaReadBytes).toBe(0); expect(second.graybox?.round).toBe(1);
});

test("a spatially accepted graybox never becomes a visually accepted full scene", () => {
  const f = fixture(true), d = f.source.detail(f.key);
  expect(d.graybox?.status).toBe("passed"); expect(d.milestones.generated).toBe(false); expect(d.milestones.built).toBe(false); expect(d.milestones.visual).toBe(false);
  expect(grayboxSummary(d.graybox)).toContain("成品验收尚未完成");
});

test("captures before spatial judging are visible with an unreviewed verdict", () => {
  const f = fixture(); delete f.job.blockout.repairBasis; f.job.blockout.currentRound = 0; f.job.status = "running";
  f.save("job.json", f.job); unlinkSync(join(f.root, f.base, "generation/blockout/0/gate.json"));
  const d = f.source.detail(f.key);
  expect(d.graybox?.round).toBe(0); expect(d.graybox?.status).toBe("unreviewed"); expect(d.graybox?.score).toBeNull();
  expect(d.artifacts).toHaveLength(2); expect(grayboxSummary(d.graybox)).toContain("空间验收待完成");
});

test("missing retained evidence reports unknown without silently serving the last round", () => {
  const f = fixture(); unlinkSync(join(f.root, f.base, "generation/blockout/1/scene.json"));
  const d = f.source.detail(f.key);
  expect(d.graybox).toBeNull(); expect(d.artifacts).toHaveLength(0); expect(d.warnings.join()).toContain("证据不完整");
});

test("a foreign recovery basis cannot authorize another job's media", () => {
  const f = fixture(); f.job.blockout.repairBasis.jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; f.save("job.json", f.job);
  const d = f.source.detail(f.key);
  expect(d.graybox).toBeNull(); expect(d.artifacts).toHaveLength(0); expect(d.warnings.join()).toContain("不属于当前任务");
});

test("a gate from another score or scene cannot be paired with retained frames", () => {
  const f = fixture(); f.save("generation/blockout/1/gate.json", { ...f.job.blockout.rounds[1], review: { score: 4.5 } });
  const d = f.source.detail(f.key);
  expect(d.graybox).toBeNull(); expect(d.warnings.join()).toContain("空间评分"); expect(d.milestones.visual).toBe(false);
});

test("changed screenshots invalidate the read-only snapshot even after a warm hash cache", () => {
  const f = fixture(); expect(f.source.detail(f.key).graybox).not.toBeNull();
  writeFileSync(join(f.root, f.base, "generation/blockout/1/runtime/reference-1.png"), "changed-frame"); f.source.detailCache.clear();
  const d = f.source.detail(f.key); expect(d.graybox).toBeNull(); expect(d.warnings.join()).toContain("截图摘要不匹配");
});

test("screenshot symlink escapes and oversized media are rejected before hashing", () => {
  const f = fixture(), outside = fixture(), path = join(f.root, f.base, "generation/blockout/1/runtime/reference-1.png");
  unlinkSync(path); symlinkSync(join(outside.root, outside.base, "generation/blockout/1/runtime/reference-1.png"), path);
  expect(f.source.detail(f.key).warnings.join()).toContain("符号链接越界");
  unlinkSync(path); writeFileSync(path, ""); truncateSync(path, 40 * 1024 * 1024 + 1); f.source.detailCache.clear();
  const d = f.source.detail(f.key); expect(d.graybox).toBeNull(); expect(d.io.mediaReadBytes).toBe(0); expect(d.warnings.join()).toContain("40 MiB");
});

test("layout cameras must match the scene that produced the observed frames", () => {
  const f = fixture(); f.save("generation/blockout/1/space.json", { version: "scene-space-v1", program: { instances: [] }, cameras: [] });
  const d = f.source.detail(f.key); expect(d.graybox).toBeNull(); expect(d.warnings.join()).toContain("空间与机位");
});

test("reference comparison uses explicit bindings and preserves full-scene frame precedence", () => {
  const f = fixture(), d = f.source.detail(f.key), frames = displayFrames(d);
  expect(referenceFrame(frames, 0)?.file).toBe("reference-1.png"); expect(referenceFrame(frames, 1)).toBeNull();
  const scene = { stage: "runtime", path: "runtime/reference-view-1.png", label: "reference-view-1.png" };
  expect(displayFrames({ artifacts: [...d.artifacts, scene] })).toEqual([scene]); expect(referenceFrame([scene], 0)).toEqual(scene);
  const html = grayboxView(d, a => `<img src="${a.url}">`);
  expect(html).toContain("第 2 轮"); expect(html).toContain("空间验收未通过"); expect(html).toContain("成品验收尚未完成"); expect(html).toContain("blockout%2F1%2F");
});

test("ambiguous reference bindings stay unknown and producer text is escaped", () => {
  const f = fixture(), file = "generation/blockout/1/runtime/runtime.json";
  const runtime = JSON.parse(readFileSync(join(f.root, f.base, file), "utf8"));
  runtime.referenceFrames.push({ file: "inspection-2.png", referenceIndex: 1 }); f.save(file, runtime);
  const d = f.source.detail(f.key); expect(referenceFrame(displayFrames(d), 0)).toBeNull();
  expect(grayboxSummary({ ...d.graybox, limitation: "<script>bad</script>" })).not.toContain("<script>");
});

test('explicit diagnosed foreign basis stays source evidence and never becomes current output or a false corruption warning',()=>{
 const f=fixture(),child='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',base=`runs/${child}`;
 mkdirSync(join(f.root,base),{recursive:true});
 const job={...f.job,id:child,status:'running',stage:'space',spatialRepairSource:{jobId:id,round:1},spatialDiagnosis:{sourceJobId:id,sourceRound:1},blockout:{...f.job.blockout,rounds:[]}};
 writeFileSync(join(f.root,base,'job.json'),JSON.stringify(job));
 const source=new Source(f.root),detail=source.detail('run:'+child);
 expect(detail.graybox).toBeNull();expect(detail.artifacts).toHaveLength(0);expect(detail.warnings.join()).not.toContain('选优来源不属于');
 expect(detail.milestones.grayboxGenerated).toBe(false);expect(detail.milestones.visual).toBe(false);
 expect(()=>source.media(`${f.base}/generation/blockout/1/runtime/reference-1.png`)).toThrow();
 job.spatialDiagnosis.sourceRound=0;writeFileSync(join(f.root,base,'job.json'),JSON.stringify(job));source.detailCache.clear();expect(source.detail('run:'+child).warnings.join()).toContain('选优来源不属于');
});
