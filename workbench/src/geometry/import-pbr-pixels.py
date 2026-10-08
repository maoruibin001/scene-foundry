"""Decode a verified aligned channel set; do not derive detail from base color."""
import base64, hashlib, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

def convert(request):
    size=request['size']
    if size not in (256,512,1024): raise ValueError('Unsupported material resolution')
    if set(request['files'])!={'Diffuse','nor_gl','arm'}: raise ValueError('A complete Diffuse / OpenGL normal / ARM set is required')
    images={}; dimensions=[]
    for channel,file in request['files'].items():
        data=Path(file['path']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=file['sha256']: raise ValueError('Source hash mismatch: '+channel)
        with Image.open(file['path']) as image:
            if image.width<1 or image.height<1 or image.width>8192 or image.height>8192: raise ValueError('Source dimensions out of bounds')
            image.load()
            dimensions.append(image.size)
            images[channel]=np.asarray(image.convert('RGB').resize((size,size),Image.Resampling.BOX)).copy()
    if len(set(dimensions))!=1 or dimensions[0][0]!=dimensions[0][1] or size>dimensions[0][0]: raise ValueError('Material channels must be aligned square images; no upscaling')
    # Renormalize the vector after area filtering, preserving the OpenGL convention.
    normals=images['nor_gl'].astype(np.float64)/127.5-1
    lengths=np.linalg.norm(normals,axis=2,keepdims=True)
    if np.any(lengths<.1): raise ValueError('Invalid normal vectors')
    images['nor_gl']=np.clip(np.rint((normals/lengths+1)*127.5),0,255).astype(np.uint8)
    def pixels(channel,space):
        raw=np.concatenate([images[channel],np.full((size,size,1),255,dtype=np.uint8)],axis=2).tobytes()
        return {'width':size,'height':size,'rgba8':base64.b64encode(raw).decode(),'colorSpace':space}
    return {**pixels('Diffuse','srgb'),'normalTexture':pixels('nor_gl','linear'),'metallicRoughnessTexture':pixels('arm','linear')}

if __name__=='__main__':
    request=json.loads(Path(sys.argv[1]).read_text())
    Path(sys.argv[2]).write_text(json.dumps(convert(request),separators=(',',':'))+'\n')
