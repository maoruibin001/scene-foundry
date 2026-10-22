import {test,expect} from 'bun:test';
import {compositionScore,rowFit,COMPOSITION_SCORE} from './composition-score';
const row=(o:any)=>({landmarkId:'lm',referenceIndex:1,critical:false,comparisonScope:'bound-instance-union',status:'measured-visible-extent',pixels:100,edgeResidual:0,...o});
test('残差越大分越低，达到尺度即为0',()=>{
 expect(rowFit(row({edgeResidual:0})).fit).toBe(1);
 expect(rowFit(row({edgeResidual:COMPOSITION_SCORE.residualScale/2})).fit).toBeCloseTo(.5);
 expect(rowFit(row({edgeResidual:1})).fit).toBe(0);
});
test('绑定可解析但完全不可见按缺失计0分，绑定无法区分时不计分',()=>{
 expect(rowFit(row({status:'unverified',pixels:0,edgeResidual:null}))).toEqual({state:'absent',fit:0});
 expect(rowFit(row({comparisonScope:'unverified-binding-scope',status:'unverified',pixels:null,edgeResidual:null}))).toEqual({state:'unresolved',fit:null});
});
test('关键地标加权、缺失计数不被平均稀释，相同输入分数相同',()=>{
 const rows=[row({landmarkId:'a',critical:true,edgeResidual:0}),row({landmarkId:'b',edgeResidual:0}),row({landmarkId:'c',critical:true,status:'unverified',pixels:0,edgeResidual:null}),row({landmarkId:'d',comparisonScope:'unverified-binding-scope',status:'unverified',pixels:null,edgeResidual:null})];
 const s=compositionScore({rows});
 expect(s.score).toBeCloseTo(100*3/5);expect(s.criticalScore).toBeCloseTo(50);expect(s.criticalMisses).toBe(1);
 expect(s).toMatchObject({measured:2,absent:1,unresolved:1,coverage:.75});
 expect(compositionScore({rows})).toEqual(s);
 expect(compositionScore({rows:[]}).score).toBeNull();
});
