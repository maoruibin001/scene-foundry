"""把共同坐标系中的多图深度变为固定三维网格，贴图来自对应原图的可见表面。"""
from __future__ import annotations
import argparse
import base64
import json
from pathlib import Path
import numpy as np
from PIL import Image
from pose_support import check_pose_support

# OpenCV 世界坐标 -> 场景生成器 Z-up；Engine 再映射到 [x,-y,-z]。
AXIS = np.array([[1., 0., 0.], [0., 0., 1.], [0., -1., 0.]])


def world_points(depth, intrinsics, extrinsics):
    h, w = depth.shape
    y, x = np.mgrid[:h, :w]
    # 与固定版本的官方 unproject_depth 一致：相机内参使用整数像素坐标。
    rays = np.stack([x, y, np.ones_like(x)], -1) @ np.linalg.inv(intrinsics).T
    camera_points = rays * depth[..., None]
    ext = np.eye(4)
    ext[:3] = extrinsics[:3]
    c2w = np.linalg.inv(ext)
    return camera_points @ c2w[:3, :3].T + c2w[:3, 3], c2w


def grid_faces(depth, confidence, rows, cols, edge_threshold=.08, content_mask=None):
    d = depth[np.ix_(rows, cols)]
    c = confidence[np.ix_(rows, cols)]
    threshold = np.percentile(confidence, 2)
    valid = np.isfinite(d) & (d > 0) & np.isfinite(c) & (c >= threshold)
    if content_mask is not None:
        valid &= content_mask[np.ix_(rows, cols)]
    index = np.arange(d.size).reshape(d.shape)
    a, b, c_, e = index[:-1, :-1], index[:-1, 1:], index[1:, :-1], index[1:, 1:]
    faces = np.concatenate([np.stack([a, c_, b], -1).reshape(-1, 3), np.stack([b, c_, e], -1).reshape(-1, 3)])
    depths = d.ravel()[faces]
    mask = valid.ravel()[faces].all(1) & ((depths.max(1) - depths.min(1)) / np.maximum(depths.mean(1), 1e-8) <= edge_threshold)
    return faces[mask]


def rasterized_coverage(pixels, faces, shape):
    """记录实际保留下来的三角形覆盖，防止把先图中的空洞误当作已有几何。"""
    coverage = np.zeros(shape, dtype=bool)
    for tri in pixels[faces]:
        lo=np.maximum(np.ceil(tri.min(0)).astype(int),0)
        hi=np.minimum(np.floor(tri.max(0)).astype(int),np.array(shape[::-1])-1)
        if np.any(hi<lo):
            continue
        y,x=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        p=np.stack([x,y],-1)
        tests=[]
        for a,b in zip(tri,np.roll(tri,-1,axis=0)):
            tests.append((b[0]-a[0])*(p[...,1]-a[1])-(b[1]-a[1])*(p[...,0]-a[0]))
        tests=np.stack(tests)
        inside=(tests>=-1e-6).all(0)|(tests<=1e-6).all(0)
        coverage[lo[1]:hi[1]+1,lo[0]:hi[0]+1] |= inside
    return coverage


def remove_duplicate_faces(points, faces, view, depths, intrinsics, extrinsics, coverage):
    """对另一张图深度也支持的重叠表面采用稳定的先图归属；遮挡后的独有表面保留。"""
    if not view:
        return faces, 0
    samples3d = np.concatenate([points[faces],points[faces].mean(1,keepdims=True)],axis=1)
    center = samples3d.reshape(-1,3)
    keep = np.ones(len(faces), dtype=bool)
    for other in range(view):
        ext, k, dep = extrinsics[other], intrinsics[other], depths[other]
        cam = center @ ext[:3, :3].T + ext[:3, 3]
        projected = cam @ k.T
        z = cam[:, 2]
        u = np.round(projected[:, 0] / np.maximum(z, 1e-8)).astype(int)
        v = np.round(projected[:, 1] / np.maximum(z, 1e-8)).astype(int)
        inside = (z > 0) & (u >= 0) & (v >= 0) & (u < dep.shape[1]) & (v < dep.shape[0])
        samples = dep[np.clip(v, 0, dep.shape[0]-1), np.clip(u, 0, dep.shape[1]-1)]
        agrees = np.abs(samples-z) / np.maximum(samples, 1e-8) < .025
        occupied = coverage[other][np.clip(v,0,dep.shape[0]-1),np.clip(u,0,dep.shape[1]-1)]
        keep &= ~(inside & agrees & occupied).reshape(-1,4).all(1)
    return faces[keep], int((~keep).sum())


def reconstruct(root, stride=2, edge_threshold=.08, diagnostic=False):
    root = Path(root)
    acceptance = None
    if not diagnostic:
        if not (root/'matching-receipt.json').is_file():
            raise ValueError('缺少多图配准证据；单图或弱重叠图不能作为已验证的共同几何导出。诊断导出需显式使用 --diagnostic。')
        acceptance = check_pose_support(root)
        if not acceptance['accepted']:
            raise ValueError('多图几何配准未通过，已停止表面合并；详见 pose-support.json。')
    data = np.load(root / "prediction.npz")
    depths, confs, exts, ints = [data[k] for k in ["depth", "depth_conf", "extrinsics", "intrinsics"]]
    if depths.ndim == 4 and depths.shape[-1] == 1:
        depths = depths[..., 0]
    if confs.ndim == 4 and confs.shape[-1] == 1:
        confs = confs[..., 0]
    if depths.shape != confs.shape or len(depths) != len(exts) or len(depths) != len(ints):
        raise ValueError("深度、置信度和相机数量不一致")
    if not all(np.isfinite(array).all() for array in [depths,confs,exts,ints]) or np.any(depths<=0):
        raise ValueError("重建数值无效")
    masks=data["valid_pixels"] if "valid_pixels" in data else np.ones_like(depths,dtype=bool)
    if masks.shape!=depths.shape or not masks.any():
        raise ValueError("参考图有效区域无效")
    if not 1 <= stride <= 8 or not .005 <= edge_threshold <= .2:
        raise ValueError("网格采样或边缘过滤参数越界")
    projection_error=max(float(np.max(np.abs(k[:2,2]-[depths.shape[2]/2,depths.shape[1]/2]))) for k in ints)
    if not diagnostic and projection_error > 1:
        raise ValueError('当前预览相机尚不支持该偏心投影，不能按精确参考机位导出。')
    # 仅统一操作尺度，不声称恢复真实米制尺寸；相机和几何使用相同缩放。
    scene_scale=3/float(np.median(depths[masks]))
    meshes, views, surfaces, stats, coverage = [], [], {}, [], []
    for view, depth in enumerate(depths):
        height, width = depth.shape
        points, c2w = world_points(depth, ints[view], exts[view])
        image = Image.open(root / f"reference-{view+1}.png").convert("RGBA")
        scale = min(1, 2048 / max(image.size))
        image = image.resize((round(image.width*scale), round(image.height*scale)), Image.Resampling.LANCZOS)
        nx, ny = int(np.ceil(image.width/512)), int(np.ceil(image.height/512))
        position = AXIS @ c2w[:3, 3]*scene_scale
        forward, up = AXIS @ c2w[:3, 2], AXIS @ -c2w[:3, 1]
        views.append({"name":f"参考视角 {view+1}","referenceIndex":view+1,"position":position.tolist(),"target":(position+forward).tolist(),"up":up.tolist(),"fov":float(2*np.arctan(height/(2*ints[view,1,1]))),"projectionAspect":float(width*ints[view,1,1]/(height*ints[view,0,0])),"width":width,"height":height,"intrinsics":ints[view].tolist()})
        total_faces, duplicates = 0, 0
        current_coverage=np.zeros(depth.shape,dtype=bool)
        for row in range(ny):
            for col in range(nx):
                # 分区在网格和贴图中使用同一归一化边界；包含边缘顶点，不以可见像素补平深度。
                y0, y1 = round(row*(height-1)/ny), round((row+1)*(height-1)/ny)
                x0, x1 = round(col*(width-1)/nx), round((col+1)*(width-1)/nx)
                rows = np.unique(np.append(np.arange(y0,y1+1,stride), y1))
                cols = np.unique(np.append(np.arange(x0,x1+1,stride), x1))
                local_points = points[np.ix_(rows,cols)].reshape(-1,3)
                faces = grid_faces(depth,confs[view],rows,cols,edge_threshold,masks[view])
                faces, removed = remove_duplicate_faces(local_points,faces,view,depths,ints,exts,coverage)
                duplicates += removed
                if not len(faces):
                    continue
                yy,xx = np.meshgrid(rows,cols,indexing="ij")
                current_coverage |= rasterized_coverage(np.stack([xx,yy],-1).reshape(-1,2),faces,depth.shape)
                used, inverse = np.unique(faces, return_inverse=True)
                faces = inverse.reshape(-1,3)
                positions = local_points[used] @ AXIS.T*scene_scale
                normals = np.zeros_like(positions)
                face_normals = np.cross(positions[faces[:,1]]-positions[faces[:,0]],positions[faces[:,2]]-positions[faces[:,0]])
                valid = np.linalg.norm(face_normals,axis=1)>1e-10
                faces,face_normals = faces[valid],face_normals[valid]
                for k in range(3):
                    np.add.at(normals,faces[:,k],face_normals)
                normals /= np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-10)
                u0,v0,u1,v1 = (x0+.5)/width,(y0+.5)/height,(x1+.5)/width,(y1+.5)/height
                px0,py0,px1,py1 = [round(v) for v in [u0*image.width,v0*image.height,u1*image.width,v1*image.height]]
                tile = image.crop((px0,py0,px1,py1))
                # 使用实际整像素分区边界校正 UV，避免四舍五入导致接缝错位。
                uv=np.stack([((xx+.5)/width*image.width-px0)/tile.width,((yy+.5)/height*image.height-py0)/tile.height],-1).reshape(-1,2)[used]
                identity=f"view{view+1}_tile{row}_{col}"
                surfaces[identity]={"width":tile.width,"height":tile.height,"rgba8":base64.b64encode(tile.tobytes()).decode(),"colorSpace":"srgb"}
                meshes.append({"name":identity,"positions":positions.astype(np.float32).ravel().tolist(),"normals":normals.astype(np.float32).ravel().tolist(),"uvs":uv.astype(np.float32).ravel().tolist(),"indices":faces.ravel().tolist(),"material":identity})
                total_faces += len(faces)
        stats.append({"referenceIndex":view+1,"triangles":total_faces,"consistentOverlapRemoved":duplicates,"depthRange":[float(np.percentile(depth,2)),float(np.percentile(depth,98))]})
        coverage.append(current_coverage)
    if not meshes or sum(len(m["indices"])//3 for m in meshes)>250000:
        raise ValueError("重建网格为空或超过 250000 三角形预算")
    scope={"diagnostic":diagnostic,"observedGeometryAccepted":bool(acceptance and acceptance['accepted']),"qualityAssessment":"not-run","projectionCenterErrorPixels":projection_error}
    scene={"version":"reference-mesh-v1","meshes":meshes,"surfaces":surfaces,"views":views,"statistics":stats,"sceneScale":scene_scale,"metricScale":False,"validation":scope,"appearance":"原参考图烘焙表面颜色，包含原始光照；不是可重新打光的完整 PBR 材质", "limitations":["未观察到的区域不具备可验证几何","相机和相对深度为模型估计","非重叠区域不能证明共同尺度和连通性"]}
    path=root/"reconstruction-scene.json"
    path.write_text(json.dumps(scene,ensure_ascii=False,separators=(",",":")))
    summary={"meshes":len(meshes),"triangles":sum(len(m["indices"])//3 for m in meshes),"materials":len(surfaces),"views":len(views),"statistics":stats,"sceneBytes":path.stat().st_size,"validation":scope}
    (root/"mesh-receipt.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(summary,ensure_ascii=False))
    return scene


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("--stride",type=int,default=2)
    parser.add_argument("--edge-threshold",type=float,default=.08)
    parser.add_argument("--diagnostic",action="store_true",help="显式导出未验收的诊断产物，不得计为配准通过或生成成功")
    args=parser.parse_args()
    reconstruct(args.root,args.stride,args.edge_threshold,args.diagnostic)
