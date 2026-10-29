# usage: python make_figs.py — regenerates paper/figs/*.pdf from paper/data/*.json (no access to the experiment directories needed).
import json, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.stats import spearmanr

H = os.path.dirname(os.path.abspath(__file__))
D, F = os.path.join(H, 'data'), os.path.join(H, 'figs')
os.makedirs(F, exist_ok=True)
plt.rcParams.update({'font.size': 8, 'axes.spines.top': False, 'axes.spines.right': False, 'pdf.fonttype': 42})
GOOD, BAD, GREY = '#1d7a45', '#a8352c', '#7a8a90'

# Fig. 1: scene-level agreement of each judge with ground truth on the 18 interiors (sign: + = judge agrees with truth).
judges = [('VLM space judge', -0.31, -0.69, 0.27), ('2D landmark residual', -0.43, -0.83, 0.21), ('2D residual, measured cameras', -0.13, -0.57, 0.42),
          ('Whole-image depth agreement', -0.12, -0.54, 0.34), ('object3d (ours)', 0.75, 0.40, 0.91)]
fig, ax = plt.subplots(figsize=(3.3, 1.9))
for k, (name, r, lo, hi) in enumerate(judges):
    ax.barh(k, r, color=GOOD if r > 0 else BAD, height=.6)
    ax.plot([lo, hi], [k, k], color='black', lw=.8)
ax.axvline(0, color='black', lw=.6); ax.axvline(.6, color=GREY, lw=.6, ls='--')
ax.set_yticks(range(len(judges))); ax.set_yticklabels([j[0] for j in judges]); ax.invert_yaxis()
ax.set_xlim(-1, 1); ax.set_xlabel('Spearman ρ with ground truth (95% CI)')
fig.tight_layout(); fig.savefig(os.path.join(F, 'judges.pdf'))

# Fig. 2: per landmark-view, object3d error vs label-free ground-truth error.
pl = json.load(open(os.path.join(D, 'per_landmark.json')))
x, y = np.array([p['judge'] for p in pl]), np.array([p['truth'] for p in pl])
fig, ax = plt.subplots(figsize=(3.3, 2.4))
ax.scatter(y, x, s=6, color=GOOD, alpha=.55, linewidths=0)
ax.plot([0, 1], [0, 1], color=GREY, lw=.6, ls='--')
ax.set_xlim(0, 1.02); ax.set_ylim(0, 1.02); ax.set_xlabel('ground-truth relative position error'); ax.set_ylabel('object3d error (no ground truth)')
ax.set_title('ρ = %.2f, n = %d landmark-views' % (spearmanr(x, y)[0], len(x)), fontsize=8)
fig.tight_layout(); fig.savefig(os.path.join(F, 'per_landmark.pdf'))

# Fig. 3: closed loop on the hardest scene, before and after the deployment fixes (object3d solid, ground truth dashed).
lv = [r for r in json.load(open(os.path.join(D, 'live_rounds.json'))) if r['scene'] == 'ai_053_007' and r['run'] in ('v29', 'v30')]
fig, ax = plt.subplots(figsize=(3.3, 2.0))
for run, colour, label in (('v29', GREY, 'before fixes'), ('v30', GOOD, 'after fixes')):
    rows = sorted([r for r in lv if r['run'] == run], key=lambda r: r['round'])
    ax.plot([r['round'] for r in rows], [r['object3d'] for r in rows], '-o', color=colour, ms=3, label=label + ': object3d')
    ax.plot([r['round'] for r in rows], [r['truth'] for r in rows], '--', color=colour, lw=.9, label=label + ': ground truth')
ax.axhline(.35, color='#8a5d00', lw=.6, ls=':'); ax.text(4, .37, 'gate .35', ha='right', fontsize=7)
ax.set_xlabel('graybox round'); ax.set_ylabel('error'); ax.set_ylim(0, 1); ax.set_xticks(range(5)); ax.legend(fontsize=6, frameon=False, loc='upper right')
fig.tight_layout(); fig.savefig(os.path.join(F, 'closed_loop.pdf'))
print('figures written to', F)
