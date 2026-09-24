"""通用多图深度适配器。输出数值几何，不包含任何场景专用布局或素材。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import Image

WORKBENCH = Path(__file__).resolve().parents[2]
PIN = json.loads(Path(__file__).with_name("pin.json").read_text())


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def content_crop(image):
    """仅去除两侧连续的近黑信箱边；每侧最多 15%，边界始终写入回执。"""
    pixels = np.asarray(image)
    rows = (pixels.max(axis=2) <= 8).mean(axis=1) >= .97
    top, bottom = 0, image.height
    limit = int(image.height * .15)
    while top < limit and rows[top]:
        top += 1
    while image.height - bottom < limit and rows[bottom - 1]:
        bottom -= 1
    # 超过边界上限视为真实暗区，保留输入；不擅自截取场景局部。
    if top == limit or image.height - bottom == limit:
        return image, [0, 0, image.width, image.height]
    box = [0, top, image.width, bottom]
    return image.crop(box), box


def prepare_images(paths, output):
    """用留边统一宽高比，保留每张图全部内容；留边区域不生成几何。"""
    originals = [Image.open(path).convert("RGB") for path in paths]
    crops = [content_crop(image) for image in originals]
    first = crops[0][0]
    ratio = min(1, 2048 / max(first.size))
    size = (round(first.width * ratio), round(first.height * ratio))
    images, receipts = [], []
    for index, (path, original, (cropped, crop)) in enumerate(zip(paths, originals, crops)):
        factor = min(size[0] / cropped.width, size[1] / cropped.height)
        resized = cropped.resize((max(1, round(cropped.width*factor)), max(1, round(cropped.height*factor))), Image.Resampling.LANCZOS)
        left, top = (size[0]-resized.width)//2, (size[1]-resized.height)//2
        canvas = Image.new("RGB", size)
        canvas.paste(resized, (left, top))
        canvas.save(output / f"reference-{index+1}.png")
        images.append(canvas)
        receipts.append({"index":index+1,"sha256":sha(path),"originalSize":list(original.size),"contentBox":crop,"canvasSize":list(size),"canvasContentBox":[left,top,left+resized.width,top+resized.height],"textureSource":f"reference-{index+1}.png"})
    return images, receipts


def load_checkpoint(model, checkpoint):
    import torch
    from safetensors.torch import load_model
    # 官方权重为外层 model.* 命名；LayerNorm 的共享存储只保存一份。
    # 官方 safetensors 加载器按参数共享关系恢复别名，strict=True 拒绝真正缺失的权重。
    wrapper=torch.nn.Module()
    wrapper.add_module("model",model)
    load_model(wrapper,str(checkpoint),strict=True,device="cpu")


def infer(paths, output, resolution=504, device="mps", pose_estimator="ray"):
    import torch

    source = WORKBENCH.parent / "reconstruction-depth"
    head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if head != PIN["codeSha"] or subprocess.run(["git", "-C", str(source), "diff", "--quiet", "HEAD"]).returncode:
        raise RuntimeError("重建模型源码与冻结版本不一致")
    checkpoint = WORKBENCH / "data/reconstruction-models" / PIN["checkpoint"]
    if not checkpoint.is_file():
        raise RuntimeError("RECONSTRUCTION_NOT_CONFIGURED：缺少本地模型权重")
    checkpoint_sha = sha(checkpoint)
    if PIN.get("checkpointSha256") and checkpoint_sha != PIN["checkpointSha256"]:
        raise RuntimeError("重建权重摘要与冻结版本不一致")
    sys.path.insert(0, str(source / "src"))
    from depth_anything_3.cfg import create_object, load_config
    from depth_anything_3.utils.io.input_processor import InputProcessor

    if not 1 <= len(paths) <= 4 or len(set(map(str, paths))) != len(paths):
        raise ValueError("需提供 1–4 张不同参考图")
    if not 196 <= resolution <= 1008 or resolution % 14:
        raise ValueError("处理分辨率须为 196–1008 范围内的 14 倍数")
    if pose_estimator not in ["ray","camera"]:
        raise ValueError("相机估计方法无效")
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("本机 MPS 不可用；未静默切换设备")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    images, receipts = prepare_images(paths, output)
    torch.manual_seed(0)
    torch.set_num_threads(4)
    model = create_object(load_config(str(source / f"src/depth_anything_3/configs/{PIN['architecture']}.yaml")))
    load_checkpoint(model, checkpoint)
    model.eval().to(device)
    batch, _, _ = InputProcessor()(images, process_res=resolution, process_res_method="upper_bound_resize", sequential=True)
    print(json.dumps({"phase": "深度与相机估计", "device": device, "shape": list(batch.shape), "model": PIN["model"]}, ensure_ascii=False), flush=True)
    started = time.monotonic()
    # 直接调用官方数值网络，避免安装与本任务无关的 Gaussian/COLMAP 导出依赖。
    # FP32 同时用于 CPU/MPS，未启用仅适用于 CUDA 的混合精度路径。
    with torch.inference_mode():
        tensor=batch[None].to(device).float()
        if pose_estimator=="ray":
            # MPS 的大型批量 SVD 在本机触发 Metal 编译错误；固定为 GPU 网络 + CPU 几何求解。
            # 调用同一官方数值实现，不切换模型、不关闭严格权重加载。
            features,_=model.backbone(tensor,cam_token=None,export_feat_layers=[],ref_view_strategy="first")
            raw=model._process_depth_head(features,tensor.shape[-2],tensor.shape[-1])
            for key in list(raw):
                if torch.is_tensor(raw[key]):raw[key]=raw[key].detach().cpu()
            raw=model._process_ray_pose_estimation(raw,tensor.shape[-2],tensor.shape[-1])
            raw=model._process_mono_sky_estimation(raw)
        else:
            raw=model(tensor,ref_view_strategy="first",use_ray_pose=False)
    result = {key: raw[key].detach().float().cpu().numpy().squeeze(0) for key in ["depth", "depth_conf", "extrinsics", "intrinsics"]}
    if not all(np.isfinite(array).all() for array in result.values()):
        raise RuntimeError("重建模型输出包含非有限数值")
    if np.any(result["depth"] <= 0):
        raise RuntimeError("重建模型输出无效深度")
    processed = (batch.permute(0, 2, 3, 1).numpy() * np.array([.229, .224, .225]) + np.array([.485, .456, .406]))
    result["images"] = np.round(np.clip(processed, 0, 1) * 255).astype(np.uint8)
    h, w = result["depth"].shape[1:3]
    y, x = np.mgrid[:h, :w]
    valid_pixels=[]
    for record in receipts:
        cw,ch=record["canvasSize"]
        x0,y0,x1,y1=record["canvasContentBox"]
        valid_pixels.append(((x+.5)/w >= x0/cw) & ((x+.5)/w < x1/cw) & ((y+.5)/h >= y0/ch) & ((y+.5)/h < y1/ch))
    result["valid_pixels"] = np.stack(valid_pixels)
    np.savez_compressed(output / "prediction.npz", **result)
    receipt = {**PIN, "checkpointSha256": checkpoint_sha, "torchVersion": torch.__version__, "device": device, "cameraSolveDevice":"cpu" if pose_estimator=="ray" else device, "precision": "float32", "poseEstimator":pose_estimator,"referenceViewStrategy":"first", "durationSeconds": time.monotonic() - started, "resolution": resolution, "references": receipts, "arrays": {key: list(value.shape) for key, value in result.items()}, "predictionSha256": sha(output / "prediction.npz"), "metricScale": False, "status": "inferred"}
    (output / "reconstruction-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(receipt, ensure_ascii=False), flush=True)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resolution", type=int, default=504)
    parser.add_argument("--device", choices=["mps", "cpu"], default="mps")
    parser.add_argument("--pose-estimator",choices=["ray","camera"],default="ray")
    args = parser.parse_args()
    infer(args.images, args.output, args.resolution, args.device,args.pose_estimator)
