import {expect,test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconstructionPython} from '../runtime-paths.mjs';
import {bindReferenceFrames} from './reference-framing';
import {sceneProbe} from './measured-pose';
import {MEASURED_CAMERA,lockAnchorCamera,lockedCameraRepairGuidance,measuredCamera,measuredCameraGuidance,measuredCameraPolicyFor} from './measured-camera';

const box=(id:string,position:number[],size:number[])=>({id,label:id,template:id,position,rotation:[0,0,0],scale:[1,1,1],requirementIds:[]});
const tpl=(id:string,size:number[])=>({id,parts:[{id:'p',material:'m',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'box',size,radius:0}}]});
// floor top at z=0, back wall face at y=5
const room:any={version:'geometry-v1',name:'房间',materials:[{id:'m',color:[1,1,1,1],roughness:.5,metallic:0,textureId:null}],
 templates:[tpl('floor',[40,40,2]),tpl('wall',[40,2,40])],instances:[box('floor',[0,0,-1],[40,40,2]),{...box('wall',[0,6,0],[40,2,40])}]};
const measured={heightRatio:.3,pitch:-5,far:1.4,left:.8,right:.9};

test('measured-camera-v1 is opt-in and needs the MoGe Python',()=>{
 expect(measuredCameraPolicyFor('scene',{PIPELINE_FOV_PYTHON:'/x/python'})).toBeNull();
 expect(measuredCameraPolicyFor('voxel',{PIPELINE_FOV_PYTHON:'/x/python',PIPELINE_CAMERA_LOCK:'1'})).toBeNull();
 expect(measuredCameraPolicyFor('scene',{PIPELINE_FOV_PYTHON:'/x/python',PIPELINE_CAMERA_LOCK:'1'})).toEqual({...MEASURED_CAMERA,model:'Ruicheng/moge-2-vitl-normal'});
 const job={measuredCameraPolicy:MEASURED_CAMERA,referenceCamera:{view:measured}};
 expect(measuredCamera(job,0)).toEqual(measured);expect(measuredCamera(job,1)).toBeUndefined();expect(measuredCamera({referenceCamera:{view:measured}},0)).toBeUndefined();
 expect(measuredCameraGuidance(job)).toContain('0.30 倍');expect(measuredCameraGuidance({})).toBe('');
});

test('camera 1 gets the measured height over the floor below it and the measured pitch, yaw kept',()=>{
 const anchor={position:[0,0,2.5],target:[0,3,2.5],fov:1},probe=sceneProbe(room);
 const locked=lockAnchorCamera(anchor,measured,probe),D=probe.depth({...locked,fov:1})!;
 expect(locked.position[2]/D).toBeCloseTo(.3,2);   // height over the median depth seen from the locked camera itselfexpect(locked.position.slice(0,2)).toEqual([0,0]);
 const f=locked.target.map((v,k)=>v-locked.position[k]);
 expect(Math.asin(f[2]/Math.hypot(...f))*180/Math.PI).toBeCloseTo(-5,6);expect(f[0]).toBeCloseTo(0,9);expect(Math.hypot(...f)).toBeCloseTo(3,9);
 const noFloor={...room,instances:[room.instances[1]]};
 expect(lockAnchorCamera(anchor,measured,sceneProbe(noFloor)).position[2]).toBe(2.5);   // nothing below: height kept, pitch still set
});

test('bindReferenceFrames locks camera 1 first and derives camera 2 from the locked camera',()=>{
 const root=mkdtempSync(join(tmpdir(),'measured-camera-')),path=join(root,'ref.png');
 expect(Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; Image.new("RGB",(1024,768)).save(sys.argv[1])',path]).exitCode).toBe(0);
 const cam=(referenceIndex:number,position:number[],target:number[])=>({name:'c',referenceIndex,position,target,fov:1,projection:'perspective'});
 const pose={R:[[1,0,0],[0,1,0],[0,0,1]],base:[1,0,0],baselineRatio:.2};
 const bound=bindReferenceFrames({program:room,cameras:[cam(1,[0,0,2.5],[0,3,2.5]),cam(2,[1,0,2.5],[1,3,2.5])]},[{path,camera:measured},{path,pose}]);
 const c1=bound.cameras[0],c2=bound.cameras[1];
 expect(c1.position[2]).toBeLessThan(2.5);expect(c2.position[2]).toBeCloseTo(c1.position[2],6);   // same rotation, sideways baseline
 const f1=c1.target.map((v:number,k:number)=>v-c1.position[k]),f2=c2.target.map((v:number,k:number)=>v-c2.position[k]);
 f1.forEach((v:number,k:number)=>expect(f2[k]/Math.hypot(...f2)).toBeCloseTo(v/Math.hypot(...f1),6));
 const plain=bindReferenceFrames({program:room,cameras:[cam(1,[0,0,2.5],[0,3,2.5])]},[{path}]);
 expect(plain.cameras[0].position).toEqual([0,0,2.5]);
});

test('repair guidance names the locked camera quantities and what stays editable',()=>{
 expect(lockedCameraRepairGuidance({},{fov:false,pose:false,camera:false})).toBe('');
 const g=lockedCameraRepairGuidance({},{fov:true,pose:true,camera:true});
 expect(g).toContain('视场');expect(g).toContain('离地高度与俯仰');expect(g).toContain('水平位置与水平朝向');expect(g).toContain('不是改机位');
});
