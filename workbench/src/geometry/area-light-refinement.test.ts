import {test,expect} from 'bun:test';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {applyRefinement,refinementSchema} from './refinement';
import {dependencyFingerprint,stageContract} from '../stage-contract';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},plan={requirements:[{id:'R1',critical:true,count:null}]};
const scene=():any=>({version:'scene-v1',program:{version:'geometry-v1',name:'光照修正',materials:[{id:'base',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'subject',parts:[{...pose,id:'body',material:'base',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'one',label:'主体',template:'subject',requirementIds:['R1']}]},entities:[{instanceId:'one',category:'任意类别',role:'subject'}],cameras:[{name:'参考',referenceIndex:1,position:[3,-4,2],target:[0,0,0],fov:1},{name:'检查',referenceIndex:null,position:[-3,4,2],target:[0,0,0],fov:1}],textures:[],textureReuse:[],lighting:{direction:[.5,.5,-.7],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]},assumptions:[]});
const patch=():any=>({version:'scene-refinement-v1',reason:'依据真实画面修正光照',instances:[],cameras:[],materials:[],parts:[],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]});
test('普通修正允许有限矩形面光，保留几何和源场景，非法方向仍拒绝',()=>{
 const s=scene(),p=patch(),before=JSON.stringify(s);
 const a={position:[0,0,2],direction:[0,0,-1],up:[0,1,0],color:[1,.8,.6],intensity:5,range:3,width:.3,height:.2};
 p.lighting={...s.lighting,areaLights:[a]};
 const next=applyRefinement(s,p,plan,1,'simple');expect(next.lighting.areaLights).toEqual([a]);expect(next.program).toEqual(s.program);expect(JSON.stringify(s)).toBe(before);
 expect(refinementSchema('simple').properties.lighting.anyOf[0].properties.areaLights.anyOf[0].maxItems).toBe(4);
 p.lighting.areaLights=[{...a,up:[0,0,1]}];expect(()=>applyRefinement(s,p,plan,1,'simple')).toThrow('矩形面光');
});
test('面光校验与指导修改自动进入共享阶段递归依赖指纹，无需人工重复表项',()=>{
 const folder=mkdtempSync(join(tmpdir(),'area-light-contract-'));
 try{
  const src=join(folder,'src');cpSync(resolve(import.meta.dirname,'..'),src,{recursive:true});
  const entries=[['geometry/layout-stages.ts','geometry/space-construction.ts','geometry/reference-observations.ts'],['geometry/layout-stages.ts'],['geometry/blockout.ts'],['geometry/layout.ts','geometry/asset-construction.ts','geometry/asset-input.ts','geometry/asset-evidence.py']];
  const before=entries.map(e=>dependencyFingerprint(e,src)),file=join(src,'geometry/area-lights.ts');writeFileSync(file,readFileSync(file,'utf8')+'\n// isolated dependency identity probe\n');
  for(let i=0;i<entries.length;i++)expect(dependencyFingerprint(entries[i],src)).not.toBe(before[i]);
  for(const role of ['scene-space','scene-surface','scene-blockout','geometry-asset'])expect(stageContract({role})).toMatch(/^[a-f0-9]{64}$/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
