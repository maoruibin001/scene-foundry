import {test,expect} from 'bun:test';
import {sceneOutput,sceneHeroHTML,requestScenePreview,previewCaptureBusy,sceneReferenceImages,bindSceneComparison} from '../public/scene-preview.js';
import {requestJSON} from '../public/request.js';

const id='11111111-1111-4111-8111-111111111111';
function job(extra:any={}){
 const best={kind:'scene',folder:'iterations/1',distManifestDigest:'a'.repeat(64),images:['iterations/1/runtime/front.png'],runtime:'iterations/1/runtime/runtime.json',score:72,qualityStatus:'not_met'};
 return {id,status:'failed',previewUrl:'http://localhost:19998/wrong-root',runtime:{images:['wrong-root.png']},selectedIteration:2,delivery:{available:true,best,selection:{status:'selected'},execution:{},limitations:'已有场景输出，当前质量未达标'},...extra};
}
function candidate(changes:any={},delivery:any={}){const j=job();return {...j,delivery:{...j.delivery,...delivery,best:{...j.delivery.best,...changes}}};}
async function inScene(kind:'ordinary'|'voxel',run:()=>any){
 const old=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{pathname:kind==='voxel'?'/voxel/':'/'}});
 try{return await run();}finally{if(old)Object.defineProperty(globalThis,'location',old);else delete (globalThis as any).location;}
}
function recordingAPI(renders:any={active:0,reserved:0},response:any={url:'http://127.0.0.1:19999/'}){
 const calls:any[]=[];return {calls,api:async(path:string,body?:any)=>{calls.push({path,body});return path.endsWith('/scheduler')?{renders}:response;}};
}

test('only an explicit delivery receipt exposes a scene; root runtime, build and passed status do not',()=>{
 const source=job();for(const delivery of [undefined,null,{available:false,best:source.delivery.best},{available:'true',best:source.delivery.best},{available:true,best:null},{available:true}])expect(sceneOutput({...source,status:'passed',stages:{build:{status:'passed'}},delivery})).toBeNull();
 expect(sceneOutput(source)?.folder).toBe('iterations/1');expect(sceneOutput(source)?.poster).toBe('/files/runs/'+id+'/iterations/1/runtime/front.png');
});

test('retained output determines poster and identity without using the newest iteration or root preview',()=>{
 const source=job(),before=JSON.stringify(source),output=sceneOutput(source)!;
 expect(output.imagePaths).toEqual(['iterations/1/runtime/front.png']);expect(JSON.parse(output.key)).toEqual(['ordinary',id,'a'.repeat(64),'iterations/1']);
 expect(sceneHeroHTML(source)).not.toContain('wrong-root');expect(sceneHeroHTML(source)).not.toContain('iterations/2');
 expect(sceneOutput(candidate({folder:'iterations/2'}))?.key).not.toBe(output.key);expect(sceneOutput(candidate({distManifestDigest:'b'.repeat(64)}))?.key).not.toBe(output.key);
 output.imagePaths.push('local-only');expect(JSON.stringify(source)).toBe(before);
});

test('scene, partial, graybox and bounds-only outputs keep their distinct labels and quality scopes',()=>{
 for(const [best,label] of [[{kind:'scene'},'场景'],[{kind:'partial',qualityStatus:'partial_assessed'},'部分场景草稿'],[{kind:'graybox',score:null},'空间草稿'],[{kind:'graybox',layoutDraft:{scope:'bounds-only'},score:null},'布局范围草稿']] as const){
  const source=candidate(best),output=sceneOutput(source)!;expect(output.label).toBe(label);expect(sceneHeroHTML(source)).toContain('生成结果 · '+label);
  if(best.kind!=='scene')expect(sceneHeroHTML(source)).not.toContain('正式验收通过');
 }
 expect(sceneOutput(candidate({kind:'partial',qualityStatus:'partial_assessed'}))?.qualityLabel).toBe('草稿已评分，成品尚未完成');
 expect(sceneOutput(candidate({kind:'graybox',qualityStatus:'passed'}))?.qualityLabel).toBe('未完成成品评分');
});

test('basic70 and profile70 receipts do not claim the old full standard passed',()=>{
 const basic=candidate({deliveryStandard:'basic70',deliveryStatus:'passed'}),profile=candidate({deliveryStandard:'profile70',deliveryStatus:'passed'});
 expect(sceneHeroHTML(basic)).toContain('70分基础交付通过；完整规范结果另列');expect(sceneHeroHTML(profile)).toContain('所选权重70分目标与共同底线通过');
 expect(sceneHeroHTML(basic)).not.toContain('正式验收通过');expect(sceneHeroHTML(profile)).not.toContain('正式验收通过');
});

test('fallback and delivery limitations are visible without promoting the returned output to best',()=>{
 const source=candidate({}, {selection:{status:'fallback',reason:'保留证据不完整；当前回退不代表重新选优'},limitations:'部分主体未达标'}),html=sceneHeroHTML(source);
 expect(html).toContain('当前回退不代表重新选优');expect(html).toContain('部分主体未达标');expect(sceneOutput(source)?.selectionStatus).toBe('fallback');
 expect(sceneHeroHTML(candidate({}, {selection:{status:'fallback'}}))).toContain('不代表重新选优');
});

test('default hero is a static retained screenshot with no Engine iframe or legacy duplicate preview button',()=>{
 const html=sceneHeroHTML(job());expect(html).toContain('class="card preview scene-preview"');expect(html).toContain('class="cover"');expect(html).toContain('id="preview-scene"');
 expect(html).not.toContain('<iframe');expect(html).not.toContain('id="preview-output"');expect(html).toContain('/api/jobs/'+id+'/download-output');
 expect(sceneHeroHTML(job(),{pending:true})).toContain('class="primary" disabled');expect(sceneHeroHTML(job(),{pending:true})).toContain('正在打开预览');
});

test('an explicitly opened local URL is loaded only by the existing lifecycle; its controls remain available',()=>{
 const html=sceneHeroHTML(job(),{url:'http://localhost:19999/?a=1&b=2'});
 expect(html).toContain('<iframe data-preview-src="http://localhost:19999/?a=1&amp;b=2"');expect(html).not.toMatch(/<iframe[^>]*\ssrc=/);
 for(const control of ['external-preview','resume-preview','preview-state'])expect(html).toContain('id="'+control+'"');
 expect(html).toContain('href="http://localhost:19999/?a=1&amp;b=2"');
});

test('refreshable summary and controls are separate from the retained Engine media context',()=>{
 const html=sceneHeroHTML(candidate({}, {selection:{status:'fallback',reason:'本轮回退'},limitations:'尚未通过'}),{url:'http://localhost:19999/',error:'可重试错误'});
 const summary=html.indexOf('class="scene-preview-summary"'),media=html.indexOf('class="scene-preview-media"'),toolbar=html.indexOf('class="preview-toolbar"');
 expect(summary).toBeGreaterThan(0);expect(media).toBeGreaterThan(summary);expect(toolbar).toBeGreaterThan(media);expect(html.indexOf('尚未通过')).toBeGreaterThan(toolbar);
 for(const text of ['生成结果 · 场景','已评分，未达标','72 分','本轮回退','可重试错误'])expect(html.indexOf(text)).toBeLessThan(media);
 expect(html.indexOf('<iframe')).toBeGreaterThan(media);expect(html.indexOf('<iframe')).toBeLessThan(toolbar);expect(html.indexOf('id="preview-scene"')).toBeGreaterThan(toolbar);
});

test('unavailable outputs show preparation or failure placeholders and cannot start a preview',async()=>{
 const api=recordingAPI(),pending=job({status:'running',delivery:{available:false,state:'pending'}}),failed=job({status:'failed',delivery:{available:false,state:'unavailable'}});
 expect(sceneHeroHTML(pending)).toContain('正在准备首个场景输出');expect(sceneHeroHTML(failed)).toContain('尚未生成可运行输出');
 for(const source of [pending,failed]){expect(sceneHeroHTML(source)).not.toContain('id="preview-scene"');await expect(requestScenePreview({api:api.api,job:source})).rejects.toThrow('没有已核验');}
 expect(api.calls).toHaveLength(0);
});

for(const kind of ['ordinary','voxel'] as const){
 test(kind+' output paths, identity and preview requests stay in the current namespace',()=>inScene(kind,async()=>{
  const source=job(),output=sceneOutput(source)!,prefix=kind==='voxel'?'/voxel':'',apiPrefix=kind==='voxel'?'/api/voxel':'/api';
  expect(JSON.parse(output.key)[0]).toBe(kind);expect(output.poster).toBe(prefix+'/files/runs/'+id+'/iterations/1/runtime/front.png');
  const html=sceneHeroHTML(source);expect(html).toContain('href="'+apiPrefix+'/jobs/'+id+'/download-output"');expect(html).toContain('href="'+prefix+'/files/runs/'+id+'/iterations/1/runtime/runtime.json"');
  const calls:any[]=[],url='http://localhost:19999/?candidate=retained',api=(path:string,body?:any)=>requestJSON(path,body,{fetch:async(path:string,init:any)=>{calls.push({path,init});return path.endsWith('/scheduler')?Response.json({renders:{active:0,reserved:0}}):Response.json({url});}});
  const result=await requestScenePreview({api,job:source});expect(result.url).toBe(url);expect(calls.map(c=>c.path)).toEqual([apiPrefix+'/scheduler',apiPrefix+'/jobs/'+id+'/preview-output']);
  expect(calls[0].init.method).toBeUndefined();expect(calls[1].init.method).toBe('POST');expect(calls[1].init.body).toBe('{}');
 }));
}

test('busy render counts or reservations reject before POST, whether encoded as counts or arrays',async()=>{
 for(const renders of [{active:1,reserved:0},{active:[{id:'capture'}],reserved:0},{active:0,reserved:1},{active:[],reserved:['legacy']},{active:2,reserved:3}]){
  const mock=recordingAPI(renders);await expect(requestScenePreview({api:mock.api,job:job()})).rejects.toThrow('正在录制、验收或渲染');expect(mock.calls).toEqual([{path:'/api/scheduler',body:undefined}]);
 }
});

test('missing, malformed or failed scheduler evidence does not silently permit a POST',async()=>{
 for(const renders of [undefined,{}, {active:undefined},{active:null},{active:'unknown'},{active:-1,reserved:0},{active:0,reserved:null},{active:0,reserved:NaN}]){
  const calls:string[]=[],api=async(path:string)=>{calls.push(path);return {renders};};
  await expect(requestScenePreview({api,job:job()})).rejects.toThrow('无法确认');expect(calls).toEqual(['/api/scheduler']);
 }
 let reads=0;await expect(requestScenePreview({job:job(),api:async()=>{reads++;throw Error('scheduler disconnected');}})).rejects.toThrow('scheduler disconnected');expect(reads).toBe(1);
});

test('shared capture detection accepts both count encodings and rejects unknown or invalid evidence',()=>{
 for(const renders of [{active:0,reserved:0},{active:[],reserved:[]},{active:0}])expect(previewCaptureBusy({renders})).toBe(false);
 for(const renders of [{active:1,reserved:0},{active:['capture'],reserved:0},{active:[],reserved:1},{active:0,reserved:['prior-worker']}])expect(previewCaptureBusy({renders})).toBe(true);
 for(const scheduler of [undefined,{}, {renders:{}},{renders:{active:undefined}},{renders:{active:null}},{renders:{active:'unknown'}},{renders:{active:-1}},{renders:{active:0,reserved:null}},{renders:{active:0,reserved:NaN}}])expect(()=>previewCaptureBusy(scheduler)).toThrow('无法确认');
});

test('duplicate in-flight clicks share one GET and POST; a later explicit click is checked again',async()=>{
 let release:(value:any)=>void=()=>{},calls:any[]=[],scheduler=new Promise(resolve=>release=resolve);
 const api=async(path:string,body?:any)=>{calls.push({path,body});return path.endsWith('/scheduler')?await scheduler:{url:'http://127.0.0.1:19999/'};},source=job();
 const first=requestScenePreview({api,job:source}),second=requestScenePreview({api,job:structuredClone(source)});expect(first).toBe(second);expect(calls).toHaveLength(1);
 release({renders:{active:0,reserved:0}});expect((await first).url).toBe('http://127.0.0.1:19999/');await second;expect(calls).toHaveLength(2);
 await requestScenePreview({api,job:source});expect(calls).toHaveLength(4);
});

test('different retained candidates and ordinary/voxel contexts never share an in-flight request',()=>inScene('ordinary',async()=>{
 let release:(value:any)=>void=()=>{};const scheduler=new Promise(resolve=>release=resolve),calls:string[]=[],api=async(path:string)=>{calls.push(path);return path.endsWith('/scheduler')?await scheduler:{url:'http://localhost:19999/'};};
 const a=requestScenePreview({api,job:job()}),b=requestScenePreview({api,job:candidate({folder:'iterations/2'})});
 (globalThis as any).location.pathname='/voxel/';const c=requestScenePreview({api,job:job()});expect(calls).toEqual(['/api/scheduler','/api/scheduler','/api/voxel/scheduler']);
 release({renders:{active:[],reserved:[]}});await Promise.all([a,b,c]);
 expect(calls.filter(path=>path==='/api/jobs/'+id+'/preview-output')).toHaveLength(2);expect(calls.filter(path=>path==='/api/voxel/jobs/'+id+'/preview-output')).toHaveLength(1);
}));

test('a failed POST is not retried, releases the in-flight entry and allows only a new explicit click',async()=>{
 const calls:string[]=[],api=async(path:string)=>{calls.push(path);if(path.endsWith('/scheduler'))return {renders:{active:0,reserved:0}};throw Error('preview unavailable');},source=job();
 const first=requestScenePreview({api,job:source}),second=requestScenePreview({api,job:source});expect(first).toBe(second);
 await expect(first).rejects.toThrow('preview unavailable');await expect(second).rejects.toThrow('preview unavailable');expect(calls).toHaveLength(2);
 await expect(requestScenePreview({api,job:source})).rejects.toThrow('preview unavailable');expect(calls).toHaveLength(4);
});

test('only local absolute HTTP(S) Engine URLs are accepted and returned unchanged',async()=>{
 for(const url of ['http://127.0.0.1:19999/scene?a=1&b=2','https://localhost:19999/','http://[::1]:19999/']){
  const mock=recordingAPI(undefined,{url});expect((await requestScenePreview({api:mock.api,job:job()})).url).toBe(url);
 }
 for(const url of [undefined,'/relative','javascript:alert(1)','file:///tmp/scene','https://example.com/scene','http://localhost.evil.test/','http://user:secret@localhost:19999/']){
  const mock=recordingAPI(undefined,{url});await expect(requestScenePreview({api:mock.api,job:job()})).rejects.toThrow('地址');expect(mock.calls).toHaveLength(2);
 }
});

test('displayed metadata and failures are escaped; invalid preview URLs never become iframe sources',()=>{
 const source=candidate({}, {selection:{status:'fallback',reason:'<img src=x onerror=alert(1)>'},limitations:'<script>alert(1)</script>'}),html=sceneHeroHTML(source,{url:'javascript:alert(1)',error:'<b>failure</b>'});
 expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x');expect(html).not.toContain('data-preview-src=');expect(html).toContain('&lt;img');expect(html).toContain('预览回执不是本地 Engine 地址');
 expect(sceneHeroHTML(source,{error:'<b>failure</b>'})).toContain('&lt;b&gt;failure&lt;/b&gt;');
});


test('original uploaded references appear beside retained evidence with independent screenshot choices',()=>{
 const source=candidate({images:['iterations/1/runtime/front.png','iterations/1/runtime/back.png']});
 source.images=[{file:'first original.png',name:'原始正面'},{file:'second.jpg',name:'侧面'}];
 const before=JSON.stringify(source),html=sceneHeroHTML(source);
 expect(sceneReferenceImages(source)).toEqual([{url:'/files/uploads/first%20original.png',name:'原始正面',label:'参考图 1'},{url:'/files/uploads/second.jpg',name:'侧面',label:'参考图 2'}]);
 expect(html).toContain('class="scene-comparison has-references"');expect(html).toContain('class="scene-compare-panel scene-compare-input"');expect(html).toContain('class="scene-compare-panel scene-compare-output"');
 expect(html).toContain('data-comparison-display="reference" src="/files/uploads/first%20original.png"');
 expect((html.match(/data-comparison-pick="reference"/g)??[])).toHaveLength(2);expect((html.match(/data-comparison-pick="output"/g)??[])).toHaveLength(2);
 expect(html).toContain('原图与生成画面分别切换；机位不自动配对');expect(html).not.toContain('wrong-root');expect(JSON.stringify(source)).toBe(before);
});

test('missing output still shows original references; text-only scenes do not reserve an empty reference column',()=>{
 const pending=job({status:'running',images:[{file:'one.png'},{file:'two.png'}],delivery:{available:false,state:'pending'}}),html=sceneHeroHTML(pending);
 expect(html).toContain('data-comparison-display="reference"');expect(html).toContain('/files/uploads/two.png');expect(html).toContain('正在准备首个场景输出');expect(html).not.toContain('id="preview-scene"');
 const text=sceneHeroHTML(job({images:[],image:null}));expect(text).not.toContain('scene-comparison has-references');expect(text).not.toContain('class="scene-compare-panel scene-compare-input"');expect(text).toContain('文字输入场景');
});

test('legacy input, namespace, duplicate files and markup do not substitute runtime reference frames',()=>inScene('voxel',()=>{
 expect(sceneReferenceImages(job({images:[],image:{file:'legacy.jpg'}})).map(image=>image.url)).toEqual(['/voxel/files/uploads/legacy.jpg']);
 const source=job({images:[{file:'same.jpg'},{file:'same.jpg'},null,{file:''},{name:'invalid'}, {file:'evil" onerror="run.png'}]});
 expect(sceneReferenceImages(source)).toHaveLength(2);const html=sceneHeroHTML(source);expect(html).toContain('/voxel/files/uploads/same.jpg');expect(html).not.toContain(' onerror=');expect(html).toContain('evil%22%20onerror%3D%22run.png');
 expect(html).not.toContain('data-comparison-display="reference" src="/voxel/files/runs/');
}));

test('interactive comparison retains the Engine iframe and explicitly disables screenshot replacement',()=>{
 const source=job({images:[{file:'ref-a.jpg'},{file:'ref-b.jpg'}]}),html=sceneHeroHTML(source,{url:'http://localhost:19999/'});
 expect(html).toContain('data-comparison-display="reference"');expect(html).toContain('<iframe data-preview-src="http://localhost:19999/"');expect(html).not.toContain('data-comparison-display="output"');
 expect(html).toMatch(/data-comparison-pick="output"[^>]* disabled/);expect(html).toContain('交互预览中保留当前场景，不通过切图重载');
});

function comparisonFixture(key:string,interactive=false){
 const button=(kind:string,index:number)=>{const attrs=new Map<string,string>();return {dataset:{index:String(index),imageUrl:kind+'-'+index+'.jpg',imageLabel:kind+' '+index},disabled:kind==='output'&&interactive,onclick:null as any,setAttribute:(name:string,value:string)=>attrs.set(name,value),getAttribute:(name:string)=>attrs.get(name)};};
 const image=()=>{const attrs=new Map<string,string>();let srcWrites=0;return {setAttribute:(name:string,value:string)=>{if(name==='src')srcWrites++;attrs.set(name,value);},getAttribute:(name:string)=>attrs.get(name),get srcWrites(){return srcWrites;}};};
 const buttons={reference:[button('reference',0),button('reference',1)],output:[button('output',0),button('output',1)]},images={reference:image(),output:interactive?null:image()},links={reference:[image()],output:interactive?[]:[image()]};
 let iframeChanges=0;const iframe={setAttribute:()=>iframeChanges++,remove:()=>iframeChanges++};
 const panel={dataset:{sceneComparison:key},querySelectorAll:(selector:string)=>{const match=selector.match(/data-comparison-(pick|link)="(reference|output)"/);if(!match)throw Error('unexpected query '+selector);return (match[1]==='pick'?buttons:links)[match[2] as 'reference'|'output'];},querySelector:(selector:string)=>{const match=selector.match(/data-comparison-display="(reference|output)"/);if(!match)throw Error('unexpected query '+selector);return images[match[1] as 'reference'|'output'];},replaceChildren:()=>{throw Error('must not replace iframe parent');},iframe};
 const root={querySelectorAll:(selector:string)=>{expect(selector).toBe('[data-scene-comparison]');return [panel];}};
 return {root,buttons,images,links,get iframeChanges(){return iframeChanges;}};
}

test('comparison switching is independent, preserves selection across polling and resets for another candidate',()=>{
 const key='comparison-switch-'+crypto.randomUUID(),s=comparisonFixture(key);bindSceneComparison(s.root);
 expect(s.images.reference.getAttribute('src')).toBe('reference-0.jpg');expect(s.images.output?.getAttribute('src')).toBe('output-0.jpg');
 s.buttons.reference[1].onclick();expect(s.images.reference.getAttribute('src')).toBe('reference-1.jpg');expect(s.links.reference[0].getAttribute('href')).toBe('reference-1.jpg');expect(s.images.output?.getAttribute('src')).toBe('output-0.jpg');
 s.buttons.output[1].onclick();expect(s.images.output?.getAttribute('src')).toBe('output-1.jpg');expect(s.images.reference.getAttribute('src')).toBe('reference-1.jpg');
 expect(s.buttons.reference[0].getAttribute('aria-pressed')).toBe('false');expect(s.buttons.reference[1].getAttribute('aria-pressed')).toBe('true');
 const polled=comparisonFixture(key);bindSceneComparison(polled.root);expect(polled.images.reference.getAttribute('src')).toBe('reference-1.jpg');expect(polled.images.output?.getAttribute('src')).toBe('output-1.jpg');
 const srcWrites=polled.images.reference.srcWrites;bindSceneComparison(polled.root);expect(polled.images.reference.getAttribute('src')).toBe('reference-1.jpg');expect(polled.images.reference.srcWrites).toBe(srcWrites);
 const changed=comparisonFixture(key+'-new-candidate');bindSceneComparison(changed.root);expect(changed.images.reference.getAttribute('src')).toBe('reference-0.jpg');expect(changed.images.output?.getAttribute('src')).toBe('output-0.jpg');expect(s.iframeChanges+polled.iframeChanges+changed.iframeChanges).toBe(0);
});

test('reference switching beside an open Engine never touches its iframe or enables screenshot switching',()=>{
 const s=comparisonFixture('comparison-live-'+crypto.randomUUID(),true);bindSceneComparison(s.root);s.buttons.reference[1].onclick();s.buttons.output[1].onclick();
 expect(s.images.reference.getAttribute('src')).toBe('reference-1.jpg');expect(s.buttons.output[1].disabled).toBe(true);expect(s.iframeChanges).toBe(0);expect(s.images.output).toBeNull();
});
