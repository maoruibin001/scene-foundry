import {test,expect} from 'bun:test';
import {prioritizeAssets,selectAssetPreviews} from './asset-priority';

function fixture(){
 const roles=['ground','ground','subject','subject'];
 const briefs=roles.map((_,n)=>({id:'asset'+n}));
 const layout:any={program:{instances:briefs.map((b,n)=>({id:'i'+n,template:b.id,requirementIds:[]}))},entities:roles.map((role,n)=>({instanceId:'i'+n,role})),observedBindings:briefs.map((_,n)=>({landmarkId:'l'+n,instanceIds:['i'+n]}))};
 const observation={landmarks:briefs.map((_,n)=>({id:'l'+n,views:[{box:[0,0,1,(4-n)/4]}]}))};
 return {layout,ranked:prioritizeAssets(briefs,layout,{requirements:[]},observation)};
}
test('两次预览包含实际声明的主体；大面积地面不包揽，制作顺序与预算不变',()=>{
 const {layout,ranked}=fixture(),before=JSON.stringify(ranked);
 expect(ranked.slice(0,2).map(r=>r.brief.id)).toEqual(['asset0','asset1']);
 expect(selectAssetPreviews(ranked,layout,2).map(r=>r.templateId)).toEqual(['asset2','asset0']);
 expect(JSON.stringify(ranked)).toBe(before);
 expect(selectAssetPreviews(ranked,layout,1).map(r=>r.templateId)).toEqual(['asset2']);
 expect(selectAssetPreviews(ranked,layout,0)).toEqual([]);
});
test('无主体时使用已有排序；上限截断且同模板只占一个名额',()=>{
 const {layout,ranked}=fixture();layout.entities=[];
 expect(selectAssetPreviews(ranked,layout,2).map(r=>r.templateId)).toEqual(['asset0','asset1']);
 layout.entities=[{instanceId:'i0',role:'subject'}];
 expect(selectAssetPreviews(ranked,layout,20)).toHaveLength(4);
 expect(new Set(selectAssetPreviews(ranked,layout,4).map(r=>r.templateId)).size).toBe(4);
 expect(selectAssetPreviews([],layout,2)).toEqual([]);
});
