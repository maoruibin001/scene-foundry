# usage: python -I hypersim_fetch.py <out dir> <scene> [scene...] — pull selected members from the remote Hypersim zip with HTTP range reads
import sys,os,struct,zlib,urllib.request,re
out=sys.argv[1];BASE='https://docs-assets.developer.apple.com/ml-research/datasets/hypersim/v1/scenes/'
WANT=re.compile(r'(_detail/metadata_scene\.csv|_detail/metadata_cameras\.csv|_detail/cam_\d\d/camera_keyframe_(orientations|positions)\.hdf5|_detail/mesh/metadata_semantic_instance_bounding_box_object_aligned_2d_(extents|orientations|positions)\.hdf5|_detail/mesh/mesh_objects_si(i)?\.hdf5|images/scene_cam_\d\d_final_preview/frame\.\d{4}\.color\.jpg|images/scene_cam_\d\d_geometry_hdf5/frame\.\d{4}\.(semantic_instance|semantic|depth_meters)\.hdf5)$')
def rng(url,a,b):
  q=urllib.request.Request(url,headers={'Range':'bytes=%d-%d'%(a,b)});return urllib.request.urlopen(q,timeout=120).read()
def size(url):return int(urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=60).headers['Content-Length'])
def central(url):
  n=size(url);tail=rng(url,max(0,n-(1<<20)),n-1);i=tail.rfind(b'PK\x06\x06')
  if i>=0:cd_size,cd_off=struct.unpack('<QQ',tail[i+40:i+56])
  else:i=tail.rfind(b'PK\x05\x06');cd_size,cd_off=struct.unpack('<II',tail[i+12:i+20])
  cd=rng(url,cd_off,cd_off+cd_size-1);p=0;ents=[]
  while p<len(cd) and cd[p:p+4]==b'PK\x01\x02':
    meth,=struct.unpack('<H',cd[p+10:p+12]);csz,usz=struct.unpack('<II',cd[p+20:p+28]);nl,el,cl=struct.unpack('<HHH',cd[p+28:p+34]);off,=struct.unpack('<I',cd[p+42:p+46])
    name=cd[p+46:p+46+nl].decode();ex=cd[p+46+nl:p+46+nl+el];q=0
    while q+4<=len(ex):
      hid,hl=struct.unpack('<HH',ex[q:q+4]);d=ex[q+4:q+4+hl];k=0
      if hid==1:
        if usz==0xFFFFFFFF:usz,=struct.unpack('<Q',d[k:k+8]);k+=8
        if csz==0xFFFFFFFF:csz,=struct.unpack('<Q',d[k:k+8]);k+=8
        if off==0xFFFFFFFF:off,=struct.unpack('<Q',d[k:k+8]);k+=8
      q+=4+hl
    ents.append((name,meth,csz,off));p+=46+nl+el+cl
  return ents
FRAMES=os.environ.get('FRAMES')  # e.g. cam_00/0000,cam_00/0050 restricts per-frame files
def keep(name):
  m=re.search(r'scene_(cam_\d\d)_(final_preview|geometry_hdf5)/frame\.(\d{4})\.',name)
  return not m or not FRAMES or f'{m.group(1)}/{m.group(3)}' in FRAMES.split(',')
for scene in sys.argv[2:]:
  url=BASE+scene+'.zip';ents=[e for e in central(url) if WANT.search(e[0]) and keep(e[0])];got=0
  for name,meth,csz,off in ents:
    dst=os.path.join(out,name)
    if os.path.exists(dst):continue
    h=rng(url,off,off+29);nl,el=struct.unpack('<HH',h[26:30]);data=rng(url,off+30+nl+el,off+30+nl+el+csz-1)
    data=zlib.decompress(data,-15) if meth==8 else data
    os.makedirs(os.path.dirname(dst),exist_ok=True);open(dst,'wb').write(data);got+=len(data)
  print(scene,len(ents),'files',round(got/1e6,1),'MB',flush=True)
