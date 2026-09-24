"""从本次输入中按数据声明提取局部表面，保留原图与片段的来源。"""
import base64
import hashlib
import json
from pathlib import Path
import sys
import cv2
import numpy as np
from PIL import Image, ImageOps


def extract(root):
    root=Path(root)
    request=json.loads((root/'texture-request.json').read_text())
    registry={};receipts=[]
    reused={r['textureId']:r for r in request.get('reused',[])}
    for t in request['textures']:
        if t['id'] in reused:
            resource=reused[t['id']];texture=resource['texture']
            width,height=texture['width'],texture['height'];raw=base64.b64decode(texture['rgba8'],validate=True)
            if not (0<width<=1024 and 0<height<=1024 and len(raw)==width*height*4):raise ValueError('复用材质像素无效')
            output=root/(t['id']+'.png');Image.frombytes('RGBA',(width,height),raw).save(output)
            registry[t['id']]=texture
            receipts.append({'id':t['id'],'description':t['description'],'assetId':resource['assetId'],'reason':resource['reason'],'source':resource['source'],'referenceSha256':resource['referenceSha256'],'file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'pixelSha256':hashlib.sha256(raw).hexdigest(),'method':'复用资源库现有像素，不重复生成；来源保留，视觉质量待本次验收'})
            continue
        index=t['referenceIndex']-1
        if not 0<=index<len(request['references']):raise ValueError('参考图引用越界')
        path=Path(request['references'][index]['path'])
        with Image.open(path) as image: pixels=np.array(ImageOps.exif_transpose(image).convert('RGB'))
        height,width=pixels.shape[:2];size=t['size']
        if size not in (256,512):raise ValueError('片段尺寸无效')
        quad=np.array(t['quad'],dtype=np.float32)*[width-1,height-1]
        if quad.shape!=(4,2) or not np.isfinite(quad).all():raise ValueError('片段坐标无效')
        transform=cv2.getPerspectiveTransform(quad.astype(np.float32),np.array([[0,0],[size-1,0],[size-1,size-1],[0,size-1]],np.float32))
        tile=cv2.warpPerspective(pixels,transform,(size,size),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
        output=root/(t['id']+'.png');Image.fromarray(tile).save(output)
        rgba=np.concatenate([tile,np.full((size,size,1),255,dtype=np.uint8)],axis=-1)
        registry[t['id']]={'width':size,'height':size,'rgba8':base64.b64encode(rgba.tobytes()).decode(),'colorSpace':'srgb'}
        receipts.append({**t,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'method':'参考图局部四边形透视纠正；保留原拍摄光照，不生成虚构细节'})
    (root/'texture-registry.json').write_text(json.dumps(registry,separators=(',',':'))+'\n')
    (root/'texture-provenance.json').write_text(json.dumps({'textures':receipts,'source':'本次任务输入','qualityAssessment':'not-run'},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'textures':len(registry),'references':len(request['references'])}))


if __name__=='__main__':extract(sys.argv[1])
