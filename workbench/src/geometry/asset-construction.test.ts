import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync,renameSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAssetConstruction,assetConstructionPrompt} from './asset-construction';
import {validateAllocatedAsset} from './asset-validation';
import {assetSchema} from './layout';
import {createAssetReview} from './asset-review';
import {assertProceduralHandoff} from './procedural-handoff';
import {assertRoleTools,serveCodexTools,withToolContinuation} from '../codex-tools';
import {callValidated} from '../contracts';
import {withProviderRecovery} from '../provider-recovery';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';

const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const part=(id='base',material='m',size=.4):any=>({...pose,id,material,shape:{type:'box',size:[size,size,size],radius:0}});
const body=(reply:any)=>JSON.parse(reply.content[0].text);
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'asset-parts-test-')),signal=new AbortController(),ref=join(root,'ref.png');writeFileSync(ref,'mock reference');
 const brief:any={id:'unit',label:'构件',description:'立体构件',origin:'中心',materialIds:['m','n'],maxParts:4,bounds:{min:[-1,-1,-1],max:[1,1,1]}};
 const layout:any={program:{version:'geometry-v1',name:'结构',materials:['m','n'].map(id=>({id,textureId:null,color:[1,1,1,1],roughness:.7,metallic:0})),templates:[brief],instances:[{...pose,id:'instance',label:'构件',template:brief.id,requirementIds:[]}]},textures:[],textureReuse:[],spatialOpenings:[],spatialContacts:[]};
 const options:any={folder:join(root,'draft'),jobId:'same-job',rootJobId:'original-root',inputKey:digest('frozen-input'),brief,layout,textures:{},signal:signal.signal,validateFinal:(v:any)=>validateAllocatedAsset(v,brief,layout,{}).value};
 const create=(extra:any={})=>createAssetConstruction({...options,...extra});
 const put=(tool:any,parts:any[],removePartIds:string[]=[],sha=tool.summary().draftSha256)=>tool.kit.call('save_asset_parts',{expectedDraftSha256:sha,partsJson:JSON.stringify(parts),removePartIds});
 return {root,ref,brief,layout,options,signal,create,put,clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('partial blocks survive process recreation; unchanged parts keep identical blobs and final output order',async()=>{
 const f=fixture();try{
  const first=f.create(),empty=first.summary().draftSha256;expect(first.summary().complete).toBe(false);
  expect(()=>first.kit.resolveOutput!({selectedAssetSha256:empty,reason:'空草稿'})).toThrow('部件数量');
  await f.put(first,[part('base')]);const row=first.summary().parts[0],blob=join(f.options.folder,'parts',row.sha256+'.json'),bytes=readFileSync(blob),mtime=statSync(blob).mtimeMs;
  const second=f.create();expect(second.summary().parts).toEqual(first.summary().parts);
  await f.put(second,[part('detail','n',.2)]);
  expect(readFileSync(blob).equals(bytes)).toBe(true);expect(statSync(blob).mtimeMs).toBe(mtime);
  expect(body(await second.kit.call('inspect_asset_parts',{partIds:['base']})).data).toEqual([part('base')]);
  const result=second.kit.resolveOutput!({selectedAssetSha256:second.summary().draftSha256,reason:'部件齐全，视觉质量待验'});
  expect(result.template.parts).toEqual([part('base'),part('detail','n',.2)]);
  expect(existsSync(join(f.root,'geometry.json'))).toBe(false);expect(existsSync(join(f.root,'checkpoint.json'))).toBe(false);
 }finally{f.clean();}
});

test('normal bounded provider recovery receives saved parts after timeout without resetting attempts',async()=>{
 const f=fixture();let attempts=0;try{
  const tool=f.create(),input:any={role:'geometry-asset',system:assetConstructionPrompt(tool.kit.instructions),text:'冻结任务',tools:tool.kit,signal:f.signal.signal};
  const result=await callValidated(input,f.root,v=>validateAllocatedAsset(v,f.brief,f.layout,{}).value,async request=>withProviderRecovery(request,f.root,async()=>{
   attempts++;const state=JSON.parse(withToolContinuation(request).text.split('真实产物，不是新评分）：\n')[1]);
   if(attempts===1){expect(state.checkpoint.parts).toHaveLength(0);await f.put(tool,[part()]);throw Error('PROVIDER_TIMEOUT');}
   expect(state.checkpoint.parts.map(p=>p.id)).toEqual(['base']);expect(state.checkpoint.writes).toBe(1);
   await f.put(tool,[part('detail','n')]);return {value:tool.kit.resolveOutput!({selectedAssetSha256:tool.summary().draftSha256,reason:'保留已完成块，仅补剩余块'}),receipt:{mock:true}} as any;
  },{wait:async()=>{}}));
  expect(attempts).toBe(2);expect(result.value.template.parts).toHaveLength(2);
  expect(read(join(f.root,'geometry-asset-recovery.json')).attempts.map(a=>a.status)).toEqual(['failed','passed']);
  expect(read(join(f.root,'geometry-asset-attempts.json')).map(a=>a.status)).toEqual(['passed']);
  expect(tool.summary().writes).toBe(2);
 }finally{f.clean();}
});

test('invalid and stale edits never replace a committed checkpoint; explicit replacement preserves order',async()=>{
 const f=fixture();try{
  const tool=f.create(),empty=tool.summary().draftSha256;await f.put(tool,[part(),part('second','n')]);
  const file=join(f.options.folder,'checkpoint.json'),before=readFileSync(file);
  for(const invalid of [[part('bad','unknown')],[{...part('far'),position:[99,0,0]}],[{...part('invalid'),shape:{type:'grid',rows:2,columns:2,points:[],doubleSided:false}}],Array.from({length:9},(_,i)=>part('many'+i)),[part('same'),part('same')]]){
   await expect(f.put(tool,invalid)).rejects.toThrow();expect(readFileSync(file).equals(before)).toBe(true);
  }
  await expect(f.put(tool,[part('third')],[],empty)).rejects.toThrow('基线摘要');
  await expect(f.put(tool,[],['missing'])).rejects.toThrow('不存在');
  await expect(f.put(tool,[part()],['base'])).rejects.toThrow('同时');
  await expect(f.put(tool,[],['base','second'])).rejects.toThrow('部件数量');
  expect(readFileSync(file).equals(before)).toBe(true);
  await f.put(tool,[part('base','m',.6)],['second']);
  expect(tool.kit.resolveOutput!({selectedAssetSha256:tool.summary().draftSha256,reason:'明确替换'}).template.parts).toEqual([part('base','m',.6)]);
  expect(readdirSync(join(f.options.folder,'revisions'))).toHaveLength(2);
 }finally{f.clean();}
});

test('same digest writes are idempotent; saved write limit survives reconstruction',async()=>{
 const f=fixture();try{
  f.brief.maxParts=1;let tool=f.create();await f.put(tool,[part()]);
  const bytes=readFileSync(join(f.options.folder,'checkpoint.json'));
  expect(body(await f.put(tool,[part()])).unchanged).toBe(true);expect(tool.summary().writes).toBe(1);
  expect(readFileSync(join(f.options.folder,'checkpoint.json')).equals(bytes)).toBe(true);
  for(let n=1;n<8;n++)await f.put(tool,[part('base','m',.4+n*.01)]);
  tool=f.create();expect(tool.summary().writes).toBe(8);await expect(f.put(tool,[part('base','m',.6)])).rejects.toThrow('保存上限');
 }finally{f.clean();}
});

test('job/root/input/layout/revision identity cannot borrow another draft',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.put(tool,[part()]);
  for(const extra of [{jobId:'other'},{rootJobId:'other'},{inputKey:digest('other')},{revision:{feedback:'changed'}},{layout:{...f.layout,spatialContacts:[{changed:true}]}}])expect(()=>f.create(extra)).toThrow('恢复身份');
  expect(f.create().summary().parts).toHaveLength(1);
 }finally{f.clean();}
});

test('changed part bytes, pointer counters, and concurrent writers fail closed',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.put(tool,[part()]);const second=f.create(),stale=second.summary().draftSha256;await f.put(tool,[part('detail')]);
  await expect(f.put(second,[part('wrong')],[],stale)).rejects.toThrow('其他执行');
  const file=join(f.options.folder,'checkpoint.json'),before=readFileSync(file);const row=read(file);row.writes=0;save(file,row);
  expect(()=>f.create()).toThrow('检查点记录已改变');writeFileSync(file,before);
  const blob=join(f.options.folder,'parts',tool.summary().parts[0].sha256+'.json');save(blob,part('base','m',.7));expect(()=>f.create()).toThrow('部件摘要变化');
 }finally{f.clean();}
});

test('interrupted filesystem commit preserves prior state and previously saved parts',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.put(tool,[part()]);const file=join(f.options.folder,'checkpoint.json'),before=readFileSync(file);
  const history=join(f.options.folder,'revisions');renameSync(history,history+'-preserved');writeFileSync(history,'injected non-directory');
  await expect(f.put(tool,[part('detail')])).rejects.toThrow();expect(readFileSync(file).equals(before)).toBe(true);expect(tool.summary().parts.map(p=>p.id)).toEqual(['base']);
  rmSync(history);renameSync(history+'-preserved',history);await f.put(tool,[part('detail')]);expect(tool.summary().writes).toBe(2);
  f.signal.abort();await expect(tool.kit.call('inspect_asset_parts',{partIds:[]})).rejects.toThrow();
 }finally{f.clean();}
});

test('instance-expanded triangle and part allocation still reject before saving or rendering',async()=>{
 const f=fixture();try{
  f.brief.maxParts=1;f.layout.program.instances=Array.from({length:20},(_,i)=>({...f.layout.program.instances[0],id:'i'+i}));
  const tool=f.create(),shape={type:'scatter',count:100,seed:4,volume:'box',size:[1,1,1],rotationRange:[1,1,1],scaleRange:[.1,1],element:{type:'box',size:[.1,.1,.1],radius:.01}};
  await expect(f.put(tool,[{...part(),shape}])).rejects.toThrow('43200 超过分配额度 11875');
  expect(tool.summary().writes).toBe(0);expect(existsSync(join(f.options.folder,'checkpoint.json'))).toBe(false);
  await f.put(tool,[part()]);await expect(f.put(tool,[part('extra')])).rejects.toThrow('部件超出');expect(tool.summary().writes).toBe(1);
 }finally{f.clean();}
});

test('partial material slots can be saved but cannot bypass final binding validation',async()=>{
 const f=fixture();try{
  f.layout.program.instances[0].surfaceOverrides=[{sourceMaterialId:'n',targetMaterialId:'m',uvScale:null,uvTransform:null}];
  const tool=f.create();await f.put(tool,[part()]);
  await expect(tool.kit.call('check_asset',{expectedDraftSha256:tool.summary().draftSha256})).rejects.toThrow('未命中');
  expect(()=>tool.kit.resolveOutput!({selectedAssetSha256:tool.summary().draftSha256,reason:'未齐全'})).toThrow('未命中');
  await f.put(tool,[part('bound','n')]);expect(body(await tool.kit.call('check_asset',{expectedDraftSha256:tool.summary().draftSha256})).structure).toBe('passed');
 }finally{f.clean();}
});

test('partial saves cannot waive frozen openings or accepted procedural structure on selection',async()=>{
 const f=fixture();try{
  f.layout.spatialOpenings=[{id:'portal',label:'通透结构',instanceId:'instance',center:[0,-.1,0],normal:[0,1,0],up:[0,0,1],width:.3,height:.3,clearDepth:.8,expectedBeyond:'open-background',beyondDescription:'天空',referenceIndices:[],evidence:'诊断构造'}];
  const tool=f.create();await f.put(tool,[part('cover')]);expect(()=>tool.kit.resolveOutput!({selectedAssetSha256:tool.summary().draftSha256,reason:'试图忽略开口'})).toThrow('封堵');
 }finally{f.clean();}
 const g=fixture();try{
  const seed={...part('crown'),shape:{type:'branchCrown',size:[1,1,1],habit:'upright',stems:2,leafPairs:2,leafLength:.1,leafWidth:.3,curl:.1,seed:5,segments:2,layer:'whole'}};
  const accepted={program:{templates:[{id:'unit',parts:[seed]}]}};
  const tool=g.create({validateFinal:(v:any)=>{assertProceduralHandoff(v,accepted);return g.options.validateFinal(v);}});await g.put(tool,[part()]);
  expect(()=>tool.kit.resolveOutput!({selectedAssetSha256:tool.summary().draftSha256,reason:'试图丢弃种子'})).toThrow('PROCEDURAL_STRUCTURE_CHANGED');
 }finally{g.clean();}
});

test('important assets still require actual reviewed digest and preserve two-preview limit across retry',async()=>{
 const f=fixture();let renders=0;try{
  const render:any=async(_s:any,_i:any,_r:any,dir:string)=>{renders++;mkdirSync(join(dir,'capture'));const frames=[1,2].map(n=>{const file=n+'.png',bytes='mock pixels '+n;writeFileSync(join(dir,'capture',file),bytes);return {file,sha256:digest(bytes)}});save(join(dir,'engine-preview-receipt.json'),{frames});return [];};
  const reviewOptions:any={brief:f.brief,layout:f.layout,textures:{},images:[{path:f.ref,mime:'image/png'}],folder:join(f.root,'preview'),signal:f.signal.signal,render};
  const review=createAssetReview(reviewOptions),tool=f.create({review:review.kit});await f.put(tool,[part()]);const first=tool.summary().draftSha256;
  expect(()=>tool.kit.resolveOutput!({selectedAssetSha256:first,reason:'没有看过'})).toThrow('必须选择');
  await tool.kit.call('preview_saved_asset',{expectedDraftSha256:first});await f.put(tool,[part('base','m',.5)]);await tool.kit.call('preview_saved_asset',{expectedDraftSha256:tool.summary().draftSha256});
  expect(tool.kit.resolveOutput!({selectedAssetSha256:first,reason:'保留已看过的第一个'}).template.parts).toEqual([part()]);
  const restoredReview=createAssetReview(reviewOptions),restored=f.create({review:restoredReview.kit});await f.put(restored,[part('base','m',.6)]);
  await expect(restored.kit.call('preview_saved_asset',{expectedDraftSha256:restored.summary().draftSha256})).rejects.toThrow('预览上限');expect(renders).toBe(2);
  expect(()=>restored.kit.resolveOutput!({selectedAssetSha256:restored.summary().draftSha256,reason:'第三稿没看过'})).toThrow('必须选择');
  expect(restoredReview.assertReviewed(restored.kit.resolveOutput!({selectedAssetSha256:first,reason:'选择真实旧候选'}))).toBeDefined();
 }finally{f.clean();}
});

test('tool discovery exposes part contract and role whitelist; final schema stays small and continuation is bounded',async()=>{
 const f=fixture();try{
  const tool=f.create();expect(()=>assertRoleTools('geometry-asset',tool.kit)).not.toThrow();expect(()=>assertRoleTools('scene-space',tool.kit)).toThrow('不允许');
  expect(()=>assertRoleTools('geometry-asset',{...tool.kit,version:'asset-preview-v1'})).toThrow('不允许');
  const server=serveCodexTools(tool.kit);try{
   const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!,[,url]=JSON.parse(arg.slice(arg.indexOf('=')+1));
   const listed=await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/list'})})).json();expect(listed.tools.map(t=>t.name)).toEqual(['save_asset_parts','inspect_asset_parts','check_asset']);
   const desc=listed.tools[0].inputSchema.properties.partsJson.description;expect(JSON.parse(desc.slice(desc.indexOf('{')))).toEqual(assetSchema().properties.template.properties.parts.items);
   expect((await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name:'preview_asset'}})})).status).toBe(400);
   const invoke=async(name:string,args:any)=>(await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name,arguments:args}})})).json());
   const committed=await invoke('save_asset_parts',{expectedDraftSha256:tool.summary().draftSha256,partsJson:JSON.stringify([part()]),removePartIds:[]});expect(committed.isError).not.toBe(true);
   expect(body(await invoke('inspect_asset_parts',{partIds:['base']})).data).toEqual([part()]);
   expect(body(await invoke('check_asset',{expectedDraftSha256:tool.summary().draftSha256})).structure).toBe('passed');
   expect((await invoke('save_asset_parts',{expectedDraftSha256:'0'.repeat(64),partsJson:'[]',removePartIds:[]})).isError).toBe(true);
  }finally{server.close();}
  await f.put(tool,[part()]);const continuation=JSON.parse(tool.kit.continuation!().text);expect(continuation.checkpoint.parts[0]).not.toHaveProperty('position');
  expect(tool.kit.outputSchema.required).toEqual(['selectedAssetSha256','reason']);expect(assetConstructionPrompt(tool.kit.instructions)).not.toContain('不得调用工具');
  expect(assetConstructionPrompt(tool.kit.instructions)).toContain('250000');
 }finally{f.clean();}
});
