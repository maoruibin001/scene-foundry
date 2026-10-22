import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {recordCompositionShadow} from './composition-shadow';
const row=(edgeResidual:number)=>({landmarkId:'lm',referenceIndex:1,critical:true,comparisonScope:'bound-instance-union',status:'measured-visible-extent',pixels:100,edgeResidual});
const round=(root:string,n:number,residual:number|null)=>{const f=join(root,'generation/blockout',String(n));mkdirSync(f,{recursive:true});writeFileSync(join(f,'reference-composition.json'),residual===null?'{"rows":':JSON.stringify({rows:[row(residual)]}));return f;};
const log=(root:string)=>JSON.parse(readFileSync(join(root,'generation/composition-shadow.json'),'utf8'));
test('逐轮记录程序分与空间评审的涨跌方向，只写影子记录',()=>{
 const root=mkdtempSync(join(tmpdir(),'shadow-'));
 recordCompositionShadow(round(root,0,.09),{round:0,passed:false,review:{score:3,confidence:.9}});
 const second=recordCompositionShadow(round(root,1,.03),{round:1,passed:true,review:{score:3.6,confidence:.9}});
 expect(second.programScore).toBeCloseTo(80);expect(second.vsPrevious).toMatchObject({round:0,direction:'agree'});
 expect(second.vsPrevious.program).toBeCloseTo(40);
 const third=recordCompositionShadow(round(root,2,.12),{round:2,passed:true,review:{score:3.7}});
 expect(third.vsPrevious.direction).toBe('disagree');
 expect(existsSync(join(root,'generation/blockout/2/composition-score.json'))).toBe(true);
 const l=log(root);expect(l).toMatchObject({version:'composition-shadow-v1',gating:false});expect(l.rounds.map((r:any)=>r.round)).toEqual([0,1,2]);
 // A recomputed round replaces its own row instead of duplicating it.
 recordCompositionShadow(join(root,'generation/blockout/2'),{round:2,passed:true,review:{score:3.7}});expect(log(root).rounds).toHaveLength(3);
});
test('缺失或损坏的构图证据只记录错误，不抛出、不影响管线',()=>{
 const root=mkdtempSync(join(tmpdir(),'shadow-'));
 expect(recordCompositionShadow(round(root,0,null),{round:0,review:{score:3}})).toBeNull();
 expect(log(root).errors).toHaveLength(1);
 expect(recordCompositionShadow(join(root,'generation/blockout/9'),{round:9})).toBeNull();
});
