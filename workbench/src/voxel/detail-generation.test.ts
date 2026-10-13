import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Mocks run in a child so they cannot replace production imports in other tests. */
test('real asset orchestrator dispatches the new role only for opted-in voxel jobs and preserves tool handoff',async()=>{
 const root=mkdtempSync(join(tmpdir(),'voxel-detail-dispatch-'));
 const geometry=new URL('../geometry/',import.meta.url).pathname,source=new URL('../',import.meta.url).pathname;
 const script=`
 import {mock} from 'bun:test';
 import assert from 'node:assert/strict';
 import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
 import {join} from 'node:path';
 const calls=[];
 mock.module(${JSON.stringify(source+'contracts.ts')},()=>({
  NoActionableChange:class extends Error{},isProviderFailure:()=>false,
  callValidated:async(input,folder,validate)=>{
   const {assertRoleTools}=await import(${JSON.stringify(source+'codex-tools.ts')});
   assertRoleTools(input.role,input.tools);calls.push(input);
   const payload=JSON.parse(input.text);
   const parts=[...payload.proceduralStructure,{id:'detail',material:'m',position:[.6,0,0],rotation:[0,0,0],scale:[1,1,1],smoothAngle:0,shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[1,1,1],operations:[{mode:'fill',min:[0,0,0],size:[1,1,1],repeat:null}]}}];
   const state=JSON.parse(input.tools.continuation().text).checkpoint;
   const saved=await input.tools.call('save_asset_parts',{expectedDraftSha256:state.draftSha256,partsJson:JSON.stringify(parts),removePartIds:[]});
   assert.equal(saved.isError,undefined);
   const sha=JSON.parse(saved.content[0].text).draftSha256;
   const selected=input.tools.resolveOutput({selectedAssetSha256:sha,reason:'fixture选择已保存的有效部件'});
   return {value:validate(selected),receipt:{mock:true}};
  }
 }));
 mock.module(${JSON.stringify(geometry+'asset-evidence.ts')},()=>({prepareAssetEvidence:async()=>({images:[],context:{}})}));
 const {generateOneAsset}=await import(${JSON.stringify(geometry+'generate.ts')});
 const {RUNS,digest}=await import(${JSON.stringify(source+'store.ts')});
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const brief={id:'unit',label:'构件',description:'结构和细节',origin:'原点',bounds:{min:[0,0,0],max:[1,1,1]},materialIds:['m'],maxParts:4};
 const layout={version:'scene-layout-v1',voxelLattice:{version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]},program:{version:'geometry-v1',name:'fixture',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[brief],instances:[{...pose,id:'instance',label:'构件',template:'unit',requirementIds:[]}]},textures:[],textureReuse:[],spatialOpenings:[],spatialContacts:[],cameras:[]};
 const seed={...pose,id:'anchor',material:'m',smoothAngle:0,shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[4,4,4],operations:[{mode:'fill',min:[0,0,0],size:[4,4,4],repeat:null}]}};
 const acceptedScene={...layout,program:{...layout.program,templates:[{id:'unit',parts:[seed]}]}};
 const ref=join(${JSON.stringify(root)},'reference.png');writeFileSync(ref,'fixture image bytes');
 for(const [kind,policy] of [['voxel','voxel-detail-v1'],['voxel',null],['scene',null]]){
  const id=crypto.randomUUID(),dir=join(RUNS,id,'generation');mkdirSync(dir,{recursive:true});
  const ctx={job:{id,prompt:'原图制作',sceneKind:kind,...(policy?{voxelDetailPolicy:policy}:{}),complexity:'simple',reuseMode:'fresh',modelSettings:{model:'gpt-6-astra',reasoningEffort:'medium'},profile:{provider:'codex-cli'},images:[{id:digest(readFileSync(ref))}]},plan:{requirements:[]},images:[{path:ref,mime:'image/png'}],dir,signal:new AbortController().signal,acceptedScene,requiresAssetPreview:false};
  const value=await generateOneAsset(ctx,layout,brief,{});
  assert.deepEqual(value.template.parts[0],seed);assert.equal(value.template.parts.length,2);
  const call=calls.at(-1);assert.equal(call.role,policy?'voxel-entity':'geometry-asset');
  if(policy){assert.equal(call.schemaContext.templateId,'unit');assert.ok(JSON.parse(call.text).voxelDetailAllocation);assert.ok(call.system.includes('逐组件体素精修'));const metrics=JSON.parse(readFileSync(join(dir,'assets/unit/voxel-detail-metrics.json'),'utf8'));assert.equal(metrics.occupiedCells,65);}
 }
 assert.equal(calls.length,3);console.log('new voxel / historical voxel / ordinary dispatch validated: 0 real model calls');
 `;
 try{
  const child=Bun.spawn([process.execPath,'--eval',script],{cwd:join(source,'..'),env:{...process.env,PIPELINE_DATA_DIR:join(root,'data'),PIPELINE_PROVIDER:'codex-cli'},stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(stderr).toBe('');expect(exit).toBe(0);expect(stdout).toContain('0 real model calls');
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
