# usage: python -I measure-points.py <model id> <out dir> <image>... — writes <out dir>/ref-<n>.npz (n = 1..) with the MoGe-2 point map
# (float16, OpenCV camera axes: x right, y down, z forward; arbitrary scale) and its validity mask, for the object3d graybox gate.
import json, os, sys
import numpy as np, torch
from PIL import Image
from moge.model.v2 import MoGeModel

model_id, out, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
model = MoGeModel.from_pretrained(model_id).to(device).eval()
os.makedirs(out, exist_ok=True)
rows = []
for n, p in enumerate(paths, 1):
    img = np.array(Image.open(p).convert('RGB'))
    x = torch.tensor(img / 255., dtype=torch.float32, device=device).permute(2, 0, 1)
    with torch.no_grad():
        o = model.infer(x, use_fp16=False)
    points, mask = o['points'].float().cpu().numpy(), o['mask'].cpu().numpy().astype(bool)
    mask &= np.all(np.isfinite(points), -1)
    np.savez_compressed(f'{out}/ref-{n}.npz', points=np.nan_to_num(points).astype(np.float16), mask=mask)
    rows.append({'referenceIndex': n, 'file': f'ref-{n}.npz', 'valid': float(mask.mean())})
print(json.dumps(rows))
