import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalize, assetModelAttemptFolders } from "./model";
import { Source } from "./source";

const job = { id: "fixture", status: "running", stage: "assets", createdAt: 500,
  generationMethod: "general-geometry-v3", stageTrackingVersion: "exclusive-stages-v1",
  stages: { assets: { status: "running", startedAt: 1000 } }, events: [] };
const receipt = (durationMs: number, tokens: number) => ({ requestedModel: "fixture-model", stopReason: "completed", durationMs, usage: { cliReportedTokens: tokens } });
const execution = (startedAt: number, endedAt: number, status = "completed") => ({ status, startedAt, endedAt, durationMs: endedAt - startedAt });

test("voxel entity and geometry asset calls retain per-template assets semantics and every schema attempt", () => {
  const prefix = "generation/assets/chair/voxel-entity", old = "generation/assets/lamp/geometry-asset";
  const files = {
    "generation/checkpoints.json": { steps: [{ id: "chair", status: "running" }, { id: "lamp", status: "passed" }] },
    [prefix + "-attempts.json"]: [
      { index: 1, role: "voxel-entity", status: "failed", startedAt: 1000, endedAt: 2000, durationMs: 1000 },
      { index: 2, role: "voxel-entity", status: "running", startedAt: 3000 },
    ],
    "generation/assets/chair/attempts/voxel-entity/1/execution.json": execution(1000, 1900),
    "generation/assets/chair/attempts/voxel-entity/1/receipt.json": receipt(900, 11),
    [prefix + "-invalid-receipt.json"]: receipt(900, 11),
    [prefix + "-execution.json"]: { status: "running", startedAt: 3000, lastActivityAt: 3100 },
    [old + "-execution.json"]: execution(1100, 1500),
    [old + "-receipt.json"]: receipt(400, 7),
  };
  const result = normalize(job, files, 3500);
  expect(result.calls).toHaveLength(3);
  expect(result.assetModelCallCount).toBe(3);
  expect(result.calls.find(c => c.id === prefix)?.status).toBe("running");
  expect(result.calls.find(c => c.id === prefix + "/attempt-1")?.usage).toEqual({ cliReportedTokens: 11 });
  expect(result.calls.every(c => c.stage === "assets" && ["chair", "lamp"].includes(c.templateId))).toBe(true);
  expect(result.children.find(s => s.id === "asset:chair")).toMatchObject({ start: 1000, dependsOn: "materials" });
  expect(result.assets.find(s => s.id === "chair")?.attempts).toHaveLength(2);
  expect(Object.keys(files)).not.toContain(prefix + "/attempt-1");
});

test("transport retries replace the enclosing schema attempt rather than being counted twice", () => {
  const prefix = "generation/assets/chair/voxel-entity", archive = "generation/assets/chair/provider-attempts/voxel-entity/1";
  const result = normalize(job, {
    [prefix + "-attempts.json"]: [{ index: 1, status: "passed", startedAt: 1000, endedAt: 4100, durationMs: 3100 }],
    [prefix + "-recovery.json"]: { attempts: [
      { index: 1, status: "failed", startedAt: 1000, endedAt: 2500, durationMs: 1500, error: "PROVIDER_TIMEOUT" },
      { index: 2, status: "passed", startedAt: 3000, endedAt: 4000, durationMs: 1000 },
    ] },
    [archive + "/execution.json"]: execution(1000, 2000, "timed_out"),
    [archive + "/receipt.json"]: receipt(500, 99), // stale completed receipt must not invent timeout usage
    [prefix + "-execution.json"]: execution(3000, 4000),
    [prefix + "-receipt.json"]: receipt(1000, 17),
  }, 4500);
  expect(result.calls).toHaveLength(2);
  expect(result.assetModelCallCount).toBe(2);
  expect(result.calls.find(c => c.id.endsWith("provider-attempt-1"))).toMatchObject({ status: "timed_out", durationMs: 1000, usage: null });
  expect(result.calls.find(c => c.id === prefix)?.schemaAttempts).toHaveLength(1);
});

test("cache reuse, inherited calls and stale preflight evidence do not become current model calls", () => {
  const prefix = "generation/assets/chair/voxel-entity", old = "generation/assets/lamp/geometry-asset";
  const result = normalize(job, {
    "generation/checkpoints.json": { steps: [{ id: "lamp", status: "reused" }] },
    [old + "-receipt.json"]: receipt(2000, 99),
    [prefix + "-attempts.json"]: [{ index: 1, status: "blocked", startedAt: 5000, endedAt: 5100 }],
    [prefix + "-recovery.json"]: { attempts: [{ index: 1, status: "failed", startedAt: 5000, endedAt: 5100, error: "MODEL_BUDGET_EXHAUSTED" }] },
    [prefix + "-execution.json"]: execution(1000, 2000),
    [prefix + "-receipt.json"]: receipt(1000, 10),
    "generation/assets/cached/voxel-entity-attempts.json": [{ index: 1, status: "passed", reused: true, startedAt: 5000, endedAt: 5010 }],
    "generation/assets/cached/voxel-entity-receipt.json": { ...receipt(10, 999), reused: true },
  }, 5500);
  expect(result.assetModelCallCount).toBe(0);
  expect(result.assetModelCallCountUnknown).toBe(1);
  const blocked = result.calls.find(c => c.id === prefix);
  expect(blocked).toMatchObject({ invoked: false, usage: null });
  expect(blocked?.execution).toBeUndefined();
  expect(blocked?.receipt).toBeUndefined();
  expect(result.calls.find(c => c.id === old)?.historical).toBe(true);
});

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = mkdtempSync(join(tmpdir(), "voxel-observer-")); roots.push(root); return root; };
const save = (root: string, name: string, value: any) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), JSON.stringify(value)); };

test("source reads role-scoped receipts and archives, preserves normal log ids and does not write the run", () => {
  const root = temp(), id = "00000000-0000-4000-8000-000000000001", base = `runs/${id}`, prefix = "generation/assets/chair/voxel-entity";
  save(root, `${base}/job.json`, { ...job, id });
  save(root, `${base}/generation/checkpoints.json`, { steps: [{ id: "chair", status: "running" }] });
  save(root, `${base}/${prefix}-attempts.json`, [{ index: 1, status: "failed", startedAt: 1000, endedAt: 2000 }, { index: 2, status: "running", startedAt: 3000 }]);
  save(root, `${base}/generation/assets/chair/attempts/voxel-entity/1/execution.json`, execution(1000, 2000));
  save(root, `${base}/generation/assets/chair/attempts/voxel-entity/1/receipt.json`, receipt(1000, 11));
  writeFileSync(join(root, base, "generation/assets/chair/attempts/voxel-entity/1/response.txt"), "first rejected geometry");
  save(root, `${base}/${prefix}-execution.json`, { status: "running", startedAt: 3000 });
  writeFileSync(join(root, base, prefix + "-stdout.log"), "current native voxel tools");
  save(root, `${base}/generation/assets/unrelated/voxel-entity-receipt.json`, receipt(999, 999));
  const before = readFileSync(join(root, base, "job.json"), "utf8"), source = new Source(root), key = "run:" + id;
  expect(source.detail(key).assetModelCallCount).toBe(2);
  expect(source.call(key, prefix, "stdout").text).toBe("current native voxel tools");
  const archived = source.call(key, prefix + "/attempt-1", "response");
  expect(archived.text).toBe("first rejected geometry");
  expect(archived.file).toBe("generation/assets/chair/attempts/voxel-entity/1/response.txt");
  expect(() => source.call(key, "generation/assets/unrelated/voxel-entity", "response")).toThrow("当前记录");
  expect(readFileSync(join(root, base, "job.json"), "utf8")).toBe(before);
});

test("bounded per-template evidence reads do not drop later templates at the old 128-file snapshot cap", () => {
  const root = temp(), id = "00000000-0000-4000-8000-000000000002", base = `runs/${id}`;
  save(root, `${base}/job.json`, { ...job, id });
  const steps = Array.from({ length: 32 }, (_, i) => ({ id: `tpl_${i}`, status: "passed" }));
  save(root, `${base}/generation/checkpoints.json`, { steps });
  for (const s of steps) {
    const prefix = `${base}/generation/assets/${s.id}/voxel-entity`;
    save(root, prefix + "-attempts.json", [{ index: 1, status: "passed", startedAt: 1000, endedAt: 2000 }]);
    save(root, prefix + "-recovery.json", { attempts: [{ index: 1, status: "passed", startedAt: 1000, endedAt: 2000 }] });
    save(root, prefix + "-execution.json", execution(1000, 2000));
    save(root, prefix + "-receipt.json", receipt(1000, 1));
    save(root, `${base}/generation/assets/${s.id}/checkpoint.json`, { status: "passed", startedAt: 1000, endedAt: 2000 });
  }
  const detail = new Source(root).detail("run:" + id);
  expect(detail.io.reads).toBeGreaterThan(128);
  expect(detail.assetModelCallCount).toBe(32);
  expect(detail.calls).toHaveLength(32);
  expect(detail.warnings).toEqual([]);
});

test("selected repair folders preserve top-level logs and use their actual directory as the stable call id", () => {
  const root = temp(), id = "00000000-0000-4000-8000-000000000003", base = `runs/${id}`, asset = "generation/assets/chair", role = "voxel-entity";
  save(root, `${base}/job.json`, { ...job, id, status: "passed", endedAt: 4000 });
  save(root, `${base}/generation/checkpoints.json`, { steps: [{ id: "chair", status: "passed" }] });
  save(root, `${base}/${asset}/checkpoint.json`, { status: "passed", modelAttemptFolders: ["detail-repair-1", "detail-repair-1"] });
  for (const [folder, start] of [["", 1000], ["detail-repair-1/", 3000], ["not-selected/", 5000]] as const) {
    save(root, `${base}/${asset}/${folder}${role}-attempts.json`, [{ index: 1, status: "passed", startedAt: start, endedAt: start + 500 }]);
    save(root, `${base}/${asset}/${folder}${role}-execution.json`, execution(start, start + 500));
    save(root, `${base}/${asset}/${folder}${role}-receipt.json`, receipt(500, start));
    writeFileSync(join(root, base, asset, folder, role + "-response.txt"), folder || "original");
  }
  const before = readFileSync(join(root, base, asset, role + "-receipt.json"), "utf8"), source = new Source(root), key = "run:" + id, detail = source.detail(key);
  expect(detail.assetModelCallCount).toBe(2);
  expect(detail.calls.map(c => c.id)).toEqual([`${asset}/${role}`, `${asset}/detail-repair-1/${role}`]);
  expect(detail.assets[0].attempts).toHaveLength(2);
  expect(detail.calls.every(c => c.templateId === "chair" && c.stage === "assets")).toBe(true);
  expect(source.call(key, `${asset}/${role}`, "response").text).toBe("original");
  expect(source.call(key, `${asset}/detail-repair-1/${role}`, "response").text).toBe("detail-repair-1/");
  expect(readFileSync(join(root, base, asset, role + "-receipt.json"), "utf8")).toBe(before);
  expect(() => source.call(key, `${asset}/not-selected/${role}`, "response")).toThrow("当前记录");
});

test("repair folder declarations reject traversal, absolute paths, nested paths and more than two folders", () => {
  for (const folder of ["../other", "/tmp", "C:\\temp", "a/b", ".", "", "detail-repair-1/../other"])
    expect(assetModelAttemptFolders({ modelAttemptFolders: [folder] })).toMatchObject({ folders: [], warnings: [expect.any(String)] });
  expect(assetModelAttemptFolders({ modelAttemptFolders: ["a", "b", "c"] }).folders).toEqual([]);
  expect(assetModelAttemptFolders({ modelAttemptFolders: ["detail-repair-1", "detail-repair-2"] }).folders).toEqual(["detail-repair-1", "detail-repair-2"]);
  const prefix = "generation/assets/chair", result = normalize(job, {
    "generation/checkpoints.json": { steps: [{ id: "chair", status: "passed" }] },
    [prefix + "/checkpoint.json"]: { modelAttemptFolders: ["../lamp"] },
    [prefix + "/detail-repair-1/voxel-entity-receipt.json"]: receipt(500, 10),
    [prefix + "/../lamp/voxel-entity-receipt.json"]: receipt(500, 20),
  });
  expect(result.calls).toEqual([]);
  expect(result.adapterWarnings).toHaveLength(1);
});

test("an allowlisted repair name cannot follow a symlink into a sibling template", () => {
  const root = temp(), id = "00000000-0000-4000-8000-000000000004", base = `runs/${id}`, asset = "generation/assets/chair";
  save(root, `${base}/job.json`, { ...job, id });
  save(root, `${base}/generation/checkpoints.json`, { steps: [{ id: "chair", status: "passed" }] });
  save(root, `${base}/${asset}/checkpoint.json`, { modelAttemptFolders: ["detail-repair-1"] });
  save(root, `${base}/generation/assets/lamp/voxel-entity-receipt.json`, receipt(9999, 99));
  symlinkSync(join(root, base, "generation/assets/lamp"), join(root, base, asset, "detail-repair-1"));
  const detail = new Source(root).detail("run:" + id);
  expect(detail.assetModelCallCount).toBe(0);
  expect(detail.calls).toEqual([]);
  expect(detail.warnings.some(w => w.includes("符号链接"))).toBe(true);
});

test("a current repair on an inherited or cached asset counts the repair while excluding original source calls", () => {
  const asset = "generation/assets/chair", repair = `${asset}/detail-repair-1/voxel-entity`, original = `${asset}/voxel-entity`, currentJob = { ...job, createdAt: 2500, status: "passed", endedAt: 4000 };
  for (const cached of [false, true]) {
    const files = {
      "generation/checkpoints.json": { steps: [{ id: "chair", status: cached ? "passed" : "reused" }] },
      ...(!cached ? { "generation/resumed-from.json": { assets: [{ id: "chair" }] } } : {}),
      [asset + "/checkpoint.json"]: { status: "passed", startedAt: 1000, endedAt: 3500, durationMs: 2500,
        ...(cached ? { reusedFrom: { sourceJobId: "parent" } } : {}), modelAttemptFolders: ["detail-repair-1"], detailRepair: "voxel-detail-merge-feedback-v1" },
      [original + "-execution.json"]: execution(1000, 2000),
      [original + "-receipt.json"]: receipt(1000, 99),
      [repair + "-execution.json"]: execution(3000, 3500),
      [repair + "-receipt.json"]: receipt(500, 5),
    };
    const result = normalize(currentJob, files, 4500);
    expect(result.assetModelCallCount).toBe(1);
    expect(result.calls.find(c => c.id === original)?.historical).toBe(true);
    expect(result.calls.find(c => c.id === repair)?.historical).toBe(false);
    expect(result.children.find(s => s.id === "asset:chair")).toMatchObject({ status: "passed", start: 3000, durationMs: 500 });
    expect(result.assets[0]).toMatchObject({ status: "passed", sourceReused: true, currentRepair: true });
    const restoredAgain = normalize({ ...currentJob, createdAt: 10000, endedAt: 11000 }, files, 12000);
    expect(restoredAgain.assetModelCallCount).toBe(0);
    expect(restoredAgain.calls.every(c => c.historical)).toBe(true);
    expect(restoredAgain.children.find(s => s.id === "asset:chair")).toMatchObject({ status: "reused", start: null, durationMs: 0 });
  }
});
