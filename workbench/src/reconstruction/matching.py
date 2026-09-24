"""有来源的局部特征匹配；剔除屏幕固定点后才拟合场景对应关系。"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import cv2
import numpy as np
from infer import WORKBENCH,sha
from alignment import moving_correspondences

PIN=json.loads(Path(__file__).with_name('matching-pin.json').read_text())


def match_references(root,device='mps'):
    import torch
    source=WORKBENCH.parent/'reconstruction-matching'
    head=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
    if head!=PIN['codeSha'] or subprocess.run(['git','-C',str(source),'diff','--quiet','HEAD']).returncode:
        raise RuntimeError('特征匹配源码与冻结版本不一致')
    checkpoint=WORKBENCH/'data/reconstruction-models'/PIN['checkpoint']
    if sha(checkpoint)!=PIN['checkpointSha256']:raise RuntimeError('特征匹配权重摘要不符')
    sys.path.insert(0,str(source))
    from lightglue import LightGlue,SIFT
    from lightglue.utils import load_image
    root=Path(root);prediction=np.load(root/'prediction.npz');count=len(prediction['depth'])
    if not 2<=count<=4:raise ValueError('多图配准需要 2–4 张输入')
    torch.manual_seed(0);torch.set_num_threads(4);cv2.setRNGSeed(0)
    extractor=SIFT(max_num_keypoints=4096,backend='opencv').eval().to(device)
    # 禁止首次推理隐式联网；只读已校验的官方权重。
    matcher=LightGlue(features=None,input_dim=128,add_scale_ori=True).eval()
    state=torch.load(checkpoint,map_location='cpu',weights_only=True)
    for i in range(matcher.conf.n_layers):
        state={k.replace(f'self_attn.{i}',f'transformers.{i}.self_attn').replace(f'cross_attn.{i}',f'transformers.{i}.cross_attn'):v for k,v in state.items()}
    missing=set(matcher.state_dict())-set(state)
    # 此缓冲区由固定模型配置计算，不是训练参数；其余缺失一律失败。
    if missing-{'confidence_thresholds'}:raise RuntimeError('匹配器存在缺失权重：'+str(sorted(missing)))
    for key in missing:state[key]=matcher.state_dict()[key]
    matcher.load_state_dict(state,strict=True);matcher.to(device)
    started=time.monotonic();features=[]
    with torch.inference_mode():
        for i in range(count):features.append(extractor.extract(load_image(root/f'reference-{i+1}.png').to(device)))
        records=[];arrays={}
        for i in range(count):
            for j in range(i+1,count):
                result=matcher({'image0':features[i],'image1':features[j]})
                pairs=result['matches'][0].cpu().numpy()
                pa=features[i]['keypoints'][0].cpu().numpy()[pairs[:,0]]
                pb=features[j]['keypoints'][0].cpu().numpy()[pairs[:,1]]
                sa=features[i]['image_size'][0].cpu().numpy();sb=features[j]['image_size'][0].cpu().numpy()
                a,b,removed=moving_correspondences(pa,pb,sa,sb)
                # 统一到最长边 1024 的尺度，阈值与独立验收保持一致。
                factor_a=1024/max(sa);factor_b=1024/max(sb)
                a=a*factor_a;b=b*factor_b;sa=sa*factor_a;sb=sb*factor_b
                record={'references':[i+1,j+1],'matches':len(pa),'stationaryMatchesExcluded':removed,'movingMatches':len(a),'status':'insufficient-correspondence'}
                records.append(record)
                if len(a)<30:continue
                f,mask=cv2.findFundamentalMat(a,b,cv2.USAC_MAGSAC,2.,.999,10000)
                if f is None or mask is None:continue
                a,b=a[mask.ravel()>0],b[mask.ravel()>0]
                if len(a)<30:continue
                coverage=[float(cv2.contourArea(cv2.convexHull(p))/(s[0]*s[1])) for p,s in [(a,sa),(b,sb)]]
                prefix=f'pair_{i}_{j}'
                arrays.update({prefix+'_a':a,prefix+'_b':b,prefix+'_sizes':np.stack([sa,sb]),prefix+'_fundamental':f})
                record.update(inliers=len(a),imageCoverage=coverage,arrayPrefix=prefix,status='candidate-correspondence-only' if min(coverage)>=.05 else 'insufficient-spatial-support')
    np.savez_compressed(root/'correspondences.npz',**arrays)
    receipt={**PIN,'device':device,'durationSeconds':time.monotonic()-started,'references':count,'pairs':records,'correspondencesSha256':sha(root/'correspondences.npz'),'predictionSha256':sha(root/'prediction.npz'),'referenceSha256':[sha(root/f'reference-{i+1}.png') for i in range(count)],'qualityAssessment':'not-run','geometryAccepted':False,'limits':'这些点只是配准候选；必须另行检查局部聚集、留出点、双向深度和模型相机。'}
    (root/'matching-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(receipt,ensure_ascii=False));return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root');parser.add_argument('--device',choices=['mps','cpu'],default='mps')
    args=parser.parse_args();match_references(args.root,args.device)
