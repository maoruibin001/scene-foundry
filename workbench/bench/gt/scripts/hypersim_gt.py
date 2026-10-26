# usage: python -I hypersim_gt.py <scene id> <out.json> — ground truth in the scoring schema (metres; Hypersim world is Z up)
import sys,json,csv,h5py,numpy as np,math
scene,out=sys.argv[1:3];S=json.load(open('set-hypersim.json'));x=next(s for s in S['scenes'] if s['id']==scene)
d=f'hypersim/{scene}/_detail';m=float(dict(csv.reader(open(d+'/metadata_scene.csv')))['meters_per_asset_unit'])
P=dict(csv.DictReader(open('vendor/hypersim-src/contrib/mikeroberts3000/metadata_camera_parameters.csv')).__next__()) if False else None
cp={r['scene_name']:r for r in csv.DictReader(open('vendor/hypersim-src/contrib/mikeroberts3000/metadata_camera_parameters.csv'))}[scene]
# M_proj row 1 col 1 is cot(vfov/2) for the (tilt-shift free) projection used by the renderer
vfov=2*math.atan(1/float(cp['M_proj_11']))
cams=[]
for i,f in enumerate(x['views']):
 cam,fid=f.split('/');fid=int(fid);pos=h5py.File(f'{d}/{cam}/camera_keyframe_positions.hdf5')['dataset'][fid]*m;R=h5py.File(f'{d}/{cam}/camera_keyframe_orientations.hdf5')['dataset'][fid]
 cams.append({'view':i+1,'position':pos.tolist(),'forward':(-R[:,2]).tolist(),'up':R[:,1].tolist(),'vfov':vfov,'frame':f})
mesh=d+'/mesh/';box=lambda k:h5py.File(mesh+f'metadata_semantic_instance_bounding_box_object_aligned_2d_{k}.hdf5')['dataset'][:]
Pc,E,O=box('positions')*m,box('extents')*m,box('orientations')
rm=f'vendor/hypersim-src/evermotion_dataset/scenes/{scene}/_detail/mesh/';si=h5py.File(rm+'mesh_objects_si.hdf5')['dataset'][:].ravel();sii=h5py.File(rm+'mesh_objects_sii.hdf5')['dataset'][:].ravel()
NYU40=['void','wall','floor','cabinet','bed','chair','sofa','table','door','window','bookshelf','picture','counter','blinds','desk','shelves','curtain','dresser','pillow','mirror','floor mat','clothes','ceiling','books','refrigerator','television','paper','towel','shower curtain','box','whiteboard','person','night stand','toilet','sink','lamp','bathtub','bag','otherstructure','otherfurniture','otherprop']
label={}
for a,b in zip(sii,si):
 if a>=0 and b>0:label.setdefault(int(a),int(b))
# Scored objects: visible in at least one input view (>=0.5% of its pixels from the semantic_instance mask) and >=0.15 m on the longest axis.
vis={}
for f in x['views']:
 cam,fid=f.split('/');mask=h5py.File(f'hypersim/{scene}/images/scene_{cam}_geometry_hdf5/frame.{fid}.semantic_instance.hdf5')['dataset'][:]
 ids,cnt=np.unique(mask[mask>=0],return_counts=True)
 for a,c in zip(ids,cnt):vis[int(a)]=max(vis.get(int(a),0),c/mask.size)
objs=[]
for k in range(len(Pc)):
 if vis.get(k,0)<.005 or E[k].max()<.15:continue
 if not np.isfinite(Pc[k]).all() or k not in label:continue
 lab=NYU40[label[k]];
 if lab in('wall','floor','ceiling','void'):continue
 # extents are along the box axes; express the box in world axes by the absolute rotation (yaw scored separately)
 world=np.abs(O[k])@E[k];yaw=math.atan2(O[k][1,0],O[k][0,0])
 objs.append({'id':k,'label':lab,'center':Pc[k].tolist(),'size':world.tolist(),'yaw':yaw,'visibleFraction':round(vis[k],4)})
json.dump({'scene':scene,'type':x['type'],'metersPerAssetUnit':m,'cameras':cams,'objects':objs},open(out,'w'),indent=1)
print(scene,len(objs),'objects','vfov %.1f'%math.degrees(vfov),'baseline %.2f m'%np.linalg.norm(np.subtract(cams[0]['position'],cams[1]['position'])))
