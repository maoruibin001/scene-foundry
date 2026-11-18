# Existing-game incremental continuation and adoption

Scene Foundry can import an existing ForgeAX source Pack, continue its immutable spec, then adopt only the changed cooked meshes into the existing game. It does not replace the project or its plugin roots. This path is an operator CLI; the live website has not been upgraded to expose it.

1. Use `scripts/adopt-engine-pack.ts` to seal existing meshes, source transforms and native environment into an intake library. Keep the original source/spec hashes.
2. Use `continueSpec` / `POST /api/spec-jobs/:id/continue` to record a reasoned revision against the exact previous spec. Source meshes not changed remain exact inputs; reviewed previous outputs remain history.
3. Export and validate the candidate through the normal pipeline. Use a unique package ID per revision. A candidate's capture alone does not verify the existing game's interactions.
4. Call `bun scripts/adopt-candidate-into-game.ts request.json receipt.json`. Request fields: `game`, `candidate` (generated asset Pack directory), `intake`, `receipt` (continuation receipt), `sourceLibrary`, `floorSource`, `revision`, `supportHeight`; optional `runtime: {gate: 'static-open' | 'lifting', radius: number}`.
5. The bridge seals the original Pack as `.pipeline-base.ts`, preserving its package ID and output keys, and emits a small wrapper that replaces only each admitted stable entity's MeshFilter. It adds a cooked asset Pack under `assets/pipeline-revisions/<revision>`; no new gameplay root is created. SHA checks reject changed binaries or source drift. Revisions form an explicit chain via `.pipeline-state.json`, so a subsequent revision keeps earlier bindings without nesting wrappers. Stale bases and reused package IDs fail closed.
6. Gameplay remains authored in the game. Its movement/door adapter explicitly consumes the pipeline runtime contract; the bridge does not rewrite arbitrary scripts. A fully open static gate must not inherit an animation that raises its entire frame. The planar support helper derives upward floor triangles and body-height barriers from the sealed source mesh and preserves holes. It does not implement arbitrary stairs, lifts, physics or a full navmesh. The caller must supply a floor whose source transform is identity, in the same game coordinates and datum.
7. Run project check, typecheck, relevant tests, then official hardware `project play` from the existing normal entry. Test old interactions, the changed visible behavior, restart and reload. Measure before/after in the same browser viewport, DPR, source cameras and input workload. Renderer completed-frame throughput is not GPU timestamp duration or proof of headroom above a display refresh cap.

## Supported adoption scope

Current bridge supports cooked, identity-preserving mesh replacement and plain standard materials. It rejects expanded/instanced changed objects, transformed replacements, GI or textured material increments pending their full material adapters; it must not silently strip those features. It does not delete old source assets, rebuild an empty game, or perform implicit high-to-low poly baking. Those are separate pipeline mechanisms requiring their own validation.

## Hall v4.2 verified application

Original game: `/Users/maoruibin/extensions/github/critical-zerog/hall-v42-graybox`.
Evidence: `/Users/maoruibin/extensions/github/critical-zerog/v42-evidence/pipeline-adoption-20261115/integration`.

One pipeline-generated `GEN-ENTRY-01` mesh replaces original `arch-10_0`; 123 other mesh objects remain. The original entry, core observation, receipt and control room journey remain. A runtime adapter extends the original restricted walking slice using the original floor support and leaves the source scene geometry unchanged. Entry/room obstacles remain enforced; the deep well is not filled.

Official hardware play passed nine steps with zero console/page errors and fifteen screenshots, including entering beyond the old invisible boundary, stopping at the real floor edge, core observation, return receipt, control room, restart, reload and original comparison cameras. Real compositor video: 632 frames / 45.315 s. No model calls were required for this deterministic reuse/generator revision.

Matched measurements (1280×720, DPR1, hardware WebGPU browser, same three source views, ~60 Hz display):

| View | Before rendered FPS | After rendered FPS |
| --- | ---: | ---: |
| Ordinary entrance | 60.237 | 60.179 |
| Eye-level source camera | 60.019 | 59.984 |
| Hero source camera | 59.703 | 59.991 |

These measurements show no material regression under these conditions; they do not establish improved GPU headroom or explain previous large-window low-FPS observations. No render settings, resolution, core mesh detail, materials or lighting were reduced for the comparison. This is a verified TRIAL gameplay integration, not final-art signoff or an independent 70-point visual review. Older visual-quality scores and source history remain unchanged.
