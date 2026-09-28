# Source coverage

This repository was assembled from the local Scene Foundry workbench serving port 19774. The 2026-09-29 synchronization compares the standalone repository with the latest local pipeline snapshot and the file inventories of the other local workbench snapshots. It includes the outstanding scene-generation, repair, recovery, assessment, delivery, and UI changes. The existing page-refresh optimization and score-status filter are retained.

The newly synchronized areas include:

- Standard/detailed matching, first-pass/bounded generation, fresh/validated reuse, production windows, and cumulative production timing.
- Bounded provider recovery and automatic continuation, preservation of interrupted outputs, stage-specific reuse, and scoring-call reserves.
- Parallel planning and graybox assets, partial output delivery, template review and provenance, camera and opening checks, curved surfaces, surface mapping, and bundled material channels.
- Scoped scene-feedback tools, actual Engine preview receipts, reviewed-candidate selection, repair audit and quality diagnosis.
- Atomic acceptance criteria and versioned score aggregation, separation of draft and completed output, and downloadable output packages.
- Browser request timeouts, shared polling, an optional UI-only proxy, and expanded detail cards for criteria, recovery, diagnosis, delivery, and production time.

See [the synchronization validation record](local-source-sync-2026-09-29.md) for the checks performed on the assembled source. These checks do not certify a model-backed generation run or visual quality.

The public repository deliberately differs from the local working copy in these places:

- The default provider remains the locally authenticated `codex` CLI. The live workbench's personal `codex6` launcher and Messages API default are not required by this project; they may be selected explicitly through local environment settings.
- `workbench/spec/` contains a repository-authored public summary instead of the external documents used locally. `src/spec.ts`, one frozen-reference test, and the specification link in `public/app.js` reflect that public source.
- Public reference-observation schemas bound image indices to the actual number of supplied images. Public geometry diagnostics, graybox scatter rejection, project-preparation symlink checks, compact state summaries, and unchanged-job refresh avoidance remain in place alongside the newly integrated contracts.
- The local `src/redirect.ts` helper only redirects an old port during a temporary migration. `candidate-codex.py` and `subscription-codex.py` are one-off local acceptance launchers. These machine-specific helpers and their local acceptance controls are ignored. The reusable bounded-recovery and acceptance-budget logic is included.
- Normal standalone execution remains enabled by default. `PIPELINE_EXECUTION_ENABLED=0` explicitly freezes generation and automatic recovery for observation; `1` re-enables it. The temporary local candidate's default freeze is not imposed on a new installation.
- Image helpers consistently locate their Python environment under `PIPELINE_DATA_DIR`, or `workbench/data` by default. `scripts/setup-python.py` prepares the pinned image dependencies before testing or generating scenes.
- Runtime jobs, uploads, model responses, snapshots, captures, generated assets, dependency checkouts, logs, and local environment settings are excluded by `.gitignore`.

The current local service still runs from its original working directory. The optional `PIPELINE_FOLLOWER_UPSTREAM` mode supports a second local UI process sharing a scheduler owner's data directory and forwarding writes to that owner; `src/ui-server.ts` also supports a separate UI release that proxies an existing worker. A normal standalone installation runs one server on port 19774. This synchronization does not restart the live service or migrate its historical data.
