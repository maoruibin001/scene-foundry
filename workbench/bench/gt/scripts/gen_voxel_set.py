# usage: python -I gen_voxel_set.py <out dir> <n> <seed> — procedural voxel dioramas from Kenney CC0 models with exact ground truth.
# Every object is voxelized solid at the scene cell size and placed on a square ground slab, without overlap. Two orthographic
# reference views (front-right / front-left isometric, as our voxel jobs use) are rendered later by the engine from the same
# cameras recorded here. Layout rules are generic, not copied from any pipeline output, so a method cannot score by replaying
# its own habits.
import json,sys,os,math,random,subprocess
import numpy as np
out,N,seed=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]);os.makedirs(out,exist_ok=True)
HERE=os.path.dirname(os.path.abspath(__file__))
# Kenney Survival Kit (CC0) GLBs with textures embedded by embed-glb-images.py; see ../README.md for the download step.
EMB=os.environ.get('KENNEY_EMBEDDED_DIR') or sys.exit('set KENNEY_EMBEDDED_DIR (Kenney Survival Kit GLBs with embedded textures)')
VOX=os.path.join(HERE,'voxelize-glb.py')
NATIVE=json.load(open(os.path.join(HERE,'..','voxel','kenney-sizes.json')))
CELL=.125
# category -> (models, target height m, count range, ground-only)
CATS={'tent':(['tent'],2.0,(1,2)),'campfire':(['campfire-pit'],.45,(0,1)),'tree':(['tree','tree-tall','tree-autumn'],4.0,(4,9)),
 'rock':(['rock-a','rock-b','rock-c'],.9,(2,5)),'log':(['tree-log'],.5,(1,3)),'barrel':(['barrel'],1.0,(0,2)),'crate':(['box-large','chest'],.8,(0,2)),
 'workbench':(['workbench'],.9,(0,1)),'fence':(['fence'],1.0,(0,3)),'signpost':(['signpost'],1.6,(0,1)),'stump':(['tree-trunk'],.5,(0,3)),'bedroll':(['bedroll'],.3,(0,1))}
cache=os.path.join(out,'_vox');os.makedirs(cache,exist_ok=True)
def voxel(model,scale):
  key=f'{model}@{scale:.4f}';p=os.path.join(cache,key+'.json')
  if not os.path.exists(p):subprocess.run(['python3','-I',VOX,os.path.join(EMB,model+'.glb'),p,str(scale),str(CELL),'--solid'],check=True,capture_output=True)
  return json.load(open(p))
def bounds(groups):
  P=np.vstack([np.array(g['positions']) for g in groups]);return P.min(0),P.max(0)
rng=random.Random(seed)
for n in range(N):
  sid=f'vox_{seed}_{n:02d}';half=rng.choice([5,6,7]);placed=[];objs=[]
  plan=[(c,rng.randint(*CATS[c][2])) for c in CATS];rng.shuffle(plan)
  for cat,count in plan:
    models,height,_=CATS[cat]
    for _ in range(count):
      model=rng.choice(models);s=round(height/NATIVE[model][1]*rng.uniform(.85,1.15),3);g=voxel(model,s);lo,hi=bounds(g)
      yaw=rng.choice([0,90,180,270]);sx,sy=(hi[0]-lo[0],hi[1]-lo[1]) if yaw in(0,180) else (hi[1]-lo[1],hi[0]-lo[0])  # voxel json is Z-up
      for _try in range(60):
        cx=round(rng.uniform(-half+sx/2+.25,half-sx/2-.25)/CELL)*CELL;cy=round(rng.uniform(-half+sy/2+.25,half-sy/2-.25)/CELL)*CELL
        box=(cx-sx/2-.25,cy-sy/2-.25,cx+sx/2+.25,cy+sy/2+.25)
        if all(box[2]<=b[0] or box[0]>=b[2] or box[3]<=b[1] or box[1]>=b[3] for b in placed):
          placed.append(box);objs.append({'label':cat,'model':model,'scale':s,'yaw':math.radians(yaw),'center':[cx,cy,(hi[2]-lo[2])/2],'size':[sx,sy,hi[2]-lo[2]],'voxels':os.path.relpath(os.path.join(cache,f'{model}@{s:.4f}.json'),out)});break
  # two isometric orthographic views from the front-right and front-left, 45 deg yaw, 35.264 deg down, framing the slab
  d=3*half;cams=[]
  for i,az in enumerate([math.radians(45),math.radians(135)]):
    pos=[d*math.cos(az)*math.cos(math.radians(35.264)),-d*math.sin(az)*math.cos(math.radians(35.264)),d*math.sin(math.radians(35.264))]
    f=np.array([0,0,.5])-np.array(pos);f/=np.linalg.norm(f)
    cams.append({'view':i+1,'position':pos,'forward':f.tolist(),'up':[0,0,1],'projection':'orthographic','orthographicHeight':round(1.55*half*2*.6,2),'vfov':0.0})
  json.dump({'scene':sid,'type':'voxel-camp','kind':'voxel','cellSize':CELL,'slab':{'half':half,'thickness':1.0},'cameras':cams,'objects':objs},open(os.path.join(out,sid+'.json'),'w'),indent=1)
  print(sid,'slab',2*half,'m',len(objs),'objects',sorted({o['label'] for o in objs}))
