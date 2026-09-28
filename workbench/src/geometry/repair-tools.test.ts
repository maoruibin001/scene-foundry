import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepairTools} from './repair-tools';
import {applyRefinement} from './refinement';
import {assertCameraPreflight} from './camera-preflight';
import {codexPrompt} from '../prompts';
import {serveCodexTools,withToolContinuation} from '../codex-tools';
import {digest} from '../store';
import {stable} from '../validated-cache';
import {validateRegion} from './visual-region';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},plan={requirements:[{id:'R1',critical:true,count:null}]};
const scene=()=>({version:'scene-v1',program:{version:'geometry-v1',name:'通用物体',materials:[{id:'base',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'subject',parts:[{...pose,id:'body',material:'base',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'one',label:'主体',template:'subject',requirementIds:['R1']}]},entities:[{instanceId:'one',category:'物体',role:'subject'}],cameras:[{name:'参考',referenceIndex:1,position:[3,-4,2],target:[0,0,0],fov:1},{name:'检查',referenceIndex:null,position:[-3,4,2],target:[0,0,0],fov:1}],textures:[],textureReuse:[],lighting:{direction:[.5,.5,-.7],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]},assumptions:[]});
const patch=()=>({version:'scene-refinement-v5',reason:'依据画面调整材质',instances:[],cameras:[],materials:[{id:'base',color:[.5,.5,.5,1],roughness:.7,metallic:0,textureId:null}],parts:[],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[],surfaceUpdates:[],screenTargets:[],removeInstances:[]});
test('局部看图只选择已知原图、明确来源机位与成功候选，不把失败或未知路径当证据',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'region-tool-test-')),seen:any[]=[];let renderFailure=false;
 const f=createRepairTools({source:scene(),textures:{},folder,signal:new AbortController().signal,images:[{path:'/known/reference.png',mime:'image/png'}],refs:['ref'],sourceFrames:[{referenceIndex:1,path:'/known/source.png'}],apply:()=>scene(),validate:()=>{},inspectRegion:async(images)=>{seen.push(images);return [{type:'text',text:'真实局部诊断'}];},render:async(_scene,_images,_refs,dir)=>{if(renderFailure)throw Error('预览失败');mkdirSync(join(dir,'capture'),{recursive:true});writeFileSync(join(dir,'capture/candidate-1.png'),'pixels');writeFileSync(join(dir,'engine-preview-receipt.json'),JSON.stringify({sceneSha256:digest(JSON.stringify(_scene)),frames:[{referenceIndex:1,file:'candidate-1.png',sha256:digest('pixels')}]}));return [];}});
 try{
  const query={referenceIndex:1,referenceRect:[.2,.3,.4,.5],frameRect:[.1,.2,.4,.6]};
  expect((await f.kit.call('inspect_visual_region',query)).isError).toBeUndefined();expect(seen[0].map((i:any)=>i.path)).toEqual(['/known/reference.png','/known/source.png']);
  await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch())});await f.kit.call('inspect_visual_region',query);expect(seen[1]).toHaveLength(3);expect(seen[1][2].path).toContain('/2/capture/candidate-1.png');
  renderFailure=true;await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch())});await f.kit.call('inspect_visual_region',query);expect(seen[2][2].path).toBe(seen[1][2].path);
  expect((await f.kit.call('inspect_visual_region',{...query,referenceIndex:2,path:'/secret'})).isError).toBe(true);
  expect((await f.kit.call('inspect_visual_region',{...query,referenceRect:[0,0,Infinity,1]})).isError).toBe(true);
  expect(seen).toHaveLength(3);expect(()=>validateRegion([.5,0,.2,1])).toThrow();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
function fixture(render:any=async()=>[]){const folder=mkdtempSync(join(tmpdir(),'repair-tools-test-')),source=scene();const apply=(p:any)=>applyRefinement(source as any,p,plan,1,'simple');return {folder,source,...createRepairTools({source,textures:{},folder,signal:new AbortController().signal,images:[],refs:[],apply,validate:p=>assertCameraPreflight(apply(p)),render})};}
test('工具预览绑定实际候选摘要；不能用旧图或失败预览证明新补丁',async()=>{
 const f=fixture();try{const p=patch(),original=JSON.stringify(f.source);expect(()=>f.assertReviewed(p)).toThrow('REPAIR_PREVIEW_REQUIRED');
  const r=await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(p)});expect(r.isError).toBeUndefined();expect(()=>f.assertReviewed(p)).not.toThrow();
  p.materials[0].roughness=.5;expect(()=>f.assertReviewed(p)).toThrow();expect(JSON.stringify(f.source)).toBe(original);
  const audit=JSON.parse(readFileSync(join(f.folder,'tool-audit.json'),'utf8'));expect(audit.attempts[0].status).toBe('passed');expect(audit.quality).toBe('not-assessed');
 }finally{rmSync(f.folder,{recursive:true,force:true});}
 const failed=fixture(async()=>{throw Error('真实预览失败')});try{expect((await failed.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch())})).isError).toBe(true);expect(()=>failed.assertReviewed(patch())).toThrow();}finally{rmSync(failed.folder,{recursive:true,force:true});}
});
test('工具拒绝实际机位碰撞，有限预算包括失败；不能无限重试',async()=>{
 let renders=0;const f=fixture(async()=>{renders++;return []});try{const p:any=patch();p.cameras=[{...f.source.cameras[0],position:[.49,0,0],target:[0,4,0]}];
  for(let n=0;n<2;n++)expect((await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(p)})).isError).toBe(true);
  expect(renders).toBe(0);expect((await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch())})).isError).toBeUndefined();expect((await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch())})).isError).toBeUndefined();expect((await f.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch())})).isError).toBe(true);expect(renders).toBe(2);
  expect((await f.kit.call('inspect_scene_parts',{templateId:'../other',partIds:[]})).isError).toBe(true);
 }finally{rmSync(f.folder,{recursive:true,force:true});}
});
test('MCP stdio真实握手、工具清单和调用由随机本地入口转发',async()=>{
 const f=fixture(),server=serveCodexTools(f.kit);try{
  expect(server.args).toContain('mcp_servers.scene_feedback.default_tools_approval_mode="approve"');expect(server.args).toContain('features.shell_tool=false');
  const allowed=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.enabled_tools='))!;expect(JSON.parse(allowed.split('=')[1])).toEqual(['inspect_visual_region','inspect_scene_parts','check_scene_patch','render_scene_patch']);
  expect(f.kit.definitions.every(d=>d.annotations.destructiveHint===false&&d.annotations.openWorldHint===false)).toBe(true);
  const assignment=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!,args=JSON.parse(assignment.slice(assignment.indexOf('=')+1));
  const p=Bun.spawn([process.execPath,...args],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  for(const msg of [{id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}},{id:2,method:'tools/list'},{id:3,method:'tools/call',params:{name:'inspect_scene_parts',arguments:{templateId:'subject',partIds:['body']}}}])p.stdin.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\n');
  p.stdin.end();const output=await new Response(p.stdout).text();expect(await p.exited).toBe(0);const messages=output.trim().split('\n').map(JSON.parse);
  expect(messages.find(x=>x.id===1).result.serverInfo.name).toBe('scene_feedback');expect(messages.find(x=>x.id===2).result.tools).toHaveLength(4);expect(JSON.parse(messages.find(x=>x.id===3).result.content[0].text).parts[0].id).toBe('body');
  const endpoint=new URL(args[1]);endpoint.pathname='/not-authorized';expect((await fetch(endpoint,{method:'POST'})).status).toBe(404);
 }finally{server.close();rmSync(f.folder,{recursive:true,force:true});}
});

test('只有修复工具调用放开专用工具，评审仍不接受工具自证',()=>{expect(codexPrompt('任务','输入',true)).not.toContain('不要使用工具');expect(codexPrompt('评审','输入')).toContain('不要使用工具');});

test('超时后全新会话可取回已预览候选，复用额度且只提交摘要；篡改无法提交',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'repair-recovery-')),source=scene(),apply=(p:any)=>applyRefinement(source as any,p,plan,1,'simple');let renders=0;
 const options={source,textures:{},folder,signal:new AbortController().signal,images:[],refs:[],apply,validate:(p:any)=>assertCameraPreflight(apply(p)),render:async(next:any,_i:any,_r:any,dir:string)=>{
  renders++;mkdirSync(join(dir,'capture'),{recursive:true});writeFileSync(join(dir,'capture/frame.png'),'actual pixels');
  writeFileSync(join(dir,'engine-preview-receipt.json'),JSON.stringify({sceneSha256:digest(JSON.stringify(next)),frames:[{referenceIndex:1,file:'frame.png',sha256:digest('actual pixels')}]}));return [];
 }};
 try{
  const first=createRepairTools(options),p=patch(),p2=patch();p2.materials[0].roughness=.8;
  await first.kit.call('render_scene_patch',{patchJson:JSON.stringify(p)});await first.kit.call('render_scene_patch',{patchJson:JSON.stringify(p2)});
  const recovered=createRepairTools(options),input=withToolContinuation({text:'原始任务',images:[],tools:recovered.kit}),context=JSON.parse(recovered.kit.continuation!().text),hash=digest(stable(p2));
  expect(context.enginePreviewsRemaining).toBe(0);expect(context.candidates).toHaveLength(2);expect(input.images).toHaveLength(2);expect(input.text).toContain(hash);
  const value=recovered.kit.resolveOutput!({selectedPatchSha256:hash,reason:'选择已有候选，仍需独立评分'});
  expect(value).toEqual(p2);expect(()=>recovered.assertReviewed(value)).not.toThrow();expect(renders).toBe(2);
  expect((await recovered.kit.call('render_scene_patch',{patchJson:JSON.stringify(p2)})).isError).toBe(true);expect(renders).toBe(2);
  expect(()=>recovered.kit.resolveOutput!({selectedPatchSha256:'a'.repeat(64),reason:'伪造候选'})).toThrow('REPAIR_PREVIEW_REQUIRED');
  expect(()=>recovered.kit.resolveOutput!(p2)).toThrow('最终结果');
  writeFileSync(join(folder,'2/patch.json'),JSON.stringify(p));
  expect(()=>recovered.kit.resolveOutput!({selectedPatchSha256:hash,reason:'原编号'})).toThrow('发生变化');
  expect(()=>createRepairTools(options)).toThrow('摘要不符');
 }finally{rmSync(folder,{recursive:true,force:true});}
});

 test('查询空列表会返回部件页，错误字段与请求留在审计中',async()=>{const f=fixture();try{f.source.program.templates[0].parts=Array.from({length:20},(_,i)=>({...f.source.program.templates[0].parts[0],id:'p'+i}));let result:any=await f.kit.call('inspect_scene_parts',{templateId:'subject',partIds:[]});let value=JSON.parse(result.content[0].text);expect(value.parts).toHaveLength(16);expect(value.nextOffset).toBe(16);result=await f.kit.call('inspect_scene_parts',{templateId:'subject',partIds:[],offset:16});value=JSON.parse(result.content[0].text);expect(value.parts).toHaveLength(4);expect(value.nextOffset).toBe(null);result=await f.kit.call('inspect_scene_parts',{templateId:'subject',partIds:Array(17).fill('p1')});expect(result.isError).toBe(true);const audit=JSON.parse(readFileSync(join(f.folder,'tool-audit.json'),'utf8'));expect(audit.attempts[2].error).toContain('最多16');expect(audit.attempts[2].query.partIds).toHaveLength(17);}finally{rmSync(f.folder,{recursive:true,force:true});}});

test('预览直接引用本轮已检查摘要，拒绝未知摘要、双输入与篡改，仍重新校验',async()=>{
 let renders=0;const f=fixture(async()=>{renders++;return []});
 try{
  const p=patch(),hash=digest(stable(p));
  expect((await f.kit.call('render_scene_patch',{patchSha256:hash})).isError).toBe(true);
  const check=await f.kit.call('check_scene_patch',{patchJson:JSON.stringify(p)});expect(check.isError).toBeUndefined();
  expect((await f.kit.call('render_scene_patch',{patchSha256:hash,patchJson:JSON.stringify(p)})).isError).toBe(true);
  expect((await f.kit.call('render_scene_patch',{patchSha256:hash})).isError).toBeUndefined();expect(renders).toBe(1);expect(()=>f.assertReviewed(p)).not.toThrow();
  const audit=JSON.parse(readFileSync(join(f.folder,'tool-audit.json'),'utf8')),checked=audit.attempts.find((r:any)=>r.name==='check_scene_patch');expect(audit.attempts.at(-1).reusedCheckedPatch.index).toBe(checked.index);
  writeFileSync(join(f.folder,String(checked.index),'patch.json'),JSON.stringify({...p,reason:'篡改'}));
  expect((await f.kit.call('render_scene_patch',{patchSha256:hash})).isError).toBe(true);expect(renders).toBe(1);
 }finally{rmSync(f.folder,{recursive:true,force:true});}
});
