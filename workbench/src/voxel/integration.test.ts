import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {voxelRequest,voxelInput} from './namespace';
import {ReferenceBaselines} from '../reference-baseline';
import {digest} from '../store';
import {generationInput} from '../reference-input';
import {freshSceneReservation} from '../scene-call-reserve';
import {compileVoxelScene,type VoxelProgram} from './program';
import {prepareGeometryProject} from '../geometry/prepare';
import {sceneComplexity} from '../geometry/run';
import {voxelProjection} from './projection';
import {uiHandler} from '../ui-server';
import {modelSchema} from '../model-schema';

test('voxel namespace preserves body/query/origin; normal requests are identical',async()=>{
 const request=new Request('http://127.0.0.1/api/voxel/jobs?x=1',{method:'POST',headers:{Origin:'http://127.0.0.1'},body:'{"imageIds":["a"]}'}),mounted=voxelRequest(request);
 expect(mounted.namespaced).toBe(true);expect(mounted.request.url).toBe('http://127.0.0.1/api/jobs?x=1');expect(await mounted.request.json()).toEqual({imageIds:['a']});expect(mounted.request.headers.get('origin')).toBe('http://127.0.0.1');
 const ordinary=new Request('http://127.0.0.1/api/jobs');expect(voxelRequest(ordinary).request).toBe(ordinary);
 expect(voxelRequest(new Request('http://127.0.0.1/voxel/files/runs/a/scene.vox')).request.url).toEndWith('/files/runs/a/scene.vox');
});
test('uploaded voxel goal freezes real hashes without fabricating manual confirmation; changed input rejected',()=>{
 const root=mkdtempSync(join(tmpdir(),'voxel-baseline-')),bytes=Buffer.from('actual-reference-bytes'),id=digest(bytes);
 try{writeFileSync(join(root,id+'.png'),bytes);writeFileSync(join(root,id+'.json'),JSON.stringify({id,file:id+'.png'}));const refs=new ReferenceBaselines(join(root,'references'),root);
  const input=voxelInput({imageIds:[id],prompt:'还原原图'},refs),baseline=refs.assert(input);expect(baseline.approval.method).toBe('uploaded-image-goal');expect(baseline.origin).toBe('uploaded');expect(input.sceneKind).toBe('voxel');expect(()=>refs.assert({...input,prompt:'改变目标'})).toThrow();expect(()=>voxelInput({prompt:'没有原图'},refs)).toThrow();
  const regular=refs.create({imageIds:[id]});expect(()=>refs.approve(regular.id,'uploaded-image-goal')).toThrow();expect(refs.approve(regular.id).approval.method).toBe('explicit-ui-confirmation');
  expect(generationInput({...input,images:[{id}]}).sceneKind).toBe('voxel');expect(freshSceneReservation({...input,matchingLevel:'standard'},{}).calls).toBe(8);expect(freshSceneReservation(input,{reuseSceneFrom:'saved'})).toBeNull();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('native export authors real orthographic camera bounds and switches projection; regular templates unchanged',()=>{
 const p:VoxelProgram={version:'voxel-scene-v1',name:'体素出口',size:[8,8,8],cellSize:.25,palette:[{id:'stone',color:'#c8b898'}],entities:[{id:'temple',label:'神庙',category:'建筑',role:'subject',requirementIds:['R1'],operations:[{action:'fill',shape:'box',min:[1,1,1],size:[4,5,6],palette:'stone',slopeAxis:'x',reverse:false}]}],cameras:[{name:'参考',referenceIndex:1,position:[-12,-20,16],target:[4,4,3],projection:'orthographic',orthographicHeight:12,fov:.785},{name:'检查',referenceIndex:null,position:[20,24,16],target:[4,4,3],projection:'perspective',orthographicHeight:null,fov:.785}],lighting:{direction:[-.4,-.6,-.8],color:[1,1,1],intensity:2,ambientColor:[1,1,1],ambientIntensity:.7,points:[]},assumptions:['背面推断']};
 const root=mkdtempSync(join(tmpdir(),'voxel-export-'));
 try{const {scene}=compileVoxelScene(p,{requirements:[{id:'R1',critical:true,count:1}]},1);scene.cameras[0].frame={width:1200,height:1200};prepareGeometryProject(root,scene.program,{}, {id:'voxel',summary:'体素原图出口',scene,provenance:{test:true}});
  const world=readFileSync(join(root,'game/assets/world.pack.ts'),'utf8'),controller=readFileSync(join(root,'game/assets/camera.plugin.ts'),'utf8'),audit=JSON.parse(readFileSync(join(root,'game/assets/scene-audit.json'),'utf8'));
  expect(world).toContain('orthographic({"left":-1.5,"right":1.5,"bottom":-1.5,"top":1.5');expect(controller).toContain('projection:1,fov:0');expect(controller).toContain('projection:0,fov:v.fov');expect(audit.views[0].projection).toBe('orthographic');expect(audit.views[0].cruise.status).toBe('ready');
  expect(sceneComplexity(scene,'complex',1).passed).toBe(false);expect(sceneComplexity(scene,'complex',1,'voxel').passed).toBe(true);
  expect(voxelProjection('unchanged','unchanged',[{projection:'perspective'}])).toEqual({world:'unchanged',controller:'unchanged'});
  expect(modelSchema('voxel-scene',{requirementIds:['R1']}).properties.version.enum).toEqual(['voxel-scene-v1']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('one UI port proxies only voxel namespaces to the isolated voxel worker',async()=>{
 const root=mkdtempSync(join(tmpdir(),'voxel-ui-')),normal=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({worker:'normal'})}),voxel=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>Response.json({worker:'voxel',path:new URL(req.url).pathname,origin:req.headers.get('origin')})});
 try{const handler=uiHandler(root,normal.url.toString(),undefined,voxel.url.toString());expect(await(await handler(new Request('http://127.0.0.1/api/jobs'))).json()).toEqual({worker:'normal'});
  const response=await handler(new Request('http://127.0.0.1/api/voxel/jobs',{method:'POST',headers:{Origin:'http://127.0.0.1'},body:'{}'}));expect(await response.json()).toEqual({worker:'voxel',path:'/api/voxel/jobs',origin:voxel.url.origin});
  expect((await handler(new Request('http://127.0.0.1/api/voxel/jobs',{headers:{Origin:'https://external.invalid'}}))).status).toBe(403);
 }finally{normal.stop(true);voxel.stop(true);rmSync(root,{recursive:true,force:true});}
});
