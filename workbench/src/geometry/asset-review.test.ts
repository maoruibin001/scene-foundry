import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAssetReview,verifyAssetReview} from './asset-review';
import {assertRoleTools,serveCodexTools} from '../codex-tools';
import {callCodex} from '../codex-provider';
import {digest,save} from '../store';
import {stable} from '../validated-cache';
test('模拟渲染：重要资产必须选已预览数据；证据篡改拒绝，恢复不重置额度',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'asset-preview-test-')),ref=join(folder,'ref.png');writeFileSync(ref,'测试参考图字节，仅用于摘要');
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},brief={id:'unit',label:'通用物体',materialIds:['m'],maxParts:4,bounds:{min:[-1,-1,-1],max:[1,1,1]}},value=(size:number)=>({version:'asset-geometry-v1',template:{id:'unit',parts:[{...pose,id:'body',material:'m',shape:{type:'box',size:[size,size,size],radius:0}}]}});
 const layout={program:{version:'geometry-v1',name:'测试',materials:[{id:'m',textureId:null,color:[1,1,1,1],roughness:.7,metallic:0}],templates:[brief],instances:[{...pose,id:'instance',label:'实例',template:'unit',requirementIds:[]}]},textures:[],textureReuse:[],spatialOpenings:[]};
 let calls=0;const render:any=async(_s:any,_i:any,_r:any,dir:string)=>{calls++;mkdirSync(join(dir,'capture'));const frames=[1,2].map(n=>{const file=n+'.png',bytes='模拟画面'+n;writeFileSync(join(dir,'capture',file),bytes);return {file,sha256:digest(bytes)}});save(join(dir,'engine-preview-receipt.json'),{frames});return [];};
 const options:any={brief,layout,textures:{},images:[{path:ref,mime:'image/png'}],folder:join(folder,'check'),signal:new AbortController().signal,render};
 try{
  const tool=createAssetReview(options);
  expect(()=>assertRoleTools('geometry-asset',tool.kit)).not.toThrow();
  expect(()=>assertRoleTools('scene-space',tool.kit)).toThrow('PROVIDER_TOOLS_INVALID');
  expect(()=>assertRoleTools('geometry-asset',{...tool.kit,definitions:[...tool.kit.definitions,{name:'render_scene_patch'}]})).toThrow('PROVIDER_TOOLS_INVALID');
  // The real provider entry reaches route preflight, rather than the stale repair-only gate. No CLI/model is started.
  await expect(callCodex({role:'geometry-asset',system:'中文测试',text:'中文测试',tools:tool.kit},folder,'fixture-model',{})).rejects.toThrow('CODEX_ROUTE_UNVERIFIED');
  const server=serveCodexTools(tool.kit);try{
   const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!;const [,url]=JSON.parse(arg.slice(arg.indexOf('=')+1));
   const listed=await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/list'})})).json();expect(listed.tools.map((t:any)=>t.name)).toEqual(['preview_asset']);
   const denied=await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name:'render_scene_patch'}})});expect(denied.status).toBe(400);
  }finally{server.close();}
  expect(()=>tool.assertReviewed(value(1))).toThrow('缺少');
  expect((await tool.kit.call('preview_asset',{assetJson:JSON.stringify(value(1))})).isError).not.toBe(true);
  const record=tool.assertReviewed(value(1));expect(verifyAssetReview(value(1),record)).toBe(true);
  const resolved=tool.kit.resolveOutput!({selectedAssetSha256:digest(stable(value(1))),reason:'已看模拟画面，仅用于单元测试'});expect(resolved).toEqual(value(1));
  await tool.kit.call('preview_asset',{assetJson:JSON.stringify(value(1))});expect(calls).toBe(1);
  await tool.kit.call('preview_asset',{assetJson:JSON.stringify(value(.8))});expect(calls).toBe(2);
  const restored=createAssetReview(options);await expect(restored.kit.call('preview_asset',{assetJson:JSON.stringify(value(.6))})).rejects.toThrow('上限');
  writeFileSync(join(options.folder,'1/capture/1.png'),'changed');expect(verifyAssetReview(value(1),record)).toBe(false);expect(()=>tool.assertReviewed(value(1))).toThrow('改变');
 }finally{rmSync(folder,{recursive:true,force:true});}
});
