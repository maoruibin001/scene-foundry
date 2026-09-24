"""将编译几何的编号缓冲区绘成诊断图；不修改任何参考图或实际渲染帧。"""
import base64
import colorsys
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def draw_maps(path):
    path = Path(path)
    report = json.loads(path.read_text())
    font = ImageFont.load_default(size=22)
    outputs = []
    for n, view in enumerate(report['views'], 1):
        width, height = view['width'], view['height']
        labels = np.frombuffer(base64.b64decode(view['labelsBase64'], validate=True), dtype='<u2').reshape(height, width)
        colors = [(20, 24, 30)] + [tuple(round(c * 255) for c in colorsys.hsv_to_rgb((i * .61803398875) % 1, .65, .9)) for i in range(len(report['palette']))]
        pixels = np.array(colors, dtype=np.uint8)[labels]
        image = Image.fromarray(pixels).resize((width * 4, height * 4), Image.Resampling.NEAREST)
        draw = ImageDraw.Draw(image)
        placed = []
        for item in view['instances']:
            ys, xs = np.where(labels == item['number'])
            if len(xs) < 50:
                continue
            # 编号落在该实例真实采样点，不能落到轮廓空洞/其他物体上。
            index = np.argmin((xs - np.mean(xs)) ** 2 + (ys - np.mean(ys)) ** 2)
            xy = ((xs[index] + .5) * 4, (ys[index] + .5) * 4)
            text = str(item['number'])
            box = draw.textbbox(xy, text, font=font, anchor='mm')
            box = (box[0]-4, box[1]-3, box[2]+4, box[3]+3)
            if any(box[0] < old[2]+3 and box[2]+3 > old[0] and box[1] < old[3]+3 and box[3]+3 > old[1] for old in placed):
                continue
            placed.append(box)
            draw.rectangle(box, fill=(15, 18, 24))
            draw.text(xy, text, font=font, fill=(255, 255, 255), anchor='mm')
        name = 'visibility-' + str(n) + '.png'
        image.save(path.parent / name)
        outputs.append({'file': name, 'cameraName': view['cameraName'], 'referenceIndex': view['referenceIndex']})
    print(json.dumps(outputs, ensure_ascii=False))


if __name__ == '__main__':
    draw_maps(sys.argv[1])
