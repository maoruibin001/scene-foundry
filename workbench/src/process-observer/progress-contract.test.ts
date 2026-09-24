import { test, expect } from "bun:test";
import { validateProgress } from "./progress-contract";
import { normalize } from "./model";
const job = {
  id: "j",
  pipelineVersion: { id: "v" },
  status: "running",
  stage: "scan",
  createdAt: "2026-09-23T00:00:00Z",
};
const snap = {
  schemaVersion: "scene-progress-v1",
  jobId: "j",
  pipelineVersionId: "v",
  updatedAt: "2026-09-23T00:01:00Z",
  stages: [
    {
      id: "scan",
      label: "识别物体",
      dependsOn: [],
      status: "running",
      startedAt: "2026-09-23T00:00:00Z",
    },
    { id: "paint", label: "着色", dependsOn: ["scan"], status: "waiting" },
  ],
};
test("version-bound producer stages adapt unknown pipelines without fixed stage names", () => {
  expect(validateProgress(snap, job)).not.toBeNull();
  const m = normalize(job, { "observer-progress.json": snap });
  expect(m.stages.map((s) => s.label)).toEqual(["识别物体", "着色"]);
  expect(m.stages[1].dependsOn).toBe("scan");
});
test("reject mismatched source and dependency cycles", () => {
  expect(validateProgress({ ...snap, jobId: "other" }, job)).toBeNull();
  expect(
    validateProgress({ ...snap, pipelineVersionId: "new" }, job),
  ).toBeNull();
  expect(
    validateProgress(
      {
        ...snap,
        stages: [{ ...snap.stages[0], dependsOn: ["paint"] }, snap.stages[1]],
      },
      job,
    ),
  ).toBeNull();
});
