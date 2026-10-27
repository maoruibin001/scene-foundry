# usage: python -I score.py <gt.json> <pred.json> [out.json]
# Ground-truth scene score, no judge. Both files share one schema (metres, Z up, world frame of the ground truth):
#   {"cameras":[{"view":i,"position":[x,y,z],"forward":[..],"up":[..],"vfov":rad}], "objects":[{"label":str,"center":[x,y,z],"size":[sx,sy,sz],"yaw":rad}]}
# The prediction is first aligned to the ground truth with one similarity transform (scale, yaw about Z, translation), because a
# reconstruction from images fixes neither the world origin nor, for a monocular input, the scale. Z stays up and the floor stays
# at its own height, so a camera placed too high is an error, not something the alignment absorbs. The transform is fitted on the
# matched objects (robust, iterated with the matching) so camera errors are measured relative to the room; the fitted scale is the
# scene's absolute-scale error. Camera-only alignment (v0) absorbed a common +0.5 m camera height error in the self-test.
import json,sys,math
import numpy as np
from scipy.optimize import linear_sum_assignment

def yaw_rot(t):c,s=math.cos(t),math.sin(t);return np.array([[c,-s,0],[s,c,0],[0,0,1]])
def align(pred_cams,gt_cams):
 """Similarity (s,R about Z,t) mapping predicted camera centres onto ground truth. With two cameras the baseline fixes scale
 and yaw exactly; the forward vectors break the remaining ambiguity when the baseline is vertical-ish."""
 P=np.array([c['position'] for c in pred_cams],float);G=np.array([c['position'] for c in gt_cams],float)
 Fp=np.array([c['forward'] for c in pred_cams],float);Fg=np.array([c['forward'] for c in gt_cams],float)
 dp,dg=P-P.mean(0),G-G.mean(0)
 base_p,base_g=np.linalg.norm(dp[:,:2],axis=1).sum()+np.abs(dp[:,2]).sum(),np.linalg.norm(dg[:,:2],axis=1).sum()+np.abs(dg[:,2]).sum()
 s=base_g/base_p if base_p>1e-6 else 1.0
 # yaw: least squares over horizontal baseline vectors and horizontal forward vectors together
 A=np.vstack([dp[:,:2]*s,Fp[:,:2]]);B=np.vstack([dg[:,:2],Fg[:,:2]])
 H=A.T@B;yaw=math.atan2(H[0,1]-H[1,0],H[0,0]+H[1,1])
 R=yaw_rot(yaw);t=G.mean(0)-s*R@P.mean(0)
 return s,R,t,yaw
def ang(a,b):a,b=np.asarray(a,float),np.asarray(b,float);return math.degrees(math.acos(np.clip(a@b/np.linalg.norm(a)/np.linalg.norm(b),-1,1)))
def iou3(c1,s1,c2,s2):
 """Axis-aligned 3D IoU after yaw is ignored: object yaw is scored separately, and furniture boxes are near-square in plan."""
 lo=np.maximum(np.subtract(c1,np.divide(s1,2)),np.subtract(c2,np.divide(s2,2)));hi=np.minimum(np.add(c1,np.divide(s1,2)),np.add(c2,np.divide(s2,2)))
 inter=np.prod(np.clip(hi-lo,0,None));return float(inter/(np.prod(s1)+np.prod(s2)-inter)) if inter>0 else 0.0

def fit_sim(P,G):
 """Planar similarity with independent vertical scale fixed to the same s and Z translation from floor contact (minimum heights)."""
 P,G=np.asarray(P,float),np.asarray(G,float);mp,mg=P[:,:2].mean(0),G[:,:2].mean(0);A,B=P[:,:2]-mp,G[:,:2]-mg
 H=A.T@B;yaw=math.atan2(H[0,1]-H[1,0],H[0,0]+H[1,1]);R2=yaw_rot(yaw)[:2,:2]
 s=float(np.sum((A@R2.T)*B)/max(np.sum(A*A),1e-9)) if len(P)>1 else 1.0
 R=yaw_rot(yaw);t=np.zeros(3);t[:2]=mg-s*R2@mp;t[2]=float(np.median(G[:,2]-s*P[:,2]))
 return s,R,t,yaw
def match(G,Q,radius):
 if not G or not Q:return []
 C=np.array([[np.linalg.norm(np.subtract(g['center'],q['center']))+(0 if g['label']==q['label'] else .5) for q in Q] for g in G])
 gi,qi=linear_sum_assignment(C);return [(i,j) for i,j in zip(gi,qi) if C[i,j]<=radius]
def label_init(gt,pred):
 """Camera-free initial alignment: RANSAC over pairs of same-label object pairs (two correspondences fix planar s, yaw, t).
 v2 initialised from cameras only, so one wrong camera put every object 2-3 m off and recall read 0 although the room was right
 (self-test: exact objects with 0.5 m / 5 deg camera noise gave recall 0 in 11% of trials)."""
 G,Q=gt['objects'],pred['objects'];by={}
 for i,o in enumerate(G):by.setdefault(o['label'],[]).append(i)
 cand=[(i,j) for j,q in enumerate(Q) for i in by.get(q['label'],[])]
 best=None;rng=np.random.default_rng(0)
 for _ in range(min(3000,len(cand)**2)):
  if len(cand)<2:break
  a,b=rng.choice(len(cand),2,replace=False);(i1,j1),(i2,j2)=cand[a],cand[b]
  if i1==i2 or j1==j2:continue
  s,R,t,y=fit_sim([Q[j1]['center'],Q[j2]['center']],[G[i1]['center'],G[i2]['center']])
  if not (.33<s<3):continue
  T=lambda c:s*R@np.asarray(c,float)+t
  inl=sum(1 for j,q in enumerate(Q) if any(np.linalg.norm(T(q['center'])-np.asarray(G[i]['center']))<1.0 for i in by.get(q['label'],[])))
  if best is None or inl>best[0]:best=(inl,(s,R,t,y))
 return best
def score(gt,pred,match_radius=1.0):
 # Initialise from the cameras, and from object correspondences alone; keep whichever matches more objects after refinement.
 inits=[align(pred['cameras'],gt['cameras'])];lb=label_init(gt,pred)
 if lb:inits.append(lb[1])
 results=[_score(gt,pred,match_radius,*i) for i in inits]
 best=max(results,key=lambda r:(r['summary']['objectRecall'] or 0,-(r['summary']['centerErrM'] or 9)))
 # 'anchored' keeps the camera-initialised fit: is the layout right as seen from the reference cameras (floor 0 on both baselines).
 # The headline fields are the best fit: is the room layout right on its own (prior/shuffle floor ~0.3 recall).
 a=results[0]['summary'];best['summary']['anchored']={k:a[k] for k in ('objectRecall','objectPrecision','centerErrM','sizeErr','meanIoU3d')}
 return best
def _score(gt,pred,match_radius,s,R,t,yaw):
 for _ in range(5):
  Q=[{**o,'center':(s*R@np.asarray(o['center'],float)+t).tolist()} for o in pred['objects']];pairs=match(gt['objects'],Q,2*match_radius)
  if len(pairs)<3:break
  s2,R2,t2,y2=fit_sim([pred['objects'][j]['center'] for _,j in pairs],[gt['objects'][i]['center'] for i,_ in pairs])
  done=abs(s2-s)<1e-6 and abs(y2-yaw)<1e-6 and np.allclose(t2,t,atol=1e-6)
  s,R,t,yaw=s2,R2,t2,y2
  if done:break
 T=lambda p:s*R@np.asarray(p,float)+t
 cams=[]
 for g in gt['cameras']:
  p=next(c for c in pred['cameras'] if c['view']==g['view'])
  if g.get('projection')=='orthographic':
   # Position along the view axis and vFoV do not exist for an orthographic view; direction and framed height do.
   cams.append({'view':g['view'],'orthographic':True,'forwardErrDeg':ang(R@np.asarray(p['forward']),g['forward']),
    'pitchErrDeg':math.degrees(math.asin(np.clip((R@np.asarray(p['forward']))[2],-1,1))-math.asin(np.clip(np.asarray(g['forward'])[2]/np.linalg.norm(g['forward']),-1,1))),
    'orthoHeightLogErr':abs(math.log(s*p['orthographicHeight']/g['orthographicHeight'])) if p.get('orthographicHeight') and g.get('orthographicHeight') else None});continue
  cams.append({'view':g['view'],'positionErrM':float(np.linalg.norm(T(p['position'])-np.asarray(g['position']))),
   'heightErrM':float(T(p['position'])[2]-g['position'][2]),'forwardErrDeg':ang(R@np.asarray(p['forward']),g['forward']),
   'pitchErrDeg':math.degrees(math.asin(np.clip((R@np.asarray(p['forward']))[2],-1,1))-math.asin(np.clip(np.asarray(g['forward'])[2]/np.linalg.norm(g['forward']),-1,1))),
   'vfovErrDeg':math.degrees(p['vfov']-g['vfov'])})
 G=gt['objects'];Q=[{**o,'center':T(o['center']).tolist(),'size':(np.abs(R)@np.asarray(o['size'])*s).tolist()} for o in pred['objects']]
 # Hungarian match on centre distance, label agreement as a soft prior (a wrong label costs 0.5 m); unmatched beyond the radius.
 pairs=match(G,Q,match_radius)
 objs=[]
 for i,j in pairs:
  g,q=G[i],Q[j];ratio=np.asarray(q['size'])/np.maximum(np.asarray(g['size']),1e-3)
  objs.append({'gt':i,'pred':j,'label':g['label'],'labelMatch':g['label']==q['label'],'centerErrM':float(np.linalg.norm(np.subtract(g['center'],q['center']))),
   'logSizeRatio':float(np.mean(np.abs(np.log(ratio)))),'iou3d':iou3(g['center'],g['size'],q['center'],q['size'])})
 n=len(G);matched=len(pairs)
 persp=[c for c in cams if not c.get('orthographic')];ortho=[c for c in cams if c.get('orthographic')]
 mean=lambda rows,k,f=lambda v:v:float(np.mean([f(c[k]) for c in rows])) if rows and all(c.get(k) is not None for c in rows) else None
 summary={'scale':s,'absScaleErr':abs(math.log(s)),'cameraPositionErrM':mean(persp,'positionErrM'),'cameraForwardErrDeg':mean(cams,'forwardErrDeg'),
  'cameraHeightErrM':mean(persp,'heightErrM',abs),'vfovErrDeg':mean(persp,'vfovErrDeg',abs),'orthoHeightLogErr':mean(ortho,'orthoHeightLogErr'),
  'objectRecall':matched/n if n else None,'objectPrecision':matched/len(Q) if Q else None,
  'centerErrM':float(np.median([o['centerErrM'] for o in objs])) if objs else None,'sizeErr':float(np.median([o['logSizeRatio'] for o in objs])) if objs else None,
  'meanIoU3d':float(np.sum([o['iou3d'] for o in objs])/n) if n else None}
 return {'version':'gt-scene-score-v3','summary':summary,'cameras':cams,'objects':objs}

if __name__=='__main__':
 gt,pred=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]));r=score(gt,pred)
 if len(sys.argv)>3:json.dump(r,open(sys.argv[3],'w'),indent=1,default=float)
 print(json.dumps(r['summary'],indent=1))
