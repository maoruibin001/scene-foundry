# Ground-truth scene benchmark (protocol, frozen 2026-10-26)

Purpose: measure whether the pipeline reconstructs the layout and cameras of a reference scene, with numbers that do not come
from any model judge. Fixed before any pipeline result on this set was seen; changes after that are logged here with the reason.

## Sets
**A — Hypersim (ordinary interiors), `set-hypersim.json`, 19 scenes.**
- **Source.** Apple Hypersim v1, val/test split only (never used for tuning). CC BY-SA 3.0, used for internal evaluation.
- **Selection.**
  - Stratified random by room type (seed 20261026).
  - View pairs chosen from metadata only: baseline 1–4 m, angle 25–80°, most shared object boxes.
  - Exposure rule fixed before results: reject if clipped white >35%, clipped black >50%, or mean L <25.
  - Backups drawn with seed 20261027.
  - 7 of 20 were rejected. The Office (home) slot had no usable backup, so A has 19 scenes.
- **Ground truth.**
  - Camera poses and vFoV, from the per-scene projection matrix.
  - Metric scale.
  - Object-aligned 3D boxes of NYU40-labelled instances, limited to instances visible at ≥0.5% of pixels in an input view and ≥0.15 m in size. Walls, floor and ceiling are excluded.

**B — Voxel dioramas, `voxel/`, 20 scenes.**
- **Source.** Kenney Survival Kit (CC0), voxelized solid at 0.125 m. Each model is scaled to a per-category real height.
- **Layout.**
  - Random placement on a 10/12/14 m slab (seed 1101), axis-aligned yaw, at least 0.25 m clearance.
  - 12 categories with count ranges per category.
- **Cameras.** Two isometric orthographic views (azimuth 45° and 135°).
- **Rendering.** Through the pipeline's own repair-preview path, so the inputs look like real voxel jobs.
- **Ground truth.** Exact: object centres and sizes as placed.
- **Known limit.** The layout rules are generic, not story-driven, so these scenes are less structured than user prompts.

## Score — `scripts/score.py` (gt-scene-score-v2)
- **Alignment.**
  - The prediction is aligned to the ground truth by one similarity transform: scale, yaw about Z, planar translation, and floor height.
  - It is fitted on matched objects and initialised from the cameras.
  - The fitted scale is reported as absolute-scale error. Camera errors are measured relative to the room after this alignment.
- **Object matching.** Hungarian matching on centre distance. A label mismatch costs 0.5 m. Pairs farther than 1 m are unmatched.
- **Reported per scene.**
  - Camera: position error, height error, forward-direction error, pitch error, vFoV error.
  - Objects: recall and precision, median centre error, median size error (|log ratio|), mean 3D IoU over all ground-truth objects.

## Metric validation — `scripts/score_selftest.py`
Every check below must read back the injected error, and only that error:

| Check | Expected reading |
|---|---|
| Identity under scale 1/1.37, yaw 1.1 rad and translation | Scale error = ln 1.37; all other errors 0 |
| 0.2 m planar noise per axis | Centre error ≈ 0.2·√(π/2) |
| Sizes ×1.3 | Size error = ln 1.3 |
| Both cameras +0.5 m | Height error 0.5 |
| Half the objects dropped | Recall ≈ 0.5 |

The v1 metric aligned on cameras only and absorbed the camera-height error, which reads 0. v2 fixes this.

## Floors — `scripts/baselines.py`
- **Prior.** True cameras, objects at the mean position and median size for their label: recall ≈ 0.
- **Shuffle.** Another room's layout: recall ≈ 0.
- A method must clear these floors before any number is read as reconstruction.

## Use
1. **Correlation with the judge (validity).** Run the pipeline's graybox on the A and B inputs. Correlate ground-truth score with the graybox judge score. A metric the judge never agrees with is a finding about the judge, not the metric.
2. **Change evaluation.**
   - Compare the same scenes before and after a change: report the paired difference with a bootstrap 95% CI over scenes.
   - A change counts as an improvement only if the CI excludes 0 on the pre-chosen primary metrics: object recall, centre error, and camera forward error.
3. **Stage attribution (oracle substitution).** Replace one stage's output with ground truth, e.g. ground-truth cameras into the space stage, and measure how much of the gap closes.

## Change log
- 2026-10-26, after the first pilot round (ai_003_010): pipeline categories are free-form Chinese, so every label compared unequal and
  the 0.5 m label prior acted uniformly. `scene_to_pred.ts` now maps categories to the ground-truth vocabulary by a fixed keyword
  table (first hit wins). Matching, alignment and all thresholds are unchanged; the raw category is kept as `rawLabel`.
- 2026-10-26, after the first voxel pilot round (vox_1101_00): orthographic views have no position along the view axis and no vFoV, so
  those read as large artefacts (6.3 m, 45.8 deg). For orthographic views the score now reports forward/pitch error and the
  log error of the framed height (after the similarity scale); position, height and vFoV are perspective-only.
- 2026-10-26, after pilot rounds ai_007_001 and ai_033_002 read recall 0: v2 initialised alignment from the cameras only, so a camera
  0.5–3 m off placed every object outside the 1 m match radius although the room was right. Self-test added (exact objects, cameras
  noised 0.5 m / 5 deg): v2 recall 0 in 11% of trials, v3 0%. v3 also tries a camera-free object-correspondence RANSAC init and keeps
  the better fit. Two readings are now reported: **best-fit** (layout on its own; prior/shuffle floor ≈0.3 recall) and **anchored**
  (camera-initialised; layout as seen from the reference views; floor 0). Primary metrics apply to both, each against its own floor.
- 2026-10-27, three benchmark defects found when the voxel set read precision 0.50 and size ~1.7x (diagnosis in
  `~/scene-foundry-verify/bench-gt/diag/voxel.md`, checked against the voxel bounds of all 302 objects):
  1. **Set B ground truth had height on a horizontal axis.** The voxel meshes are Z-up, but `gen_voxel_set.py` read them as Y-up, so a
     4.5 m tree was stored 1.5 m tall and its centre sat at half its depth. The generator is fixed and the 20 stored scenes are rewritten
     by the same permutation, which is exact against the voxel bounds. The rendered references were already right (`gt_to_scene.ts`
     uses the meshes), so they are unchanged.
  2. **`score.py` rotated predicted centres into the ground-truth frame but not box extents.** Every voxel round aligned at -90°, so x
     and y sizes were swapped. Extents are now rotated with `|R|`. A rotated-frame self-test is added (size error must read 0). This
     also changes Set A size numbers.
  3. **Objects built from several instances were scored as several objects.** `scene_to_pred.ts` now merges the instances of one
     `observedBindings` landmark into a single object (union box). Precision is therefore per observed object, not per instance.
  Matching radius, label prior and alignment are unchanged; floors are unchanged (anchored 0, best-fit ~0.3).
