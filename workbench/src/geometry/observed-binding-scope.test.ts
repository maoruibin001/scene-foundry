import {test,expect} from 'bun:test';
import {validateCriticalViewExclusive,observedBindingRule,ObservedBindingScopeError,OBSERVED_BINDING_POLICY} from './observed-binding-scope';
import {referenceComposition,NEXT_REFERENCE_COMPOSITION} from './reference-composition';

const view=(referenceIndex:number,box=[.1,.1,.9,.9])=>({referenceIndex,box,evidence:'测试'});
const observation={landmarks:[
 {id:'beam',critical:true,views:[view(1)]},{id:'pediment',critical:true,views:[view(1)]},{id:'relief',critical:true,views:[view(1)]},
 {id:'wall',critical:true,views:[view(1),view(2)]},{id:'lamps',critical:false,views:[view(2)]},{id:'pair',critical:true,views:[view(2,[0,0,.4,.4]),view(2,[.6,.6,1,1])]}]};
const space=(bindings:Record<string,string[]>)=>({observedBindings:Object.entries(bindings).map(([landmarkId,instanceIds])=>({landmarkId,instanceIds}))});

test('关键地标在每个观察机位都需要独有实例；全部冲突一次列出',()=>{
 let error:any;
 try{validateCriticalViewExclusive(space({beam:['gate'],pediment:['gate'],relief:['gate'],wall:['wall'],lamps:['wall'],pair:['p1']}),observation);}catch(e){error=e;}
 expect(error).toBeInstanceOf(ObservedBindingScopeError);
 const rows=error.violations.map((v:any)=>v.landmarkId+'/'+v.referenceIndex);
 // Non-critical lamps borrowing the wall still hide the wall on camera 2; camera 1 stays measurable.
 expect(rows).toEqual(['beam/1','pediment/1','relief/1','wall/2','pair/2']);
 expect(error.violations.find((v:any)=>v.landmarkId==='beam').sharedWith).toEqual({gate:['pediment','relief']});
 expect(error.violations.find((v:any)=>v.landmarkId==='pair')).toMatchObject({boxes:2,exclusiveInstanceIds:['p1']});
 expect(error.message).toContain('OBSERVED_BINDING_SCOPE');
});

test('拆分后的组件和宿主可共存：只要每个关键视角保有足够独有实例',()=>{
 const ok=space({beam:['gate-beam','gate-frame'],pediment:['gate-top','gate-frame'],relief:['gate-relief'],wall:['wall','lamp-1'],lamps:['lamp-1','lamp-2'],pair:['p1','p2']});
 expect(validateCriticalViewExclusive(ok,observation)).toBe(ok);
 // Sharing is only judged on the same camera: wall and lamps share lamp-1 on view 2, but wall still owns `wall` there.
});

test('仅新任务启用；历史任务没有字段时不校验',()=>{
 expect(observedBindingRule({observedBindingPolicy:OBSERVED_BINDING_POLICY})).toBe(true);
 expect(observedBindingRule({})).toBe(false);expect(observedBindingRule(null)).toBe(false);
});

test('通过此规则的绑定在v4构图中可测，不再是unverified-binding-scope',()=>{
 const obs={landmarks:[{id:'a',label:'A',critical:true,views:[{referenceIndex:1,box:[0,0,.5,1],evidence:'左'}]},{id:'b',label:'B',critical:true,views:[{referenceIndex:1,box:[.5,0,1,1],evidence:'右'}]}],cameras:[{referenceIndex:1,contentRect:[0,0,1,1]}]};
 const scene:any={program:{instances:[{id:'host'},{id:'left'},{id:'right'}]},cameras:[{referenceIndex:1}],observedBindings:[{landmarkId:'a',instanceIds:['host','left']},{landmarkId:'b',instanceIds:['host','right']}]};
 validateCriticalViewExclusive(scene,obs);
 const w=8,h=8,labels=Buffer.alloc(w*h*2);
 for(let p=0;p<w*h;p++){const x=p%w;labels.writeUInt16LE(x<4?2:3,p*2);}
 const visibility={palette:[{number:1,instanceId:'host'},{number:2,instanceId:'left'},{number:3,instanceId:'right'}],views:[{referenceIndex:1,width:w,height:h,labelsBase64:labels.toString('base64')}]};
 const report=referenceComposition(scene,obs,visibility,{version:NEXT_REFERENCE_COMPOSITION});
 expect(report.rows.map((r:any)=>[r.landmarkId,r.comparisonScope,r.measuredInstanceIds])).toEqual([['a','exclusive-instance-subset',['left']],['b','exclusive-instance-subset',['right']]]);
});
