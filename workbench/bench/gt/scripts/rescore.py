# usage: python -I rescore.py <scenes_dir> [per-scene.json stats.json]
# Re-score stored predictions (<scenes_dir>/<id>/pred-0.json) with the current score.py, rewrite each score-0.json, and, when given,
# refresh the per-scene table and its statistics. A stats entry is recomputed only if its per-scene values changed or it is new, so
# entries the metric change does not touch keep their published numbers. Medians: percentile bootstrap over scenes; rho: Spearman
# between judge and metric, same bootstrap (10000 resamples, seed 0). Set A excludes ai_016_004 (2 ground-truth objects).
import os,sys,json,glob,numpy as np
from scipy.stats import spearmanr
H=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,H);from score import score
FIELDS=('objectRecall','objectPrecision','centerErrM','sizeErr','meanIoU3d','cameraForwardErrDeg','cameraHeightErrM','vfovErrDeg','scale',
 'roomFitted','cameraPositionErrM','pitchErrDeg','relRotErrDeg','baselineDirErrDeg')
STATS={'A':('objectRecall','anchoredRecall','objectPrecision','centerErrM','sizeErr','meanIoU3d','cameraForwardErrDeg','vfovErrDeg','cameraHeightErrM',
 'scale','cameraPositionErrM','pitchErrDeg','relRotErrDeg','baselineDirErrDeg'),
 'B':('objectRecall','anchoredRecall','objectPrecision','centerErrM','sizeErr','meanIoU3d','cameraForwardErrDeg','scale','pitchErrDeg','relRotErrDeg')}
RHO=('anchoredRecall','objectRecall','objectPrecision','sizeErr','centerErrM','cameraForwardErrDeg','cameraHeightErrM','cameraPositionErrM','relRotErrDeg','baselineDirErrDeg')
def boot(f,cols,B=10000):
 rng=np.random.default_rng(0);n=len(cols[0]);v=[f(*[c[i] for c in cols]) for i in (rng.integers(0,n,n) for _ in range(B))]
 v=np.asarray(v,float);v=v[np.isfinite(v)];return [float(f(*cols)),*map(float,np.percentile(v,[2.5,97.5])),float(n)]
def main(d,per=None,st=None):
 rows={}
 for p in sorted(glob.glob(os.path.join(d,'*','pred-0.json'))):
  sid=os.path.basename(os.path.dirname(p));gt=os.path.join(H,'..','hypersim' if sid.startswith('ai_') else 'voxel',sid+'.json')
  r=score(json.load(open(gt)),json.load(open(p)));json.dump(r,open(os.path.join(os.path.dirname(p),'score-0.json'),'w'),indent=1,default=float)
  s=r['summary'];rows[sid]={**{k:s[k] for k in FIELDS},'anchoredRecall':s['anchored']['objectRecall']}
  print(sid,'fitted' if s['roomFitted'] else 'NOT-FITTED',{k:None if s[k] is None else round(float(s[k]),3) for k in
   ('cameraPositionErrM','cameraHeightErrM','cameraForwardErrDeg','vfovErrDeg','pitchErrDeg','relRotErrDeg','baselineDirErrDeg','objectRecall')},
   'anchored',round(s['anchored']['objectRecall'],3))
 if not per:return
 old=json.load(open(per));new={k:{'judge':v['judge'],**rows[k]} for k,v in old.items()};json.dump(new,open(per,'w'),indent=1,default=float)
 S=json.load(open(st))
 for g,keys in STATS.items():
  ids=[k for k in new if (k.startswith('ai_') if g=='A' else k.startswith('vox_')) and k!='ai_016_004']
  def vec(m,src):return [(src[k]['judge'],src[k].get(m)) for k in ids if src[k].get(m) is not None]
  for m in keys:
   if f'{g}.{m}' not in S or vec(m,new)!=vec(m,old):
    v=vec(m,new);S[f'{g}.{m}']=boot(np.median,[np.array([x for _,x in v],float)]) if v else None
  for m in RHO:
   if m not in keys:continue
   if f'{g}.rho.{m}' not in S or vec(m,new)!=vec(m,old):
    v=vec(m,new);S[f'{g}.rho.{m}']=boot(lambda a,b:spearmanr(a,b)[0],[np.array([j for j,_ in v],float),np.array([x for _,x in v],float)]) if len(v)>3 else None
 json.dump(S,open(st,'w'),indent=1)
if __name__=='__main__':main(*sys.argv[1:])
