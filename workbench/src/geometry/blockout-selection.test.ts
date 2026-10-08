import {test,expect} from 'bun:test';
import {selectSpatialCandidate,spatialCandidateProof} from './blockout-selection';

const candidate=(score:number,failed=['rear'],changes:any={})=>({jobId:'own-root',round:0,folder:'actual-frame-folder',space:{spatialRelations:[{id:'rear',critical:true},{id:'path',critical:true}]},gate:{protocol:'spatial-composition-v3',threshold:{space:3.5,critical:3,confidence:.6},passed:false,failed,review:{score,confidence:.9},runtimeDigest:'exact-dist',...changes}});

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
