import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconstructionPython} from '../runtime-paths.mjs';
import {textureSourceEvidence,referencePixelSizes} from './texture-source';
import {prepareAssetEvidence} from './asset-evidence';
import {repairTextureEvidence} from './repair-texture-evidence';

const crop={id:'brick',referenceIndex:1,quad:[[.633,.432],[.647,.432],[.647,.545],[.633,.545]],size:256};
test('照片窄条放大到256不增加源细节；两个信息量分别报告且不改纹理',()=>{
 const scene={textures:[crop]},before=JSON.stringify(scene);
 const [r]=textureSourceEvidence(scene,[{referenceIndex:1,width:1600,height:2400}]);
 expect(r.minimumSourceEdgePixels).toBeCloseTo(22.39,2);expect(r.maximumEdgeUpscale).toBeCloseTo(11.44,2);
 expect(r.outputPixels).toEqual([256,256]);expect(r.issues).toHaveLength(2);expect(JSON.stringify(scene)).toBe(before);
 const [clear]=textureSourceEvidence({textures:[{...crop,quad:[[0,0],[1,0],[1,1],[0,1]]}]},[{referenceIndex:1,width:1600,height:2400}]);
 expect(clear.issues).toEqual([]);
});
test('缺原图不得猜采样清晰度；资源库复用不误套当前裁切；非法坐标拒绝',()=>{
 expect(textureSourceEvidence({textures:[crop]},[])[0].sourceKind).toBe('unknown');
 expect(textureSourceEvidence({textures:[crop],textureReuse:[{textureId:'brick'}]},[])[0].sourceKind).toBe('verified-library');
 expect(()=>textureSourceEvidence({textures:[{...crop,quad:[[2,0],[1,0],[1,1],[0,1]]}]},[{referenceIndex:1,width:100,height:100}])).toThrow('坐标无效');
});
test('原图EXIF方向与实际提取一致，素材证据和修复证据均保留源采样风险及原像素',async()=>{
 const root=mkdtempSync(join(tmpdir(),'texture-source-')),path=join(root,'reference.jpg');
 try{
  const p=Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; i=Image.new("RGB",(160,240),(30,80,100)); e=i.getexif(); e[274]=6; i.save(sys.argv[1],exif=e)',path]);expect(p.exitCode).toBe(0);
  const images=[{path,mime:'image/jpeg'}],pixels=referencePixelSizes(images);expect(pixels).toEqual([{referenceIndex:1,width:240,height:160}]);
  const before=readFileSync(path),texture={width:2,height:2,rgba8:Buffer.from(Array(4).fill([30,80,100,255]).flat()).toString('base64'),colorSpace:'srgb'};
  const brief={id:'subject',materialIds:['mat'],bounds:{min:[0,0,0],max:[1,1,1]},maxParts:2};
  const layout:any={textures:[crop,{...crop,id:'unused'}],cameras:[],program:{templates:[brief],materials:[{id:'mat',textureId:'brick'}],instances:[{id:'i',template:'subject',requirementIds:[],scale:[1,1,1]}]}};
  const ctx={job:{id:crypto.randomUUID()},images,plan:{requirements:[]},signal:AbortSignal.timeout(15000),observation:{landmarks:[]}};
  const evidence=await prepareAssetEvidence(ctx,layout,brief,{brick:texture,unused:texture},root);
  expect(evidence.context.textureSourceEvidence).toHaveLength(1);expect(evidence.context.textureSourceEvidence[0]).toMatchObject({id:'brick',sourcePixels:[240,160]});
  expect(evidence.context.textureSourceEvidence[0].issues).toHaveLength(2);expect(evidence.images.length).toBeGreaterThan(0);
  const repair=await repairTextureEvidence(layout,{brick:texture,unused:texture},root,ctx.signal,images);
  expect(repair.context).toHaveLength(1);expect(repair.context[0].sourceSampling).toEqual(evidence.context.textureSourceEvidence[0]);
  expect(readFileSync(path)).toEqual(before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
