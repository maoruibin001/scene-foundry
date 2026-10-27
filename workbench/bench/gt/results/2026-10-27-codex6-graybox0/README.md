# Baseline: graybox round 0, codex6, 2026-10-27

## Run conditions
- **Code:** main at e5a10bc (retry v2, worker contract in the prompt, 2 scenes per kind).
- **Model:** `gpt-6-astra-aihub-azure` through the codex6 relay.
- **Rounds scored:** every scene's first graybox round. The job was cancelled after that round's judge score.
- **Metric:** `score.py` gt-scene-score-v3 plus the 2026-10-27 benchmark fixes (see PROTOCOL.md change log).
- **Ordinary set:** ai_016_004 is excluded. Its ground truth has only 2 objects (staircase), so any method gets recall 0.
- **Statistics:** medians with bootstrap 95% CIs over scenes. ρ is Spearman correlation between the graybox judge score and each metric.
- **Files:**
  - `per-scene.json`: per-scene numbers.
  - `scenes/<id>/`: `pred-0.json` and `score-0.json` for each scene.

## Set A: Hypersim interiors (n = 18)
Judge score ranged from 2.3 to 3.2, median 2.8.

| metric | median [95% CI] |
|---|---|
| object recall (best-fit) | 0.41 [0.34, 0.60]; floor ≈ 0.30 |
| object recall (anchored, as seen from the reference cameras) | 0.36 [0.00, 0.52]; 6 of 18 scenes score 0 |
| object precision | 0.51 [0.40, 0.67] |
| centre error | 0.42 m [0.29, 0.49] |
| size error (\|log ratio\|) | 0.62 [0.35, 0.82] |
| mean 3D IoU | 0.06 [0.02, 0.10] |
| camera forward error | 12.8° [8.2, 20.5] |
| vFoV error | 12.5° [7.5, 14.5], too wide in almost every view |
| camera height error | 0.40 m [0.14, 0.64] |
| absolute scale | 0.93 [0.82, 1.03] |

ρ(judge, metric): every interval includes 0.

| metric | ρ [95% CI] |
|---|---|
| anchored recall | −0.31 [−0.69, +0.27] |
| recall | −0.21 [−0.67, +0.38] |
| precision | −0.16 [−0.61, +0.37] |
| size error | +0.34 [−0.06, +0.71] |
| camera forward error | +0.13 [−0.40, +0.64] |

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
| absolute scale | 0.93 [0.85, 1.00] |

ρ(judge, metric): every interval includes 0. The ground-truth metrics are near ceiling here, so this set cannot test the judge.

## Reading
1. **Voxel graybox layout is already accurate.** Remaining issues are small: rock piles are slightly too tall, and a few small items in one scene are placed 2–3 m off.
2. **Ordinary interiors are the problem, and it starts at the camera.**
   - Direction is off by about 13°, vFoV is about 12.5° too wide, and height is off by about 0.4 m.
   - One third of scenes match nothing from the reference views.
   - Object layout on its own is only slightly above the trivial floor.
   - A constant-prior vFoV estimator scores perfectly on this set, because Hypersim vFoV is constant. Any vFoV fix needs varied-FoV samples before it can be validated (see `~/scene-foundry-verify/bench-gt/diag/fov/FINDING.md`).
3. **The graybox judge score does not track ground truth on either set.**
   - On interiors it barely varies (2.3–3.2) while anchored recall spans 0–0.8.
   - It should not be the gate or the repair target for the space stage without an objective term.
