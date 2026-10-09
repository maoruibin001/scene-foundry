import {test,expect} from 'bun:test';
import {assetReferenceEvidence} from './asset-reference-evidence';
import {assetEvidencePlan} from './asset-evidence';
import {prioritizeAssets,selectAssetPreviews} from './asset-priority';

const view=(area:number,referenceIndex=1)=>({referenceIndex,box:[0,0,1,area],extent:'partial',evidence:'原图可见依据'});
function fixture(){
 const briefs=[{id:'a'},{id:'b'},{id:'c'}];
 const layout:any={program:{templates:briefs,instances:[{id:'a1',template:'a',requirementIds:['r']},{id:'a2',template:'a',requirementIds:[]},{id:'b1',template:'b',requirementIds:[]},{id:'c1',template:'c',requirementIds:[]}]},
  entities:[{instanceId:'a1',role:'subject'},{instanceId:'b1',role:'subject'},{instanceId:'c1',role:'ground'}],cameras:[{referenceIndex:1},{referenceIndex:2}],
  observedBindings:[{landmarkId:'group',instanceIds:['a1','b1','c1']},{landmarkId:'a',instanceIds:['a1','a2']},{landmarkId:'b',instanceIds:['b1']},{landmarkId:'c',instanceIds:['c1']}]};
 const observation={landmarks:[{id:'group',label:'共同光照与围合',critical:true,views:[view(1)]},{id:'a',label:'不按名字分类',views:[view(.1)]},{id:'b',label:'其他实例',views:[view(.7)]},{id:'c',label:'地面',views:[view(.5)]}]};
 return {briefs,layout,observation,plan:{requirements:[{id:'r',critical:true}]}};
}

test('跨模板范围不逐个归为资产面积；全部共享证据保留，来源不变',()=>{
 const f=fixture(),before=JSON.stringify(f),e=assetReferenceEvidence(f.layout,'a',f.observation);
 expect(e.views.map(v=>v.landmarkId)).toEqual(['a']);expect(e.contextViews.map(v=>v.landmarkId)).toEqual(['group']);
 expect(e.evidence.find(v=>v.id==='group')).toMatchObject({evidenceScope:'shared-context',templateIds:['a','b','c']});
 expect(e.evidence.find(v=>v.id==='a')).toMatchObject({evidenceScope:'template-group',templateIds:['a']});
 expect(JSON.stringify(f)).toBe(before);
});
test('相同模板多实例、多个局部框仍可用；不要求一地标一实例',()=>{
 const f=fixture();f.observation.landmarks[1].views.push(view(.2,2));
 const e=assetReferenceEvidence(f.layout,'a',f.observation);expect(e.views).toHaveLength(2);
 expect(e.views.every(v=>v.evidenceScope==='template-group')).toBe(true);
});
test('不完整和重复绑定不伪造成独占范围；其他不相关观察不进入资产证据',()=>{
 const f=fixture();f.layout.observedBindings[1].instanceIds.push('missing');
 let e=assetReferenceEvidence(f.layout,'a',f.observation);expect(e.views).toHaveLength(0);
 expect(e.evidence.find(v=>v.id==='a')?.evidenceScope).toBe('unresolved-binding');expect(e.evidence.some(v=>v.id==='b')).toBe(false);
 f.layout.observedBindings[1].instanceIds.pop();f.layout.observedBindings.push({landmarkId:'a',instanceIds:['a1']});
 e=assetReferenceEvidence(f.layout,'a',f.observation);expect(e.views).toHaveLength(0);
 expect(assetReferenceEvidence(f.layout,'absent',f.observation).evidence).toEqual([]);
 expect(assetReferenceEvidence(f.layout,'a',undefined).evidence).toEqual([]);
});
test('全图共享关系不占局部裁图名额；最多四框且保留原图坐标与文字',()=>{
 const f=fixture();f.observation.landmarks[1].views=[.1,.2,.3,.4,.5].map(a=>view(a));
 const e=assetEvidencePlan(f.layout,f.briefs[0],f.observation);
 expect(e.crops).toHaveLength(4);expect(e.crops.map(v=>v.box[3])).toEqual([.5,.4,.3,.2]);
 expect(e.crops.every(v=>v.landmarkId==='a'&&v.evidence==='原图可见依据')).toBe(true);
 expect(e.evidence.some(v=>v.id==='group')).toBe(true);expect(e.referenceCameras).toEqual(f.layout.cameras);
});
test('无独占范围时不编局部框和面积；关键需求排序仍保留，模板仍生成',()=>{
 const f=fixture();f.observation.landmarks=f.observation.landmarks.slice(0,1);
 const e=assetEvidencePlan(f.layout,f.briefs[0],f.observation);expect(e.crops).toEqual([]);expect(e.evidence).toHaveLength(1);
 const rows=prioritizeAssets(f.briefs,f.layout,f.plan,f.observation);expect(rows).toHaveLength(3);
 expect(rows[0]).toMatchObject({critical:1,salience:0,priority:4,salienceEvidence:{scope:'unknown'}});
});
test('固定预览名额按模板证据分配；不扩大预算、不删除需求或修改场景',()=>{
 const f=fixture(),before=JSON.stringify(f),rows=prioritizeAssets(f.briefs,f.layout,f.plan,f.observation);
 expect(rows.map(r=>r.brief.id)).toEqual(['b','c','a']);expect(rows.find(r=>r.brief.id==='a')?.salience).toBe(.1);
 expect(selectAssetPreviews(rows,f.layout,2).map(r=>r.templateId)).toEqual(['b','c']);
 expect(selectAssetPreviews(rows,f.layout,0)).toEqual([]);expect(selectAssetPreviews(rows,f.layout,1)).toHaveLength(1);
 expect(JSON.stringify(f)).toBe(before);
});
