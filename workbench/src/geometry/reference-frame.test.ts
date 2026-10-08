import {test,expect} from 'bun:test';
import {referenceFrame,cameraAspect,captureFrame} from './reference-frame.mjs';
import {project,ray} from './camera-fit';
import {assertVisibilityCamera} from './visibility-evidence';
import {bindReferenceFrames} from './reference-framing';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const camera={name:'参考',referenceIndex:1,position:[0,-5,0],target:[0,0,0],fov:Math.PI/2};
test('portrait projection and ray match the actual reference frame; legacy stays landscape',()=>{
 const c={...camera,frame:referenceFrame(1600,2400)};expect(c.frame).toMatchObject({width:960,height:1440});expect(captureFrame(camera)).toEqual({width:1600,height:900});
 const uv=project(c,[1,0,0]);expect(uv[0]).toBeCloseTo(.65,6);expect(project(camera,[1,0,0])[0]).toBeCloseTo(.55625,6);
 const direction=ray(c,uv);expect(direction[0]/direction[1]).toBeCloseTo(.2,6);expect(cameraAspect(c)).toBeCloseTo(2/3);
});
test('camera evidence rejects correct pose captured at the wrong aspect',()=>{
 const c={...camera,frame:referenceFrame(1600,2400)},pose={selectedView:0,position:[0,0,5],target:[0,0,0],fov:camera.fov};
 expect(()=>assertVisibilityCamera(c,pose,0,960,1440)).not.toThrow();expect(()=>assertVisibilityCamera(c,pose,0,1600,900)).toThrow('画幅不一致');
});
test('frame metadata is derived from image bytes, overrides claimed values and leaves source immutable',()=>{
 const folder=mkdtempSync(join(tmpdir(),'reference-frame-'));
 try{const file=join(folder,'reference.ppm');writeFileSync(file,Buffer.concat([Buffer.from('P6\n2 3\n255\n'),Buffer.alloc(18,100)]));
  const source={cameras:[{...camera,frame:{width:100,height:100}},{...camera,referenceIndex:null}]},before=JSON.stringify(source),bound=bindReferenceFrames(source,[{path:file}]);
  expect(bound.cameras[0].frame).toMatchObject({width:960,height:1440,sourceWidth:2,sourceHeight:3});expect(JSON.stringify(source)).toBe(before);expect(bound.cameras[1].frame).toBeUndefined();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
