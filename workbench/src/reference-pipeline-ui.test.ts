import {test,expect} from 'bun:test';
import {pipelinePresetCatalog} from './pipeline-plan';
import {referencePage,referencePipelineSummary} from '../public/reference-ui.js';

const selection=()=>({pipelinePreset:'effects',scoreWeights:{coverage:20,spatial:15,shape:10,material:15,lighting:25,readability:15},policy:{deliveryStandard:'basic70'},reuseMode:'fresh',matchingLevel:'standard',generationMode:'qualified'});
const reference=()=>({id:'reference-fixture',status:'awaiting_confirmation',revision:1,prompt:'保留两张图的共同结构',createdAt:1,origin:'uploaded',images:[{file:'a.png',name:'原图一'},{file:'b.png',name:'原图二'}],generationSettings:selection()});

// Fake page surface, but execute the production approve/start bindings. No server or task starts.
function content(){
 let source='';const node:any={nodes:new Map(),querySelector(selector:string){return this.nodes.get(selector)??null;}};
 Object.defineProperty(node,'innerHTML',{get:()=>source,set:(value:string)=>{source=value;node.nodes=new Map();for(const match of value.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*>/g))node.nodes.set('#'+match[1],{disabled:/\bdisabled\b/.test(match[0]),onclick:null});}});return node;
}
async function withTimers(action:()=>Promise<void>){
 const original=globalThis.setInterval,clear=globalThis.clearInterval;
 (globalThis as any).setInterval=()=>77;(globalThis as any).clearInterval=()=>{};
 try{await action();}finally{globalThis.setInterval=original;globalThis.clearInterval=clear;}
}

test('reference summary uses actual catalog labels and saved custom weights without substituting defaults',()=>{
 const record=reference(),catalog=structuredClone(pipelinePresetCatalog());record.generationSettings.scoreWeights.lighting=30;record.generationSettings.scoreWeights.material=10;
 catalog.presets.find(p=>p.id==='effects').label='测试成图标签';catalog.dimensions.find(d=>d.id==='lighting').label='测试光照标签';
 const before=JSON.stringify(record),html=referencePipelineSummary(record,catalog);
 expect(html).toContain('测试成图标签');expect(html).toContain('测试光照标签 30%');expect(html).toContain('材质表面 10%');expect(html).toContain('已保存的自定义权重');expect(html).toContain('所选权重综合分 ≥70（原始加权分单列参考）');expect(html).toContain('六维预设仍待真实场景校准');expect(JSON.stringify(record)).toBe(before);
});

test('historical reference has no implicit preset and missing saved weights never borrow current defaults',()=>{
 expect(referencePipelineSummary({generationSettings:{policy:{deliveryStandard:'basic70'}}},pipelinePresetCatalog())).toBe('');
 const record:any=reference();delete record.generationSettings.scoreWeights;const html=referencePipelineSummary(record,pipelinePresetCatalog());
 expect(html).toContain('缺少已保存权重');expect(html).not.toContain('光照 25%');
});

test('unknown preset, invalid saved sum or unavailable catalog show uncertainty and preserve the selection',()=>{
 const record:any=reference();record.generationSettings.pipelinePreset='<未知>';const before=JSON.stringify(record);
 const unknown=referencePipelineSummary(record,pipelinePresetCatalog());expect(unknown).toContain('&lt;未知&gt;');expect(unknown).toContain('不在当前管线清单');expect(JSON.stringify(record)).toBe(before);
 record.generationSettings.pipelinePreset='effects';record.generationSettings.scoreWeights.lighting=26;expect(referencePipelineSummary(record,pipelinePresetCatalog())).toContain('合计须为 100%');
 expect(referencePipelineSummary(reference(),null,'catalog offline')).toContain('尚不能核对预设名称与权重摘要');
});

test('confirmation page reads existing catalog once and retains ordinary approve/start requests and saved settings',async()=>withTimers(async()=>{
 const record:any=reference(),before=JSON.stringify(record.generationSettings),root=content(),requests:any[]=[],errors:any[]=[],originalLocation=globalThis.location;
 (globalThis as any).location={hash:'#reference/'+record.id};
 const api=async(path:string,body?:any)=>{
  requests.push({path,body});
  if(path==='/api/references/'+record.id&&body===undefined)return structuredClone(record);
  if(path==='/api/reference-service')return {configured:false,reason:'未配置生图'};
  if(path==='/api/pipeline-presets')return pipelinePresetCatalog();
  if(path.endsWith('/approve')){record.status='approved';record.approval={at:2};return structuredClone(record);}
  if(path.endsWith('/start')){record.jobId='new-scene';return {id:'new-scene'};}
  throw Error('unexpected '+path);
 };
 try{
  await referencePage({id:record.id,api,content:root,onError:error=>errors.push(error),isActive:()=>true});
  expect(root.innerHTML).toContain('成图效果优先');expect(root.innerHTML).toContain('光照 25%');expect(root.querySelector('#approve-ref')).not.toBeNull();expect(root.querySelector('#start-ref')).toBeNull();
  await root.querySelector('#approve-ref').onclick();expect(root.querySelector('#start-ref')).not.toBeNull();
  await root.querySelector('#start-ref').onclick();expect(globalThis.location.hash).toBe('job/new-scene');
  expect(requests.filter(r=>r.path==='/api/pipeline-presets')).toHaveLength(1);expect(requests.filter(r=>r.body!==undefined)).toEqual([{path:'/api/references/'+record.id+'/approve',body:{}},{path:'/api/references/'+record.id+'/start',body:{}}]);expect(JSON.stringify(record.generationSettings)).toBe(before);expect(errors).toEqual([]);
 }finally{(globalThis as any).location=originalLocation;}
}));

test('catalog failure only affects the summary and does not add or replace confirmation mutations',async()=>withTimers(async()=>{
 const record=reference(),root=content(),requests:any[]=[],errors:any[]=[];
 await referencePage({id:record.id,content:root,isActive:()=>true,onError:error=>errors.push(error),api:async(path:string,body?:any)=>{requests.push({path,body});if(path==='/api/references/'+record.id)return record;if(path==='/api/reference-service')return {configured:false};if(path==='/api/pipeline-presets')throw Error('catalog offline');throw Error(path);}});
 expect(root.innerHTML).toContain('当前无法读取管线清单');expect(root.innerHTML).toContain('catalog offline');expect(root.querySelector('#approve-ref')).not.toBeNull();expect(requests.some(r=>r.body!==undefined)).toBe(false);expect(errors).toEqual([]);
}));

test('legacy reference page keeps its saved delivery target and does not request the new catalog',async()=>withTimers(async()=>{
 const record:any=reference();delete record.generationSettings.pipelinePreset;delete record.generationSettings.scoreWeights;
 const root=content(),paths:string[]=[];
 await referencePage({id:record.id,content:root,isActive:()=>true,onError:error=>{throw error;},api:async(path:string)=>{paths.push(path);if(path==='/api/references/'+record.id)return record;if(path==='/api/reference-service')return {configured:false};throw Error(path);}});
 expect(root.innerHTML).toContain('交付目标：基础70分');expect(root.innerHTML).not.toContain('本次选择的制作管线');expect(paths).toEqual(['/api/references/'+record.id,'/api/reference-service']);
}));
