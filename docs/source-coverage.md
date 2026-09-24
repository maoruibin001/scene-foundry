# Source coverage

The initial repository was assembled from the working directory serving the local Scene Foundry page on port 19774. The comparison was repeated on 2026-09-24 after the first push.

All 201 files under the live workbench's `src/` and all 16 files under `public/` have corresponding files here. The four `prototype/bin/` files, the scene source, and the three authored Engine template files are also present. The older Studio worktree had no unique `src/` or `public/` files absent from the live workbench.

The public repository deliberately differs from the local working copy in these places:

- `workbench/spec/` contains a repository-authored public summary instead of the external documents used locally. `src/spec.ts`, one frozen-reference test, and the specification link text in `public/app.js` reflect that public source.
- Four project-preparation files use a symlink-presence check that also works when the private Engine checkout is unavailable. Two copied source files had whitespace-only cleanup.
- Runtime jobs, uploads, model responses, snapshots, captures, generated assets, dependency checkouts, logs, and local environment settings are excluded by `.gitignore`.

The current local service still runs from its original working directory. This repository is the source location for subsequent independent development; moving the service and its historical data is a separate runtime migration.
