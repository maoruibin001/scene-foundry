import {expect,test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconstructionPython} from '../runtime-paths.mjs';
import {bindReferenceFrames} from './reference-framing';
import {MEASURED_FOV,measuredFovGuidance,measuredFovPolicyFor,measuredVfov} from './measured-fov';

test('measured-fov-v1 is on only for non-voxel jobs with a configured tool',()=>{
 expect(measuredFovPolicyFor('scene',{})).toBeNull();
 expect(measuredFovPolicyFor('voxel',{PIPELINE_FOV_PYTHON:'/x/python'})).toBeNull();
 expect(measuredFovPolicyFor('scene',{PIPELINE_FOV_PYTHON:'/x/python'})).toEqual({...MEASURED_FOV,model:'Ruicheng/moge-2-vitl-normal'});
});

test('a measured FoV is read only under the policy',()=>{
 const referenceIntrinsics={views:[{referenceIndex:1,vfov:.82}]};
 expect(measuredVfov({referenceIntrinsics},0)).toBeUndefined();
 const job={measuredFovPolicy:MEASURED_FOV,referenceIntrinsics};
 expect(measuredVfov(job,0)).toBe(.82);expect(measuredVfov(job,1)).toBeUndefined();
 expect(measuredFovGuidance(job)).toContain('0.820 弧度');expect(measuredFovGuidance({})).toBe('');
});

test('bindReferenceFrames locks measured FoV on reference perspective cameras only',()=>{
 const root=mkdtempSync(join(tmpdir(),'measured-fov-')),path=join(root,'ref.png');
 expect(Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; Image.new("RGB",(1024,768)).save(sys.argv[1])',path]).exitCode).toBe(0);
 const cam=(referenceIndex:number|null,projection='perspective')=>({name:'c',referenceIndex,position:[0,0,1],target:[0,1,1],fov:1.08,projection});
 const bound=bindReferenceFrames({cameras:[cam(1),cam(null)]},[{path,vfov:.82}]);
 expect(bound.cameras.map(c=>c.fov)).toEqual([.82,1.08]);
 expect(bindReferenceFrames({cameras:[cam(1,'orthographic')]},[{path,vfov:.82}]).cameras[0].fov).toBe(1.08);
 expect(bindReferenceFrames({cameras:[cam(1)]},[{path}]).cameras[0].fov).toBe(1.08);
});

test('binding an already bound scene returns it unchanged',()=>{
 const root=mkdtempSync(join(tmpdir(),'bind-once-')),path=join(root,'ref.png');
 expect(Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; Image.new("RGB",(1024,768)).save(sys.argv[1])',path]).exitCode).toBe(0);
 const once=bindReferenceFrames({cameras:[{name:'c',referenceIndex:1,position:[0,0,1],target:[0,1,1],fov:1.08,projection:'perspective'}]},[{path,vfov:.82}]);
 expect(bindReferenceFrames(once,[{path,vfov:.9}])).toBe(once);
});
