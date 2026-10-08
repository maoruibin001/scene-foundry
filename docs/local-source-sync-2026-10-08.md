# Local source synchronization — 2026-10-08

The public repository was synchronized from the current local worker's `workbench-validation-ui-20261008` source, using the previous local snapshot and published source as a three-way merge base. The current source inventory was compared with the other local workbench snapshots. Historical experiments are not treated as current runtime features.

This update includes material catalog provisioning and provenance, geometry and lighting improvements, bounded graybox feedback and recovery, output selection and delivery standards, external-provider hard stops, runtime/storage checks, cumulative timing, preview lifecycle, and explicit validation-round boundaries. Public defaults remain the ordinary local `codex` CLI, repository-authored specification, default port 19774, score-status filtering, compact state responses, and unchanged-job refresh avoidance.

The optional validation wrappers now use configurable local control files and an ordinary `codex` default. Their call audits preserve earlier entries; exhausted logical recovery is not automatically restarted. Fixed material source descriptors and checksums are published, while downloaded images and converted pixels remain in ignored data. The runbook now includes `bun scripts/setup-materials.ts` before testing or generation.

## Validation

- Workbench suite: **967 passed, 0 failed**, across 182 files, with separate temporary task data.
- Template suite: **3 passed, 0 failed**.
- Subscription validation-boundary test: **1 passed**, exercising concurrent append-only audit reservations without calling a model.
- Video-frame suite: **7 passed**, using OpenCV frame processing.
- Syntax checks passed for **21 Python source/script files** and **35 browser/capture JavaScript files**.
- Material provisioning downloaded and verified the source-pinned channels for `wood_table_001` and `marble_01`. Both conversions reproduced the exact catalog IDs. Decoded catalog records and source images remain ignored.
- A separate server started with empty temporary task data. The homepage, compact state, scored-record query, process index, and public specification returned HTTP 200. State reported `codex-cli`, a resolved ordinary local `codex` executable, and execution enabled. The record query retained `scoreStatus=scored`.

The first suite run identified missing material prerequisites and three assertions tied to earlier recovery/progress semantics. The material preparation command supplies the required fixed resources. Updated assertions cover current behavior: exhausted logical recovery stops, unexhausted transient errors remain eligible, and an explicitly registered strategy boundary retains historical scores and cumulative facts while measuring its own low-gain streak.

## Evidence limits

This is source synchronization and local verification. No model-backed scene generation, complete Engine build/capture run, production quality certification, or live service migration was performed. Private Engine and Scene Generator checkouts remained separate ignored dependencies. The current local worker was left running in its original directory.
