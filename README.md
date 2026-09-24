# Scene Foundry

Scene Foundry is a standalone repository for the scene generation pipeline and its local web workbench. It accepts a text prompt, reference images, or both; produces a ForgeaX Engine scene; and keeps generation steps, model-call receipts, assets, previews, and evaluation results in the local workbench.

This repository contains the pipeline source, UI, tests, and a small Engine project template. It does **not** contain historical jobs, uploaded images, model weights, credentials, generated scenes, or the ForgeaX Engine and Scene Generator source. Those two upstream repositories are currently private. Access to them is required for a full scene build, even though this repository is public. The model provider is also an external prerequisite.

The [source coverage record](docs/source-coverage.md) identifies which parts of the live local workbench are represented here and the deliberate differences in the public copy.

## Layout

- `workbench/src/`: pipeline, provider adapters, assessment, and HTTP server.
- `workbench/public/`: local UI and read-only process viewer.
- `workbench/spec/`: public project rules and a short method summary.
- `prototype/`: pinned Engine project template and dependency bootstrap.

## Local setup

Install Bun, Node.js, Python 3, Corepack/pnpm, and a local Codex CLI (or configure a compatible Messages API provider). The pinned dependency commits are in `prototype/brief.json`. With access to the two upstream repositories, run from this repository's root:

```sh
python3 prototype/bin/bootstrap.py
cp workbench/.env.example workbench/.env
cd workbench
bun run start
```

`bootstrap.py` clones `ForgeaXGame/forgeax-engine` and `ForgeaXGame/forgeax-ex-scene-generator` beside `prototype/`, verifies their exact commits, and builds their local outputs. Existing checkouts are verified without being switched. The server listens on `127.0.0.1:19774` by default; set `PORT` to use another port. Open the URL printed at startup.

Before running a model-backed job, set an explicit local call limit in `.env`, choose an available model, and verify your CLI login. For a Messages API provider, use `PIPELINE_PROVIDER=messages-api` and supply the provider URL, API key, model, and call limit through local environment variables. Never commit `.env` or provider credentials.

## Checks

From `workbench/`:

```sh
bun test ./src
```

After the private Engine and Scene Generator dependencies are prepared, run the template integration test from the repository root:

```sh
bun test prototype/bin/pipeline.test.ts
```

The web page and API starting successfully do not establish that a model route, Engine build, runtime capture, or visual quality gate has passed. The current pipeline is a local prototype; production certification still requires independent calibration and fixed evaluation sets.

## Data and publication boundary

All jobs, user uploads, model receipts, generated projects, and version snapshots are written under `workbench/data/` and ignored by Git. `prototype/evidence/`, build outputs, local dependencies, and environment files are ignored too. The public rule summary in `workbench/spec/` is specific to this repository and does not redistribute the original external specification or method document.

This public repository does not include a license grant for reuse. The vendored terminal library retains its own license in `workbench/public/process/vendor/LICENSE.xterm`.
