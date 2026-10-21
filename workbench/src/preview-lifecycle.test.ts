import {test,expect} from 'bun:test';
import {createPreviewLifecycle} from '../public/preview-lifecycle.js';
function setup(){
 let callback:any;const listeners=new Map(),states:any[]=[];
 const doc={hidden:false,addEventListener:(k:string,f:any)=>listeners.set(k,f),removeEventListener:(k:string)=>listeners.delete(k)};
 class Observer{constructor(cb:any){callback=cb;}observe(){}disconnect(){}}
 const makeFrame=()=>{const attrs=new Map<string,string>();let loads=0;return {dataset:{previewSrc:'/engine'},isConnected:true,getAttribute:(k:string)=>attrs.get(k),setAttribute:(k:string,v:string)=>{attrs.set(k,v);loads++;},removeAttribute:(k:string)=>attrs.delete(k),get loads(){return loads;}};};
 const c=createPreviewLifecycle({document:doc,IntersectionObserver:Observer,onState:s=>states.push(s)}),frame=makeFrame();c.attach(frame);
 return {c,doc,frame,makeFrame,states,show:(target=frame,visible=true)=>callback([{target,isIntersecting:visible,intersectionRatio:visible?1:0}]),visibility:()=>listeners.get('visibilitychange')?.()};
}
test('hidden/offscreen preview does not boot; repeated UI refresh does not reload an active Engine',()=>{const s=setup();s.doc.hidden=true;s.show();expect(s.frame.loads).toBe(0);s.doc.hidden=false;s.visibility();expect(s.frame.loads).toBe(1);s.c.attach(s.frame);expect(s.frame.loads).toBe(1);s.show(s.frame,false);expect(s.frame.getAttribute('src')).toBeUndefined();s.show();expect(s.frame.loads).toBe(2);s.c.dispose();});
test('external preview releases embedded context and stays paused across refresh and visibility until explicit resume',()=>{const s=setup();s.show();s.c.pauseForExternal();expect(s.frame.getAttribute('src')).toBeUndefined();s.c.attach(s.frame);s.doc.hidden=true;s.visibility();s.doc.hidden=false;s.visibility();s.show();expect(s.frame.loads).toBe(1);s.c.resume();expect(s.frame.loads).toBe(2);expect(s.states.at(-1).active).toBe(true);s.c.dispose();});
test('replacing task or recording placeholder unloads old Engine; stale observer cannot start detached frame',()=>{const s=setup();s.show();const next=s.makeFrame();s.c.attach(next);expect(s.frame.getAttribute('src')).toBeUndefined();s.show(s.frame);expect(next.loads).toBe(0);s.show(next);expect(next.loads).toBe(1);s.c.attach(null);expect(next.getAttribute('src')).toBeUndefined();s.c.dispose();});

test('capture suspension unloads an active Engine and stays suspended across polling and same-node refresh',()=>{
 const s=setup();s.show();expect(s.frame.loads).toBe(1);
 s.c.setSuspended(true);expect(s.frame.getAttribute('src')).toBeUndefined();expect(s.states.at(-1)).toMatchObject({active:false,suspended:true,external:false,reason:'正在录制与验收，页面内预览已暂停'});
 s.c.attach(s.frame);s.show();s.c.setSuspended(true);s.visibility();expect(s.frame.loads).toBe(1);expect(s.frame.getAttribute('src')).toBeUndefined();
 s.c.setSuspended(false);expect(s.frame.loads).toBe(2);expect(s.states.at(-1)).toMatchObject({active:true,suspended:false});s.c.setSuspended(false);expect(s.frame.loads).toBe(2);s.c.dispose();
});

test('capture and external pauses are independent; neither resume can override the other pause',()=>{
 const s=setup();s.show();s.c.setSuspended(true);s.c.pauseForExternal();s.c.resume();expect(s.frame.loads).toBe(1);expect(s.frame.getAttribute('src')).toBeUndefined();expect(s.states.at(-1)).toMatchObject({active:false,suspended:true,external:false});
 s.c.pauseForExternal();s.c.setSuspended(false);expect(s.frame.loads).toBe(1);expect(s.frame.getAttribute('src')).toBeUndefined();expect(s.states.at(-1)).toMatchObject({active:false,suspended:false,external:true});
 s.c.resume();expect(s.frame.loads).toBe(2);s.c.dispose();
});

test('suspension can explain unknown capture state and clearing it still respects visibility and replacement',()=>{
 const s=setup();s.c.setSuspended(true,'无法读取渲染资源状态，交互预览已暂停');s.show();expect(s.frame.loads).toBe(0);expect(s.states.at(-1).reason).toBe('无法读取渲染资源状态，交互预览已暂停');
 const next=s.makeFrame();s.c.attach(next);s.show(next);expect(next.loads).toBe(0);s.doc.hidden=true;s.c.setSuspended(false);expect(next.loads).toBe(0);
 s.doc.hidden=false;s.visibility();expect(next.loads).toBe(1);s.show(next,false);s.c.setSuspended(true);s.c.setSuspended(false);expect(next.loads).toBe(1);s.show(next);expect(next.loads).toBe(2);s.c.dispose();
});
