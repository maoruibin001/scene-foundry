import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {pipelinePresetCatalog,compilePipelinePlan} from './pipeline-plan';
import {validateScoreWeights,normalizeScoreWeights,validatePresetCatalog,weightEditorHTML,createPipelinePlanSelector,scoredWeightDimensions,previewWeightedScore,pipelinePlanHTML,reweightHTML,bindPipelineReweight} from '../public/pipeline-plan-ui.js';

const ids=['coverage','spatial','shape','material','lighting','readability'];
const defaults={coverage:20,spatial:30,shape:15,material:15,lighting:10,readability:10};
const presetWeights=[[20,30,15,15,10,10],[20,45,15,8,5,7],[20,15,30,25,5,5],[20,15,10,15,25,15]];
const catalog=()=>({version:'pipeline-presets-v1',dimensions:ids.map(id=>({id,label:id})),presets:['balanced','spatial','assets','effects'].map((id,n)=>({id,label:id,description:'actual '+id,weights:Object.fromEntries(ids.map((key,i)=>[key,presetWeights[n][i]])),focus:['真实制作重点'],tools:[{id:'parts',label:'资产分块创建',available:true}]})),capabilities:[{id:'external',label:'外部 GLB',available:false,reason:'未接入'}]});
const scoredJob=(id='scored',six=true)=>({id,status:'failed',stage:'gate',runtime:{distManifestDigest:'a'.repeat(64)},delivery:{best:{assessmentScope:'scene',distManifestDigest:'a'.repeat(64),qualityFile:'quality.json'}},quality:{score:68,dimensions:(six?ids:ids.filter(id=>id!=='lighting')).map(key=>({id:key,label:key,weight:six?defaults[key]:({coverage:28,spatial:32,shape:12,material:20,readability:8})[key]}))},review:{dimensions:(six?ids:ids.filter(id=>id!=='lighting')).map((key,i)=>({id:key,score:i===0?2:4}))}});

// Exercise the production handlers without starting a renderer, model, or server.
function fragment(html=''){
 const root:any={dataset:{},nodes:new Map(),querySelector(selector:string){if(selector==='[data-reweight-job]')return this.dataset.reweightJob?this:null;return this.nodes.get(selector)??null;},querySelectorAll(selector:string){if(selector==='[data-score-weight]')return this.inputs;if(selector==='[name="pipeline-preset"]')return this.radios;return [];},inputs:[],radios:[]};
 const node=(value='')=>({value,disabled:false,textContent:'',innerHTML:'',dataset:{},classList:{toggle(){}}});
 let source='';Object.defineProperty(root,'innerHTML',{get:()=>source,set:(next:string)=>{source=next;root.inputs=[];root.radios=[];root.nodes=new Map();root.dataset.reweightJob=next.match(/data-reweight-job="([^"]+)"/)?.[1];for(const match of next.matchAll(/<input\b[^>]+>/g)){const raw=match[0],input:any=node(raw.match(/value="([^"]*)"/)?.[1]??'');input.disabled=/ disabled/.test(raw);const id=raw.match(/data-score-weight="([^"]+)"/)?.[1];if(id){input.dataset.scoreWeight=id;root.inputs.push(input);}if(raw.includes('name="pipeline-preset"'))root.radios.push(input);}for(const key of ['active-weights','weight-status','weight-reset','weight-normalize','pipeline-retry','reweight-reset','reweight-normalize','reweight-save','reweight-preview','reweight-receipts'])if(next.includes('data-'+key))root.nodes.set('[data-'+key+']',node());}});root.innerHTML=html;return root;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('six weights must cover exact dimensions, be bounded integers, and total 100',()=>{
 expect(validateScoreWeights(defaults)).toEqual(defaults);
 for(const weights of [{...defaults,lighting:9},{...defaults,spatial:30.5},{...defaults,spatial:-1},{...defaults,spatial:101},{...defaults,unknown:0},Object.fromEntries(Object.entries(defaults).filter(([id])=>id!=='lighting'))])expect(()=>validateScoreWeights(weights)).toThrow();
 expect(()=>validateScoreWeights({...defaults,spatial:NaN})).toThrow();expect(()=>validateScoreWeights({...defaults,spatial:Infinity})).toThrow();
});
test('ratio normalization uses stable integer allocation with exact total and rejects zero or invalid input',()=>{
 const equal=normalizeScoreWeights(Object.fromEntries(ids.map(id=>[id,1])));expect(Object.values(equal)).toEqual([17,17,17,17,16,16]);expect(Object.values(equal).reduce((a,b)=>a+b,0)).toBe(100);
 expect(normalizeScoreWeights(defaults)).toEqual(defaults);
 expect(()=>normalizeScoreWeights(Object.fromEntries(ids.map(id=>[id,0])))).toThrow('至少');expect(()=>normalizeScoreWeights({...defaults,spatial:10.5})).toThrow('整数');
 const legacy={coverage:1,spatial:1,shape:1,material:1,readability:1};expect(normalizeScoreWeights(legacy,Object.keys(legacy))).toEqual({coverage:20,spatial:20,shape:20,material:20,readability:20});
});
test('catalog data drives presets and exact six-dimensional availability; no fallback creates a different policy',()=>{
 expect(validatePresetCatalog(catalog()).presets.map(p=>p.id)).toEqual(['balanced','spatial','assets','effects']);
 for(const changed of [{...catalog(),dimensions:catalog().dimensions.slice(0,5)},{...catalog(),presets:catalog().presets.slice(0,3)},{...catalog(),presets:[catalog().presets[0],catalog().presets[0],...catalog().presets.slice(2)]}])expect(()=>validatePresetCatalog(changed)).toThrow();
});
test('creation reads one catalog, shows actual focus and unavailable tools, and updates frozen settings on preset change',async()=>{
 const root=fragment(),paths:string[]=[],errors:any[]=[];const selector=createPipelinePlanSelector({container:root,api:async path=>{paths.push(path);return catalog();},onError:error=>errors.push(error)});
 expect(selector.ready()).toBe(false);await tick();expect(paths).toEqual(['/api/pipeline-presets']);expect(selector.ready()).toBe(true);expect(root.innerHTML).toContain('真实制作重点');expect(root.innerHTML).toContain('外部 GLB · 未接入');expect(root.innerHTML).toContain('光照与氛围单独评审');
 const effects=root.radios.find(r=>r.value==='effects');effects.onchange();expect(root.querySelector('[data-active-weights]').textContent).toContain('lighting 25%');expect(selector.selection()).toEqual({pipelinePreset:'effects',scoreWeights:{coverage:20,spatial:15,shape:10,material:15,lighting:25,readability:15}});expect(errors).toEqual([]);
});
test('actual backend preset contract labels ready tools and unavailable capabilities consistently in create and detail',async()=>{
 const root=fragment(),selector=createPipelinePlanSelector({container:root,api:async()=>pipelinePresetCatalog()});await tick();expect(selector.ready()).toBe(true);expect(root.innerHTML).toContain('外部GLB与生成服务 · 未接入');expect(root.innerHTML).toContain('空间测量与拟合');expect(root.innerHTML).toContain('固定两项CC0成套材质');expect(root.innerHTML).not.toContain('<li>spatial</li>');
 const plan=compilePipelinePlan(selector.selection(),{engineSha:'engine',generatorSha:'generator'}),html=pipelinePlanHTML({pipelinePlan:plan});expect(html).toContain('程序模型创建');expect(html).toContain('先关闭共同底线失败');
});
test('invalid weight edits block create; normalize and preset reset restore valid submission',async()=>{
 const root=fragment(),selector=createPipelinePlanSelector({container:root,api:async()=>catalog()});await tick();const spatial=root.inputs.find(i=>i.dataset.scoreWeight==='spatial');spatial.value='50';spatial.oninput();expect(selector.ready()).toBe(false);expect(root.querySelector('[data-weight-status]').textContent).toContain('120%');expect(()=>selector.selection()).toThrow();
 root.querySelector('[data-weight-normalize]').onclick();expect(selector.ready()).toBe(true);expect(Object.values(selector.selection().scoreWeights).reduce((a,b)=>a+b,0)).toBe(100);
 root.querySelector('[data-weight-reset]').onclick();expect(selector.selection().scoreWeights).toEqual(defaults);
 spatial.value='';spatial.oninput();expect(selector.ready()).toBe(false);
});
test('failed catalog is actionable and retries only on click; abandoned page ignores late catalog',async()=>{
 const root=fragment();let calls=0;const errors:string[]=[];const selector=createPipelinePlanSelector({container:root,api:async()=>{calls++;if(calls===1)throw Error('catalog offline');return catalog();},onError:error=>errors.push(error.message)});await tick();expect(selector.ready()).toBe(false);expect(root.innerHTML).toContain('重新读取管线');expect(calls).toBe(1);await root.querySelector('[data-pipeline-retry]').onclick();expect(selector.ready()).toBe(true);expect(calls).toBe(2);expect(errors).toEqual(['catalog offline']);
 let resolve:any,active=true;const late=fragment();createPipelinePlanSelector({container:late,isActive:()=>active,api:()=>new Promise(r=>resolve=r)});active=false;resolve(catalog());await tick();expect(late.radios).toHaveLength(0);
});
test('legacy results only expose actual five dimensions; partial or mismatched reviews cannot fabricate lighting',()=>{
 const legacy=scoredJob('legacy',false),six=scoredJob('six');expect(scoredWeightDimensions(legacy).map(d=>d.id)).not.toContain('lighting');expect(scoredWeightDimensions(six)).toHaveLength(6);expect(reweightHTML(legacy)).toContain('没有独立光照评审');expect(reweightHTML(legacy)).not.toContain('data-score-weight="lighting"');
 const missing=structuredClone(six);missing.review.dimensions.pop();expect(scoredWeightDimensions(missing)).toBeNull();expect(reweightHTML(missing)).toBe('');
 const mismatch=structuredClone(six);mismatch.quality.dimensions.pop();expect(scoredWeightDimensions(mismatch)).toBeNull();
});
test('preview weighting uses saved raw dimensions without changing official score or gate outcome',()=>{
 const job=scoredJob(),before=JSON.stringify(job);expect(previewWeightedScore(job,defaults)).toBe(72);expect(previewWeightedScore(job,{coverage:100,spatial:0,shape:0,material:0,lighting:0,readability:0})).toBe(40);expect(JSON.stringify(job)).toBe(before);
});
test('frozen plan displays selected weights, real phases, and original plan identity; HTML is escaped',()=>{
 const job={pipelinePlan:{label:'效果<优先>',version:'v1',weights:defaults,focus:['光照'],tools:[{id:'preview',label:'Engine预览'}],stages:[{id:'surface',label:'材质',reason:'实际原图'},{id:'runtime',label:'运行'}]},stage:'runtime',status:'running',stages:{surface:{status:'passed'}}};const html=pipelinePlanHTML(job);expect(html).toContain('效果&lt;优先&gt;');expect(html).toContain('光照与氛围 10%');expect(html).toContain('已完成');expect(html).toContain('进行中');expect(pipelinePlanHTML({})).toBe('');
 expect(weightEditorHTML(defaults,[{id:'coverage',label:'<script>'}])).toContain('&lt;script&gt;');
});
test('reweight submits only explicit weights, stores a separate receipt after ack, and does not mutate original job',async()=>{
 const job=scoredJob('one/job'),before=JSON.stringify(job),root=fragment(reweightHTML(job)),requests:any[]=[],saved:any[]=[];
 bindPipelineReweight({root,job,api:async(path,body)=>{requests.push({path,body});expect(root.querySelector('[data-reweight-save]').disabled).toBe(true);return {id:'receipt',weightedScore:71,rawWeightedScore:72,weights:body.weights,evidenceSignature:'abc'};},onSaved:receipt=>saved.push(receipt),onError:error=>{throw error;}});
 await root.querySelector('[data-reweight-save]').onclick();expect(requests).toEqual([{path:'/api/jobs/one%2Fjob/reweight',body:{weights:defaults}}]);expect(saved).toHaveLength(1);expect(root.querySelector('[data-reweight-receipts]').innerHTML).toContain('独立回执 receipt');expect(root.querySelector('[data-reweight-preview]').textContent).toContain('已保存独立回执');expect(JSON.stringify(job)).toBe(before);
});
test('one pending reweight survives rerenders, and failure remains retryable without a fake receipt',async()=>{
 const job=scoredJob('reweight-dedup'),root=fragment(reweightHTML(job));let finish:any,calls=0;const errors:string[]=[];const options={root,job,api:()=>{calls++;return new Promise(resolve=>finish=resolve);},onError:error=>errors.push(error.message)};
 bindPipelineReweight(options);const pending=root.querySelector('[data-reweight-save]').onclick();await root.querySelector('[data-reweight-save]').onclick();root.innerHTML=reweightHTML(job);bindPipelineReweight(options);expect(root.querySelector('[data-reweight-save]').disabled).toBe(true);await root.querySelector('[data-reweight-save]').onclick();expect(calls).toBe(1);finish({id:'r',weights:defaults,weightedScore:72});await pending;expect(root.querySelector('[data-reweight-save]').disabled).toBe(false);
 const failed=scoredJob('retry-reweight'),failureRoot=fragment(reweightHTML(failed));let attempts=0;bindPipelineReweight({root:failureRoot,job:failed,api:async()=>{attempts++;throw Error('save offline');},onError:error=>errors.push(error.message)});await failureRoot.querySelector('[data-reweight-save]').onclick();expect(failureRoot.querySelector('[data-reweight-save]').disabled).toBe(false);expect(failureRoot.querySelector('[data-reweight-receipts]').innerHTML).toBe('');await failureRoot.querySelector('[data-reweight-save]').onclick();expect(attempts).toBe(2);expect(errors).toEqual(['save offline','save offline']);
});
test('running results and invalid sums cannot save reweight; navigating away suppresses stale result writes',async()=>{
 const running={...scoredJob('running-reweight'),status:'running'},root=fragment(reweightHTML(running));let calls=0;bindPipelineReweight({root,job:running,api:async()=>calls++});await root.querySelector('[data-reweight-save]').onclick();expect(calls).toBe(0);
 const job=scoredJob('navigate-reweight'),r=fragment(reweightHTML(job));let finish:any,saves=0;bindPipelineReweight({root:r,job,api:()=>new Promise(resolve=>finish=resolve),onSaved:()=>saves++});const pending=r.querySelector('[data-reweight-save]').onclick();r.innerHTML='<p>别的页面</p>';finish({id:'late'});await pending;expect(saves).toBe(0);expect(r.innerHTML).toBe('<p>别的页面</p>');
 const invalid=scoredJob('invalid-reweight'),invalidRoot=fragment(reweightHTML(invalid)),errors:string[]=[];bindPipelineReweight({root:invalidRoot,job:invalid,api:async()=>calls++,onError:error=>errors.push(error.message)});const spatial=invalidRoot.inputs.find(input=>input.dataset.scoreWeight==='spatial');spatial.value='31';spatial.oninput();expect(invalidRoot.querySelector('[data-reweight-save]').disabled).toBe(true);await invalidRoot.querySelector('[data-reweight-save]').onclick();expect(calls).toBe(0);expect(errors).toEqual(['权重合计须为 100%']);
});
test('creation and result integration keeps stop controls and carries settings into the reference-confirmation path',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');expect(app).toContain('createPipelinePlanSelector');expect(app).toContain('const pipelineSettings=pipelineCreate.selection()');expect(app).toContain("$('#scene-acceptance').disabled=true");expect(app).toContain("$('#scene-acceptance').closest('label').hidden=true");expect(app).toContain("api('/api/references',{...pipelineSettings,generationSettings");expect(app).toContain('${pipelinePlanHTML(j)}');expect(app).toContain('${reweightHTML(j)}');expect(app).toContain('bindPipelineReweight');expect(app).toContain('stopGenerationHTML(j)');expect(app).toContain('bindStopGeneration');
});
