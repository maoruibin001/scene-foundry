# Two reference points every method must beat, from the ground truth set itself (leave-one-scene-out, no images used):
#  prior   - cameras at the true poses, objects of the true labels placed at the room-type mean position and median size of that label
#  shuffle - true objects of another scene of the same type (layout knowledge with the wrong room)
import os,json,glob,sys,copy,numpy as np,collections
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from score import score
G={json.load(open(f))['scene']:json.load(open(f)) for f in glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','hypersim','ai_*.json'))}
def rel(gt,o):c=np.mean([cc['position'] for cc in gt['cameras']],0);return np.subtract(o['center'],c)
out=collections.defaultdict(list)
for k,gt in G.items():
 if len(gt['objects'])<3:continue
 others=[g for kk,g in G.items() if kk!=k]
 size={};pos={}
 for g in others:
  for o in g['objects']:size.setdefault(o['label'],[]).append(o['size']);pos.setdefault(o['label'],[]).append(rel(g,o))
 cam=np.mean([c['position'] for c in gt['cameras']],0)
 prior=copy.deepcopy(gt)
 for o in prior['objects']:
  if o['label'] in size:o['size']=np.median(size[o['label']],0).tolist();o['center']=(cam+np.median(pos[o['label']],0)).tolist()
 out['prior'].append(score(gt,prior)['summary'])
 same=[g for g in others if g['type']==gt['type']] or others
 sh=copy.deepcopy(gt);donor=same[0];c2=np.mean([c['position'] for c in donor['cameras']],0)
 sh['objects']=[{**o,'center':(cam+np.subtract(o['center'],c2)).tolist()} for o in donor['objects']]
 out['shuffle'].append(score(gt,sh)['summary'])
for n,rows in out.items():
 f=lambda k:np.nanmedian([r[k] if r[k] is not None else np.nan for r in rows])
 print('%-8s n=%d best-fit recall %.2f centreErr %.2f m sizeErr %.2f IoU3d %.3f | anchored recall %.2f'%(n,len(rows),f('objectRecall'),f('centerErrM'),f('sizeErr'),f('meanIoU3d'),np.median([r['anchored']['objectRecall'] for r in rows])))
