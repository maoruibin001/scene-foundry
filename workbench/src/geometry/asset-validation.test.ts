import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateAsset,assetSchema} from './layout';
import {validateAllocatedAsset} from './asset-validation';
import {createAssetReview} from './asset-review';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import {serveCodexTools} from '../codex-tools';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'asset-budget-test-')),ref=join(root,'ref.png');writeFileSync(ref,'fixture reference');
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},brief:any={id:'leaves',label:'叶丛',materialIds:['m'],maxParts:1,bounds:{min:[-1,-1,-1],max:[1,1,1]}};
 const layout:any={program:{version:'geometry-v1',name:'重复植物',materials:[{id:'m',textureId:null,color:[1,1,1,1],roughness:.7,metallic:0}],templates:[brief],instances:Array.from({length:20},(_,n)=>({...pose,id:'i'+n,label:'植物',template:brief.id,requirementIds:[]}))},textures:[],textureReuse:[],spatialOpenings:[]};
 const asset=(count:number):any=>({version:'asset-geometry-v1',template:{id:brief.id,parts:[{...pose,id:'cluster',material:'m',shape:{type:'scatter',count,seed:4,volume:'box',size:[1,1,1],rotationRange:[1,1,1],scaleRange:[.1,1],element:{type:'box',size:[.1,.1,.1],radius:.01}}}]}});
 let renders=0;const render:any=async(_s:any,_i:any,_r:any,dir:string)=>{renders++;mkdirSync(join(dir,'capture'));const frames=[1,2].map(n=>{const file=n+'.png',bytes='mock frame '+n;writeFileSync(join(dir,'capture',file),bytes);return {file,sha256:digest(bytes)}});save(join(dir,'engine-preview-receipt.json'),{frames});return [];};
 const options={brief,layout,textures:{},images:[{path:ref,mime:'image/png'}],folder:join(root,'preview'),signal:new AbortController().signal,render};
 return {root,brief,layout,asset,options,renders:()=>renders};
}

test('结构有效但展开分配超额的资产，预览与最终校验都拒绝且不改输入',()=>{
 const f=fixture();try{const value=f.asset(100),before=stable(value);expect(validateAsset(value,f.brief,f.layout,{}).triangles).toBe(43200);
 expect(()=>validateAllocatedAsset(value,f.brief,f.layout,{})).toThrow('43200 超过分配额度 11875');expect(stable(value)).toBe(before);
 const accepted=validateAllocatedAsset(f.asset(25),f.brief,f.layout,{});expect(accepted.triangles).toBe(10800);expect(accepted.budget.expandedMaximum).toBe(237500);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('超额候选在渲染前反馈；纠正后仍有两次预览并可正常选择真实候选',async()=>{
 const f=fixture();try{const review=createAssetReview(f.options),audit=join(f.options.folder,'asset-preview-audit.json');
 await expect(review.kit.call('preview_asset',{assetJson:JSON.stringify(f.asset(100))})).rejects.toThrow('分配额度');expect(f.renders()).toBe(0);expect(existsSync(audit)).toBe(false);
 const value=f.asset(25),result=await review.kit.call('preview_asset',{assetJson:JSON.stringify(value)}),feedback=JSON.parse((result.content[0] as any).text);
 expect(feedback.triangles).toBe(10800);expect(feedback.triangleBudget.maximum).toBe(11875);expect(read(audit).used).toBe(1);
 expect(review.kit.resolveOutput!({selectedAssetSha256:feedback.sha256,reason:'已看实际候选'})).toEqual(value);
 await expect(review.kit.call('preview_asset',{assetJson:JSON.stringify(f.asset(100))})).rejects.toThrow('分配额度');expect(read(audit).used).toBe(1);
 await review.kit.call('preview_asset',{assetJson:JSON.stringify(f.asset(24))});expect(f.renders()).toBe(2);expect(read(audit).used).toBe(2);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('旧预览记录不能让超额资产越过最终选择或证据检查',async()=>{
 const f=fixture();try{const review=createAssetReview(f.options);await review.kit.call('preview_asset',{assetJson:JSON.stringify(f.asset(25))});
 const value=f.asset(100),file=join(f.options.folder,'asset-preview-audit.json'),audit=read(file);audit.attempts[0].sha256=digest(stable(value));save(file,audit);save(join(f.options.folder,'1/asset.json'),value);
 const restored=createAssetReview(f.options);expect(()=>restored.kit.resolveOutput!({selectedAssetSha256:audit.attempts[0].sha256,reason:'旧管线已预览'})).toThrow('分配额度');expect(()=>restored.assertReviewed(value)).toThrow('分配额度');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});


test('真实工具发现保留完整几何契约，最终选择摘要的 schema 不再遮蔽资产格式',async()=>{
 const f=fixture();try{const review=createAssetReview(f.options),server=serveCodexTools(review.kit);try{
  const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!;const [,url]=JSON.parse(arg.slice(arg.indexOf('=')+1));
  const listed=await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/list'})})).json();
  const field=listed.tools[0].inputSchema.properties.assetJson;expect(field.type).toBe('string');expect(JSON.parse(field.description.slice(field.description.indexOf('{')))).toEqual(assetSchema());
  expect(()=>review.kit.resolveOutput!({selectedAssetSha256:'a'.repeat(64),reason:'声称已看过'})).toThrow('可用摘要：[]');
  const response=await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name:'preview_asset',arguments:{assetJson:JSON.stringify(f.asset(100))}}})})).json();
  expect(response.isError).toBe(true);expect(response.content[0].text).toContain('43200 超过分配额度 11875');expect(f.renders()).toBe(0);
 }finally{server.close();}}finally{rmSync(f.root,{recursive:true,force:true});}
});
