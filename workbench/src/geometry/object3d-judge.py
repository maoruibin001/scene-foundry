# usage: python -I object3d-judge.py <grid.json> <reference-observations.json> <points dir> — object3d-v1 graybox space judge.
# Per observed landmark-view: pg = median graybox ray hit on the landmark's bound instances (camera frame), pm = median MoGe point inside
# the inner half of its observation box; one scale per view (median |pm|/|pg|); error |s·pg − pm| / |pm| capped at 1; a bound landmark
# invisible in that view scores 1. Score = mean over landmark-views (lower is better). Rows carry the depth ratio (graybox z / reference z
# after the scale) so a repair knows whether the object sits too near or too far.
import json, sys
import numpy as np

grid, obs, pts = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3]
rows, total = [], 0
for vk, v in grid['views'].items():
    z = np.load(f'{pts}/ref-{vk}.npz'); P, M = z['points'].astype(np.float32), z['mask']; Hm, Wm = M.shape
    cells = [c for c in v['grid'] if c]
    view = []
    for l in obs.get('landmarks', []):
        ids = set(grid['bindings'].get(l['id'], []))
        for b in l.get('views', []):
            if str(b.get('referenceIndex')) != vk or not isinstance(b.get('box'), list) or not ids:
                continue
            x0, y0, x1, y1 = b['box']; cx, cy, hw, hh = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 4, (y1 - y0) / 4
            ya, xa = int((cy - hh) * Hm), int((cx - hw) * Wm)
            ys, xs = np.mgrid[ya:max(int((cy + hh) * Hm), ya + 1), xa:max(int((cx + hw) * Wm), xa + 1)]
            ys, xs = ys.clip(0, Hm - 1).ravel(), xs.clip(0, Wm - 1).ravel(); ok = M[ys, xs]
            if ok.sum() < 3:
                continue
            hits = np.array([c[1:] for c in cells if c[0] in ids])
            view.append({'landmarkId': l['id'], 'label': l.get('label'), 'critical': bool(l.get('critical')), 'referenceIndex': int(vk),
                         'pm': np.median(P[ys[ok], xs[ok]], 0), 'pg': np.median(hits, 0) if len(hits) else None})
    seen = [r for r in view if r['pg'] is not None]
    s = float(np.median([np.linalg.norm(r['pm']) / max(np.linalg.norm(r['pg']), 1e-6) for r in seen])) if seen else 1.0
    for r in view:
        pg, pm = r.pop('pg'), r.pop('pm')
        if pg is None:
            r.update(error=1.0, visible=False, depthRatio=None)
        else:
            r.update(error=min(1.0, float(np.linalg.norm(s * pg - pm) / np.linalg.norm(pm))), visible=True,
                     depthRatio=round(float(s * pg[2] / pm[2]), 3) if pm[2] > 1e-6 else None)
        r['error'] = round(r['error'], 4); rows.append(r)
n = len(rows)
print(json.dumps({'version': 'object3d-v1', 'score': round(sum(r['error'] for r in rows) / n, 4) if n else None, 'rows': n,
                  'invisible': sum(not r['visible'] for r in rows), 'landmarks': rows}))
