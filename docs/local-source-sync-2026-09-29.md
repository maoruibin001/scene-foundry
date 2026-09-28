# Local source synchronization — 2026-09-29

The independent public repository was compared with the latest local scene-pipeline snapshot and the source-file inventories of the other local workbench snapshots. Functional changes were integrated in an isolated checkout based on the previously published score-filter commit. Runtime data, credentials, uploads, generated assets, private dependency checkouts, original external specification documents, and one-off local acceptance launchers were excluded.

The assembled source preserves the standalone defaults: locally authenticated `codex`, the repository-authored public specification, normal execution unless explicitly frozen, port 19774, the score-status filter, and the earlier compact-state and scene-switching optimizations. New image helpers use the configured data directory consistently. A Python environment preparation command and pinned image dependencies were added to the runbook.

## Validation performed

- Workbench source suite: **585 passed, 0 failed**, across 117 files. Tests used a separate temporary data directory and the newly prepared image environment.
- Template suite: **3 passed, 0 failed**.
- Video-frame tests: **2 passed** using real OpenCV frame processing.
- Python parsing: **17 source/script files passed**. Browser and capture JavaScript syntax: **27 files passed**.
- Pinned image setup succeeded in a new local virtual environment: Pillow 12.3.0, NumPy 1.26.4, OpenCV 4.11.0.86.
- A separate server started with empty temporary task data. The homepage, compact state, scored-record query, process index, and public specification endpoints returned HTTP 200. State reported `codex-cli`, a resolved local `codex` executable, and execution enabled; the scored-record query retained its filter.
- Whitespace validation passed. The source tree and pending Git changes were checked for publication exclusions before pushing.

The first suite run exposed three missing image-runtime prerequisites and a stale assertion about the primitive count. The runbook now prepares the image environment; the affected helpers honor the configured data directory; the geometry assertion covers the newly supported primitive names. The final suite results above were obtained after these changes.

## Limits of this evidence

No paid model-backed scene generation, complete Engine build/capture run, visual-quality certification, or live service migration was performed for this source synchronization. The private Engine and Scene Generator dependencies used by local tests remained separate ignored checkouts. The original service on port 19774 was not restarted or moved into this repository.
