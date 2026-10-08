import {test,expect} from 'bun:test';
import {assetInspectionCameras} from './asset-inspection-cameras';
import {assetPreviewScene,createAssetReview} from './asset-review';
import {save,read,digest,runDir} from '../store';
import {stable} from '../validated-cache';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},mat={id:'metal',textureId:null,color:[.2,.3,.4,1],roughness:.5,metallic:.8};
const brief={id:'wire',label:'细线组',materialIds:['metal'],maxParts:4,bounds:{min:[-9,-8,5],max:[9,32,7]}};
const asset={version:'asset-geometry-v1',template:{id:'wire',parts:[{...pose,id:'line',material:'metal',shape:{type:'tube',from:[1,-8,6],to:[1,32,6],radius:.006,endRadius:.006,segments:8}}]}};
const layout={version:'scene-layout-v1',program:{version:'geometry-v1',name:'test',materials:[mat],templates:[brief],instances:[{...pose,id:'one',label:'one',template:'wire',requirementIds:[]}]},textures:[],textureReuse:[],spatialOpenings:[]};
test('稀疏细线检查实际表面，两机位可读且不修改模型、材质或布局',()=>{
 const original=stable([asset,brief,layout]),scene=assetPreviewScene(asset,brief,layout),result=assetInspectionCameras(scene.program,brief);
 expect(result.detail).toBe(true);expect(result.measurement.distance).toBeLessThan(2);expect(scene.cameras).toHaveLength(2);
 expect(scene.cameras[0].target[0]).toBeCloseTo(1,1);expect(scene.cameras[0].target[2]).toBeCloseTo(6,1);
 expect(scene.cameras[0].position).not.toEqual(scene.cameras[1].position);expect(scene.program.templates[0]).toEqual(asset.template);
 expect(stable([asset,brief,layout])).toBe(original);expect(scene.assumptions.join(' ')).toContain('局部');
});
test('实体正常预览保持完整包围盒相机',()=>{
 const b={...brief,bounds:{min:[-1,-1,-1],max:[1,1,1]}},a={...asset,template:{id:'wire',parts:[{...pose,id:'box',material:'metal',shape:{type:'box',size:[2,2,2],radius:0}}]}};
 const scene=assetPreviewScene(a,b,layout),check=assetInspectionCameras(scene.program,b);
 expect(check.detail).toBe(false);expect(scene.cameras[0].target).toEqual([0,0,0]);
 expect(check.measurement.distance).toBeCloseTo(Math.sqrt(3)/Math.sin(.65/2)*1.2,8);
});
test('恢复失败预览保留同源几何并重新渲染，不自动做模型选择；拒绝跨根和改动数据',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'asset-preview-recovery-')),id=crypto.randomUUID(),root=runDir(id),prior=join(root,'generation/assets/wire/visual-check');
 mkdirSync(join(prior,'1'),{recursive:true});const ref=join(folder,'ref.png');writeFileSync(ref,'fixture reference');
 const job={id:crypto.randomUUID(),executionRecoveryRoot:id,recoverySourceJobId:id,reuseMode:'fresh',prompt:'fixture',images:[{id:'ref'}],modelSettings:{model:'fixture'}};
 save(join(root,'job.json'),{...job,id,recoverySourceJobId:null});save(join(root,'generation/layout.json'),layout);
 const hash=digest(stable(asset)),contract=digest(stable([brief,layout.program.materials,[digest('fixture reference')]]));
 save(join(prior,'1/asset.json'),asset);save(join(prior,'asset-preview-audit.json'),{contract,used:2,attempts:[{index:1,sha256:hash,status:'failed',error:'browser-capture-runtime-failed'}]});
 let renders=0;const render:any=async(_s:any,_i:any,_r:any,dir:string)=>{renders++;mkdirSync(join(dir,'capture'),{recursive:true});const frames=[1,2].map(n=>{const file=n+'.png',bytes='actual fixture '+n;writeFileSync(join(dir,'capture',file),bytes);return {file,sha256:digest(bytes)}});save(join(dir,'engine-preview-receipt.json'),{frames});return [];};
 const options:any={brief,layout,textures:{},images:[{path:ref,mime:'image/png'}],signal:new AbortController().signal,render};
 try{
  const denied=createAssetReview({...options,folder:join(folder,'denied')});expect(await denied.restoreFailedPreview({...job,executionRecoveryRoot:crypto.randomUUID()})).toBe(false);expect(renders).toBe(0);
  const tool=createAssetReview({...options,folder:join(folder,'restored')});expect(await tool.restoreFailedPreview(job)).toBe(true);expect(renders).toBe(1);
  expect(read(join(folder,'restored/restored-preview.json')).modelSelection).toBe('pending');expect(tool.kit.continuation!().images).toHaveLength(2);
  expect(()=>tool.kit.resolveOutput!({selectedAssetSha256:'0'.repeat(64),reason:'unverified'})).toThrow();
  expect(tool.kit.resolveOutput!({selectedAssetSha256:hash,reason:'仅测试明确选择'})).toEqual(asset);
  expect(await tool.restoreFailedPreview(job)).toBe(false);expect(renders).toBe(1);
  save(join(prior,'1/asset.json'),{...asset,extra:'changed'});
  const changed=createAssetReview({...options,folder:join(folder,'changed')});await expect(changed.restoreFailedPreview(job)).rejects.toThrow('摘要变化');
 }finally{rmSync(folder,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});}
});
