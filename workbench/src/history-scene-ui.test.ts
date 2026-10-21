import {test,expect} from 'bun:test';
import {historySceneHTML,hydrateHistoryScenes} from '../public/history-scene-ui.js';

const delivery=(extra:any={})=>({available:true,state:'available',best:{kind:'graybox',folder:'generation/blockout/2',distManifestDigest:'a'.repeat(64),images:['generation/blockout/2/runtime/front.png'],runtime:'generation/blockout/2/runtime.json',score:null,qualityStatus:'not_assessed'},selection:{status:'selected'},...extra});
function fixture(ids:string[]){
 const nodes=ids.map(id=>{const node:any={dataset:{sceneOutput:id},buttons:[],querySelectorAll(){return this.buttons;},querySelector(){return this.retry??null;}};let html='';Object.defineProperty(node,'innerHTML',{get:()=>html,set:(value:string)=>{html=value;node.buttons=[...value.matchAll(/<button\b[^>]*data-open-scene[^>]*>/g)].map(match=>({disabled:/\bdisabled\b/.test(match[0]),classList:{contains:(value:string)=>match[0].includes(value)},textContent:match[0].includes('record-open-scene')&&value.includes('正在打开…')?'正在打开…':'',setAttribute(){},onclick:null}));node.retry=value.includes('data-reload-scene')?{disabled:false,onclick:null}:null;}});return node;});
 return {nodes,querySelectorAll(){return nodes;}};
}
function host(){const tabs:any[]=[];return {tabs,location:{href:'original'},open(){const tab={location:{href:'about:blank'},closed:false,close(){this.closed=true;}};tabs.push(tab);return tab;}};}

test('列表场景画面和打开入口来自保留输出，灰模和fallback不冒充成品',()=>{
 const job={id:'same',name:'街角',thumbnail:'/files/runs/same/runtime/wrong.png'},d=delivery(),html=historySceneHTML(job,d);
 expect(html).toContain('generation/blockout/2/runtime/front.png');expect(html).not.toContain('wrong.png');expect(html).toContain('打开空间草稿');expect(html).toContain('/api/jobs/same/download-output');
 expect(historySceneHTML(job,delivery({selection:{status:'fallback'}}))).toContain('其他可运行输出');
 expect(historySceneHTML(job,{available:false,state:'pending'})).toContain('场景制作中');expect(historySceneHTML(job,null,'offline')).toContain('重试读取输出');expect(historySceneHTML(job,null,'offline')).not.toContain('data-open-scene');
});

test('读取当前页保存回执不打开预览，点击图片或按钮直接打开服务回执URL',async()=>{
 const root=fixture(['one']),window=host(),calls:any[]=[];
 const api=async(path:string,body?:any)=>{calls.push({path,body});if(path.includes('/files/'))return delivery();if(path.endsWith('/scheduler'))return {renders:{active:[],reserved:[]}};if(path.endsWith('/preview-output'))return {url:'http://localhost:19775/'};throw Error(path);};
 await hydrateHistoryScenes({items:[{id:'one',name:'场景'}],api,root,isActive:()=>true,onError:()=>{},hostWindow:window});
 expect(calls).toEqual([{path:'/files/runs/one/delivery.json',body:undefined}]);expect(window.tabs).toHaveLength(0);
 await root.nodes[0].buttons[0].onclick();expect(window.tabs).toHaveLength(1);expect(window.tabs[0].location.href).toBe('http://localhost:19775/');expect(calls.filter(c=>c.body!==undefined)).toEqual([{path:'/api/jobs/one/preview-output',body:{}}]);
});

test('重复点击只开一个标签并提交一次，离开列表后的回执不会导航旧页面',async()=>{
 const root=fixture(['pending']),window=host();let finish:any,post=0,active=true;
 const api=async(path:string,body?:any)=>{if(path.includes('/files/'))return delivery();if(path.endsWith('/scheduler'))return {renders:{active:[],reserved:[]}};post++;return new Promise(resolve=>finish=resolve);};
 await hydrateHistoryScenes({items:[{id:'pending'}],api,root,isActive:()=>active,onError:()=>{},hostWindow:window});
 const opened=root.nodes[0].buttons[0].onclick();await root.nodes[0].buttons[1].onclick();await Promise.resolve();expect(window.tabs).toHaveLength(1);expect(post).toBe(1);
 active=false;finish({url:'http://localhost:19776/'});await opened;expect(window.tabs[0].closed).toBe(true);expect(window.tabs[0].location.href).toBe('about:blank');
});

test('录制忙或打开失败会关闭空标签，不自动重试；用户仍可再次点击',async()=>{
 const root=fixture(['busy']),window=host(),errors:string[]=[];let post=0,busy=true;
 const api=async(path:string,body?:any)=>{if(path.includes('/files/'))return delivery();if(path.endsWith('/scheduler'))return {renders:{active:busy?[{id:'capture'}]:[],reserved:[]}};post++;throw Error('ENGINE_UNAVAILABLE');};
 await hydrateHistoryScenes({items:[{id:'busy'}],api,root,isActive:()=>true,onError:(e:any)=>errors.push(e.message),hostWindow:window});
 await root.nodes[0].buttons[0].onclick();expect(post).toBe(0);expect(window.tabs[0].closed).toBe(true);expect(root.nodes[0].buttons.every((b:any)=>!b.disabled)).toBe(true);
 busy=false;await root.nodes[0].buttons[0].onclick();expect(post).toBe(1);expect(window.tabs[1].closed).toBe(true);expect(errors).toHaveLength(2);expect(errors[1]).toBe('ENGINE_UNAVAILABLE');
});

test('回执读取有界并发，导航后不会把旧页数据填到新记录里',async()=>{
 const items=Array.from({length:12},(_,i)=>({id:String(i)})),root=fixture(items.map(j=>j.id));let active=true,inFlight=0,max=0,calls=0;const pending:any[]=[];
 const loading=hydrateHistoryScenes({items,root,isActive:()=>active,onError:()=>{},hostWindow:host(),api:()=>{calls++;inFlight++;max=Math.max(max,inFlight);return new Promise(resolve=>pending.push(()=>{inFlight--;resolve(delivery());}));}});
 await Promise.resolve();expect(calls).toBe(4);expect(max).toBe(4);active=false;pending.forEach(f=>f());await loading;expect(calls).toBe(4);expect(root.nodes.every(n=>!n.innerHTML)).toBe(true);
});

test('打开期间刷新回同一记录，新节点在旧请求结束后恢复，不会永久禁用',async()=>{
 const before=fixture(['refresh']),after=fixture(['refresh']);let current=before,finish:any;
 const api=async(path:string)=>{if(path.includes('/files/'))return delivery();if(path.endsWith('/scheduler'))return {renders:{active:[],reserved:[]}};return new Promise(resolve=>finish=resolve);};
 const options={items:[{id:'refresh'}],api,onError:()=>{},hostWindow:host()};
 await hydrateHistoryScenes({...options,root:before,isActive:()=>current===before});
 const pending=before.nodes[0].buttons[0].onclick();await Promise.resolve();
 current=after;await hydrateHistoryScenes({...options,root:after,isActive:()=>current===after});expect(after.nodes[0].buttons.every((b:any)=>b.disabled)).toBe(true);
 finish({url:'http://localhost:19777/'});await pending;expect(after.nodes[0].buttons.every((b:any)=>!b.disabled)).toBe(true);expect(after.nodes[0].buttons[1].textContent).toBe('打开空间草稿 ↗');
});
