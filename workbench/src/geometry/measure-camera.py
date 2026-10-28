# usage: python -I measure-camera.py <model id> <image> — prints {"heightRatio","pitch","far","left","right","depth"} for reference view 1.
# MoGe-2 point map (camera frame, OpenCV axes). Floor: RANSAC over points from the lower half whose normal is within 30 deg of the
# camera's vertical; orientation (pitch) from the best-supported horizontal plane, height from the lowest plane parallel to it that
# is clearly lower (a table top or bed can out-vote the floor). All lengths are over the median z-depth, so they are scale-free.
# On 17 Hypersim views: height ratio within 4% (median), pitch within 0.4 deg, far/left/right extent within 2-7%.
import json, math, sys
import numpy as np, torch
from PIL import Image
from moge.model.v2 import MoGeModel

model_id, path = sys.argv[1], sys.argv[2]
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
model = MoGeModel.from_pretrained(model_id).to(device).eval()
img = np.array(Image.open(path).convert('RGB'))
with torch.no_grad():
    out = model.infer(torch.tensor(img / 255., dtype=torch.float32, device=device).permute(2, 0, 1), use_fp16=False)
P, M = out['points'].float().cpu().numpy().astype(np.float64), out['mask'].cpu().numpy().astype(bool)
H = M.shape[0]
valid = M & np.all(np.isfinite(P), -1)
V = P[valid]
D = float(np.median(V[:, 2]))
rng = np.random.default_rng(0)
low = P[H // 2:][valid[H // 2:]]
low = low[rng.choice(len(low), min(20000, len(low)), replace=False)]
cands = []
for _ in range(800):
    a, b, c = low[rng.choice(len(low), 3, replace=False)]
    n = np.cross(b - a, c - a)
    if np.linalg.norm(n) < 1e-9:
        continue
    n /= np.linalg.norm(n)
    if n[1] > 0:
        n = -n
    if n[1] > -math.cos(math.radians(30)):
        continue
    d = -n @ a
    inl = np.abs(low @ n + d) < .02 * D
    cands.append((int(inl.sum()), abs(d), n, inl))
result = {'depth': D, 'heightRatio': None, 'pitch': None}
if cands:
    lead = max(cands, key=lambda c: c[0])
    par = [c for c in cands if c[0] >= .3 * lead[0] and c[2] @ lead[2] > math.cos(math.radians(5))]
    lowest = max(par, key=lambda c: c[1])
    pick = lowest if lowest[1] > 1.25 * lead[1] else lead
    L = low[lead[3]]
    n = np.linalg.svd(L - L.mean(0))[2][2]
    if n[1] > 0:
        n = -n
    height = abs(n @ low[pick[3]].mean(0))
    # camera looks along +z; the floor normal points up (-y). Looking up gives a positive pitch.
    result.update(heightRatio=height / D, pitch=math.degrees(math.asin(float(np.clip(n @ np.array([0, 0, 1.]), -1, 1)))))
result.update(far=float(np.percentile(V[:, 2], 95) / D), left=float(-np.percentile(V[:, 0], 2) / D), right=float(np.percentile(V[:, 0], 98) / D))
print(json.dumps(result))
