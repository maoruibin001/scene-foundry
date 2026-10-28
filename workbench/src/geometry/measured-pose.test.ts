import {expect,test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconstructionPython} from '../runtime-paths.mjs';
import {bindReferenceFrames} from './reference-framing';
import {MEASURED_POSE,MEASURED_POSE_V1,PURE_ROTATION_RATIO,WALL_MARGIN,anchorMedianDepth,sceneProbe as sceneProbeFor,measuredPose,measuredPoseGuidance,measuredPosePolicyFor,poseFromAnchor} from './measured-pose';

const sub=(a:number[],b:number[])=>a.map((v,k)=>v-b[k]),unit=(a:number[])=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** World-from-camera with OpenCV columns (right, down, forward) for a roll-free camera; rows-major 3x3. */
const basis=(c:{position:number[];target:number[]})=>{const f=unit(sub(c.target,c.position)),r=unit(cross(f,[0,0,1])),u=cross(r,f),d=u.map(v=>-v);return [0,1,2].map(k=>[r[k],d[k],f[k]]);};
const mul=(A:number[][],B:number[][])=>A.map(r=>B[0].map((_,j)=>r.reduce((s,v,k)=>s+v*B[k][j],0)));
const T=(A:number[][])=>A[0].map((_,j)=>A.map(r=>r[j])),apply=(A:number[][],v:number[])=>A.map(r=>r.reduce((s,x,k)=>s+x*v[k],0));
/** The measurement a perfect tool would return for camera b relative to camera a. */
function truePose(a:{position:number[];target:number[]},b:{position:number[];target:number[]},ratio=.3){
 const A=basis(a),B=basis(b);return {R:mul(T(A),B),base:unit(apply(T(A),sub(b.position,a.position))),baselineRatio:ratio};
}
const close=(a:number[],b:number[],eps=1e-9)=>a.forEach((v,k)=>expect(v).toBeCloseTo(b[k],9));

test('measured-pose is on only for non-voxel jobs with a configured tool',()=>{
 expect(measuredPosePolicyFor('scene',{})).toBeNull();
 expect(measuredPosePolicyFor('voxel',{PIPELINE_POSE_PYTHON:'/x/python'})).toBeNull();
 expect(measuredPosePolicyFor('scene',{PIPELINE_POSE_PYTHON:'/x/python'})).toEqual({...MEASURED_POSE,model:'depth-anything/DA3-BASE'});
 expect(measuredPosePolicyFor('scene',{PIPELINE_POSE_PYTHON:'/x/python',PIPELINE_POSE_MODEL:'depth-anything/DA3-SMALL'})?.model).toBe('depth-anything/DA3-SMALL');
});

test('a measured pose is read only under the policy and never for view 1',()=>{
 const referencePose={views:[{referenceIndex:1},{referenceIndex:2,R:[[1,0,0],[0,1,0],[0,0,1]],base:[1,0,0],baselineRatio:.2}]};
 expect(measuredPose({referencePose},1)).toBeUndefined();
 const job={measuredPosePolicy:MEASURED_POSE,referencePose};
 expect(measuredPose(job,0)).toBeUndefined();expect(measuredPose(job,1)?.base).toEqual([1,0,0]);expect(measuredPose(job,2)).toBeUndefined();
 expect(measuredPoseGuidance({})).toBe('');
});

test('poseFromAnchor recovers the true direction and baseline direction at the scene\'s own baseline length',()=>{
 const anchor={position:[0,0,1.5],target:[.3,4,1.2]};
 const truth={position:[2.4,1.1,1.6],target:[-1,5,1.1]};
 const guessed={position:[1,-1,1.4],target:[3,3,1.4]};   // the model's own camera 2: wrong place and direction
 const placed=poseFromAnchor(anchor,guessed,truePose(anchor,truth));
 const L=Math.hypot(...sub(guessed.position,anchor.position));
 close(unit(sub(placed.position,anchor.position)),unit(sub(truth.position,anchor.position)));
 expect(Math.hypot(...sub(placed.position,anchor.position))).toBeCloseTo(L,9);
 close(unit(sub(placed.target,placed.position)),unit(sub(truth.target,truth.position)));
 expect(Math.hypot(...sub(placed.target,placed.position))).toBeCloseTo(Math.hypot(...sub(guessed.target,guessed.position)),9);
});

test('a near-zero measured baseline keeps camera 2 at camera 1 and only turns it',()=>{
 const anchor={position:[0,0,1.5],target:[0,4,1.5]},truth={position:[0,0,1.5],target:[3,3,1.5]};
 const placed=poseFromAnchor(anchor,{position:[2,0,1.5],target:[2,4,1.5]},{...truePose(anchor,{position:[1e-3,0,1.5],target:[3+1e-3,3,1.5]}),baselineRatio:PURE_ROTATION_RATIO/2});
 close(placed.position,anchor.position);close(unit(sub(placed.target,placed.position)),unit([3,3,0]));
});

test('bindReferenceFrames re-places only non-anchor perspective reference cameras',()=>{
 const root=mkdtempSync(join(tmpdir(),'measured-pose-')),path=join(root,'ref.png');
 expect(Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; Image.new("RGB",(1024,768)).save(sys.argv[1])',path]).exitCode).toBe(0);
 const anchor={position:[0,0,1.5],target:[0,4,1.5]},truth={position:[2,1,1.5],target:[-1,5,1.5]};
 const cam=(referenceIndex:number|null,c:{position:number[];target:number[]},projection='perspective')=>({name:'c',referenceIndex,...c,fov:1.08,projection});
 const pose=truePose(anchor,truth),other={position:[5,5,2],target:[5,6,2]};
 const bound=bindReferenceFrames({cameras:[cam(1,anchor),cam(2,{position:[1,-1,1.5],target:[1,3,1.5]}),cam(null,other)]},[{path},{path,pose}]);
 expect(bound.cameras[0].position).toEqual(anchor.position);expect(bound.cameras[0].target).toEqual(anchor.target);
 close(unit(sub(bound.cameras[1].target,bound.cameras[1].position)),unit(sub(truth.target,truth.position)));
 expect(bound.cameras[2].position).toEqual(other.position);
 const ortho=bindReferenceFrames({cameras:[cam(1,anchor),cam(2,other,'orthographic')]},[{path},{path,pose}]);
 expect(ortho.cameras[1].position).toEqual(other.position);
 const noPose=bindReferenceFrames({cameras:[cam(1,anchor),cam(2,other)]},[{path},{path}]);
 expect(noPose.cameras[1].position).toEqual(other.position);
 expect(measuredPoseGuidance({measuredPosePolicy:MEASURED_POSE,referencePose:{views:[{referenceIndex:1},{referenceIndex:2,...pose}]}})).toContain('图2：相对图1朝向左转');
});

const wall:any={version:'geometry-v1',name:'墙',materials:[{id:'m',color:[1,1,1,1],roughness:.5,metallic:0,textureId:null}],templates:[{id:'t',parts:[{id:'p',material:'m',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'box',size:[60,2,60],radius:0}}]}],instances:[{id:'wall',label:'墙',template:'t',position:[0,6,1.5],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]};

test('v2 locks spacing, v1 jobs replay with the scene spacing',()=>{
 const referencePose={views:[{referenceIndex:1},{referenceIndex:2,R:[[1,0,0],[0,1,0],[0,0,1]],base:[1,0,0],baselineRatio:.2}]};
 expect(measuredPose({measuredPosePolicy:MEASURED_POSE,referencePose},1)?.lockSpacing).toBe(true);
 expect(measuredPose({measuredPosePolicy:{...MEASURED_POSE,version:MEASURED_POSE_V1},referencePose},1)?.lockSpacing).toBe(false);
});

test('anchorMedianDepth reads the z-depth of the scene from camera 1',()=>{
 expect(anchorMedianDepth(wall,{position:[0,0,1.5],target:[0,1,1.5],fov:1})).toBeCloseTo(5,6);
 expect(anchorMedianDepth(wall,{position:[0,0,1.5],target:[0,-1,1.5],fov:1})).toBeUndefined();
});

test('with spacing locked, camera 2 sits baselineRatio x scene depth from camera 1 along the measured direction',()=>{
 const anchor={position:[0,0,1.5],target:[0,4,1.5]},truth={position:[2,1,1.5],target:[-1,5,1.5]};
 const pose={...truePose(anchor,truth,.4),lockSpacing:true};
 const placed=poseFromAnchor(anchor,{position:[0.3,0,1.5],target:[0.3,4,1.5]},pose,5);
 expect(Math.hypot(...sub(placed.position,anchor.position))).toBeCloseTo(2,9);
 close(unit(sub(placed.position,anchor.position)),unit(sub(truth.position,anchor.position)));
 const root=mkdtempSync(join(tmpdir(),'measured-pose-')),path=join(root,'ref.png');
 expect(Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; Image.new("RGB",(1024,768)).save(sys.argv[1])',path]).exitCode).toBe(0);
 const cam=(referenceIndex:number,c:{position:number[];target:number[]})=>({name:'c',referenceIndex,...c,fov:1,projection:'perspective'});
 const bound=bindReferenceFrames({program:wall,cameras:[cam(1,anchor),cam(2,{position:[0.3,0,1.5],target:[0.3,4,1.5]})]},[{path},{path,pose}]);
 expect(Math.hypot(...sub(bound.cameras[1].position,anchor.position))).toBeCloseTo(2,6);
 const v1=bindReferenceFrames({program:wall,cameras:[cam(1,anchor),cam(2,{position:[0.3,0,1.5],target:[0.3,4,1.5]})]},[{path},{path,pose:{...pose,lockSpacing:false}}]);
 expect(Math.hypot(...sub(v1.cameras[1].position,anchor.position))).toBeCloseTo(.3,9);
});


test('a locked spacing longer than the room stops short of the first wall along the baseline',()=>{
 const anchor={position:[0,0,1.5],target:[0,4,1.5]};
 const side:any={...wall,instances:[{...wall.instances[0],id:'side',position:[-3,0,1.5],rotation:[0,0,Math.PI/2]}]};   // wall face at x=-2
 const pose={R:[[1,0,0],[0,1,0],[0,0,1]],base:[-1,0,0],baselineRatio:.8,lockSpacing:true};
 const free=(o:number[],d:number[])=>sceneProbeFor(side).clearance(o,d);
 const placed=poseFromAnchor(anchor,anchor,pose,5,free);
 expect(placed.position[0]).toBeCloseTo(-2+WALL_MARGIN,6);
 expect(poseFromAnchor(anchor,anchor,pose,1,free).position[0]).toBeCloseTo(-.8,9);   // shorter than the clearance: unchanged
});

