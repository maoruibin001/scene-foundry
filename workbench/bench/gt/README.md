# Ground-truth scene benchmark

This benchmark asks one question: does the pipeline reconstruct the layout and cameras of a reference scene? The scores here
are computed from known 3D ground truth, not from a model judge.

The rules are in [PROTOCOL.md](PROTOCOL.md): set construction, metric, validation, how to use the results, and the change log.
Read it before changing anything here.

## Contents
| path | what |
|---|---|
| `inputs.json` | 39 scenes: `set` (A/B), `kind`, two reference images and a fixed-template prompt per scene |
| `set-hypersim.json` | Set A: 19 Hypersim interiors with their room type, split and view pair |
| `hypersim/<scene>.json` | Set A ground truth: cameras (pose, vFoV) and boxes of visible objects, in metres, Z up |
| `hypersim/images/` | Set A references: the two Hypersim tone-mapped preview frames |
| `voxel/vox_1101_*.json` | Set B ground truth: object model, scale, yaw, centre and size; slab; two orthographic cameras |
| `voxel/images/` | Set B references, rendered through the pipeline's own preview path |
| `voxel/kenney-sizes.json` | Native sizes of the Kenney models used to scale them |
| `scripts/` | Builders, the scorer and runners (see below) |

## Score a scene
```sh
# A pipeline scene (e.g. a graybox round's render-scene.json) converted to the scoring schema
SF_REPO=$(git rev-parse --show-toplevel) bun scripts/scene_to_pred.ts <generated-scene.json> pred.json
python3 -I scripts/score.py hypersim/ai_003_010.json pred.json score.json
```
- **Requirements:** Python 3 with numpy and scipy (`requirements.txt`); building Set A also needs h5py, pillow and opencv.
- **Output:** a summary (scale, camera errors, object recall/precision, centre and size error, 3D IoU) plus per-camera and per-object rows.
- **Two readings:**
  - **best-fit:** is the room layout right on its own?
  - **anchored:** is the layout right as seen from the reference cameras?

## Check the metric before trusting a change
```sh
python3 -I scripts/score_selftest.py   # injected errors must read back exactly
python3 -I scripts/baselines.py        # floors: best-fit recall ~0.3, anchored recall 0
```
If either check changes, the metric changed. Log the change in PROTOCOL.md before comparing any numbers.

## Run the pipeline on the set
`scripts/full_run.py` runs all scenes against running workbench backends, as parallel as the backends allow. For each scene it:
1. creates the job through the UI (`scripts/create-job.js`, which needs playwright-core on `NODE_PATH`);
2. cancels the job once the first graybox round has a judge score;
3. scores that round against ground truth.

Jobs blocked by the provider are resumed with a backoff.
```sh
GT_RUN_DATA=<dir holding ordinary/data and voxel/data> GT_UI=20084 GT_PORT_ORDINARY=20086 GT_PORT_VOXEL=20087 \
  python3 -I scripts/full_run.py <out dir> [scene ids...]
```

## Rebuild the sets
- **Set A:** `hypersim_fetch.py`, then `pick_views.py`, `exposure.py` and `hypersim_gt.py`.
  - The fetch reads only the needed members from Apple's per-scene zips with HTTP range requests, about 1 MB per scene.
  - The scene draw and seeds are in PROTOCOL.md.
  - Semantic labels come from the Hypersim repository (`git clone https://github.com/apple/ml-hypersim`) under `evermotion_dataset/scenes/<scene>/_detail/mesh`.
- **Set B:**
  1. Download the Kenney Survival Kit (CC0) from https://kenney.nl/assets/survival-kit.
  2. Embed each GLB's textures with `embed-glb-images.py`.
  3. Run `gen_voxel_set.py <out> 20 1101` with `KENNEY_EMBEDDED_DIR` set. It voxelizes each object solid at 0.125 m with `voxelize-glb.py --solid`.
  4. Render with `gt_to_scene.ts` followed by `render_gt.ts`.

## Licences
- **Set A:** derived from Apple Hypersim, CC BY-SA 3.0 (https://github.com/apple/ml-hypersim). Use it for evaluation only, and keep the attribution and share-alike terms if you redistribute it.
- **Set B:** built from Kenney assets, CC0.
