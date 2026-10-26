# usage: embed-glb-images.py <in.glb> <texture dir base> <out.glb> — moves external image URIs into the GLB binary chunk
import json,struct,sys,os
src,base,out=sys.argv[1:4];b=open(src,'rb').read()
jl=struct.unpack('<I',b[12:16])[0];j=json.loads(b[20:20+jl]);rest=b[20+jl:]
bl=struct.unpack('<I',rest[0:4])[0];binc=bytearray(rest[8:8+bl])
for im in j.get('images',[]):
  if 'uri' in im:
    data=open(os.path.join(base,im.pop('uri')),'rb').read()
    while len(binc)%4:binc.append(0)
    j.setdefault('bufferViews',[]).append({'buffer':0,'byteOffset':len(binc),'byteLength':len(data)});binc+=data
    im['bufferView']=len(j['bufferViews'])-1;im['mimeType']='image/png'
while len(binc)%4:binc.append(0)
j['buffers'][0]['byteLength']=len(binc)
js=json.dumps(j).encode()
while len(js)%4:js+=b' '
total=12+8+len(js)+8+len(binc)
open(out,'wb').write(struct.pack('<III',0x46546C67,2,total)+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(binc),0x004E4942)+bytes(binc))
