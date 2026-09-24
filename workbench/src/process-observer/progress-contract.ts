/** Optional producer snapshot. The observer never writes this file. */
export interface ProgressSnapshot {
  schemaVersion: "scene-progress-v1";
  jobId: string;
  pipelineVersionId: string;
  updatedAt: string;
  stages: Array<{
    id: string;
    label: string;
    dependsOn: string[];
    status:
      | "pending"
      | "waiting"
      | "running"
      | "passed"
      | "failed"
      | "cancelled";
    startedAt?: string;
    endedAt?: string;
    error?: string;
    inputSummary?: string;
    outputSummary?: string;
    outputs?: Array<{ path: string; sha256: string }>;
  }>;
}
export function validateProgress(
  value: any,
  job: any,
): ProgressSnapshot | null {
  if (
    value?.schemaVersion !== "scene-progress-v1" ||
    value.jobId !== job.id ||
    value.pipelineVersionId !== job.pipelineVersion?.id ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.stages) ||
    value.stages.length > 128
  )
    return null;
  const ids = new Set(value.stages.map((s: any) => s?.id));
  if (ids.size !== value.stages.length) return null;
  for (const s of value.stages) {
    if (
      typeof s.id !== "string" ||
      !s.id ||
      typeof s.label !== "string" ||
      !Array.isArray(s.dependsOn) ||
      !s.dependsOn.every((id: any) => ids.has(id) && id !== s.id) ||
      ![
        "pending",
        "waiting",
        "running",
        "passed",
        "failed",
        "cancelled",
      ].includes(s.status)
    )
      return null;
    if (
      (s.startedAt && !Number.isFinite(Date.parse(s.startedAt))) ||
      (s.endedAt && !Number.isFinite(Date.parse(s.endedAt)))
    )
      return null;
  }
  const visiting = new Set(),
    done = new Set();
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const d of value.stages.find((s: any) => s.id === id).dependsOn)
      if (!visit(d)) return false;
    visiting.delete(id);
    done.add(id);
    return true;
  };
  if (!value.stages.every((s: any) => visit(s.id))) return null;
  return value;
}
