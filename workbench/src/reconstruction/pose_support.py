"""验证多图共享几何的证据；局部物体拟合不能充当整幅画面的配准证明。"""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def spatial_support(a, b, sizes):
    records = []
    for points, size in zip((a, b), sizes):
        coverage = float(cv2.contourArea(cv2.convexHull(points.astype(np.float32))) / np.prod(size)) if len(points) >= 3 else 0.
        cells = np.floor(points / np.asarray(size) * 4).astype(int)
        inside = (cells >= 0).all(1) & (cells < 4).all(1)
        occupied = np.unique(cells[inside], axis=0)
        records.append({'imageCoverage': coverage, 'occupiedCells': len(occupied)})
    return {'passed': len(a) >= 30 and all(r['imageCoverage'] >= .05 and r['occupiedCells'] >= 4 for r in records), 'count': len(a), 'views': records}


def projected(points, rotation, translation, intrinsics):
    camera = points @ rotation.T + np.asarray(translation).reshape(3)
    pixels = camera @ intrinsics.T
    front = camera[:, 2] > 1e-6
    return pixels[:, :2] / np.where(front, camera[:, 2], 1.)[:, None], front


def error_summary(errors, front):
    # 后方点记为失败而不是丢弃，避免只挑投影成功的点。
    bounded = np.where(front & np.isfinite(errors), errors, 1e9)
    return {'medianErrorPixels': float(np.median(bounded)), 'p90ErrorPixels': float(np.percentile(bounded, 90)), 'positiveDepthFraction': float(front.mean())}


def check_pair(a, b, sizes, depth, intrinsics, relative, valid_pixels=None):
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    sizes = np.asarray(sizes, dtype=np.float64)
    if a.shape != b.shape or a.ndim != 2 or a.shape[1] != 2 or sizes.shape != (2, 2) or not np.isfinite(np.concatenate([a.ravel(), b.ravel(), sizes.ravel()])).all() or (sizes <= 0).any():
        raise ValueError('对应点或图像尺寸无效')
    result = {'accepted': False, 'status': 'insufficient-correspondence', 'inputCorrespondences': len(a), 'cameraModified': False}
    if len(a) < 30:
        return result
    h, w = depth.shape
    ks = np.asarray(intrinsics, dtype=np.float64).copy()
    for k, size in zip(ks, sizes):
        k[0] *= size[0] / w
        k[1] *= size[1] / h
    x, y = np.rint(a / sizes[0] * [w, h]).astype(int).T
    inside = (x >= 0) & (x < w) & (y >= 0) & (y < h)
    sample = depth[np.clip(y, 0, h-1), np.clip(x, 0, w-1)]
    valid = inside & np.isfinite(sample) & (sample > 0)
    if valid_pixels is not None:
        valid &= valid_pixels[np.clip(y, 0, h-1), np.clip(x, 0, w-1)]
    a, b, sample = a[valid], b[valid], sample[valid]
    result['validDepthCorrespondences'] = len(a)
    if len(a) < 30:
        return result
    points = (np.column_stack([a, np.ones(len(a))]) @ np.linalg.inv(ks[0]).T) * sample[:, None]
    pixels, front = projected(points, relative[:3, :3], relative[:3, 3], ks[1])
    errors = np.linalg.norm(pixels-b, axis=1)
    original = error_summary(errors, front)
    supported = front & (errors <= 4)
    original['support'] = spatial_support(a[supported], b[supported], sizes)
    original['passed'] = original['medianErrorPixels'] <= 3 and original['p90ErrorPixels'] <= 8 and original['positiveDepthFraction'] >= .95 and original['support']['passed']
    result['predictedCamera'] = original
    # 先按坐标排序，避免匹配器输出顺序影响固定留出集。留出点不参加相机拟合。
    order = np.lexsort((b[:, 1], b[:, 0], a[:, 1], a[:, 0]))
    permutation = np.random.default_rng(0).permutation(order)
    holdout = permutation[:max(8, len(a)//4)]
    training = permutation[len(holdout):]
    cv2.setRNGSeed(0)
    ok, rotation, translation, inliers = cv2.solvePnPRansac(points[training], b[training], ks[1], None, iterationsCount=2000, reprojectionError=4., confidence=.999, flags=cv2.SOLVEPNP_EPNP)
    if not ok or inliers is None or len(inliers) < 6:
        result['status'] = 'unverified-pose-fit'
        return result
    fit_indices = training[inliers.ravel()]
    rotation, translation = cv2.solvePnPRefineLM(points[fit_indices], b[fit_indices], ks[1], None, rotation, translation)
    pixels, front = projected(points, cv2.Rodrigues(rotation)[0], translation, ks[1])
    errors = np.linalg.norm(pixels-b, axis=1)
    support = front & (errors <= 4)
    fitted = {'trainingCount': len(training), 'trainingInliers': int(support[training].sum()), 'heldOutCount': len(holdout), 'heldOutInliers': int(support[holdout].sum()), 'heldOut': error_summary(errors[holdout], front[holdout]), 'support': spatial_support(a[support], b[support], sizes)}
    fitted['passed'] = fitted['trainingInliers'] >= 20 and fitted['heldOutInliers'] >= 8 and fitted['heldOutInliers']/len(holdout) >= .8 and fitted['heldOut']['medianErrorPixels'] <= 3 and fitted['heldOut']['p90ErrorPixels'] <= 8 and fitted['support']['passed']
    result['independentPoseFit'] = fitted
    result['accepted'] = original['passed'] and fitted['passed']
    result['status'] = 'observed-geometry-consistent' if result['accepted'] else 'insufficient-spatial-support' if not fitted['support']['passed'] else 'held-out-pose-mismatch' if not fitted['passed'] else 'predicted-camera-mismatch'
    return result


def check_pose_support(root):
    root = Path(root)
    prediction_path, correspondence_path = root/'prediction.npz', root/'correspondences.npz'
    receipt = json.loads((root/'matching-receipt.json').read_text())
    if receipt['predictionSha256'] != digest(prediction_path) or receipt['correspondencesSha256'] != digest(correspondence_path):
        raise ValueError('配准证据与当前深度或对应点不一致')
    data = np.load(prediction_path, allow_pickle=False)
    matches = np.load(correspondence_path, allow_pickle=False)
    count = len(data['depth'])
    if receipt.get('referenceSha256') != [digest(root/f'reference-{i+1}.png') for i in range(count)]:
        raise ValueError('配准证据缺少当前参考图片的完整来源')
    pairs = []
    for i in range(count):
        for j in range(i+1, count):
            prefix = f'pair_{i}_{j}'
            if prefix+'_a' not in matches:
                pairs.append({'references': [i+1, j+1], 'accepted': False, 'status': 'insufficient-correspondence'})
                continue
            sizes = matches[prefix+'_sizes']
            ext = np.repeat(np.eye(4)[None], 2, axis=0)
            ext[:, :3] = data['extrinsics'][[i, j]]
            relative = ext[1] @ np.linalg.inv(ext[0])
            directions = []
            for first, second, sa, sb, transform in [(i, j, 'a', 'b', relative), (j, i, 'b', 'a', np.linalg.inv(relative))]:
                directions.append(check_pair(matches[prefix+'_'+sa], matches[prefix+'_'+sb], sizes if sa == 'a' else sizes[::-1], data['depth'][first], data['intrinsics'][[first, second]], transform, data['valid_pixels'][first] if 'valid_pixels' in data else None))
            pairs.append({'references': [i+1, j+1], 'accepted': all(d['accepted'] for d in directions), 'directions': directions})
    reached = {0}
    for _ in range(count):
        for pair in pairs:
            a, b = (v-1 for v in pair['references'])
            if pair['accepted'] and (a in reached or b in reached):
                reached |= {a, b}
    accepted = count > 1 and len(reached) == count
    result = {'version': 'pose-support-v1', 'accepted': accepted, 'status': 'observed-geometry-consistent' if accepted else 'unverified-multiview-geometry', 'referenceCount': count, 'pairs': pairs, 'predictionSha256': digest(prediction_path), 'correspondencesSha256': digest(correspondence_path), 'matchingReceiptSha256': digest(root/'matching-receipt.json'), 'referenceSha256': [digest(root/f'reference-{i+1}.png') for i in range(count)], 'cameraModified': False, 'qualityAssessment': 'not-run', 'limitations': '只检查已观测共同表面的配准；通过不代表隐藏部分、完整场景或视觉质量达标。拟合相机仅作诊断，不替换模型相机。'}
    (root/'pose-support.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root')
    print(json.dumps(check_pose_support(parser.parse_args().root), ensure_ascii=False))
