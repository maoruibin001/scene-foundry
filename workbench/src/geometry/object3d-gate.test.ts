import {expect,test} from 'bun:test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OBJECT3D_GATE,compareObject3d,object3dPolicyFor,object3dProgressScore,object3dRepairFeedback,object3dRule,withObject3dAcceptance} from './object3d-gate';
import {selectSpatialCandidate} from './blockout-selection';

const review={score:2.6,confidence:.8,summary:'s',relations:[]};
const objectiveGate=(checks:any[])=>({passed:false,review,threshold:{confidence:.6},protocol:'p',objective:{passed:false,checks}});
const kept=[{id:'critical-visible',passed:true,detail:'ok'},{id:'not-mirrored',passed:true,detail:'ok'},{id:'camera-clear',passed:true,detail:'ok'}];
const judged=(score:number,checks=kept)=>withObject3dAcceptance(objectiveGate([...checks,{id:'critical-floor',passed:false,detail:'judge row'},{id:'landmark-alignment',passed:false,detail:'2d'}]),{version:'object3d-v1',score,rows:20,invisible:1});

test('object3d-gate-v1 is on for non-voxel jobs with the MoGe Python unless switched off',()=>{
 expect(object3dPolicyFor('scene',{})).toBeNull();
 expect(object3dPolicyFor('voxel',{PIPELINE_FOV_PYTHON:'/p'})).toBeNull();
 expect(object3dPolicyFor('scene',{PIPELINE_FOV_PYTHON:'/p',PIPELINE_OBJECT3D_GATE:'0'})).toBeNull();
 expect(object3dRule({object3dGatePolicy:object3dPolicyFor('scene',{PIPELINE_FOV_PYTHON:'/p'})})).toBe(true);
 expect(object3dRule({})).toBe(false);
});

test('object3d decides the gate; judge rows and the 2D residual no longer block',()=>{
 const pass=judged(.3);
 expect(pass.passed).toBe(true);expect(pass.objective.version).toBe(OBJECT3D_GATE.version);
 expect(pass.objective.checks.map((c:any)=>c.id)).toEqual(['critical-visible','not-mirrored','camera-clear','object3d']);
 expect(judged(.4).passed).toBe(false);
 expect(judged(.3,[{...kept[0],passed:false},kept[1],kept[2]]).passed).toBe(false);
});

test('rounds order by failed checks, then object3d error; progress counts .02 of error as two points',()=>{
 expect(compareObject3d(judged(.3),judged(.5))).toBeLessThan(0);
 expect(compareObject3d(judged(.2,[{...kept[0],passed:false},kept[1],kept[2]]),judged(.3))).toBeGreaterThan(0);
 expect(object3dProgressScore(judged(.4))-object3dProgressScore(judged(.42))).toBeCloseTo(2,6);
 expect(object3dProgressScore(judged(.4,[{...kept[0],passed:false},kept[1],kept[2]]))).toBe(35);
});

test('selection keeps the lower-error round and ignores the review confidence',()=>{
 const space={spatialRelations:[]},c=(round:number,gate:any)=>({jobId:'j',round,folder:'f'+round,space,gate});
 const low=judged(.3);low.review={...review,confidence:.1};
 expect(selectSpatialCandidate(c(0,judged(.5)),c(1,low)).candidate.round).toBe(1);
 const worse=selectSpatialCandidate(c(0,judged(.3)),c(1,judged(.5)));expect(worse.candidate.round).toBe(0);expect(worse.eligible).toBe(true);
});

test('repair feedback names the worst landmarks and whether they sit too near or too far',()=>{
 const folder=mkdtempSync(join(tmpdir(),'object3d-'));
 writeFileSync(join(folder,'object3d.json'),JSON.stringify({score:.5,landmarks:[
  {landmarkId:'sofa',label:'沙发',critical:true,referenceIndex:1,error:.6,visible:true,depthRatio:.6},
  {landmarkId:'lamp',label:'灯',critical:false,referenceIndex:1,error:1,visible:false,depthRatio:null},
  {landmarkId:'desk',label:'桌',critical:false,referenceIndex:2,error:.5,visible:true,depthRatio:1.4},
  {landmarkId:'rug',label:'地毯',critical:false,referenceIndex:1,error:.1,visible:true,depthRatio:1}]}));
 const f=object3dRepairFeedback(judged(.5),folder)!;
 expect(f.landmarks.map((x:any)=>x.landmarkId)).toEqual(['sofa','lamp','desk']);
 expect(f.landmarks[0].issue).toContain('过近');expect(f.landmarks[1].issue).toContain('不可见');expect(f.landmarks[2].issue).toContain('过远');
 expect(object3dRepairFeedback(judged(.3),folder)).toBeNull();
});

test('an invisible landmark says where its instances project and where the reference puts them',()=>{
 const folder=mkdtempSync(join(tmpdir(),'object3d-'));
 writeFileSync(join(folder,'object3d.json'),JSON.stringify({score:.5,landmarks:[{landmarkId:'cab',label:'柜',critical:true,referenceIndex:1,error:1,visible:false,depthRatio:null,projected:[-.505,.447,2.84],expected:[.094,.5]}]}));
 const issue=object3dRepairFeedback(judged(.5),folder)!.landmarks[0].issue;
 expect(issue).toContain('画面左侧外');expect(issue).toContain('u=-0.505');expect(issue).toContain('u=0.094');
});
