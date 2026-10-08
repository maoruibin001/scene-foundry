"""按原始录屏 PTS 与真实相机观测配对；绝不插帧、补造位置或放宽对应误差。"""
import cv2, json, hashlib, sys, re, math
from bisect import bisect_left
from pathlib import Path

class VideoCoverageError(ValueError):
    """A decoded recording can be retained even when it cannot prove camera correspondence."""

def select_frames(timestamps, targets, observations=None):
    records=[]
    spacing=min(b['timeMs']-a['timeMs'] for a,b in zip(targets,targets[1:]))
    for target in targets:
        candidates=[]
        for index,timestamp in enumerate(timestamps):
            if records and index <= records[-1]['frameIndex']: continue
            observed=target['timeMs']; observation_index=None
            if observations is not None:
                if abs(timestamp-target['timeMs']) >= spacing/2: continue
                i=bisect_left(observations,timestamp)
                indices=[j for j in (i-1,i) if 0<=j<len(observations)]
                observation_index=min(indices,key=lambda j:abs(observations[j]-timestamp))
                if records and observation_index <= records[-1]['observationIndex']: continue
                observed=observations[observation_index]
            if abs(timestamp-observed)>250: continue
            candidates.append((abs(timestamp-target['timeMs']),abs(timestamp-observed),index,timestamp,observation_index,observed))
        if not candidates: raise VideoCoverageError('录屏区间缺少真实帧与相机观测的250毫秒内配对，不能覆盖连续观测')
        _,_,index,timestamp,observation_index,observed=min(candidates)
        record={'name':target['name'],'requestedTimeMs':target['timeMs'],'videoTimeMs':timestamp,'frameIndex':index}
        if observations is not None: record.update(observationIndex=observation_index,observationTimeMs=observed,observationDeltaMs=timestamp-observed)
        records.append(record)
    return records

def extract(video, output, targets, width=1600, height=900, observations=None, preserve_incomplete=False):
    if not all(isinstance(n,int) and 2<=n<=2048 for n in (width,height)): raise ValueError('声明的采集尺寸无效')
    if not 4<=len(targets)<=6: raise ValueError('连续画面需要4至6个观测点')
    if any(not re.fullmatch(r'continuous-[1-6]\.png',t['name']) or not isinstance(t['timeMs'],(int,float)) or not math.isfinite(t['timeMs']) or not 0<=t['timeMs']<=300000 for t in targets): raise ValueError('视频取帧目标无效')
    if any(a['timeMs']>=b['timeMs'] for a,b in zip(targets,targets[1:])) or len({t['name'] for t in targets})!=len(targets): raise ValueError('观测时间和文件名必须唯一且递增')
    if observations is not None:
        if not observations or any(not isinstance(t,(int,float)) or not math.isfinite(t) or not 0<=t<=300000 for t in observations): raise ValueError('连续相机观测时间无效')
        if any(a>=b for a,b in zip(observations,observations[1:])): raise ValueError('连续相机观测时间必须递增')
    source_hash=hashlib.sha256(video.read_bytes()).hexdigest()
    cap=cv2.VideoCapture(str(video));timestamps=[]
    if not cap.isOpened(): raise ValueError('原始录屏不可解码')
    try:
        while True:
            ok,frame=cap.read()
            if not ok: break
            timestamp=cap.get(cv2.CAP_PROP_POS_MSEC)
            if not math.isfinite(timestamp) or timestamps and timestamp<=timestamps[-1]: raise ValueError('视频PTS缺失或没有递增')
            if frame.shape[:2]!=(height,width): raise ValueError('录屏尺寸与固定采集尺寸不符')
            timestamps.append(timestamp)
    finally: cap.release()
    if not timestamps: raise ValueError('录屏不完整，不能覆盖连续观测')
    receipt={'source':'原始ForgeaX Engine录屏按PTS解码','poseCorrespondence':'dense-observed-camera-pairs-v2' if observations is not None else 'fixed-observation-v1','videoSha256':source_hash,'decodedFrames':len(timestamps),'durationMs':timestamps[-1]}
    try: records=select_frames(timestamps,targets,observations)
    except VideoCoverageError as error:
        if not preserve_incomplete: raise
        if source_hash!=hashlib.sha256(video.read_bytes()).hexdigest(): raise ValueError('原始录屏在解码时改变')
        # No selected-frame images are written: static screenshots remain separate evidence.
        return {**receipt,'status':'incomplete','frames':[],'issue':{'code':'VIDEO_POSE_COVERAGE','message':str(error)}}
    # 两遍顺序解码，只保留六个目标帧，避免缓存整个高分辨率视频导致内存尖峰。
    cap=cv2.VideoCapture(str(video));selected={r['frameIndex']:r for r in records};index=-1
    if not cap.isOpened(): raise ValueError('原始录屏不可解码')
    try:
        while True:
            ok,frame=cap.read()
            if not ok: break
            index+=1
            if index not in selected: continue
            record=selected[index]
            if abs(cap.get(cv2.CAP_PROP_POS_MSEC)-record['videoTimeMs'])>.001: raise ValueError('两次解码的原始视频PTS不一致')
            path=output/record['name']
            if not cv2.imwrite(str(path),frame): raise ValueError('视频取帧写入失败')
            record['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    finally: cap.release()
    if any('sha256' not in r for r in records) or source_hash!=hashlib.sha256(video.read_bytes()).hexdigest(): raise ValueError('原始录屏在取帧时改变或缺帧')
    return {**receipt,'status':'complete','frames':records}

if __name__=='__main__':
    video,output,request=map(Path,sys.argv[1:4]);output.mkdir(parents=True,exist_ok=True)
    spec=json.loads(request.read_text())
    result=extract(video,output,spec['targets'],spec['width'],spec['height'],spec.get('observations'),spec.get('preserveIncomplete') is True) if isinstance(spec,dict) else extract(video,output,spec)
    (output/'video-frames.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
