# Metric validation on ground truth with known perturbations: each must read back as the injected error, and nothing else.
import os,json,glob,math,copy,sys,numpy as np
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from score import score,yaw_rot
rng=np.random.default_rng(0);rows=[]
def frame(gt,s,yaw,t):
 R=yaw_rot(yaw);P=copy.deepcopy(gt)
 for c in P['cameras']:c['position']=(s*R@np.array(c['position'])+t).tolist();c['forward']=(R@np.array(c['forward'])).tolist()
 for o in P['objects']:o['center']=(s*R@np.array(o['center'])+t).tolist();o['size']=(np.array(o['size'])*s).tolist()
 return P
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','hypersim','ai_*.json'))):
 gt=json.load(open(f));
 if len(gt['objects'])<3:continue
 r0=score(gt,frame(gt,1/1.37,1.1,[5,-3,2]))['summary']           # same scene in another frame and scale: must be perfect except scale
 noisy=copy.deepcopy(gt)
 for o in noisy['objects']:o['center']=(np.array(o['center'])+rng.normal(0,.2,3)*[1,1,0]).tolist()
 r1=score(gt,noisy)['summary']                                     # 0.2 m/axis planar noise: centre error ~0.2*sqrt(pi/2)=0.25 m
 big=copy.deepcopy(gt)
 for o in big['objects']:o['size']=(np.array(o['size'])*1.3).tolist()
 r2=score(gt,big)['summary']                                       # 1.3x sizes: sizeErr = ln 1.3 = 0.262
 hi=copy.deepcopy(gt)
 for c in hi['cameras']:c['position'][2]+=.5
 r3=score(gt,hi)['summary']                                        # cameras 0.5 m too high, objects unchanged
 drop=copy.deepcopy(gt);drop['objects']=drop['objects'][::2]
 r4=score(gt,drop)['summary']                                      # half the objects missing
 rows.append([gt['scene'],r0['absScaleErr'],r0['centerErrM'],r0['cameraForwardErrDeg'],r0['objectRecall'],r1['centerErrM'],r2['sizeErr'],r3['cameraHeightErrM'],r4['objectRecall']])
a=np.array([r[1:] for r in rows],float)
names=['identity: |log scale| vs 1.37 (want ln1.37=.315)','identity: centre err (want 0)','identity: forward err deg (want 0)','identity: recall (want 1)','noise .2m: centre err (want ~.25)','size x1.3: size err (want .262)','cams +.5m: height err (want .5)','half dropped: recall (want ~.5)']
for n,col in zip(names,a.T):print('%-48s median %.3f  min %.3f  max %.3f'%(n,np.median(col),col.min(),col.max()))
