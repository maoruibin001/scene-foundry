#!/usr/bin/env python3
# bench-landmark-colour-v1: per-landmark CIELAB offsets between a reference photo and the same-camera render.
# Reads {"pairs":[{referenceIndex,original,frame,baseline?,boxes:[{id,label,box:[x0,y0,x1,y1]}]}]} (boxes normalised to the
# reference frame) from stdin and writes {"references":[{referenceIndex,landmarks:[{id,label,dL,dChroma,dHue}]}]}.
# Boxes come from the reference observation, not segmentation: a box also holds background and occluders.
import sys, json, math
import numpy as np
import cv2


def lab(path, size=None):
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError('无法读取 ' + path)
    if size is not None:
        bgr = cv2.resize(bgr, size, interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    return np.stack([lab[..., 0] * 100.0 / 255.0, lab[..., 1] - 128.0, lab[..., 2] - 128.0], axis=-1)


def region(img, box):
    h, w = img.shape[:2]
    x0, y0, x1, y1 = [min(max(v, 0.0), 1.0) for v in box]
    crop = img[int(y0 * h):max(int(y0 * h) + 1, int(y1 * h)), int(x0 * w):max(int(x0 * w) + 1, int(x1 * w))]
    return crop.reshape(-1, 3).mean(axis=0)


def offsets(o, f):
    chroma = lambda c: math.hypot(c[1], c[2])
    hue = lambda c: math.degrees(math.atan2(c[2], c[1]))
    d_hue = (hue(f) - hue(o) + 180.0) % 360.0 - 180.0
    return {'dL': round(float(f[0] - o[0]), 2), 'dChroma': round(chroma(f) - chroma(o), 2), 'dHue': round(d_hue, 1)}


def main():
    request = json.load(sys.stdin)
    out = []
    for pair in request['pairs']:
        o = lab(pair['original'])
        f = lab(pair['frame'], (o.shape[1], o.shape[0]))
        row = {'referenceIndex': pair['referenceIndex'], 'global': offsets(o.reshape(-1, 3).mean(axis=0), f.reshape(-1, 3).mean(axis=0)),
               'landmarks': [{'id': b['id'], 'label': b['label'], **offsets(region(o, b['box']), region(f, b['box']))} for b in pair['boxes']]}
        # Mean absolute L* change against the previous bench render of the same camera: a silent shading regression shows here.
        if pair.get('baseline'):
            row['baselineDiffL'] = round(float(np.abs(f[..., 0] - lab(pair['baseline'], (o.shape[1], o.shape[0]))[..., 0]).mean()), 2)
        out.append(row)
    json.dump({'version': 'bench-landmark-colour-v1', 'references': out}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
