# Local source synchronization — 2026-10-10

This update brings the ordinary-scene changes from the local release candidate `v1-rc.227` into the public repository. The method is a per-file three-way merge between public `main` (44e52df), rc227's frozen version snapshot, and each file's most recent shared public ancestor. Public `main` already contains the voxel and `sceneKind` work, which is a superset of rc227 in those files. Every cleanly merged file was therefore also audited for token-level deletions and duplicated definitions, so that a clean merge could not silently drop public features.

## Ported

- **Validation boundary.** `validation-rounds.ts` now reads the round's control boundary: fresh-input permission, registered input sets, a first-pass, bounded, or qualified generation mode, and unlimited rounds. It exposes `validationBoundaryStatus()`. Both the compact and the full `/api/state` responses return it as `validationBoundary`, which is `null` when no control file is configured. `public/validation-boundary.js` derives the create-form lock, the boundary hint, and the round text. `app.js` uses that module to disable creation when a limit is reached, when new inputs are refused, or when the selected model does not match the boundary.
- **Graybox contact evidence.** `geometry/blockout-input-evidence.ts` is new. Blockout contract v3 adds shared interfaces and moves the part limit into `blockoutTemplateInput`. Blockout now seals the spatial assessment before it preserves its output, and recovery records that the contact input was supplied. A saved scene blockout is reused only after its contacts have been recorded. `stage-contract.ts` lists `geometry/space-construction.ts` and `geometry/asset-construction.ts`.
- **Output delivery and package.** Delivery verifies the sealed spatial-assessment evidence. The retained-graybox candidate search checks real file locations and sealed graybox twins. Image-reconstruction status is reported. The package script takes the union of both sides' file lists.
- **Tests.** New: `validation-boundary-ui.test.ts`, `geometry/blockout-contact-input.test.ts`. Extended: the validation-round, blockout, recovery, delivery, package, and score-delivery tests. The score-delivery addition checks that exhausted asset recovery is not reset.

## Kept from public `main`

- The voxel `spacePlanningSchema(ids, {strictVoxel})`. The merge had appended rc227's older single-argument definition, which overrode the voxel version and broke four scene-lattice tests. `layout-stages.ts` was restored to the public version.
- The record score-status filter: `scoreStatus`, `summary.scored`, the 评分状态 selector, and the `stateJobSummary` tests. A clean merge had removed them. `job-history.ts`, its test, and `history-ui.js` were restored to the public versions. rc227 had no new changes in those files.
- The ordinary `codex` default and its wording in the UI, the repository-authored specification link, the unchanged-job refresh guard, and the bench filter that uses `benchEligible` and `assessmentProfileId`.
- The public versions of `round-audit-ui.js`, `reference-observations.ts`, `scene-contract.ts`, `model-schema.ts`, `pipeline-vnext.test.ts`, and `improvement-progress.test.ts`. Their rc227 differences were either older forms of public code or local-only wording.

## Not ported

- `src/redirect.ts`, a temporary local port-migration shim.
- Private identifiers in the new validation-round tests were replaced with neutral fixtures (`fixture-route` and `fixture-model-b`). A scan of the added lines found no personal launcher names, private document names, enterprise-chat URLs, local user paths, or credentials.

## Validation

- The workbench suite ran with separate temporary task data, a separate ledger, and an empty validation control path. **1248 tests: 1233 passed, 15 failed.** The 15 failing tests have the same names as the failures that the unmodified public `main` (1216 tests: 1201 passed, 15 failed) produces under the same isolation. In both runs they come from the empty temporary data directory: it lacks the reconstruction Python environment (`scripts/setup-python.py`) and the material catalog (`scripts/setup-materials.ts`). This sync adds no new failures.
- `python3 -m py_compile src/output-package.py` passed.
- A separate worker was started with empty temporary data, a temporary ledger, no control file, and execution disabled, with a UI server (`src/ui-server.ts`) in front of it. These returned HTTP 200 through the UI: `/`, `/app.js`, `/validation-boundary.js`, `/preview-lifecycle.js`, `/voxel/`, and `/favicon.svg`. `/api/state` contained `validationBoundary: null`. Both processes were stopped and the temporary directory was removed.

## Evidence limits

This is source synchronization and local verification only. No model-backed generation, Engine build or capture, quality certification, or live service migration was performed. The live UI overlay on 19774 still serves public `main`, which does not include `validation-boundary.js` until this branch is merged and the service is restarted.
