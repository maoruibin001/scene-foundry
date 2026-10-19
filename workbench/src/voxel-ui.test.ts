import {test,expect} from 'bun:test';
import {voxelDetailsHTML,bindVoxelDetails} from '../public/voxel-ui.js';

const voxel=(extra:any={})=>({id:'voxel-job',sceneKind:'voxel',status:'failed',stage:'voxel',plan:{name:'已保存需求'},...extra});
function fragment(html:string){
 const root:any={buttons:[],card:null,querySelector(selector:string){if(selector==='[data-voxel-job]')return this.card;if(selector==='#recover-job')return this.recover??null;return null;},querySelectorAll(){return this.buttons;}};
 Object.defineProperty(root,'innerHTML',{set(value:string){root.card=value.includes('data-voxel-job=')?{dataset:{voxelJob:value.match(/data-voxel-job="([^"]*)"/)?.[1]}}:null;root.buttons=[...value.matchAll(/data-voxel-action="([^"]+)"/g)].map(match=>({dataset:{voxelAction:match[1]},disabled:false,textContent:'',setAttribute(){}}));root.recover=value.includes('id="recover-job"')?{}:null;}});
 root.innerHTML=html;return root;
}

test('普通任务不显示体素卡片，体素上下文兼容旧记录而不造出计数',()=>{
 expect(voxelDetailsHTML({id:'ordinary',sceneKind:'scene',voxel:{cells:50}})).toBe('');
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 try{
  Object.defineProperty(globalThis,'location',{value:{pathname:'/voxel/'},configurable:true});
  const html=voxelDetailsHTML({id:'legacy',voxel:{cells:0}});
  expect(html).toContain('0 个占用格');expect(html).not.toContain('undefined');expect(html).not.toContain('表面三角形');expect(html).not.toContain('个实体');
 }finally{if(previous)Object.defineProperty(globalThis,'location',previous);else delete (globalThis as any).location;}
 expect(voxelDetailsHTML(voxel({status:'running',stage:'space',plan:null}))).toBe('');
});

test('体素指标与palette来自真实元数据，文本转义且颜色样式不能注入',()=>{
 const html=voxelDetailsHTML(voxel({voxel:{cells:1234,triangles:4567,entities:8,palette:[{id:'<script>',color:'#aabbcc'},{id:'unsafe',color:'red" onmouseover="oops'}]}}));
 expect(html).toContain('1,234 个占用格');expect(html).toContain('4,567 个表面三角形');expect(html).toContain('8 个实体');expect(html).toContain('&lt;script&gt;');expect(html).toContain('background:#aabbcc');expect(html).not.toContain('background:red');expect(html).not.toContain('onmouseover="oops');
 const missing=voxelDetailsHTML(voxel({voxel:{cells:NaN,triangles:-1,entities:Infinity}}));expect(missing).not.toContain('NaN');expect(missing).not.toContain('Infinity');expect(missing).not.toContain('个实体');
});

test('可编辑体素与program绑定实际保留候选folder并走体素文件namespace',()=>{
 const job=voxel({voxel:{cells:2,editable:'scene.vox',program:'voxel-program.json'},delivery:{best:{folder:'delivery/outputs/scene-deadbeef'}}});
 const html=voxelDetailsHTML(job);
 expect(html).toContain('/voxel/files/runs/voxel-job/delivery/outputs/scene-deadbeef/scene.vox?download=1');
 expect(html).toContain('/voxel/files/runs/voxel-job/delivery/outputs/scene-deadbeef/voxel-program.json');
 expect(html).not.toContain('/voxel/files/runs/voxel-job/scene.vox');expect(html).toContain('当前保留候选');
 const own=voxelDetailsHTML(voxel({voxel:{editable:'scene.vox',program:'voxel-program.json'}}));expect(own).toContain('/voxel/files/runs/voxel-job/scene.vox?download=1');
});

test('越界或非法保留folder不能退回另一轮次，越界文件名不生成链接',()=>{
 for(const folder of ['../other','/absolute','nested/../../other','nested\\other']){
  const html=voxelDetailsHTML(voxel({voxel:{cells:1},delivery:{best:{folder}}}));expect(html).not.toContain('href=');expect(html).toContain('路径暂不可核验');
 }
 const html=voxelDetailsHTML(voxel({voxel:{editable:'../../scene.vox',program:'/secret.json'}}));expect(html).not.toContain('href=');
});

test('继续体素生成只用于保存plan的终态voxel阶段，已通过和活跃任务没有入口',()=>{
 for(const status of ['failed','blocked','cancelled','needs_review'])expect(voxelDetailsHTML(voxel({status}))).toContain('data-voxel-action="continue-voxel"');
 for(const extra of [{status:'running'},{status:'queued'},{status:'passed'},{stage:'graybox'},{stage:'space'},{plan:null}])expect(voxelDetailsHTML(voxel(extra))).not.toContain('data-voxel-action="continue-voxel"');
});

test('网络续接只在blocked并明确available时显示，初始规划升级复用共同恢复入口',()=>{
 expect(voxelDetailsHTML(voxel({status:'blocked',stage:'space',networkResume:{available:true}}))).toContain('data-voxel-action="network-resume"');
 for(const extra of [{status:'failed',networkResume:{available:true}},{status:'blocked',networkResume:{available:1}},{status:'blocked',networkResume:{available:false}}])expect(voxelDetailsHTML(voxel(extra))).not.toContain('data-voxel-action="network-resume"');
 const source=voxel({status:'blocked',stage:'space',voxelConstructionVersion:'voxel-lattice-v1',recovery:{available:true,mode:'plan'},spatialMechanismChangeAvailable:true});
 const html=voxelDetailsHTML(source);expect(html).toContain('新的初始规划机制');expect(html).toContain('恢复未完成的任务');expect(html).not.toContain('data-voxel-action="recover"');expect(html).not.toContain('id="recover-job"');
 for(const extra of [{recovery:{available:false,mode:'plan'}},{recovery:{available:true,mode:'generation'}},{spatialMechanismChangeAvailable:false},{status:'running'}])expect(voxelDetailsHTML({...source,...extra})).not.toContain('新的初始规划机制');
});

test('续接按钮只提交一次逻辑API，ack后交给共享页面定位新记录',async()=>{
 const job=voxel({id:'one/job'}),root=fragment(voxelDetailsHTML(job)),calls:any[]=[],created:any[]=[];
 bindVoxelDetails({job,root,api:async(path:any,body:any)=>{calls.push({path,body});expect(root.buttons[0].disabled).toBe(true);return {id:'next'};},onCreated:(next:any)=>created.push(next),onError:(error:any)=>{throw error;}});
 await root.buttons[0].onclick();expect(calls).toEqual([{path:'/api/jobs/one%2Fjob/continue-voxel',body:{}}]);expect(created).toEqual([{id:'next'}]);expect(root.buttons[0].disabled).toBe(false);
});

test('同任务两种动作与重渲染共享pending，不重放写请求',async()=>{
 const job=voxel({id:'dedup',status:'blocked',networkResume:{available:true}}),root=fragment(voxelDetailsHTML(job));let finish:any,calls=0;
 const options={job,root,api:()=>{calls++;return new Promise(resolve=>finish=resolve);},onCreated:()=>{},onError:(error:any)=>{throw error;}};
 bindVoxelDetails(options);const started=root.buttons[0].onclick();await root.buttons[1].onclick();expect(calls).toBe(1);expect(root.buttons.every((button:any)=>button.disabled)).toBe(true);
 root.innerHTML=voxelDetailsHTML(job);bindVoxelDetails(options);expect(root.buttons.every((button:any)=>button.disabled)).toBe(true);await root.buttons[0].onclick();expect(calls).toBe(1);
 finish({id:'continued'});await started;expect(root.buttons.every((button:any)=>!button.disabled)).toBe(true);
});

test('网络恢复失败显示真实错误并恢复按钮，后续重试仅由用户点击触发',async()=>{
 const job=voxel({id:'offline',status:'blocked',stage:'space',networkResume:{available:true}}),root=fragment(voxelDetailsHTML(job)),errors:string[]=[];let calls=0,created=0;
 bindVoxelDetails({job,root,api:async(path:any)=>{calls++;expect(path).toBe('/api/jobs/offline/network-resume');throw Error('PROVIDER_STILL_UNREACHABLE');},onCreated:()=>created++,onError:(error:any)=>errors.push(error.message)});
 await root.buttons[0].onclick();expect(calls).toBe(1);expect(root.buttons[0].disabled).toBe(false);expect(created).toBe(0);expect(errors).toEqual(['PROVIDER_STILL_UNREACHABLE']);
 await root.buttons[0].onclick();expect(calls).toBe(2);
});

test('导航或异步无效回执不能把旧结果当作已创建新任务',async()=>{
 const job=voxel({id:'old-view'}),root=fragment(voxelDetailsHTML(job));let finish:any,created=0;const errors:string[]=[];
 bindVoxelDetails({job,root,api:()=>new Promise(resolve=>finish=resolve),onCreated:()=>created++,onError:(error:any)=>errors.push(error.message)});
 const request=root.buttons[0].onclick();root.innerHTML='<p>其他页面</p>';finish({id:'late'});await request;expect(created).toBe(0);expect(errors).toEqual([]);
 const bad=voxel({id:'missing-id'}),current=fragment(voxelDetailsHTML(bad));bindVoxelDetails({job:bad,root:current,api:async()=>({}),onCreated:()=>created++,onError:(error:any)=>errors.push(error.message)});await current.buttons[0].onclick();expect(created).toBe(0);expect(errors).toEqual(['服务未返回可继续查看的任务记录']);expect(current.buttons[0].disabled).toBe(false);
});
