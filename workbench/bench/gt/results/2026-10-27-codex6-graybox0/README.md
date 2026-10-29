# Baseline: graybox round 0, codex6, 2026-10-27

## Run conditions
- **Code:** main at e5a10bc (retry v2, worker contract in the prompt, 2 scenes per kind).
- **Model:** `gpt-6-astra-aihub-azure` through the codex6 relay.
- **Rounds scored:** every scene's first graybox round. The job was cancelled after that round's judge score.
- **Metric:** `score.py` gt-scene-score-v5 (see PROTOCOL.md change log). First published with v3; re-scored from the stored
  predictions with `scripts/rescore.py`. Only the camera fields of ai_016_004, ai_044_003 and ai_053_007 changed (now unmeasurable);
  object metrics are identical. v5 (2026-10-29) leaves every per-scene number unchanged and takes object metrics into set
  statistics only from the 13 scenes with at least 8 scored objects (flagged: ai_008_005, ai_035_004, ai_041_002, ai_044_003,
  ai_053_007).
- **Ordinary set:** ai_016_004 is excluded. Its ground truth has only 2 objects (staircase), so any method gets recall 0.
- **Statistics:** medians with bootstrap 95% CIs over scenes. ρ is Spearman correlation between the graybox judge score and each metric.
- **Files:**
  - `per-scene.json`: per-scene numbers.
  - `scenes/<id>/`: `pred-0.json` and `score-0.json` for each scene.

## Set A: Hypersim interiors (n = 18)
Judge score ranged from 2.3 to 3.2, median 2.8.

| metric | median [95% CI] |
|---|---|
| object recall (best-fit) | 0.42 [0.39, 0.64]; floor ≈ 0.30; object rows: n = 13 (v4, all 18: 0.41) |
| object recall (anchored, as seen from the reference cameras) | 0.38 [0.19, 0.55]; 3 of 13 scenes score 0 (v4, all 18: 0.36, 6 at 0) |
| object precision | 0.53 [0.50, 0.69] |
| centre error | 0.42 m [0.31, 0.50] |
| size error (\|log ratio\|) | 0.57 [0.35, 0.82] |
| mean 3D IoU | 0.07 [0.02, 0.11] |
| camera forward error | 12.3° [8.1, 17.4]; n = 16, room not fitted in ai_044_003 and ai_053_007 |
| camera position error | 1.86 m [1.29, 2.44]; n = 16 |
| camera height error | 0.50 m [0.14, 0.72]; n = 16 (v3 read 0.40 m with the two unfitted scenes near 0) |
| vFoV error | 12.5° [7.5, 14.5], too wide in almost every view |
| pitch error | 3.0° [1.9, 4.0] |
| relative rotation between the two views | 16.9° [10.0, 17.6] |
| baseline direction in view 1's frame | 16.8° [9.0, 56.0] |
| absolute scale | 0.93 [0.82, 1.03] |

ρ(judge, metric): every interval includes 0 except centre error, +0.62 [+0.06, +0.90] on the 13 scenes with valid object metrics:
a higher judge score goes with a larger centre error.

| metric | ρ [95% CI] |
|---|---|
| anchored recall | −0.49 [−0.89, +0.16]; n = 13 (v4, all 18: −0.31) |
| recall | −0.48 [−0.93, +0.24]; n = 13 |
| precision | −0.23 [−0.82, +0.36]; n = 13 |
| size error | +0.37 [−0.23, +0.78]; n = 13 |
| camera forward error | +0.34 [−0.22, +0.79]; n = 16 |
| relative rotation | −0.16 [−0.64, +0.38] |

## Set B: voxel camps (n = 20)
Judge score ranged from 2.7 to 4.0, median 3.4.

| metric | median [95% CI] |
|---|---|
| object recall (best-fit = anchored) | 1.00 [1.00, 1.00]; 0 of 20 scenes score 0 |
| object precision | 1.00 [0.91, 1.00] |
| centre error | 0.13 m [0.12, 0.15] |
| size error | 0.12 [0.10, 0.15], about 1.12× |
| mean 3D IoU | 0.58 [0.54, 0.60] |
| camera forward error | 0.48° [0.41, 0.60] |
| relative rotation between the two views | 0.50° [0.39, 0.59] |
| absolute scale | 0.93 [0.85, 1.00] |

ρ(judge, metric): every interval includes 0. The ground-truth metrics are near ceiling here, so this set cannot test the judge.

## Reading
1. **Voxel graybox layout is already accurate.** Remaining issues are small: rock piles are slightly too tall, and a few small items in one scene are placed 2–3 m off.
2. **Ordinary interiors are the problem, and it starts at the camera.**
   - Direction is off by about 12°, vFoV is about 12.5° too wide, and height is off by about 0.5 m.
   - The two views are not consistent with each other either: their relative rotation is off by about 17°. This is measured
     without any alignment, so it is a pipeline error, not a scoring artefact. The two scenes with a ~140° forward error
     (ai_035_001, ai_053_007) also read 67° and 80° relative rotation error, so their cameras are wrong, not the alignment.
   - One third of scenes match nothing from the reference views.
   - Object layout on its own is only slightly above the trivial floor.
   - A constant-prior vFoV estimator scores perfectly on this set, because Hypersim vFoV is constant. Any vFoV fix needs varied-FoV samples before it can be validated (see `~/scene-foundry-verify/bench-gt/diag/fov/FINDING.md`).
3. **The graybox judge score does not track ground truth on either set.**
   - On interiors it barely varies (2.3–3.2) while anchored recall spans 0–0.8.
   - It should not be the gate or the repair target for the space stage without an objective term.
