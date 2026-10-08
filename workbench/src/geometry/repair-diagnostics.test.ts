import {test,expect} from 'bun:test';
import {supportDiagnostics,compactSurfaceAudit} from './repair-diagnostics';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const scene:any={lighting:{intensity:2,ambientIntensity:.5,points:[]},program:{version:'geometry-v1',name:'支承测试',materials:[{id:'mat',color:[1,1,1,1],roughness:.5,metallic:0,textureId:null}],templates:[{id:'unit',parts:[{...pose,id:'box',material:'mat',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'ground',label:'地面',template:'unit',position:[0,0,-.5],scale:[10,10,1],requirementIds:[]},{...pose,id:'floating',label:'离地物体',template:'unit',position:[0,0,2],requirementIds:[]},{...pose,id:'resting',label:'落地物体',template:'unit',position:[2,0,.5],requirementIds:[]}]}};
test('support evidence measures transformed triangles without moving or judging objects',()=>{
 const before=JSON.stringify(scene),d=supportDiagnostics(scene),floating=d.rows.find(r=>r.instanceId==='floating')!,resting=d.rows.find(r=>r.instanceId==='resting')!;
 expect(floating.min[2]).toBe(1.5);expect(floating.baseSamples.every(p=>p.support?.instanceId==='ground'&&Math.abs(p.support.gap-1.5)<1e-6)).toBe(true);
 expect(resting.baseSamples.every(p=>Math.abs(p.support.gap)<1e-6)).toBe(true);expect(JSON.stringify(scene)).toBe(before);
});
test('compact surface evidence keeps actual channels and material multipliers',()=>{
 const d=compactSurfaceAudit(scene,{});expect(d.materials[0]).toMatchObject({id:'mat',roughness:.5,metallic:0,textureSize:null,meshCount:3});
});
