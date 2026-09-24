"""独立图像对应点检查；模型给出相机矩阵并不等于多视图已配准。"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np


def epipolar_distance(a,b,fundamental):
    aa=np.column_stack([a,np.ones(len(a))]);bb=np.column_stack([b,np.ones(len(b))])
    lb=aa@fundamental.T;la=bb@fundamental
    numerator=np.abs(np.sum(bb*lb,axis=1))
    return .5*numerator*(1/np.maximum(np.linalg.norm(lb[:,:2],axis=1),1e-12)+1/np.maximum(np.linalg.norm(la[:,:2],axis=1),1e-12))


def moving_correspondences(a,b,size_a,size_b,minimum_normalized_motion=.0025):
    """排除屏幕固定标注和零视差点；它们不能提供相机运动的独立证据。"""
    displacement=np.linalg.norm(a/np.array(size_a)-b/np.array(size_b),axis=1)
    keep=displacement>=minimum_normalized_motion
    return a[keep],b[keep],int((~keep).sum())


def check_alignment(root):
    root=Path(root);data=np.load(root/'prediction.npz');exts=data['extrinsics'];ks=data['intrinsics']
    h,w=data['depth'].shape[1:3]
    features=[];sift=cv2.SIFT_create(nfeatures=4000,contrastThreshold=.02)
    cv2.setRNGSeed(0)
    for i in range(len(exts)):
        image=cv2.imread(str(root/f'reference-{i+1}.png'),cv2.IMREAD_GRAYSCALE)
        if image is None:raise ValueError('参考图缺失')
        scale=min(1,1024/max(image.shape));size=(round(image.shape[1]*scale),round(image.shape[0]*scale))
        image=cv2.resize(image,size)
        keypoints,descriptors=sift.detectAndCompute(image,None)
        features.append((np.array([k.pt for k in keypoints],dtype=np.float32),descriptors,size))
    pairs=[]
    for i in range(len(exts)):
        for j in range(i+1,len(exts)):
            pa,da,sa=features[i];pb,db,sb=features[j]
            result={'references':[i+1,j+1],'status':'insufficient-correspondence','accepted':False}
            pairs.append(result)
            if da is None or db is None or min(len(da),len(db))<2:continue
            matcher=cv2.BFMatcher()
            good=lambda matches:{p.queryIdx:p.trainIdx for p,q in matches if p.distance<.75*q.distance}
            ab=good(matcher.knnMatch(da,db,k=2));ba=good(matcher.knnMatch(db,da,k=2))
            mutual=[(a,b) for a,b in ab.items() if ba.get(b)==a]
            result['mutualMatches']=len(mutual)
            if len(mutual)<30:continue
            a=np.array([pa[x] for x,y in mutual]);b=np.array([pb[y] for x,y in mutual])
            a,b,removed=moving_correspondences(a,b,sa,sb)
            result['stationaryMatchesExcluded']=removed
            result['movingMatches']=len(a)
            if len(a)<30:continue
            _,mask=cv2.findFundamentalMat(a,b,cv2.USAC_MAGSAC,2.,.999,10000)
            if mask is None:continue
            a,b=a[mask.ravel()>0],b[mask.ravel()>0]
            result['inliers']=len(a)
            if len(a)<30:continue
            coverage=[float(cv2.contourArea(cv2.convexHull(p))/(s[0]*s[1])) for p,s in [(a,sa),(b,sb)]]
            result['imageCoverage']=coverage
            if min(coverage)<.05:
                result['status']='insufficient-spatial-support';continue
            ki=ks[i].copy();kj=ks[j].copy()
            ki[0]*=sa[0]/w;ki[1]*=sa[1]/h;kj[0]*=sb[0]/w;kj[1]*=sb[1]/h
            ei=np.eye(4);ei[:3]=exts[i];ej=np.eye(4);ej[:3]=exts[j]
            relative=ej@np.linalg.inv(ei);rotation=relative[:3,:3];tx,ty,tz=relative[:3,3]
            if np.linalg.norm([tx,ty,tz])<1e-6:
                result['status']='unverified-zero-baseline';continue
            skew=np.array([[0,-tz,ty],[tz,0,-tx],[-ty,tx,0]])
            f=np.linalg.inv(kj).T@skew@rotation@np.linalg.inv(ki)
            distances=epipolar_distance(a,b,f)
            result.update(medianErrorPixels=float(np.median(distances)),p90ErrorPixels=float(np.percentile(distances,90)),matchingResolution=[list(sa),list(sb)])
            result['accepted']=result['medianErrorPixels']<=3 and result['p90ErrorPixels']<=8
            result['status']='consistent-observed-correspondence' if result['accepted'] else 'camera-correspondence-mismatch'
    # 至少形成已验证的连通图，才有资格进入后续三维表面检查。
    reached={0}
    for _ in exts:
        for p in pairs:
            a,b=[v-1 for v in p['references']]
            if p['accepted'] and (a in reached or b in reached):reached|={a,b}
    accepted=len(exts)>1 and len(reached)==len(exts)
    result={'method':'SIFT 双向匹配 + 屏幕固定对应排除 + 独立鲁棒对应点 + 预测相机极线残差','accepted':accepted,'status':'observed-camera-consistency-only' if accepted else 'unverified-multiview-alignment','referenceCount':len(exts),'pairs':pairs,'limits':'通过只证明已观测对应点的相机一致性，不证明完整几何、未见区域或生产质量；单图和零视差输入不能通过多视图配准检查。'}
    (root/'alignment-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False));return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root')
    check_alignment(parser.parse_args().root)
