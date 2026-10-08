# Source coverage

This repository was assembled from the local Scene Foundry workbench. The 2026-10-08 synchronization compares the standalone repository with the current worker's source (`workbench-validation-ui-20261008`) and the source inventories of the local workbench snapshots. It includes the outstanding scene-generation, repair, recovery, assessment, delivery, and UI changes. The existing page-refresh optimization and score-status filter are retained. The standalone server's default port remains 19774.

The newly synchronized areas include:

- Standard/detailed matching, first-pass/bounded generation, fresh/validated reuse, production windows, and cumulative production timing.
- Bounded provider recovery and automatic continuation, preservation of interrupted outputs, stage-specific reuse, and scoring-call reserves.
- Parallel planning and graybox assets, partial output delivery, template review and provenance, camera and opening checks, curved surfaces, surface mapping, and bundled material channels.
- Scoped scene-feedback tools, actual Engine preview receipts, reviewed-candidate selection, repair audit and quality diagnosis.
- Atomic acceptance criteria and versioned score aggregation, separation of draft and completed output, and downloadable output packages.
- Browser request timeouts, shared polling, an optional UI-only proxy, and expanded detail cards for criteria, recovery, diagnosis, delivery, and production time.
- Source-pinned PBR material catalogs and provisioning, emission and reflection support, procedural structures, contact and composition checks, asset inspection cameras, and bounded graybox feedback.
- Provider hard-stop precedence, continuation provenance, storage/runtime preflight, production and sidebar timing, preview lifecycle, and explicit validation-round boundaries with append-only execution audits.

See [the current synchronization validation record](local-source-sync-2026-10-08.md) for checks on this source and [the previous record](local-source-sync-2026-09-29.md) for the earlier baseline. These checks do not certify a model-backed generation run or visual quality.

The public repository deliberately differs from the local working copy in these places:

- The default provider remains the locally authenticated `codex` CLI. The live workbench's personal `codex6` launcher and Messages API default are not required by this project; they may be selected explicitly through local environment settings.
- `workbench/spec/` contains a repository-authored public summary instead of the external documents used locally. `src/spec.ts`, one frozen-reference test, and the specification link in `public/app.js` reflect that public source.
- Public reference-observation schemas bound image indices to the actual number of supplied images. Public geometry diagnostics, graybox scatter rejection, project-preparation symlink checks, compact state summaries, and unchanged-job refresh avoidance remain in place alongside the newly integrated contracts.
- The local `src/redirect.ts` helper only redirects an old port during a temporary migration and is ignored. Validation wrappers are now included with configurable local control files and an ordinary `codex` default; their control files and generated call ledgers remain ignored. Using a custom validation launcher is explicit through `PIPELINE_VALIDATION_CODEX_BIN`.
- Normal standalone execution remains enabled by default. `PIPELINE_EXECUTION_ENABLED=0` explicitly freezes generation and automatic recovery for observation; `1` re-enables it. The temporary local candidate's default freeze is not imposed on a new installation.
- Image helpers consistently locate their Python environment under `PIPELINE_DATA_DIR`, or `workbench/data` by default. `scripts/setup-python.py` prepares the pinned image dependencies before testing or generating scenes.
- `scripts/setup-materials.ts` prepares the source-pinned catalog required by runtime preflight. Only public source descriptors and checksums are committed; downloaded images and decoded catalog records remain ignored.
- Runtime jobs, uploads, model responses, snapshots, captures, generated assets, dependency checkouts, logs, and local environment settings are excluded by `.gitignore`.

The current local service still runs from its original working directory. The optional `PIPELINE_FOLLOWER_UPSTREAM` mode supports a second local UI process sharing a scheduler owner's data directory and forwarding writes to that owner; `src/ui-server.ts` also supports a separate UI release that proxies an existing worker. A normal standalone installation runs one server on port 19774. This synchronization does not restart the live service or migrate its historical data.
