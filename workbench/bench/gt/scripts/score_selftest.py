# Metric validation on ground truth with known perturbations: each must read back as the injected error, and nothing else.
import os,json,glob,math,copy,sys,numpy as np
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from score import score,yaw_rot
rng=np.random.default_rng(0);rows=[]
def frame(gt,s,yaw,t):
 R=yaw_rot(yaw);P=copy.deepcopy(gt)
 for c in P['cameras']:c['position']=(s*R@np.array(c['position'])+t).tolist();c['forward']=(R@np.array(c['forward'])).tolist();c['up']=(R@np.array(c['up'])).tolist()
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
# A frame rotated 90 deg with the boxes rotated alike must read zero size error (v3 rotated centres but not box extents).
rot=[]
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','hypersim','ai_*.json'))):
 gt=json.load(open(f))
 if len(gt['objects'])<3:continue
 P=frame(gt,1.0,math.pi/2,[0,0,0])
 for o in P['objects']:s=o['size'];o['size']=[s[1],s[0],s[2]]
 rot.append(score(gt,P)['summary']['sizeErr'])
print('%-48s median %.3f  min %.3f  max %.3f'%('rotated 90 deg: size err (want 0)',np.median(rot),min(rot),max(rot)))
# Too few objects to fit the room: v3 fell back to the camera-only fit and read room-relative camera errors near 0 (a +0.5 m camera
# height read 0). v4 must report them as unmeasurable, and the alignment-free camera errors must still read the injected error.
few=[];pair=[]
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','hypersim','ai_*.json'))):
 gt=json.load(open(f))
 if len(gt['objects'])<3:continue
 P=frame(gt,1/1.37,1.1,[5,-3,2]);P['objects']=P['objects'][:2]
 for c in P['cameras']:c['position'][2]+=.5/1.37
 r=score(gt,P)['summary'];few.append([r['roomFitted'],r['cameraHeightErrM'],r['cameraPositionErrM'],r['cameraForwardErrDeg']])
 P=frame(gt,1/1.37,1.1,[5,-3,2]);r0=score(gt,P)['summary']
 c=P['cameras'][1];Rz=yaw_rot(math.radians(10));c['forward']=(Rz@np.array(c['forward'])).tolist();c['up']=(Rz@np.array(c['up'])).tolist()
 r1=score(gt,P)['summary'];pair.append([r0['relRotErrDeg'],r0['baselineDirErrDeg'],r0['pitchErrDeg'],r1['relRotErrDeg'],r1['baselineDirErrDeg'],r1['pitchErrDeg']])
print('%-48s %d of %d'%('2 objects, cams +.5m: room-fitted (want 0)',sum(1 for x in few if x[0]),len(few)))
print('%-48s %d of %d'%('2 objects: height/position/forward None (want all)',sum(1 for x in few if x[1] is None and x[2] is None and x[3] is None),len(few)))
# v5: a scene with fewer than 8 scored objects is flagged; object metrics from it do not enter set statistics.
ok=lambda sid:(lambda g:score(g,frame(g,1,0,[0,0,0]))['summary']['objectMetricsValid'])(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','hypersim',sid+'.json'))))
print('%-48s %s'%('objectMetricsValid ai_052_009 32 objs (want True)',ok('ai_052_009')));print('%-48s %s'%('objectMetricsValid ai_053_007 4 objs (want False)',ok('ai_053_007')))
b=np.array(pair,float)
for n,col in zip(['identity: relative rotation deg (want 0)','identity: baseline direction deg (want 0)','identity: pitch deg (want 0)',
 'view 2 yawed 10 deg: relative rotation (want 10)','view 2 yawed 10 deg: baseline dir (want 0)','view 2 yawed 10 deg: pitch (want 0)'],b.T):
 print('%-48s median %.3f  min %.3f  max %.3f'%(n,np.median(col),col.min(),col.max()))
