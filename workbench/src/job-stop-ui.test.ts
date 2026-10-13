import {test,expect} from 'bun:test';
import {stopGenerationHTML,bindStopGeneration} from '../public/job-stop-ui.js';

function fixture(id='running-job'){
 const button:any={dataset:{stopJob:id},disabled:false,textContent:'停止生成',attributes:{},setAttribute(name:string,value:string){this.attributes[name]=value;}};
 const root:any={buttons:[button],querySelectorAll(){return this.buttons;}};
 return {root,button};
}
test('running and queued jobs can stop before an output exists; terminal records have no stop action',()=>{
 for(const status of ['running','queued'])expect(stopGenerationHTML({id:'job',status})).toContain('data-stop-job="job"');
 for(const status of ['passed','failed','blocked','cancelled','needs_review',undefined])expect(stopGenerationHTML({id:'job',status})).toBe('');
 expect(stopGenerationHTML({id:'" onclick="oops',status:'running'})).not.toContain('data-stop-job=""');
});
test('dismissing the confirmation sends no cancellation and leaves the button usable',async()=>{
 const {root,button}=fixture();let calls=0;
 bindStopGeneration({root,api:async()=>{calls++;},onError:()=>{},confirmStop:()=>false});
 await button.onclick();expect(calls).toBe(0);expect(button.disabled).toBe(false);
});
test('accepted stop sends the existing POST body and refreshes only after acknowledgement',async()=>{
 const {root,button}=fixture('one/job'),steps:string[]=[];
 bindStopGeneration({root,api:async(path,body)=>{expect(path).toBe('/api/jobs/one%2Fjob/cancel');expect(body).toEqual({});expect(button.disabled).toBe(true);expect(button.textContent).toBe('正在停止…');steps.push('ack');return {status:'cancelled'};},onStopped:async id=>{expect(id).toBe('one/job');steps.push('refresh');},onError:error=>{throw error;},confirmStop:()=>true});
 await button.onclick();expect(steps).toEqual(['ack','refresh']);expect(button.disabled).toBe(false);
});
test('repeated click and a rerendered detail/list share one pending cancellation',async()=>{
 const first=fixture('shared'),second=fixture('shared');let finish:any,calls=0;
 const api=()=>{calls++;return new Promise(resolve=>{finish=resolve;});},options={api,onError:()=>{},confirmStop:()=>true};
 bindStopGeneration({root:first.root,...options});const pending=first.button.onclick();await Promise.resolve();await first.button.onclick();
 expect(stopGenerationHTML({id:'shared',status:'running'})).toContain('disabled aria-busy="true"');
 bindStopGeneration({root:second.root,...options});expect(second.button.disabled).toBe(true);await second.button.onclick();expect(calls).toBe(1);
 finish({status:'cancelled'});await pending;
 bindStopGeneration({root:second.root,...options});expect(second.button.disabled).toBe(false);
});
test('a failed or timed-out stop is shown and can be retried; it never pretends the task stopped',async()=>{
 const {root,button}=fixture();let calls=0,refreshes=0;const errors:string[]=[];
 bindStopGeneration({root,api:async()=>{calls++;throw Error('服务暂不可用');},onStopped:()=>{refreshes++;},onError:error=>errors.push(error.message),confirmStop:()=>true});
 await button.onclick();expect(button.disabled).toBe(false);expect(button.textContent).toBe('停止生成');expect(refreshes).toBe(0);expect(errors).toEqual(['服务暂不可用']);
 await button.onclick();expect(calls).toBe(2);
});
test('finishing an old request does not change a different job after navigation',async()=>{
 const {root,button}=fixture('old');let finish:any;
 bindStopGeneration({root,api:()=>new Promise(resolve=>{finish=resolve;}),onError:()=>{},confirmStop:()=>true});
 const pending=button.onclick();await Promise.resolve();const other=fixture('new');root.buttons=[other.button];finish({status:'cancelled'});await pending;
 expect(other.button.textContent).toBe('停止生成');expect(other.button.disabled).toBe(false);
});

 test('asynchronous confirmation blocks duplicate dialogs and cancelling it sends no POST',async()=>{
 const {root,button}=fixture('confirming');let finish:any,dialogs=0,calls=0;
 bindStopGeneration({root,api:async()=>{calls++;},onError:()=>{},confirmStop:()=>{dialogs++;return new Promise(resolve=>finish=resolve);}});
 const pending=button.onclick();await button.onclick();expect(dialogs).toBe(1);expect(button.textContent).toBe('确认停止…');expect(calls).toBe(0);
 finish(false);await pending;expect(calls).toBe(0);expect(button.disabled).toBe(false);
 });
 test('pending confirmation survives a rerender and enters the request state only after confirmation',async()=>{
 const {root,button}=fixture('confirm-rerender');let accept:any,ack:any,calls=0;
 const options={root,api:()=>{calls++;return new Promise(resolve=>ack=resolve);},onError:()=>{},confirmStop:()=>new Promise(resolve=>accept=resolve)};
 bindStopGeneration(options);const pending=button.onclick();const next=fixture('confirm-rerender');root.buttons=next.root.buttons;bindStopGeneration(options);
 expect(next.button.textContent).toBe('确认停止…');await next.button.onclick();expect(calls).toBe(0);
 accept(true);await Promise.resolve();expect(calls).toBe(1);expect(next.button.textContent).toBe('正在停止…');ack({status:'cancelled'});await pending;expect(next.button.disabled).toBe(false);
 });
