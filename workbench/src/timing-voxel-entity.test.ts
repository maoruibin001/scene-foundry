import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { timingSnapshot } from "./timing-snapshot";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = mkdtempSync(join(tmpdir(), "voxel-timing-")); roots.push(root); return root; };
const save = (root: string, name: string, value: any) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), JSON.stringify(value)); };
const receipt = (durationMs: number) => ({ requestedModel: "fixture", stopReason: "completed", durationMs });
const job = { id: "fixture", status: "passed", stage: "assets", createdAt: new Date(500).toISOString(), endedAt: 6000, stages: {} };

test("mixed entity and historical geometry roles count every receipt once and use entity execution as the asset time fallback", () => {
  const root = temp(), asset = "generation/assets/chair/";
  save(root, "generation/checkpoints.json", { steps: [{ id: "chair", status: "passed" }] });
  save(root, asset + "geometry-asset-receipt.json", receipt(400));
  save(root, asset + "voxel-entity-attempts.json", [{ index: 1, status: "failed", startedAt: 1000, endedAt: 2000 }, { index: 2, status: "passed", startedAt: 3000, endedAt: 4000 }]);
  save(root, asset + "attempts/voxel-entity/1/receipt.json", receipt(900));
  save(root, asset + "voxel-entity-invalid-receipt.json", receipt(900));
  save(root, asset + "voxel-entity-receipt.json", receipt(800));
  save(root, asset + "voxel-entity-execution.json", { status: "completed", startedAt: 3000, endedAt: 3800, durationMs: 800 });
  const result = timingSnapshot(job, root);
  expect(result.assets[0].attempts).toHaveLength(3);
  expect(result.assets[0].modelCallCount).toBe(3);
  expect(result.assetModelCallCount).toBe(3);
  expect(result.assetModelCallMs).toBe(2100);
  expect(result.assets[0].start).toBe(1000);
  expect(result.assets[0].end).toBeNull(); // historical receipt lacks timestamps; no complete span is invented
  expect(result.assets[0].attempts.filter(a => a.role === "voxel-entity").map(a => a.status)).toEqual(["failed", "passed"]);
  expect(result.assets[0].attempts.find(a => a.role === "geometry-asset")?.status).toBe("passed");
});

test("model call time comes from transport evidence and excludes recovery backoff inside a validation attempt", () => {
  const root = temp(), asset = "generation/assets/chair/";
  save(root, "generation/checkpoints.json", { steps: [{ id: "chair", status: "passed" }] });
  save(root, asset + "checkpoint.json", { status: "passed", readyAt: 500, startedAt: 1000, endedAt: 4500, durationMs: 3500 });
  save(root, asset + "voxel-entity-attempts.json", [{ index: 1, status: "passed", startedAt: 1000, endedAt: 4500, durationMs: 3500 }]);
  save(root, asset + "voxel-entity-recovery.json", { attempts: [{ index: 1, status: "failed", error: "PROVIDER_TIMEOUT", startedAt: 1000, endedAt: 2500 }, { index: 2, status: "passed", startedAt: 3000, endedAt: 4000 }] });
  save(root, asset + "provider-attempts/voxel-entity/1/execution.json", { status: "timed_out", startedAt: 1000, endedAt: 2000, durationMs: 1000 });
  save(root, asset + "voxel-entity-execution.json", { status: "completed", startedAt: 3000, endedAt: 4000, durationMs: 1000 });
  save(root, asset + "voxel-entity-receipt.json", receipt(1000));
  const result = timingSnapshot(job, root);
  expect(result.assets[0].attempts).toHaveLength(2);
  expect(result.assetModelCallCount).toBe(2);
  expect(result.assetModelCallMs).toBe(2000);
  expect(result.assetWorkMs).toBe(3500);
  expect(result.assets[0].queueMs).toBe(500);
});

test("reused geometry and missing call receipts never become paid calls or fabricated usage time", () => {
  const root = temp();
  save(root, "generation/checkpoints.json", { steps: [{ id: "old", status: "reused" }, { id: "blocked", status: "failed" }, { id: "cached", status: "passed" }] });
  save(root, "generation/assets/old/geometry-asset-receipt.json", receipt(9999));
  save(root, "generation/assets/blocked/voxel-entity-attempts.json", [{ index: 1, status: "blocked", error: "MODEL_BUDGET_EXHAUSTED", startedAt: 1000, endedAt: 1100 }]);
  save(root, "generation/assets/cached/voxel-entity-attempts.json", [{ index: 1, status: "passed", reused: true, startedAt: 1000, endedAt: 1100 }]);
  save(root, "generation/assets/cached/voxel-entity-receipt.json", { ...receipt(100), reused: true });
  const result = timingSnapshot(job, root);
  expect(result.assets[0]).toMatchObject({ durationMs: 0, modelCallCount: 0, attempts: [] });
  expect(result.assetModelCallCount).toBe(0);
  expect(result.assetModelCallCountUnknown).toBe(1);
  expect(result.assetModelCallMs).toBeNull();
});

test("one sibling collision repair adds its own model call and time without replacing or double-counting the original", () => {
  const root = temp(), asset = "generation/assets/chair/";
  save(root, "generation/checkpoints.json", { steps: [{ id: "chair", status: "passed" }] });
  save(root, asset + "checkpoint.json", { status: "passed", startedAt: 1000, endedAt: 4500, durationMs: 3500, modelAttemptFolders: ["detail-repair-1", "detail-repair-1"] });
  for (const [folder, start, duration] of [["", 1000, 1000], ["detail-repair-1/", 3000, 500], ["not-selected/", 4000, 100]] as const) {
    save(root, asset + folder + "voxel-entity-attempts.json", [{ index: 1, status: "passed", startedAt: start, endedAt: start + duration }]);
    save(root, asset + folder + "voxel-entity-execution.json", { status: "completed", startedAt: start, endedAt: start + duration, durationMs: duration });
    save(root, asset + folder + "voxel-entity-receipt.json", receipt(duration));
  }
  const result = timingSnapshot(job, root);
  expect(result.assetModelCallCount).toBe(2);
  expect(result.assetModelCallMs).toBe(1500);
  expect(result.assetWorkMs).toBe(3500);
  expect(result.assets[0].attempts.map(a => a.id)).toEqual([asset + "voxel-entity", asset + "detail-repair-1/voxel-entity"]);
  expect(result.assets[0].attemptFolderWarnings).toEqual([]);
});

test("invalid repair folder metadata does not read another template or an undeclared repair", () => {
  const root = temp(), asset = "generation/assets/chair/";
  save(root, "generation/checkpoints.json", { steps: [{ id: "chair", status: "passed" }] });
  save(root, asset + "checkpoint.json", { status: "passed", modelAttemptFolders: ["../lamp", "/tmp"] });
  save(root, "generation/assets/lamp/voxel-entity-receipt.json", receipt(9999));
  save(root, asset + "detail-repair-1/voxel-entity-receipt.json", receipt(9999));
  const result = timingSnapshot(job, root);
  expect(result.assetModelCallCount).toBe(0);
  expect(result.assets[0].attempts).toEqual([]);
  expect(result.assets[0].attemptFolderWarnings).toHaveLength(1);
});

test("timing rejects an allowlisted name that resolves through a sibling-template symlink", () => {
  const root = temp(), asset = "generation/assets/chair/";
  save(root, "generation/checkpoints.json", { steps: [{ id: "chair", status: "passed" }] });
  save(root, asset + "checkpoint.json", { modelAttemptFolders: ["detail-repair-1"] });
  save(root, "generation/assets/lamp/voxel-entity-receipt.json", receipt(9999));
  symlinkSync(join(root, "generation/assets/lamp"), join(root, asset, "detail-repair-1"));
  const result = timingSnapshot(job, root);
  expect(result.assetModelCallCount).toBe(0);
  expect(result.assets[0].attempts).toEqual([]);
  expect(result.assets[0].attemptFolderWarnings).toHaveLength(1);
});

test("repairing an inherited or cached asset counts only the new repair and leaves copied historical repairs reused", () => {
  for (const cached of [false, true]) {
    const root = temp(), asset = "generation/assets/chair/", currentJob = { ...job, createdAt: new Date(2500).toISOString(), endedAt: 4500 };
    save(root, "generation/checkpoints.json", { steps: [{ id: "chair", status: cached ? "passed" : "reused" }] });
    if (!cached) save(root, "generation/resumed-from.json", { assets: [{ id: "chair" }] });
    save(root, asset + "checkpoint.json", { status: "passed", startedAt: 1000, endedAt: 3500, durationMs: 2500,
      ...(cached ? { reusedFrom: { sourceJobId: "parent" } } : {}), modelAttemptFolders: ["detail-repair-1"], detailRepair: "voxel-detail-merge-feedback-v1" });
    for (const [folder, start, duration] of [["", 1000, 1000], ["detail-repair-1/", 3000, 500]] as const) {
      save(root, asset + folder + "voxel-entity-attempts.json", [{ index: 1, status: "passed", startedAt: start, endedAt: start + duration }]);
      save(root, asset + folder + "voxel-entity-execution.json", { status: "completed", startedAt: start, endedAt: start + duration, durationMs: duration });
      save(root, asset + folder + "voxel-entity-receipt.json", receipt(duration));
    }
    const result = timingSnapshot(currentJob, root);
    expect(result.assets[0]).toMatchObject({ reused: false, status: "passed", start: 3000, end: 3500, durationMs: 500, modelCallCount: 1, modelCallMs: 500 });
    expect(result.assetModelCallCount).toBe(1);
    expect(result.assetModelCallMs).toBe(500);
    expect(result.assetWorkMs).toBe(500);
    expect(result.assets[0].attempts.find(a => a.id === asset + "voxel-entity")?.historical).toBe(true);
    const restoredAgain = timingSnapshot({ ...currentJob, createdAt: new Date(10000).toISOString(), endedAt: 11000 }, root);
    expect(restoredAgain.assets[0]).toMatchObject({ reused: true, durationMs: 0, modelCallCount: 0, attempts: [] });
    expect(restoredAgain.assetWorkMs).toBe(0);
    expect(restoredAgain.assetModelCallCount).toBe(0);
  }
});
