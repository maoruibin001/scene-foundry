"""从原始 Engine 录屏按真实 PTS 取帧，不依赖 WebM 不可靠的 FPS/帧数元数据。"""
import cv2, json, hashlib, sys, re
from pathlib import Path

def extract(video, output, targets):
    if not 4 <= len(targets) <= 6:
        raise ValueError("连续画面需要4至6个观测点")
    if any(not re.fullmatch(r"continuous-[1-6]\.png", t["name"]) or not isinstance(t["timeMs"], (int,float)) or not 0 <= t["timeMs"] <= 300000 for t in targets):
        raise ValueError("视频取帧目标无效")
    if any(a["timeMs"] >= b["timeMs"] for a,b in zip(targets,targets[1:])) or len({t["name"] for t in targets}) != len(targets):
        raise ValueError("观测时间和文件名必须唯一且递增")
    cap=cv2.VideoCapture(str(video)); records=[]; previous=None; index=-1
    if not cap.isOpened(): raise ValueError("原始录屏不可解码")
    def save(target, candidate):
        timestamp, frame_index, frame=candidate
        if abs(timestamp-target["timeMs"]) > 250:
            raise ValueError("录屏帧与相机观测相差超过250毫秒")
        if records and frame_index <= records[-1]["frameIndex"]:
            raise ValueError("连续取帧重复或逆序")
        if frame.shape[:2] != (900,1600): raise ValueError("录屏尺寸与固定采集尺寸不符")
        path=output/target["name"]
        if not cv2.imwrite(str(path),frame): raise ValueError("视频取帧写入失败")
        records.append({"name":target["name"],"requestedTimeMs":target["timeMs"],"videoTimeMs":timestamp,"frameIndex":frame_index,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
    try:
        while True:
            ok,frame=cap.read()
            if not ok: break
            index+=1;timestamp=cap.get(cv2.CAP_PROP_POS_MSEC)
            if previous and timestamp <= previous[0]: raise ValueError("视频PTS缺失或没有递增")
            current=(timestamp,index,frame)
            while len(records)<len(targets) and timestamp>=targets[len(records)]["timeMs"]:
                target=targets[len(records)];nearest=min([previous,current] if previous else [current],key=lambda v:abs(v[0]-target["timeMs"]));save(target,nearest)
            previous=current
        while previous and len(records)<len(targets): save(targets[len(records)],previous)
        if len(records)!=len(targets): raise ValueError("录屏不完整，不能覆盖连续观测")
    finally: cap.release()
    return {"source":"原始ForgeaX Engine录屏按PTS解码","videoSha256":hashlib.sha256(video.read_bytes()).hexdigest(),"decodedFrames":index+1,"durationMs":previous[0],"frames":records}

if __name__ == "__main__":
    video,output,request=map(Path,sys.argv[1:4]);output.mkdir(parents=True,exist_ok=True)
    result=extract(video,output,json.loads(request.read_text()));(output/"video-frames.json").write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
