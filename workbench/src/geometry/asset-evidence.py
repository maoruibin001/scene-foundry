"""资产输入证据：原图局部裁切与真实纹理像素，不补画内容。"""
import base64
import hashlib
import json
import math
from pathlib import Path
import sys
from PIL import Image, ImageOps, ImageDraw


def prepare(root):
    root = Path(root)
    request = json.loads((root / 'request.json').read_text())
    result = []
    for n, crop in enumerate(request['crops']):
        index, box = crop['referenceIndex'] - 1, crop['box']
        if not 0 <= index < len(request['references']) or len(box) != 4 or not all(math.isfinite(v) and 0 <= v <= 1 for v in box) or box[0] >= box[2] or box[1] >= box[3]:
            raise ValueError('资产裁切证据越界')
        source = Path(request['references'][index]['path'])
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
            w, h = image.size
            bounds = (math.floor(box[0] * w), math.floor(box[1] * h), math.ceil(box[2] * w), math.ceil(box[3] * h))
            tile = image.crop(bounds)
            tile.thumbnail((768, 768))
            file = f'crop-{n + 1}.png'
            tile.save(root / file)
        result.append({'file': file, 'label': f"原图局部：{crop['label']}，参考图 {index + 1}", 'referenceIndex': index + 1, 'box': box, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    for n, texture in enumerate(request['textures']):
        w, h = texture['width'], texture['height']
        raw = base64.b64decode(texture['rgba8'], validate=True)
        if not 0 < w <= 1024 or not 0 < h <= 1024 or len(raw) != w * h * 4:
            raise ValueError('贴图像素无效')
        file = f'texture-{n + 1}.png'
        Image.frombytes('RGBA', (w, h), raw).save(root / file)
        result.append({'file': file, 'label': '已提取贴图片段：' + texture['id'], 'textureId': texture['id'], 'pixelSha256': hashlib.sha256(raw).hexdigest()})
    if request.get('contactSheet') and request['textures']:
        textures = [item for item in result if 'textureId' in item]
        sheet = Image.new('RGB', (4 * 256, math.ceil(len(textures) / 4) * 282), '#eeeeee')
        draw = ImageDraw.Draw(sheet)
        for n, item in enumerate(textures):
            x, y = (n % 4) * 256, (n // 4) * 282
            with Image.open(root / item['file']) as tile:
                tile.thumbnail((250, 250))
                sheet.paste(tile.convert('RGB'), (x, y))
            draw.text((x + 4, y + 256), item['textureId'], fill='#111111')
        sheet.save(root / 'textures.png')
    for item in result:
        item['sha256'] = hashlib.sha256((root / item['file']).read_bytes()).hexdigest()
    (root / 'receipt.json').write_text(json.dumps({'version': 'asset-evidence-v1', 'images': result}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    prepare(sys.argv[1])
