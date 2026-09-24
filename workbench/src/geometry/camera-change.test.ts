import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,save} from '../store';
import {cameraChangeFeedback} from './camera-change';
import {cameraChangeHistory} from './camera-change-history';
import {sceneVisibility} from './visibility';

const transform={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function scene():any{return {program:{version:'geometry-v1',name:'遮挡对照',materials:[{id:'solid',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'post',parts:[{...transform,id:'body',material:'solid',shape:{type:'box',size:[1,.2,2],radius:0}}]}],instances:[{...transform,id:'front',label:'前景柱',template:'post',position:[0,0,1],requirementIds:[]}]},cameras:[{name:'参考机位',referenceIndex:1,position:[0,-5,1],target:[0,0,1],fov:1}],textures:[],entities:[],assumptions:[],lighting:{}};}
function pair(){const previous=scene(),current=structuredClone(previous);current.cameras[0].position=[0,-2,1];return {previous,current};}
test('同一新几何对照机位，反馈面积而不生成得分或机位结论',()=>{
 const {previous,current}=pair();previous.program.templates[0].parts[0].shape.size=[.1,.2,.2];
 const unchanged=JSON.stringify([previous,current]),r=cameraChangeFeedback(previous,current)!;
 const counterfactual=sceneVisibility({...current,cameras:previous.cameras});
 expect(r.views[0].areaIncreases[0]).toMatchObject({instanceId:'front',partId:'body',beforeFraction:counterfactual.views[0].parts[0].frameFraction});
 expect(r.views[0].areaIncreases[0].change).toBeGreaterThan(.05);
 expect(r.quality).toBe('not-assessed');expect(r).not.toHaveProperty('score');expect(r).not.toHaveProperty('passed');
 expect(JSON.stringify([previous,current])).toBe(unchanged);
});
test('无机位变化不做额外诊断，改名和顺序不被误认作参考机位变化',()=>{
 const previous=scene(),current=structuredClone(previous);current.cameras[0].name='改名';expect(cameraChangeFeedback(previous,current)).toBeNull();
 current.program.instances[0].position[0]=1;expect(cameraChangeFeedback(previous,current)).toBeNull();
 current.cameras.push({...current.cameras[0],name:'新增检查',referenceIndex:null});expect(cameraChangeFeedback(previous,current)).toBeNull();
});
test('透明和缺失纹理不伪装成实心遮挡，遗漏材料明确披露',()=>{
 const {previous,current}=pair();current.program.materials[0].textureId='missing';
 const r=cameraChangeFeedback(previous,current)!;expect(r.excludedMaterials).toEqual(['solid']);expect(r.views[0].areaIncreases).toEqual([]);
});
test('引用全部部件，摘要之外的小部件也有真实旧机位面积',()=>{
 const {previous,current}=pair();
 current.program.templates[0].parts=Array.from({length:10},(_,i)=>({...current.program.templates[0].parts[0],id:'part'+i,position:[(i-4.5)*.15,0,0],shape:{type:'box',size:[.12,.2,.2+i*.01],radius:0}}));
 const r=cameraChangeFeedback(previous,current)!,v=sceneVisibility({...current,cameras:previous.cameras}).views[0];
 expect(v.parts.length).toBe(10);expect(v.instances[0].visibleParts.length).toBe(6);
 expect(r.views[0].areaIncreases.every(p=>p.beforeFraction>0)).toBe(true);
});
test('历史来自冻结修正收据及对应轮次，摘要被改动即拒绝',()=>{
 const dir=mkdtempSync(join(tmpdir(),'camera-feedback-'));try{
  const locate=(id:string)=>join(dir,id),{previous,current}=pair(),old=locate('old'),now=locate('new');
  mkdirSync(old,{recursive:true});mkdirSync(join(now,'generation/refinement'),{recursive:true});
  save(join(old,'generated-scene.json'),previous);save(join(now,'job.json'),{id:'new',selectedIteration:0,visualRefinement:{sourceJobId:'old',sourceIteration:null}});
  const receipt={sourceJobId:'old',sourceDigest:digest(JSON.stringify(previous)),sceneDigest:digest(JSON.stringify(current))};save(join(now,'generation/refinement/receipt.json'),receipt);
  expect(cameraChangeHistory(now,current,{},locate)?.views).toHaveLength(1);
  // 第二轮的候选元数据必须定位自身的增量产物，而不是误用初稿收据。
  const iteration=join(now,'iterations/1');mkdirSync(iteration,{recursive:true});mkdirSync(join(now,'generation/iteration-1/refinement'),{recursive:true});
  save(join(iteration,'candidate.json'),{jobId:'new',cycle:{index:1},fields:{visualRefinement:{sourceJobId:'old',sourceIteration:null}}});
  save(join(now,'generation/iteration-1/refinement/receipt.json'),receipt);
  expect(cameraChangeHistory(iteration,current,{},locate)?.sourceIteration).toBe(1);
  const changed=structuredClone(current);changed.cameras[0].fov=1.1;expect(()=>cameraChangeHistory(now,changed,{},locate)).toThrow('摘要');
  previous.cameras[0].fov=1.2;save(join(old,'generated-scene.json'),previous);expect(()=>cameraChangeHistory(now,current,{},locate)).toThrow('摘要');
  save(join(now,'job.json'),{id:'new'});expect(cameraChangeHistory(now,current,{},locate)).toBeNull();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
