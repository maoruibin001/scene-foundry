import {expect,test} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareSpecProject} from './prepare-spec';
import {sampleSpec} from './fixtures';

test('volumetric export preserves authored optics while retaining fine silhouette reconstruction',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'spec-volume-profile-')),spec=sampleSpec(),post=spec.lighting.states[0].post;
 post.fog={color:[.12,.18,.24],density:.01,anisotropy:.5,boundsMin:[-20,-20,0],boundsMax:[20,20,20],light:'key'};
 post.volumetric={extinction:.007,albedo:[.45,.6,.8],anisotropy:.5,heightFalloff:.02,noise:.3,maxDistance:100};
 const frozen=JSON.stringify(spec);
 try{await prepareSpecProject(dir,spec,{id:'volume-profile-unit',concurrency:1});
  const profile=JSON.parse(readFileSync(join(dir,'render-profile.json'),'utf8'));
  expect(profile.volumetricFog).toEqual({quality:'high',depth:48,tileSize:4});
  expect(JSON.stringify(spec)).toBe(frozen);
  const fog=readFileSync(join(dir,'game/assets/volumetric-fog.plugin.ts'),'utf8');
  expect(fog).toContain('extinction:[0.007,0.007,0.007]');expect(fog).toContain('maxDistance:100');
  expect(readFileSync(join(dir,'game/assets/render-profile.plugin.ts'),'utf8')).toContain(JSON.stringify(profile));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
