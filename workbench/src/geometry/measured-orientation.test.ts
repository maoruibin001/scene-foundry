import {expect,test} from 'bun:test';
import {basis} from './camera-fit';
import {lockHeading,measuredOrientation,measuredOrientationPolicyFor,MEASURED_ORIENTATION,sceneWallAxis} from './measured-orientation';

const deg=Math.PI/180,close=(a:number[],b:number[])=>a.forEach((v,k)=>expect(v).toBeCloseTo(b[k],6));
test('roll turns the camera frame about the view direction (benchmark convention); level cameras are unchanged',()=>{
 const level=basis({position:[0,0,0],target:[0,1,0],fov:1} as any);close(level.up,[0,0,1]);close(level.right,[1,0,0]);
 const rolled=basis({position:[0,0,0],target:[0,1,0],fov:1,roll:10*deg} as any);
 close(rolled.up,[Math.sin(10*deg),0,Math.cos(10*deg)]);close(rolled.right,[Math.cos(10*deg),0,-Math.sin(10*deg)]);
});
test('heading lock keeps position and pitch and picks the quarter turn nearest the scene camera',()=>{
 const anchor={position:[1,2,1.5],target:[1,7,1]},locked=lockHeading(anchor,{roll:0,wall:20*deg},0);
 const f=locked.target.map((v,k)=>v-locked.position[k]);expect(locked.position).toEqual(anchor.position);expect(f[2]).toBeCloseTo(-.5,9);
 expect(Math.atan2(f[1],f[0])/deg).toBeCloseTo(70,6);expect(Math.hypot(f[0],f[1])).toBeCloseTo(5,9);
});
test('the wall axis follows the vertical faces of the scene',()=>{
 const program=(yaw:number)=>({version:'geometry-v1',name:'room',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],
  templates:[{id:'t',parts:[{id:'p',material:'m',shape:{type:'box',size:[4,1,2],radius:0},position:[0,0,1],rotation:[0,0,0],scale:[1,1,1]}]}],
  instances:[{id:'i',label:'墙',template:'t',position:[0,0,0],rotation:[0,0,yaw],scale:[1,1,1],requirementIds:[]}]});
 expect(sceneWallAxis(program(0))/deg).toBeCloseTo(0,4);expect(sceneWallAxis(program(30*deg))/deg).toBeCloseTo(30,4);
});
test('measured-orientation-v1 needs object3d point maps and can be switched off',()=>{
 expect(measuredOrientationPolicyFor('scene',null,{})).toBeNull();expect(measuredOrientationPolicyFor('voxel',{},{})).toBeNull();
 expect(measuredOrientationPolicyFor('scene',{},{PIPELINE_ORIENTATION_LOCK:'0'})).toBeNull();expect(measuredOrientationPolicyFor('scene',{},{})).toEqual({...MEASURED_ORIENTATION});
 const job={measuredOrientationPolicy:MEASURED_ORIENTATION,referenceOrientation:{views:[{roll:-9,wall:20}]}};
 expect(measuredOrientation(job,0)!.roll/deg).toBeCloseTo(-9,9);expect(measuredOrientation({referenceOrientation:job.referenceOrientation},0)).toBeUndefined();
});
