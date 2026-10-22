import {test,expect} from 'bun:test';
import {withNormalizedSky,skyShells,SKY_NORMALIZATION} from './sky-normalization';

const pose={rotation:[0,0,0],scale:[1,1,1]};
// Canal 38c83a76 in miniature: a ground plane, a 90 m sky dome around the camera with a textured shell and a thin cloud part.
function canal(){
 const tex={width:4,height:2,colorSpace:'srgb',rgba8:Buffer.from([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255, 10,10,10,255, 20,20,20,255, 30,30,30,255, 40,40,40,255]).toString('base64')};
 const dome={type:'lathe',profile:[[90,0],[64,64],[0,90],[0,89.6],[63.7,63.7],[89.6,0],[90,0]],segments:24,arc:null,start:null};
 const program={version:'geometry-v1',name:'运河',materials:[{id:'water',color:[.2,.3,.4,1],roughness:.2,metallic:0,textureId:null},{id:'sky',color:[1,1,1,1],roughness:1,metallic:0,textureId:'TX_SKY'},{id:'cloud',color:[.6,.4,.3,1],roughness:1,metallic:0,textureId:null}],
  templates:[{id:'ground',parts:[{...pose,id:'water',position:[0,0,-.05],material:'water',shape:{type:'box',size:[40,80,.1],radius:0}}]},{id:'T_SKY',parts:[{...pose,id:'shell',position:[0,0,0],material:'sky',shape:dome},{...pose,id:'low_thin_cloud',position:[10,40,20],material:'cloud',shape:{type:'box',size:[20,4,.2],radius:0}}]}],
  instances:[{...pose,id:'I_WATER',label:'水面',template:'ground',position:[0,0,0],requirementIds:[]},{...pose,id:'I_SKY',label:'晚霞',template:'T_SKY',position:[0,0,0],requirementIds:[]}]};
 return {scene:{program,cameras:[{name:'参考',referenceIndex:1,position:[0,-20,1.6],target:[0,20,3],fov:1}],assumptions:[]},textures:{TX_SKY:tex}};
}

test('the sky shell of an outdoor scene gets self-lit materials and a row-mean texture that meets across the wrap',()=>{
 const {scene,textures}=canal(),before=JSON.stringify([scene,textures]);
 expect(skyShells(scene)).toEqual(['I_SKY']);
 const r=withNormalizedSky(scene,textures);
 const sky=r.scene.program.templates.find((t:any)=>t.id==='T_SKY');
 expect(sky.parts.map((p:any)=>p.material)).toEqual(['sky__sky','cloud__sky']);
 const shell=r.scene.program.materials.find((m:any)=>m.id==='sky__sky'),cloud=r.scene.program.materials.find((m:any)=>m.id==='cloud__sky');
 expect(shell.textureId).toBe('TX_SKY__sky');expect(shell.emission.intensity).toBeGreaterThan(0);expect(cloud.emission.color[0]).toBeGreaterThan(cloud.emission.color[2]);
 const b=Buffer.from(r.textures.TX_SKY__sky.rgba8,'base64');
 for(let y=0;y<2;y++)for(let k=0;k<3;k++)expect(b[(y*4)*4+k]).toBe(b[(y*4+3)*4+k]);
 expect(r.scene.program.materials.find((m:any)=>m.id==='water').emission).toBeUndefined();
 expect(JSON.stringify([scene,textures])).toBe(before);

});

test('a roofed interior and a scene without an enclosing shell are left unchanged',()=>{
 const {scene,textures}=canal();
 const roofed=structuredClone(scene);roofed.program.instances.push({...pose,id:'roof',label:'顶',template:'ground',position:[0,-20,4],requirementIds:[]});
 expect(withNormalizedSky(roofed,textures).scene).toBe(roofed);
 const open=structuredClone(scene);open.program.instances=open.program.instances.filter((i:any)=>i.id!=='I_SKY');
 expect(withNormalizedSky(open,textures).report.shells).toEqual([]);
});
