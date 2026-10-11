import {test,expect} from 'bun:test';
import {selectSpatialCandidate,spatialCandidateProof,spatialSelectionRule,spatialSwapRule} from './blockout-selection';

const candidate=(score:number,failed=['rear'],changes:any={},relations:any[]=[])=>({jobId:'own-root',round:0,folder:'actual-frame-folder',space:{spatialRelations:[{id:'rear',critical:true},{id:'path',critical:true},{id:'roof',critical:true},{id:'wall',critical:true}]},gate:{protocol:'spatial-composition-v3',threshold:{space:3.5,critical:3,confidence:.6},passed:false,failed,review:{score,confidence:.9,relations},runtimeDigest:'exact-dist',...changes}});

test('3.2来源后出现3.0及2.9退步，几何/截图/反馈一起保留来源且原评估不改',()=>{
 const source=candidate(3.2),worse={...candidate(3,['rear','path']),folder:'worse-actual'},before=JSON.stringify([source,worse]);
 const first=selectSpatialCandidate(source,worse);expect(first.candidate).toBe(source);expect(first.changed).toBe(false);expect(first.eligible).toBe(false);
 const second=selectSpatialCandidate(first.candidate,candidate(2.9));expect(second.candidate).toBe(source);expect(second.changed).toBe(false);
 expect(JSON.stringify([source,worse])).toBe(before);expect(spatialCandidateProof(second.candidate)).toMatchObject({score:3.2,passed:false,folder:'actual-frame-folder'});
});
test('更高总空间分但新增关键阻断不能替代；新分仍留在原候选证据',()=>{
 const source=candidate(3.2),next=candidate(3.4,['rear','path']);const selected=selectSpatialCandidate(source,next);
 expect(selected.candidate).toBe(source);expect(selected.eligible).toBe(false);expect(next.gate.review.score).toBe(3.4);
});
test('已验证提高且关键阻断未增加，后续退步继续沿用新的较好来源',()=>{
 const source=candidate(3.2),better=candidate(3.4);const first=selectSpatialCandidate(source,better);
 expect(first.candidate).toBe(better);expect(first.changed).toBe(true);expect(selectSpatialCandidate(first.candidate,candidate(3.3)).candidate).toBe(better);
});
test('只有实际独立通过才能放行；低置信度、同分、不同协议或关系不借历史最佳',()=>{
 const source=candidate(3.2),passed=candidate(3.5,[],{passed:true});expect(selectSpatialCandidate(source,passed).candidate).toBe(passed);
 expect(selectSpatialCandidate(source,candidate(4,[],{review:{score:4,confidence:.5}})).candidate).toBe(source);
 expect(selectSpatialCandidate(source,candidate(3.2)).candidate).toBe(source);
 expect(()=>selectSpatialCandidate(source,candidate(3.4,['rear'],{protocol:'different'}))).toThrow('契约改变');
 const changed=candidate(3.4);changed.space.spatialRelations[0].critical=false;expect(()=>selectSpatialCandidate(source,changed)).toThrow('契约改变');
});
test('没有外部来源时首个实际候选保留，未评估数字拒绝',()=>{
 const first=candidate(2.9);expect(selectSpatialCandidate(null,first).candidate).toBe(first);
 expect(()=>selectSpatialCandidate(first,candidate(NaN))).toThrow('完整独立评估');
});
test('净关闭关键阻断：关闭两项、新增一项临界且分数提高时作为下一轮来源；新增项过低或净数不减仍保留来源',()=>{
 const source=candidate(2.7,['rear','path','roof']);
 const net=candidate(2.9,['rear','wall'],{},[{id:'wall',score:2.8}]);const net_off=selectSpatialCandidate(source,net);expect(net_off.candidate).toBe(source);
 const selected=selectSpatialCandidate(source,net,{netClosure:true});
 expect(selected.candidate).toBe(net);expect(selected.eligible).toBe(true);expect(selected.reason).toContain('net-closure-v1');expect(net.gate.passed).toBe(false);
 expect(selectSpatialCandidate(source,candidate(2.9,['rear','wall'],{},[{id:'wall',score:2.4}]),{netClosure:true}).candidate).toBe(source);
 expect(selectSpatialCandidate(source,candidate(2.9,['rear','path','wall'],{},[{id:'wall',score:2.9}]),{netClosure:true}).candidate).toBe(source);
 expect(selectSpatialCandidate(source,candidate(2.7,['rear','wall'],{},[{id:'wall',score:2.9}]),{netClosure:true}).candidate).toBe(source);
});
test('net-closure-v2等量交换：关闭一项、新增一项临界且分数提高时作为来源；v1、新增过低、分数不升或零关闭仍保留来源',()=>{
 const source=candidate(3.1,['rear','path']),swap=candidate(3.2,['wall','path'],{},[{id:'wall',score:2.5}]);
 expect(selectSpatialCandidate(source,swap,{netClosure:true}).candidate).toBe(source);
 const selected=selectSpatialCandidate(source,swap,{netClosure:true,swap:true});
 expect(selected.candidate).toBe(swap);expect(selected.eligible).toBe(true);expect(selected.reason).toContain('net-closure-v2');
 expect(selectSpatialCandidate(source,candidate(3.2,['wall','path'],{},[{id:'wall',score:2.4}]),{netClosure:true,swap:true}).candidate).toBe(source);
 expect(selectSpatialCandidate(source,candidate(3.1,['wall','path'],{},[{id:'wall',score:2.8}]),{netClosure:true,swap:true}).candidate).toBe(source);
 expect(selectSpatialCandidate(source,candidate(3.3,['rear','path','wall'],{},[{id:'wall',score:2.8}]),{netClosure:true,swap:true}).candidate).toBe(source);
 // v1 net closure still names its own policy.
 expect(selectSpatialCandidate(candidate(2.7,['rear','path','roof']),candidate(2.9,['rear','wall'],{},[{id:'wall',score:2.8}]),{netClosure:true,swap:true}).reason).toContain('net-closure-v1');
 expect(spatialSelectionRule({spatialSelectionPolicy:'net-closure-v1'})).toBe(true);expect(spatialSwapRule({spatialSelectionPolicy:'net-closure-v1'})).toBe(false);
 expect(spatialSelectionRule({spatialSelectionPolicy:'net-closure-v2'})).toBe(true);expect(spatialSwapRule({spatialSelectionPolicy:'net-closure-v2'})).toBe(true);expect(spatialSelectionRule({})).toBe(false);
});
