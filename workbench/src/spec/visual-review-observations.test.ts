import {test,expect} from 'bun:test';
import {verifiedVisualReview,STYLE_DIMENSIONS} from './visual-review';

const dimensions=STYLE_DIMENSIONS.map(id=>({id,score:3,reason:'实际可见的形状与光色'}));
const review=(observations:any[])=>({
 evidence:{status:'visible',reason:'像素可辨认',observations},
 overall:22,verdict:'mismatch',dimensions,
 strengths:['空间骨架对应'],issues:['光照与氛围不足'],
 summary:'逐张给出可见的具体形状、光色与空间遮挡观察',
});
const detail=(i:number,k:number)=>({imageIndex:i,description:`第 ${i} 张图第 ${k} 处可见形状、光色与遮挡描述`});

test('每张图写多条详细观察仍然有效：契约要求覆盖，不要求恰好一条',()=>{
 // 复现首次 judge：5 张输入图、每图 4 条观察（共 20 条），此前被误判为 VISUAL_EVIDENCE_UNAVAILABLE。
 const observations=[];
 for(let i=0;i<5;i++)for(let k=0;k<4;k++)observations.push(detail(i,k));
 const value=verifiedVisualReview(review(observations),5);
 expect(value.overall).toBe(22);
 expect(value.version).toBe('spec-style-judge-v2');
});

test('单图单条观察保持原有行为',()=>{
 expect(verifiedVisualReview(review([detail(0,0)]),1).overall).toBe(22);
});

test('缺任意一张图、越界索引、空观察仍被拒绝',()=>{
 const four=[0,1,2,3].flatMap(i=>[detail(i,0),detail(i,1)]);
 expect(()=>verifiedVisualReview(review(four),5)).toThrow('VISUAL_EVIDENCE_UNAVAILABLE');
 expect(()=>verifiedVisualReview(review([...four,detail(9,0)]),5)).toThrow('VISUAL_EVIDENCE_UNAVAILABLE');
 expect(()=>verifiedVisualReview(review([]),5)).toThrow('VISUAL_EVIDENCE_UNAVAILABLE');
});

test('描述过短或自述看不到像素仍被拒绝',()=>{
 expect(()=>verifiedVisualReview(review([{imageIndex:0,description:'短'},detail(1,0),detail(2,0),detail(3,0),detail(4,0)]),5)).toThrow('VISUAL_EVIDENCE_UNAVAILABLE');
 const v=review([0,1,2,3,4].map(i=>detail(i,0)));
 v.summary='图片像素不可见，无法给出观察';
 expect(()=>verifiedVisualReview(v,5)).toThrow('VISUAL_EVIDENCE_UNAVAILABLE');
});

test('六维评分不完整仍被拒绝',()=>{
 const v:any=review([0,1,2,3,4].map(i=>detail(i,0)));
 v.dimensions=dimensions.slice(0,5);
 expect(()=>verifiedVisualReview(v,5)).toThrow('VISUAL_REVIEW_INVALID');
});
