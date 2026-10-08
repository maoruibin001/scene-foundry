import {test,expect} from 'bun:test';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import {checkpointFixture} from './checkpoint-fixture';
import {read} from '../store';
import {assetPartCapacity,surfacePartBudget} from './surface-part-budget';
import {validateAsset,validateLayout} from './layout';
import {assetInput} from './asset-input';
import {assetTriangleBudget} from './triangle-budget';
import {checkpointSpatialInput} from './checkpoint-space';

function fixture(){
 const f=checkpointFixture(),layout=read(join(f.registration.generationDir,'layout.json')),plan=read(f.registration.planFile),brief=layout.program.templates[0];
 brief.maxParts=1;brief.materialIds=['mat','end','unused'];
 layout.program.materials.push(...['end','unused'].map(id=>({...layout.program.materials[0],id})));
 for(const i of layout.program.instances)i.surfaceOverrides=['mat','end'].map(id=>({sourceMaterialId:id,targetMaterialId:id,uvScale:null}));
 const part=f.geometry.template.parts[0],geometry={...f.geometry,template:{...f.geometry.template,parts:[part,{...structuredClone(part),id:'end-face',material:'end'}]}};
 return {...f,layout,plan,brief,geometry};
}

test('one planned part with two required surfaces derives two parts; missing surfaces and excess parts still fail',()=>{
 const f=fixture();try{
  expect(()=>validateLayout(f.layout,f.plan,2,'simple')).not.toThrow();
  expect(assetPartCapacity(f.layout,f.brief)).toMatchObject({plannedMaxParts:1,minimumParts:2,maxParts:2});
  expect(validateAsset(f.geometry,f.brief,f.layout,{}).surfaceBindings.every(c=>c.passed)).toBe(true);
  const missing=structuredClone(f.geometry);missing.template.parts.pop();expect(()=>validateAsset(missing,f.brief,f.layout,{})).toThrow('未命中');
  const excess=structuredClone(f.geometry);excess.template.parts.push({...excess.template.parts[0],id:'third'});expect(()=>validateAsset(excess,f.brief,f.layout,{})).toThrow('预算');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('distinct required source slots across instances define capacity, not targets or unused allowed materials',()=>{
 const f=fixture();try{
  f.layout.program.instances[0].surfaceOverrides=[{sourceMaterialId:'mat',targetMaterialId:'end',uvScale:null}];
  f.layout.program.instances[1].surfaceOverrides=[{sourceMaterialId:'end',targetMaterialId:'mat',uvScale:null}];
  expect(assetPartCapacity(f.layout,f.brief).maxParts).toBe(2);
  f.layout.program.instances[1].surfaceOverrides[0].sourceMaterialId='mat';
  expect(assetPartCapacity(f.layout,f.brief).maxParts).toBe(1);
  expect(assetPartCapacity(f.layout,f.brief).requiredMaterialIds).not.toContain('unused');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('derived capacity is supplied consistently without changing spatial or checkpoint identity',()=>{
 const f=fixture();try{
  const before=JSON.stringify(f.layout),space=structuredClone(f.layout);delete space.program.materials;
  space.version='scene-space-v1';for(const t of space.program.templates)delete t.materialIds;for(const i of space.program.instances)delete i.surfaceOverrides;
  expect(surfacePartBudget(f.layout,'simple')).toMatchObject({before:2,after:4,limit:192,spatialPlanUnchanged:true});
  expect(assetInput('原输入',f.plan,f.layout,f.brief,{}).brief.maxParts).toBe(2);
  expect(checkpointSpatialInput(f.layout,space)).toBe(space);
  expect(JSON.stringify(f.layout)).toBe(before);expect(f.brief.maxParts).toBe(1);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('expanded global and per-template hard ceilings are unchanged; impossible allocations fail before asset dispatch',()=>{
 const f=fixture();try{
  f.layout.program.instances=Array.from({length:97},(_,n)=>({...f.layout.program.instances[n%2],id:'instance'+n}));
  expect(()=>surfacePartBudget(f.layout,'simple')).toThrow('194 超过场景上限 192');
  const i=f.layout.program.instances[0];i.surfaceOverrides=Array.from({length:65},(_,n)=>({sourceMaterialId:'m'+n,targetMaterialId:'m'+n,uvScale:null}));
  expect(()=>assetPartCapacity(f.layout,f.brief)).toThrow('超过单资产上限 64');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('all triangle allocations use reconciled capacity, so repeated assets cannot overbook the scene',()=>{
 const f=fixture();try{
  const other={...f.brief,id:'other',maxParts:3};f.layout.program.templates.push(other);
  f.layout.program.instances.push({...f.layout.program.instances[0],id:'third',template:'other',surfaceOverrides:[]});
  const allocations=f.layout.program.templates.map(t=>assetTriangleBudget(f.layout,t));
  expect(allocations[0].maximum).toBe(Math.floor(237500*2/7));
  expect(allocations[1].maximum).toBe(Math.floor(237500*3/7));
  expect(allocations.reduce((n,x)=>n+x.expandedMaximum,0)).toBeLessThanOrEqual(237500);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
