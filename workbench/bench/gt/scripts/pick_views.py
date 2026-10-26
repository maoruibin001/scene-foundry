# For each scene choose two public frames that view the same space from clearly different poses:
# baseline 1-4 m (metres), view-direction angle 25-80 deg, and both frames see the most-shared object boxes.
import sys,os,csv,json,h5py,numpy as np
root='hypersim';A='vendor/hypersim-src/evermotion_dataset/analysis/metadata_images_split_scene_v1.csv'
pub={}
for r in csv.DictReader(open(A)):
  if r['included_in_public_release']=='True':pub.setdefault(r['scene_name'],set()).add((r['camera_name'],int(r['frame_id'])))
out={}
for scene in sorted(os.listdir(root)):
  d=f'{root}/{scene}/_detail';m=float(dict(csv.reader(open(d+'/metadata_scene.csv')))['meters_per_asset_unit'])
  mesh=d+'/mesh/';box=lambda k:h5py.File(mesh+f'metadata_semantic_instance_bounding_box_object_aligned_2d_{k}.hdf5')['dataset'][:]
  P,E=box('positions')*m,box('extents')*m;ok=np.isfinite(P).all(1)&(E.min(1)>.05);P=P[ok]
  frames=[]
  for cam,fid in sorted(pub.get(scene,())):
    f=f'{d}/{cam}';pos=h5py.File(f+'/camera_keyframe_positions.hdf5')['dataset'][fid]*m;R=h5py.File(f+'/camera_keyframe_orientations.hdf5')['dataset'][fid]
    fwd=-R[:,2];rel=P-pos;z=rel@fwd;x=rel@R[:,0];y=rel@R[:,1]
    vis=(z>.3)&(np.abs(x)<z*np.tan(np.radians(30)))&(np.abs(y)<z*np.tan(np.radians(23)))
    frames.append((cam,fid,pos,fwd,vis))
  best=None
  for i,a in enumerate(frames):
    for b in frames[i+1:]:
      base=np.linalg.norm(a[2]-b[2]);ang=np.degrees(np.arccos(np.clip(a[3]@b[3],-1,1)));shared=(a[4]&b[4]).sum()
      if 1<=base<=4 and 25<=ang<=80 and (best is None or shared>best[0]):best=(shared,a,b,base,ang)
  if best:out[scene]={'views':[f'{best[1][0]}/{best[1][1]:04d}',f'{best[2][0]}/{best[2][1]:04d}'],'sharedObjects':int(best[0]),'baselineM':round(float(best[3]),2),'angleDeg':round(float(best[4]),1),'objects':int(ok.sum())}
  else:out[scene]=None
json.dump(out,open('views.json','w'),indent=1)
for k,v in out.items():print(k,v)
