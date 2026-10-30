# usage: python -I measure-orientation.py <points dir> <n images> — prints [{"roll": deg, "pitch": deg, "wall": deg, "walls": n}, ...] per image.
# Manhattan frame from the MoGe-2 point map that object3d already saved (ref-<n>.npz, OpenCV axes): the vertical is the direction most
# floor/ceiling normals align with, the wall axis the 4-fold mean of horizontal normals. On 36 Hypersim reference views (2026-10-30):
# roll median error 0.2° (max 3.2°), pitch 0.2° (max 2.1°), heading relative to the room walls 1.2° (max 6.2°).
# roll: rotation of the camera's up about the view direction (benchmark convention); wall: angle from the view direction to the nearest
# wall axis, so the camera's heading in a scene whose walls run along angle A is A - wall (mod 90°).
import json, math, sys
import numpy as np

def normals(P, step=4):
    P = P[::step, ::step]; dx = P[1:-1, 2:] - P[1:-1, :-2]; dy = P[2:, 1:-1] - P[:-2, 1:-1]; n = np.cross(dx, dy)
    l = np.linalg.norm(n, axis=-1); ok = np.isfinite(l) & (l > 1e-9); return n[ok] / l[ok, None]

def frame(n):
    cos8 = math.cos(math.radians(8)); best = None
    for pitch in np.arange(-40, 40.1, 1):
        for roll in np.arange(-25, 25.1, 1):
            p, r = math.radians(pitch), math.radians(roll)
            v = np.array([math.sin(r) * math.cos(p), -math.cos(r) * math.cos(p), math.sin(p)])
            s = int((np.abs(n @ v) > cos8).sum())
            if best is None or s > best[0]: best = (s, v)
    v = best[1]; a = n[np.abs(n @ v) > cos8]; a = a * np.sign(a @ v)[:, None]; v = a.mean(0); v /= np.linalg.norm(v)
    f = np.array([0, 0, 1.]); fh = f - (f @ v) * v; fh /= np.linalg.norm(fh); rh = np.cross(v, fh)
    w = n[np.abs(n @ v) < math.sin(math.radians(15))]; ang = np.degrees(np.arctan2(w @ rh, w @ fh))
    wall = math.degrees(math.atan2(np.sin(np.radians(4 * ang)).sum(), np.cos(np.radians(4 * ang)).sum())) / 4
    roll = -math.degrees(math.atan2(v[0], -v[1])); pitch = math.degrees(math.asin(np.clip(v[2], -1, 1)))
    return {'roll': round(roll, 3), 'pitch': round(pitch, 3), 'wall': round(wall, 3), 'walls': int(len(w)), 'vertical': int(best[0])}

out = []
for k in range(1, int(sys.argv[2]) + 1):
    z = np.load(f'{sys.argv[1]}/ref-{k}.npz'); P = np.where(z['mask'][..., None], z['points'].astype(np.float32), np.nan)
    out.append(frame(normals(P)))
print(json.dumps(out))
