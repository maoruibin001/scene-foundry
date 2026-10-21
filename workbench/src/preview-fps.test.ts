import {test,expect} from 'bun:test';
import {createSubmissionFpsMonitor,installPreviewFps} from '../public/preview-fps.js';
const frame=(id:number,deviceGeneration=1,worldIdentity='world')=>({frameId:id,deviceGeneration,worldIdentity});

test('real submitted events produce a two second rate and p95 interval; ticks or skipped frame IDs do not inflate FPS',()=>{
 const m=createSubmissionFpsMonitor(),canvas={};
 for(let i=0;i<=100;i++)m.observe(frame(i*3),i*20,canvas);
 expect(m.sample(2000)).toEqual({status:'running',fps:50,p95FrameMs:20,samples:100});
 for(let i=101;i<=150;i++)m.observe(frame(i*3),i*20,canvas);
 expect(m.sample(3000).fps).toBe(50);expect(m.sample(3500).fps).toBeLessThan(50);
 expect(m.observe(frame(450),3020,canvas)).toBe(false);
 expect(m.observe({frameId:451,deviceGeneration:NaN},3020,canvas)).toBe(false);
 expect(m.observe({frames:451},3020,canvas)).toBe(false);expect(m.observe({frameId:451,deviceGeneration:1,worldIdentity:{}},3020,canvas)).toBe(false);
});

test('the overlay never recycles a prior high rate across hidden, missing or stalled submission streams',()=>{
 const m=createSubmissionFpsMonitor(),canvas={};expect(m.sample(10).status).toBe('waiting');
 m.observe(frame(1),100,canvas);expect(m.sample(200).status).toBe('warming');
 for(let i=2;i<=40;i++)m.observe(frame(i),100+(i-1)*20,canvas);
 expect(m.sample(880).fps).toBe(50);expect(m.sample(880,{hidden:true})).toEqual({status:'hidden',fps:null,p95FrameMs:null,samples:0});
 expect(m.sample(2380)).toEqual({status:'stalled',fps:0,p95FrameMs:null,samples:0});
 m.reset();expect(m.sample(2400).status).toBe('waiting');
});

test('a changed world, device or canvas resets the sample; duplicates and out of order facts are rejected',()=>{
 const m=createSubmissionFpsMonitor(),a={},b={};
 for(let i=0;i<40;i++)m.observe(frame(i),i*20,a);
 expect(m.sample(780).status).toBe('running');
 expect(m.observe(frame(39),800,a)).toBe(false);expect(m.observe(frame(38),800,a)).toBe(false);
 m.observe(frame(1,2),900,a);expect(m.sample(920).status).toBe('warming');
 m.observe(frame(1,2,'other'),1000,a);expect(m.sample(1020).status).toBe('warming');
 m.observe(frame(1,2,'other'),1100,b);expect(m.sample(1120).status).toBe('warming');
 expect(m.observe(frame(2,2,'other'),1090,b)).toBe(false);
});

function browser({width=1200,hud=null}:any={}){
 class Canvas{}const canvas=new Canvas(),other=new Canvas(),listeners=new Map<string,any>(),timers=new Map<number,any>();let now=0,removed=false;
 const elements:any[]=[];
 const doc:any={hidden:false,documentElement:{append:()=>{}},createElement:(tag:string)=>{const element:any={tag,dataset:{},style:{},attributes:new Map(),setAttribute(name:string,value:string){this.attributes.set(name,value);},getAttribute(name:string){return this.attributes.get(name);},remove(){this.removed=true;if(tag==='div')removed=true;}};elements.push(element);return element;},querySelector:(selector:string)=>selector.startsWith('canvas')?canvas:selector==='#scene-hud[data-scene-ui="recording-controls"]'?hud:null,addEventListener:(kind:string,fn:any,capture?:boolean)=>{listeners.set(kind,{fn,capture});},removeEventListener:(kind:string)=>{listeners.delete(kind);}};
 const win:any={document:doc,innerWidth:width,HTMLCanvasElement:Canvas,performance:{now:()=>now},setInterval:(fn:any,ms:number)=>{expect(ms).toBe(500);timers.set(1,fn);return 1;},clearInterval:(id:number)=>timers.delete(id)};
 return {win,doc,canvas,other,elements,get badge(){return elements.find(e=>e.tag==='div');},listeners,timers,get removed(){return removed;},at:(n:number)=>{now=n;},tick:()=>timers.get(1)?.(),submit:(n:number,target=canvas)=>listeners.get('forgeax:frame-submitted')?.fn({target,detail:frame(n)})};
}

test('one noninteractive badge per preview listens to the actual canvas and releases timer/listeners',()=>{
 const b=browser(),handle=installPreviewFps(b.win);expect(installPreviewFps(b.win)).toBe(handle);expect(b.timers.size).toBe(1);expect(b.badge.textContent).toContain('等待引擎提交');
 expect(b.listeners.get('forgeax:frame-submitted').capture).toBe(true);expect(b.badge.style.cssText).toContain('pointer-events:none');
 for(let i=0;i<=50;i++){b.at(i*20);b.submit(i,b.other);}b.tick();expect(b.badge.dataset.status).toBe('waiting');
 for(let i=0;i<=50;i++){b.at(i*20);b.submit(i);}b.tick();expect(b.badge.textContent).toContain('实时 FPS 50.0');expect(b.badge.textContent).toContain('p95 20.0 ms');
 b.doc.hidden=true;b.listeners.get('visibilitychange').fn();expect(b.badge.textContent).toContain('页面已暂停');
 b.doc.hidden=false;b.at(2000);b.listeners.get('visibilitychange').fn();expect(b.badge.textContent).toContain('等待引擎提交');
 handle.dispose();expect(b.timers.size).toBe(0);expect(b.listeners.size).toBe(0);expect(b.removed).toBe(true);
});


test('narrow previews fold only the precise scene HUD; button and H-key changes stay synchronized while wide previews remain open',()=>{
 const hud:any={hidden:false},b=browser({width:455,hud}),handle=installPreviewFps(b.win);
 const button=b.elements.find(e=>e.tag==='button');expect(hud.hidden).toBe(true);expect(button.textContent).toBe('操作说明 ▾');expect(button.getAttribute('aria-expanded')).toBe('false');
 button.onclick();expect(hud.hidden).toBe(false);expect(button.getAttribute('aria-expanded')).toBe('true');
 // The Engine's unchanged H handler changes this same property; the existing
 // FPS timer observes it without installing another key handler or observer.
 hud.hidden=true;b.tick();expect(button.getAttribute('aria-expanded')).toBe('false');expect(hud.hidden).toBe(true);
 b.tick();expect(hud.hidden).toBe(true);button.onclick();b.tick();expect(hud.hidden).toBe(false);expect(button.getAttribute('aria-expanded')).toBe('true');
 handle.dispose();expect(button.removed).toBe(true);expect(hud.hidden).toBe(false);
 const wideHud:any={hidden:false},wide=browser({width:1000,hud:wideHud}),wideHandle=installPreviewFps(wide.win);expect(wideHud.hidden).toBe(false);expect(wide.elements.find(e=>e.tag==='button').getAttribute('aria-expanded')).toBe('true');wideHandle.dispose();
 const absent=browser({width:455});const absentHandle=installPreviewFps(absent.win);expect(absent.elements.filter(e=>e.tag==='button')).toHaveLength(0);absentHandle.dispose();
});
