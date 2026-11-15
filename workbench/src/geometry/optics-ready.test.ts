import {test,expect} from 'bun:test';
import {opticsProblems,rendererFrameCompleted,waitForOptics} from './optics-ready.mjs';
const expected={probes:1,ssr:true,volume:true};
const value=()=>({state:'alive',frame:{frameId:80,deviceGeneration:2,pendingCompletionCount:1,pendingCompletions:[{frameId:80}]},reflectionProbes:{pipelineReady:true,activeCount:1,updates:[{activeGeneration:1,capturedRevision:1,requestedRevision:1,pending:false}]},ssr:{status:'admitted',history:{state:'stable',resetCount:1}},volumetricFog:{status:'available',resourceStage:'accepted',selectedLight:{entity:7},digest:'density-A'}});
const sample=(canvasFrame:number,v=value())=>({progress:{canvases:[{canvas:0,submitted:{frameId:canvasFrame+1,worldIdentity:'W',deviceGeneration:2},completed:{frameId:canvasFrame,worldIdentity:'W',deviceGeneration:2,presentation:'ready'}}]},pose:{position:[1,2,3],target:[0,0,0],selectedView:0,running:false},afterPose:{position:[1,2,3],target:[0,0,0],selectedView:0,running:false},result:{ok:true,value:v}});
test('probe publication, SSR stable history, accepted volume and completion must all be observed',()=>{
 expect(opticsProblems(value(),expected)).toEqual([]);
 for(const alter of [(v:any)=>v.reflectionProbes.updates[0].pending=true,(v:any)=>v.ssr.history.state='reset',(v:any)=>v.volumetricFog.resourceStage='lkg',(v:any)=>delete v.frame.pendingCompletions]){const v=value();alter(v);expect(opticsProblems(v,expected).length).toBeGreaterThan(0);}
 expect(rendererFrameCompleted(value(),{frameId:80,deviceGeneration:2})).toBe(false);
 const done=value();done.frame.pendingCompletions=[];done.frame.pendingCompletionCount=0;expect(rendererFrameCompleted(done,{frameId:80,deviceGeneration:2})).toBe(true);expect(rendererFrameCompleted(done,{frameId:80,deviceGeneration:3})).toBe(false);
 done.frame.pendingCompletionCount=9;expect(rendererFrameCompleted(done,{frameId:80,deviceGeneration:2})).toBe(false);
});
test('independent frame counters are not equated; stale pose cannot pass',async()=>{
 const done=value();done.frame.frameId=82;done.frame.pendingCompletions=[];done.frame.pendingCompletionCount=0;
 const stale=sample(200);stale.pose.selectedView=1;
 const queue=[stale,sample(201),sample(205),sample(206,done)];
 const audit={opticsInspection:expected,views:[{position:[1,2,3],target:[0,0,0]}]};
 const result=await waitForOptics({evaluate:async()=>queue.shift(),waitForTimeout:async()=>{}},audit,0);
 expect(result.rendererFrame).toBe(80);expect(result.canvasCompletedFrame).toBe(206);expect(result.passed).toBe(true);
 let clock=0;await expect(waitForOptics({evaluate:async()=>stale,waitForTimeout:async()=>{}},audit,0,{now:()=>clock+=1000,timeoutMs:5000})).rejects.toThrow('TIMEOUT');
});
test('missing observer, changed GPU identity and resource generations never reuse a stale pass',async()=>{
 const audit={opticsInspection:expected,views:[{position:[1,2,3],target:[0,0,0]}]};
 let clock=0;await expect(waitForOptics({evaluate:async()=>({...sample(10),result:{ok:false,error:{code:'OPTICS_OBSERVER_MISSING'}}}),waitForTimeout:async()=>{}},audit,0,{now:()=>clock+=1000,timeoutMs:5000})).rejects.toThrow('TIMEOUT');
 const changed=sample(21);changed.progress.canvases[0]!.completed.worldIdentity='other';changed.progress.canvases[0]!.submitted.worldIdentity='other';
 const queue=[sample(20),changed];await expect(waitForOptics({evaluate:async()=>queue.shift(),waitForTimeout:async()=>{}},audit,0)).rejects.toThrow('IDENTITY_CHANGED');
});
