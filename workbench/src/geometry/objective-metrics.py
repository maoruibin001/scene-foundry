#!/usr/bin/env python3
# objective-reference-metrics-v1: deterministic, alignment-robust colour/structure statistics between a
# rendered frame and its original reference photo. Reads {"pairs":[{referenceIndex,original,frame}]} from
# stdin, writes {"references":[{referenceIndex,metrics|error}]} to stdout. NON-GATING: a cross-check only.
import sys, json
import numpy as np
import cv2


def _split_lab(bgr):
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0] * 100.0 / 255.0            # OpenCV 8-bit L in [0,255] -> [0,100]
    a = lab[..., 1] - 128.0                     # a,b centred at 128
    b = lab[..., 2] - 128.0
    return L, a, b


def _metrics(original, frame):
    o = cv2.imread(original, cv2.IMREAD_COLOR)
    f = cv2.imread(frame, cv2.IMREAD_COLOR)
    if o is None:
        raise ValueError('无法读取原图 ' + original)
    if f is None:
        raise ValueError('无法读取渲染帧 ' + frame)
    f = cv2.resize(f, (o.shape[1], o.shape[0]), interpolation=cv2.INTER_AREA)
    Lo, ao, bo = _split_lab(o)
    Lf, af, bf = _split_lab(f)

    # Global luminance / chroma offsets. Negative lumDelta => render darker than photo (our "膜面偏暗" case).
    lum_delta = float(Lf.mean() - Lo.mean())
    chroma_o = np.sqrt(ao ** 2 + bo ** 2)
    chroma_f = np.sqrt(af ** 2 + bf ** 2)
    chroma_delta = float(chroma_f.mean() - chroma_o.mean())  # negative => render less saturated

    # Hue/palette distribution shift: L1 distance of normalised 2-D (a,b) histograms, 0..1.
    def ab_hist(a, b):
        h, _, _ = np.histogram2d(a.ravel(), b.ravel(), bins=32, range=[[-128, 128], [-128, 128]])
        s = h.sum()
        return h / s if s > 0 else h
    ab_hist_dist = float(np.abs(ab_hist(ao, bo) - ab_hist(af, bf)).sum() / 2.0)

    # Luminance distribution shift (0..1).
    def l_hist(L):
        h, _ = np.histogram(L.ravel(), bins=32, range=(0, 100))
        s = h.sum()
        return h / s if s > 0 else h
    lum_hist_dist = float(np.abs(l_hist(Lo) - l_hist(Lf)).sum() / 2.0)

    # Coarse structure agreement: zero-mean gradient-magnitude correlation on a 64x64 grey downsample.
    # Alignment-sensitive (estimated pose), so informational, not a fidelity score.
    def grad(bgr):
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        g = cv2.resize(g, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0)
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1)
        return np.sqrt(gx ** 2 + gy ** 2).ravel()
    so, sf = grad(o), grad(f)
    so, sf = so - so.mean(), sf - sf.mean()
    denom = float(np.linalg.norm(so) * np.linalg.norm(sf))
    struct_corr = float((so @ sf) / denom) if denom > 1e-6 else 0.0

    return {
        'lumDelta': round(lum_delta, 2),         # render minus photo mean lightness (<0 = darker)
        'chromaDelta': round(chroma_delta, 2),   # render minus photo mean chroma (<0 = less saturated)
        'abHistDistance': round(ab_hist_dist, 4),  # 0..1 hue/palette shift (0 = identical palette)
        'lumHistDistance': round(lum_hist_dist, 4),  # 0..1 brightness-distribution shift
        'structCorr': round(struct_corr, 4),     # -1..1 coarse layout agreement (alignment-sensitive)
    }


def main():
    data = json.load(sys.stdin)
    out = []
    for p in data.get('pairs', []):
        row = {'referenceIndex': p.get('referenceIndex')}
        try:
            row['metrics'] = _metrics(p['original'], p['frame'])
        except Exception as e:  # one bad pair never fails the batch
            row['error'] = str(e)[:200]
        out.append(row)
    json.dump({'version': data.get('version'), 'references': out}, sys.stdout)


if __name__ == '__main__':
    main()
