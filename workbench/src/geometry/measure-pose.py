# usage: python -I measure-pose.py <model id> <image>... — prints {"views":[...]} with each reference view's pose relative to view 1.
# Depth Anything 3 (Apache-2.0 checkpoints DA3-BASE / DA3-SMALL) multi-view camera estimate. Axes are OpenCV (x right, y down,
# z forward). For view i >= 2: R maps camera-i coordinates to camera-1 coordinates, base is the unit direction of camera i's centre
# in camera 1's frame, baselineRatio is the baseline length over view 1's median depth (scale-free; near 0 means the camera only turned).
import json, sys
import numpy as np, torch
from depth_anything_3.api import DepthAnything3

model_id, paths = sys.argv[1], sys.argv[2:]
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
model = DepthAnything3.from_pretrained(model_id).to(device).eval()
with torch.no_grad():
    pred = model.inference(paths)
E = np.asarray(pred.extrinsics, dtype=np.float64)  # world-to-camera
R1, t1 = E[0][:3, :3], E[0][:3, 3]
c1, depth1 = -R1.T @ t1, float(np.median(pred.depth[0]))
views = [{'referenceIndex': 1, 'confidence': float(np.median(pred.conf[0]))}]
for i in range(1, len(paths)):
    Ri, ti = E[i][:3, :3], E[i][:3, 3]
    b = R1 @ (-Ri.T @ ti - c1)
    n = float(np.linalg.norm(b))
    views.append({'referenceIndex': i + 1, 'R': (R1 @ Ri.T).tolist(), 'base': (b / n if n > 1e-9 else b).tolist(),
                  'baselineRatio': n / depth1 if depth1 > 0 else 0.0, 'confidence': float(np.median(pred.conf[i]))})
print(json.dumps({'views': views}))
