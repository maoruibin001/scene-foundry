"""只截取真实输入和渲染像素用于诊断；不改色、不生成画面、不评分。"""
import sys, json, hashlib, math
from pathlib import Path
from PIL import Image, ImageStat

folder = Path(sys.argv[1])
request = json.loads((folder / 'region-request.json').read_text())
result = []
for index, item in enumerate(request['images']):
    path = Path(item['path'])
    rect = item['rect']
    if len(rect) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in rect) or rect[0] >= rect[2] or rect[1] >= rect[3]:
        raise ValueError('裁切坐标无效')
    with Image.open(path) as image:
        image = image.convert('RGB')
        box = (math.floor(rect[0]*image.width), math.floor(rect[1]*image.height), math.ceil(rect[2]*image.width), math.ceil(rect[3]*image.height))
        if box[2]-box[0] < 8 or box[3]-box[1] < 8:
            raise ValueError('诊断区域过小，至少需要8像素宽高')
        crop = image.crop(box)
        # 显示域灰度统计只是相对明暗诊断，不是物理照度或还原质量。
        gray = crop.convert('L'); hist = gray.histogram(); count = sum(hist)
        def quantile(ratio):
            cumulative = 0
            for value, frequency in enumerate(hist):
                cumulative += frequency
                if cumulative >= count * ratio:
                    return value
        stats = ImageStat.Stat(gray)
        file = 'region-' + str(index+1) + '.png'
        original_size = crop.size
        crop.thumbnail((960, 960), Image.Resampling.LANCZOS)
        crop.save(folder / file)
        result.append({'label':item['label'], 'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(), 'sourceSize':list(image.size), 'normalizedRect':rect, 'pixelRect':list(box), 'cropSize':list(original_size), 'displaySize':list(crop.size), 'file':file, 'sha256':hashlib.sha256((folder/file).read_bytes()).hexdigest(), 'displayLuma':{'mean':round(stats.mean[0],2),'stddev':round(stats.stddev[0],2),'p10':quantile(.1),'p50':quantile(.5),'p90':quantile(.9)}})
(folder/'region-result.json').write_text(json.dumps({'version':'visual-region-v1','images':result,'boundary':'裁切坐标由调用者选择，未做物体对应或曝光匹配；灰度差不能自动解释为好坏，不参与评分。'}, ensure_ascii=False, indent=2))
