# Source coverage

This repository was assembled from the local Scene Foundry workbench serving port 19774. On 2026-09-24, its functional source was compared again with the live workbench and the outstanding scheduling, recovery, spatial-order, process-observer, and UI changes were integrated here. The page-refresh and scene-switching optimization was already included in the preceding commit.

The public repository deliberately differs from the local working copy in these places:

- The default provider remains the locally authenticated `codex` CLI. The live workbench's personal `codex6` launcher and Messages API default are not required by this project; they may be selected explicitly through local environment settings.
- `workbench/spec/` contains a repository-authored public summary instead of the external documents used locally. `src/spec.ts`, one frozen-reference test, and the specification link in `public/app.js` reflect that public source.
- Public reference-observation schemas bound image indices to the actual number of supplied images. Public geometry diagnostics, scatter rejection, and project-preparation symlink checks remain in place alongside the newly integrated recovery and stage logic.
- The local `src/redirect.ts` helper only redirects an old port to 19774 during a temporary migration and is not part of the standalone application. Whitespace-only local changes and a path alias needed by the live folder name were also omitted.
- Runtime jobs, uploads, model responses, snapshots, captures, generated assets, dependency checkouts, logs, and local environment settings are excluded by `.gitignore`.

The current local service still runs from its original working directory. The optional `PIPELINE_FOLLOWER_UPSTREAM` mode supports a second local UI process sharing a scheduler owner's data directory and forwarding writes to that owner; a normal standalone installation runs one server on port 19774. Moving the live service and its historical data into this checkout is a separate runtime migration.
