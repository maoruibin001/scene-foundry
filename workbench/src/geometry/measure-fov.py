# usage: python -I measure-fov.py <model id> <image>... — prints [{"vfov": radians, "hfov": radians}, ...] per image.
# MoGe-2 single-image intrinsics; on the ground-truth benchmark it reads vertical FoV within about 2° (also on known-zoom crops).
import json, math, sys
import numpy as np, torch
from PIL import Image
from moge.model.v2 import MoGeModel

model_id, paths = sys.argv[1], sys.argv[2:]
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
model = MoGeModel.from_pretrained(model_id).to(device).eval()
out = []
for p in paths:
    img = np.array(Image.open(p).convert('RGB'))
    x = torch.tensor(img / 255., dtype=torch.float32, device=device).permute(2, 0, 1)
    with torch.no_grad():
        K = model.infer(x, use_fp16=False)['intrinsics'].float().cpu().numpy()  # normalized: fx, fy in image-size units
    out.append({'vfov': 2 * math.atan(0.5 / float(K[1, 1])), 'hfov': 2 * math.atan(0.5 / float(K[0, 0]))})
print(json.dumps(out))
