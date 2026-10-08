import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ImprovementLedger} from './improvement-governance';
import {resumeDiagnosedRefinement} from './diagnosed-refinement';
const reason='真实画面与两轮评分都显示接触阴影缺失。已验证固定偏移掩盖小部件阴影，新版本开放实际Engine阴影覆盖与偏移控制，保留几何、原评分及全部门槛，按真实预览再修正。';
function setup(){const dir=mkdtempSync(join(tmpdir(),'diagnosed-refinement-')),ledger=new ImprovementLedger(dir);const input={prompt:'图像还原',images:[],generationMode:'qualified'},id=ledger.enter(input,'first');ledger.call(id,'scene-refine');ledger.reserveRepair(id,'final','已知缺陷');for(let i=0;i<3;i++)ledger.result(id,{comparison:'same',status:'failed',score:80,jobId:'first'});return {ledger,id,source:{...input,id:'first',improvementId:id,status:'failed',sceneProgram:{},quality:{score:80},review:{}},cleanup:()=>rmSync(dir,{recursive:true,force:true})};}
test('有据新策略保持调用、轮次、历史和门槛，通过同一正常修正入口续接',()=>{const f=setup();try{
 const before=f.ledger.get(f.id),v=resumeDiagnosedRefinement(f.ledger,f.source,reason,{id:'fixed'});
 expect(v.calls).toBe(before.calls);expect(v.repairs).toBe(before.repairs);expect(v.results).toEqual(before.results);expect(v.limits).toEqual(before.limits);expect(v.stopped).toBeUndefined();
 expect(v.strategyRevisions).toHaveLength(1);expect(v.strategyRevisions[0].reason).toBe(reason);
 resumeDiagnosedRefinement(f.ledger,f.source,reason,{id:'fixed'});expect(f.ledger.get(f.id).strategyRevisions).toHaveLength(1);
 expect(f.ledger.enter(f.source,'next',[],f.source,'continuation')).toBe(f.id);
}finally{f.cleanup();}});
test('新策略不绕过有限预算、硬阻塞或草稿身份，空泛重试不解锁',()=>{const f=setup();try{
 for(const source of [{...f.source,generationMode:'first-pass'},{...f.source,partialOutput:{completed:1,total:2}},{...f.source,status:'running'}])expect(()=>resumeDiagnosedRefinement(f.ledger,source,reason,{id:'fixed'})).toThrow();
 expect(()=>resumeDiagnosedRefinement(f.ledger,f.source,'再试一次',{id:'fixed'})).toThrow('证据');
 f.ledger.markStopped(f.id,'PROVIDER_HTTP_401');expect(()=>resumeDiagnosedRefinement(f.ledger,f.source,reason,{id:'fixed'})).toThrow('外部阻塞');
 const bounded=f.ledger.enter({prompt:'有限验证',images:[],generationMode:'first-pass'},'bounded');expect(()=>resumeDiagnosedRefinement(f.ledger,{...f.source,improvementId:bounded},reason,{id:'fixed'})).toThrow('限额');
}finally{f.cleanup();}});
