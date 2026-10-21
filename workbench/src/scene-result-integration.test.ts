import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('生成场景直接位于标题之后，在模型、计划、评分与诊断之前；过程iframe仍可展开',()=>{
 const result=app.slice(app.indexOf('function renderJob(j)'));
 expect(result.indexOf('${sceneHeroHTML(j,scenePreviewStateFor(j))}')).toBeLessThan(result.indexOf('<p class="model-summary">'));
 expect(result.indexOf('${sceneHeroHTML(j,scenePreviewStateFor(j))}')).toBeLessThan(result.indexOf('${pipelinePlanHTML(j)}'));
 expect(result).toContain('class="job-process-frame"');expect(result).not.toContain('data-preview-src="${esc(j.previewUrl)}"');
 expect(app).toContain('previous.dataset.outputKey===(sceneOutput(job)?.key');expect(app).toContain("previous.querySelector('iframe[data-preview-src]').dataset.previewSrc===replacement.querySelector('iframe[data-preview-src]').dataset.previewSrc");
});

test('实际预览按钮的异步回执使用轮询后的最新任务，不把新状态退回点击时旧对象',async()=>{
 const begin=app.indexOf(" bindAction('#preview-scene',async()=>{")+" bindAction('#preview-scene',async()=>{".length,end=app.indexOf('\n });',begin),body=app.slice(begin,end);
 expect(begin).toBeGreaterThan(0);expect(end).toBeGreaterThan(begin);
 let finish:any;const renders:any[]=[],view={pending:false,error:'',url:null};
 const job={id:'same',status:'running'},latest={id:'same',status:'passed'},deps={job,view,scenePreviewStateFor:()=>view,renderJob:(j:any)=>renders.push(j),requestScenePreview:()=>new Promise(resolve=>finish=resolve),previewLifecycle:{resume(){},setSuspended(){}},api:()=>{}};
 const control=new Function('deps',`let currentScenePreview=deps.view,latestRenderedJob=deps.job,selected=deps.job.id,screen='job';const {scenePreviewStateFor,renderJob,requestScenePreview,previewLifecycle,api}=deps,j=deps.job;return {run:async()=>{${body}},update(job){latestRenderedJob=job;renderJob(job);},navigate(){screen='records';}};`)(deps);
 const pending=control.run();control.update(latest);finish({url:'http://localhost:19775/'});await pending;
 expect(renders).toEqual([job,latest,latest]);expect(view.url).toBe('http://localhost:19775/');expect(view.pending).toBe(false);
});
