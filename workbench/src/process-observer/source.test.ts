import { test, expect, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Reader } from "./reader";
import { Source } from "./source";
const roots: string[] = [];
const temp = () => {
  const p = mkdtempSync(join(tmpdir(), "scene-observer-test-"));
  roots.push(p);
  mkdirSync(join(p, "runs"));
  return p;
};
const save = (root: string, p: string, value: any) => {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), JSON.stringify(value));
};
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
test("unchanged snapshots read zero additional bytes; invalid partial write is unknown", () => {
  const root = temp();
  save(root, "runs/a.json", { v: 1 });
  const r = new Reader(root);
  expect(r.session().json("runs/a.json")).toEqual({ v: 1 });
  const s = r.session();
  s.json("runs/a.json");
  expect(s.stats().readBytes).toBe(0);
  writeFileSync(join(root, "runs/a.json"), '{"v":');
  const p = r.session();
  expect(p.json("runs/a.json")).toBe(null);
  expect(p.warnings.length).toBe(1);
  save(root, "runs/a.json", { v: 2 });
  expect(r.session().json("runs/a.json")).toEqual({ v: 2 });
});
test("caps file reads and rejects traversal / symlink escape", () => {
  const root = temp(),
    outside = temp();
  save(root, "small.json", { v: 1 });
  save(outside, "secret.json", { secret: true });
  symlinkSync(join(outside, "secret.json"), join(root, "link.json"));
  const r = new Reader(root);
  expect(() => r.path("../secret.json")).toThrow();
  expect(() => r.path("link.json")).toThrow();
  expect(r.session(1).json("small.json")).toBe(null);
  writeFileSync(join(root, "large.json"), " ".repeat(2 * 1024 * 1024 + 1));
  const s = r.session();
  expect(s.json("large.json")).toBe(null);
  expect(s.stats().readBytes).toBe(0);
});
test("source never mutates job files; media is scoped and API data contains no budgets", () => {
  const root = temp(),
    id = "00000000-0000-0000-0000-000000000000",
    file = `runs/${id}/job.json`;
  save(root, file, { id, status: "failed", stages: {}, events: [] });
  save(root, `runs/${id}/model-budget.json`, { secret: "not exposed" });
  const before = readFileSync(join(root, file), "utf8"),
    source = new Source(root);
  expect(source.index().items.length).toBe(1);
  const d = source.detail("run:" + id);
  expect(JSON.stringify(d)).not.toContain("not exposed");
  expect(() => source.media(`runs/${id}/model-budget.json`)).toThrow();
  expect(readFileSync(join(root, file), "utf8")).toBe(before);
  expect(() => source.detail("run:../../x")).toThrow();
});
test("asset previews are limited to saved geometry belonging to the selected run", () => {
  const root = temp(), id = "00000000-0000-0000-0000-000000000001";
  const base = `runs/${id}`;
  save(root, `${base}/job.json`, { id, status: "blocked", stages: {}, events: [] });
  save(root, `${base}/generation/checkpoints.json`, { steps: [{ id: "tpl_chair", label: "椅子", status: "passed" }] });
  save(root, `${base}/generation/layout.json`, { program: { materials: [{ id: "mat_a", color: [1, 0, 0, 1], roughness: 1, metallic: 0, textureId: null }] } });
  save(root, `${base}/generation/assets/tpl_chair/geometry.json`, { version: "asset-geometry-v1", template: {
    id: "tpl_chair", parts: [{ id: "seat", material: "mat_a", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], shape: { type: "box", size: [1, 1, 1], radius: 0 } }],
  } });
  const source = new Source(root), key = `run:${id}`;
  expect(source.detail(key).assets[0].previewAvailable).toBe(true);
  expect(source.detail(key).assets[0].materialIds).toEqual(["mat_a"]);
  expect(source.assetPreview(key, "tpl_chair")).toContain("<polygon");
  expect(() => source.assetPreview(key, "../job.json")).toThrow();
  expect(() => source.assetPreview(key, "tpl_other")).toThrow();
});
test("runtime screenshots appear as files arrive before the job receipt is complete", () => {
  const root = temp(), id = "00000000-0000-0000-0000-000000000002";
  save(root, `runs/${id}/job.json`, { id, status: "running", stage: "runtime", stages: {}, events: [] });
  mkdirSync(join(root, `runs/${id}/runtime`), { recursive: true });
  writeFileSync(join(root, `runs/${id}/runtime/capture-1.png`), "png-bytes");
  const source = new Source(root), detail = source.detail(`run:${id}`);
  expect(detail.artifacts.map((artifact: any) => artifact.label)).toContain("capture-1.png");
});
test("diagnostic timeout is independent of source job and has no quality inheritance", () => {
  const root = temp();
  save(root, "diagnostics/probe/preflight.json", {
    candidate: "abc",
    sourceJob: "a",
    startedAt: 1000,
    model: { model: "model-x" },
  });
  save(root, "diagnostics/probe/result.json", {
    status: "failed",
    error: "timeout",
    durationMs: 480000,
  });
  save(root, "diagnostics/probe/scene-space-execution.json", {
    status: "timed_out",
    startedAt: 1000,
    endedAt: 481000,
    durationMs: 480000,
    stdoutBytes: 0,
  });
  const source = new Source(root);
  expect(source.index().items[0].kind).toBe("diagnostic");
  const d = source.detail("diagnostic:probe");
  expect(d.calls[0].status).toBe("timed_out");
  expect(d.milestones.visual).toBe(false);
  expect(d.totalMs).toBe(480000);
});

test("source loss is unknown rather than a false empty idle list", () => {
  const root = temp();
  const source = new Source(root);
  source.index();
  rmSync(join(root, "runs"), { recursive: true });
  expect(() => source.index(true)).toThrow("执行状态未确认");
});

test("diagnostic running trace is visible in list without inventing a successful result", () => {
  const root = temp();
  save(root, "diagnostics/probe/preflight.json", {
    candidate: "v",
    sourceJob: "j",
    startedAt: 1000,
  });
  save(root, "diagnostics/probe/scene-space-execution.json", {
    status: "running",
    startedAt: 1000,
    lastActivityAt: 2000,
  });
  const source = new Source(root);
  expect(source.index().active).toBe(1);
  expect(source.detail("diagnostic:probe").job.status).toBe("running");
});

test("全局修正与自动修正调用可在执行过程里读取，不遗漏嵌套目录",()=>{
 const root=temp(),id='00000000-0000-0000-0000-000000000000';save(root,`runs/${id}/job.json`,{id,status:'running',stage:'repair',stages:{repair:{status:'running',startedAt:1000}},events:[],refineScene:true,generationMethod:'general-geometry-v3'});
 for(const folder of ['generation/refinement','generation/iteration-1/refinement','generation/iteration-2/refinement'])save(root,`runs/${id}/${folder}/scene-refine-execution.json`,{status:'running',startedAt:'2026-09-23T12:00:00Z',pid:1,lastActivityAt:'2026-09-23T12:00:01Z'});
 const d=new Source(root).detail('run:'+id);expect(d.calls.filter(c=>c.id.includes('scene-refine'))).toHaveLength(3);
});

test("目标选择工件随原始与自动修正轮次读取，过程页可查看真实输出",()=>{
 const root=temp(),id="11111111-1111-4111-8111-111111111111";
 save(root,`runs/${id}/job.json`,{id,status:"running",stage:"generate",stages:{generate:{status:"running",startedAt:1000}},profile:{version:"5.4"},events:[]});
 for(const folder of ["generation/refinement","generation/iteration-1/refinement","generation/iteration-2/refinement"]){
  save(root,`runs/${id}/${folder}/repair-goals.json`,{version:"scene-repair-goals-v1",goals:[{id:"G1"}]});
  save(root,`runs/${id}/${folder}/repair-history.json`,{version:"repair-history-v1",attempts:[{scoreGain:-1}]});
  save(root,`runs/${id}/${folder}/scene-repair-plan-execution.json`,{status:"completed",startedAt:1000,endedAt:2000,durationMs:1000});
 }
 const d=new Source(root).detail("run:"+id);expect(Object.keys(d.files).filter(k=>k.endsWith("repair-goals.json"))).toHaveLength(3);expect(Object.keys(d.files).filter(k=>k.endsWith("repair-history.json"))).toHaveLength(3);expect(d.children.find(s=>s.id==="scene-repair-plan").status).toBe("passed");
});
