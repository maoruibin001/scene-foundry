import { describe, test, expect } from "bun:test";
import { normalize } from "./model";
const base = {
  id: "test",
  status: "running",
  createdAt: 1000,
  stage: "generate",
  stages: {
    input: { status: "passed" },
    plan: { status: "passed", startedAt: 1000, durationMs: 100 },
    generate: { status: "running", startedAt: 1100 },
  },
  events: [],
  profile: { version: "5.2" },
  generationMethod: "general-geometry-v3",
};
describe("state evidence", () => {
  test("timeout freezes duration and leaves missing usage unknown", () => {
    const job = {
      ...base,
      status: "blocked",
      events: [{ type: "error", at: 481100, message: "timeout" }],
      error: "timeout",
    };
    const m = normalize(
      job,
      {
        "generation/scene-space-execution.json": {
          status: "timed_out",
          startedAt: 1100,
          endedAt: 481100,
          durationMs: 480000,
          stdoutBytes: 0,
          lastActivityAt: 1200,
        },
        "generation/scene-space-failure.json": {
          error: "timeout",
          usage: null,
        },
      },
      9999999,
    );
    expect(m.totalMs).toBe(480100);
    expect(m.stageElapsed).toBe(480000);
    expect(m.calls[0].usage).toBe(null);
    expect(m.activity).toBe("任务已结束");
    expect(m.children.find((s) => s.id === "assembly").status).toBe("pending");
  });
  test("stale running process never implies effective generation", () => {
    const m = normalize(
      base,
      {
        "generation/scene-space-execution.json": {
          status: "running",
          startedAt: 1100,
          lastActivityAt: 1200,
          stdoutBytes: 0,
        },
      },
      100000,
    );
    expect(m.activity).toContain("无法确认");
    expect(m.count.total).toBe(null);
    expect(m.milestones.generated).toBe(false);
  });
  test("complete call without a validated artifact is not a completed plan", () => {
    const m = normalize(
      base,
      {
        "generation/scene-space-receipt.json": {
          stopReason: "completed",
          requestedModel: "test",
        },
      },
      3000,
    );
    expect(m.children.find((s) => s.id === "space").status).toBe(
      "needs_review",
    );
  });
  test("cancellation supersedes running stages and asset checkpoint", () => {
    const m = normalize(
      { ...base, status: "cancelled", events: [{ at: 2000, type: "cancel" }] },
      {
        "generation/checkpoints.json": {
          steps: [{ id: "chair", status: "running" }],
        },
      },
      9999,
    );
    expect(m.stages.find((s) => s.id === "generate")?.status).toBe("cancelled");
    expect(m.children.find((s) => s.id === "asset:chair").status).toBe(
      "interrupted",
    );
    expect(m.totalMs).toBe(1000);
  });
  test("quality failure overrides passed gate execution, build is not visual success", () => {
    const m = normalize(
      {
        ...base,
        status: "failed",
        stage: "gate",
        stages: {
          ...base.stages,
          build: { status: "passed" },
          gate: { status: "passed" },
        },
        quality: { status: "failed", score: 95, reasons: ["critical unmet"] },
      },
      {},
      3000,
    );
    expect(m.stages.find((s) => s.id === "gate")?.status).toBe("failed");
    expect(m.milestones.built).toBe(true);
    expect(m.milestones.visual).toBe(false);
  });
  test("unknown pipeline stages remain visible and do not gain fabricated dependencies", () => {
    const m = normalize(
      {
        ...base,
        stages: { custom: { status: "passed" }, paint: { status: "running" } },
        stage: "paint",
        generationMethod: "future-v99",
      },
      {},
      3000,
    );
    expect(m.stages.map((s) => s.id)).toEqual(["custom", "paint"]);
    expect(m.children.length).toBe(0);
  });
  test("missing end event does not keep terminal duration ticking", () => {
    const m = normalize({ ...base, status: "failed" }, {}, 999999);
    expect(m.totalMs).toBe(null);
    expect(m.stageElapsed).toBe(null);
  });
  test("asset completion derives from per-asset checkpoints not object count", () => {
    const m = normalize(
      { ...base, objectCount: 400 },
      {
        "generation/checkpoints.json": {
          steps: [
            { id: "lamp", status: "passed" },
            { id: "tree", status: "running" },
          ],
        },
      },
      3000,
    );
    expect(m.count).toMatchObject({ completed: 1, total: 2 });
  });
  test("empty and optional historical fields are safe", () => {
    const m = normalize({ status: "unknown" }, {});
    expect(m.stages).toEqual([]);
    expect(m.count.total).toBe(null);
    expect(m.totalMs).toBe(null);
  });
});

test("a missing predecessor record is unknown when downstream execution exists", () => {
  const m = normalize(
    {
      ...base,
      stages: { input: { status: "passed" }, build: { status: "passed" } },
      stage: "build",
    },
    {
      "generation/checkpoints.json": {
        steps: [{ id: "a", status: "running" }],
      },
    },
    3000,
  );
  expect(m.stages.find((s) => s.id === "export")?.status).toBe("unknown");
  expect(m.children.find((s) => s.id === "materials")?.status).toBe("unknown");
});

test("asset without a start timestamp does not borrow the enclosing stage duration", () => {
  const m = normalize(
    base,
    {
      "generation/checkpoints.json": {
        steps: [{ id: "a", status: "running" }],
      },
    },
    10000,
  );
  expect(m.currentLabel).toBe("a");
  expect(m.stageElapsed).toBeNull();
});
test('历史续跑的继承清单优先于遗留 pending 标志，资产并发不假设串行依赖',()=>{const job={id:'resume',status:'cancelled',stage:'export',profile:{version:'5.4'},generationMethod:'general-geometry-v3',createdAt:'2026-09-23T10:00:00Z',events:[]};const d=normalize(job,{'generation/checkpoints.json':{steps:[{id:'a',status:'pending'},{id:'b',status:'pending'}]},'generation/resumed-from.json':{assets:[{id:'a'},{id:'b'}]},'generation/assets/a/checkpoint.json':{durationMs:600000,startedAt:1000}});expect(d.count.completed).toBe(2);const assets=d.children.filter(s=>s.id.startsWith('asset:'));expect(assets.every(s=>s.status==='reused'&&s.durationMs===0&&s.start===null&&s.dependsOn==='materials')).toBe(true);});

test("已校验目标按当前调用所属轮次显示完成，旧轮产物不冒充当前完成", () => {
  const folder="generation/iteration-1/refinement/",next="generation/iteration-2/refinement/";
  const files:any={
    [folder+"scene-repair-plan-execution.json"]:{status:"completed",startedAt:1000,endedAt:2000,durationMs:1000},
    [folder+"repair-goals.json"]:{version:"scene-repair-goals-v1",goals:[{id:"G1"}]},
  };
  expect(normalize(base,files,3000).children.find(s=>s.id==="scene-repair-plan").status).toBe("passed");
  files[next+"scene-repair-plan-execution.json"]={status:"running",startedAt:2100};
  expect(normalize(base,files,3000).children.find(s=>s.id==="scene-repair-plan").status).toBe("running");
  files[next+"scene-repair-plan-execution.json"]={status:"completed",startedAt:2100,endedAt:2500,durationMs:400};
  expect(normalize(base,files,3000).children.find(s=>s.id==="scene-repair-plan").status).toBe("needs_review");
  files[next+"repair-goals.json"]={version:"scene-repair-goals-v1",goals:[{id:"G2"}]};
  const done=normalize(base,files,3000).children.find(s=>s.id==="scene-repair-plan");expect(done.status).toBe("passed");expect(done.durationMs).toBe(400);
});

test("复用已有场景修正不展示未执行的逐资产生成依赖",()=>{
 const m=normalize({...base,refineScene:true,reuseSceneFrom:"source"},{"generation/refinement/scene-repair-plan-execution.json":{status:"running",startedAt:1200}},3000);
 expect(m.children.some(s=>["materials","assets","assembly"].includes(s.id))).toBe(false);expect(m.children.find(s=>s.id==="scene-repair-plan").dependsOn).toBe("plan");
});
