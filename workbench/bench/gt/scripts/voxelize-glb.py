# usage: voxelize-glb.py <in.glb (embedded images)> <out.glb> <scale> <unit> — samples textured triangles into a cube grid, one material per quantized colour
import json,struct,sys,io
import numpy as np
from PIL import Image
src,out,scale,unit=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4])
b=open(src,'rb').read();jl=struct.unpack('<I',b[12:16])[0];j=json.loads(b[20:20+jl]);binc=b[20+jl+8:]
def acc(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];dt={5126:np.float32,5123:np.uint16,5125:np.uint32,5121:np.uint8}[a['componentType']]
  o=v.get('byteOffset',0)+a.get('byteOffset',0);return np.frombuffer(binc,dt,a['count']*n,o).reshape(-1,n) if n>1 else np.frombuffer(binc,dt,a['count'],o)
imgs=[np.asarray(Image.open(io.BytesIO(binc[j['bufferViews'][im['bufferView']].get('byteOffset',0):][:j['bufferViews'][im['bufferView']]['byteLength']])).convert('RGB')) for im in j.get('images',[])]
def world(node,parent=np.eye(4)):
  m=np.eye(4)
  if 'matrix' in node:m=np.array(node['matrix']).reshape(4,4).T
  else:
    t=node.get('translation',[0,0,0]);r=node.get('rotation',[0,0,0,1]);s=node.get('scale',[1,1,1]);x,y,z,w=r
    R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    m[:3,:3]=R*np.array(s);m[:3,3]=t
  return parent@m
cells={}
def visit(ni,parent):
  n=j['nodes'][ni];M=world(n,parent)
  if 'mesh' in n:
    for p in j['meshes'][n['mesh']]['primitives']:
      P=acc(p['attributes']['POSITION']);P=(np.c_[P,np.ones(len(P))]@M.T)[:,:3]*scale
      I=acc(p['indices']).reshape(-1,3) if 'indices' in p else np.arange(len(P)).reshape(-1,3)
      mat=j['materials'][p.get('material',0)];pbr=mat.get('pbrMetallicRoughness',{});fac=np.array(pbr.get('baseColorFactor',[1,1,1,1])[:3])
      tex=pbr.get('baseColorTexture');UV=acc(p['attributes']['TEXCOORD_0']) if tex and 'TEXCOORD_0' in p['attributes'] else None
      img=imgs[j['textures'][tex['index']]['source']] if tex else None
      for t in I:
        a,bb,c=P[t];area=np.linalg.norm(np.cross(bb-a,c-a));k=max(3,int(np.ceil(np.sqrt(area)/unit*3)))
        for u in np.linspace(0,1,k):
          for v in np.linspace(0,1-u,max(1,int(k*(1-u)))):
            w=1-u-v;q=w*a+u*bb+v*c;key=tuple(np.floor(q/unit).astype(int))
            col=fac*255
            if img is not None:
              uv=w*UV[t[0]]+u*UV[t[1]]+v*UV[t[2]];h,wd=img.shape[:2];col=img[int(np.clip(uv[1]%1*h,0,h-1)),int(np.clip(uv[0]%1*wd,0,wd-1))]*fac
            cells.setdefault(key,[]).append(col)
  for c in n.get('children',[]):visit(c,M)
for r in j['scenes'][j.get('scene',0)]['nodes']:visit(r,np.eye(4))
# Solid fill: a cell inside the closed surface along +X/+Y/+Z parity (majority of three axes) takes the nearest surface colour in that column.
if '--solid' in sys.argv:
  occ0=set(cells);ks=np.array(list(occ0));lo,hi=ks.min(0),ks.max(0)
  def inside(c):
    votes=0
    for ax in range(3):
      col=[k for k in occ0 if all(k[i]==c[i] for i in range(3) if i!=ax)]
      runs=sorted(k[ax] for k in col);cross=sum(1 for i,v in enumerate(runs) if v>c[ax] and (i==0 or runs[i-1]!=v-1))
      votes+=cross%2
    return votes>=2
  cols_by={}
  for k in occ0:cols_by.setdefault((k[0],k[1]),[]).append(k)
  for x in range(lo[0],hi[0]+1):
    for y in range(lo[1],hi[1]+1):
      for z in range(lo[2],hi[2]+1):
        c=(x,y,z)
        if c in cells:continue
        if inside(c):
          near=min(occ0,key=lambda k:abs(k[0]-x)+abs(k[1]-y)+abs(k[2]-z));cells[c]=cells[near]
keys=list(cells)
# dominant quantized colour of each cell (a mean of texels across a texture-atlas seam yields colours absent from the model)
def mode(cs):
  qs=[tuple((np.round(np.asarray(c)/32)*32).clip(0,255).astype(int)) for c in cs]
  return max(set(qs),key=qs.count)
q=np.array([mode(cells[k]) for k in keys]);pal={};idx=[pal.setdefault(tuple(c),len(pal)) for c in q]
occ=set(keys);F=[((1,0,0),[(1,0,0),(1,1,0),(1,1,1),(1,0,1)]),((-1,0,0),[(0,0,0),(0,0,1),(0,1,1),(0,1,0)]),((0,1,0),[(0,1,0),(0,1,1),(1,1,1),(1,1,0)]),((0,-1,0),[(0,0,0),(1,0,0),(1,0,1),(0,0,1)]),((0,0,1),[(0,0,1),(1,0,1),(1,1,1),(0,1,1)]),((0,0,-1),[(0,0,0),(0,1,0),(1,1,0),(1,0,0)])]
groups=[[[],[],[]] for _ in pal]
for k,pi in zip(keys,idx):
  for nrm,quad in F:
    if (k[0]+nrm[0],k[1]+nrm[1],k[2]+nrm[2]) in occ:continue
    g=groups[pi];base=len(g[0])
    for cq in quad:g[0].append([(k[i]+cq[i])*unit for i in range(3)]);g[1].append(nrm)
    g[2]+= [base,base+1,base+2,base,base+2,base+3]
if out.endswith('.json'):
  import json as J;J.dump([{'color':[int(x) for x in c],'positions':[[float(v[0]),float(-v[2]),float(v[1])] for v in g[0]],'triangles':[[int(x) for x in g[2][i:i+3]] for i in range(0,len(g[2]),3)]} for (c,pi),g in zip(pal.items(),groups) if g[2]],open(out,'w'));print('cells',len(keys),'colours',len(pal));sys.exit()
buf=bytearray();views=[];accs=[];prims=[];mats=[]
def add(arr,typ,comp,target,mm=False):
  while len(buf)%4:buf.append(0)
  views.append({'buffer':0,'byteOffset':len(buf),'byteLength':arr.nbytes,'target':target});buf.extend(arr.tobytes())
  a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr),'type':typ}
  if mm:a['min']=arr.min(0).tolist();a['max']=arr.max(0).tolist()
  accs.append(a);return len(accs)-1
srgb=lambda c:((c/255)**2.2).tolist()+[1]
for (c,pi),g in zip(pal.items(),groups):
  if not g[2]:continue
  P=np.array(g[0],np.float32);N=np.array(g[1],np.float32);I=np.array(g[2],np.uint32)
  prims.append({'attributes':{'POSITION':add(P,'VEC3',5126,34962,True),'NORMAL':add(N,'VEC3',5126,34962),'TEXCOORD_0':add(np.tile(np.array([[0,0],[1,0],[1,1],[0,1]],np.float32),(len(P)//4,1)),'VEC2',5126,34962)},'indices':add(I,'SCALAR',5125,34963),'material':len(mats)})
  mats.append({'name':'vox_%d'%pi,'pbrMetallicRoughness':{'baseColorFactor':srgb(np.array(c)),'metallicFactor':0,'roughnessFactor':1}})
while len(buf)%4:buf.append(0)
G={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'voxel','mesh':0}],'meshes':[{'name':'voxel','primitives':prims}],'materials':mats,'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':len(buf)}]}
js=json.dumps(G).encode()
while len(js)%4:js+=b' '
open(out,'wb').write(struct.pack('<III',0x46546C67,2,28+len(js)+len(buf))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(buf),0x004E4942)+bytes(buf))
mn=np.min(keys,0)*unit;mx=(np.max(keys,0)+1)*unit;print('cells',len(keys),'colours',len(pal),'bounds',mn.tolist(),mx.tolist())
