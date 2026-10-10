import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compositionCoverage,runInsight,insightFindings,aggregateInsights} from './pipeline-insights';

const row=(id:string,scope:string,edge:number|null,critical=true,ref=1,sourceDelta:any=null)=>({landmarkId:id,referenceIndex:ref,critical,comparisonScope:scope,edgeResidual:edge,...(sourceDelta?{sourceDelta}:{})});
const w=(p:string,v:any)=>{mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,typeof v==='string'?v:JSON.stringify(v));};

test('未验证关键目标计为测量盲区，不当作0误差',()=>{
 const c=compositionCoverage({version:'v4',rows:[row('A','bound-instance-union',.04),row('B','unverified-binding-scope',null),row('C','unverified-binding-scope',null),row('D','exclusive-instance-subset',.02,true,2),row('N','bound-instance-union',.5,false)]});
 expect(c).toMatchObject({critical:4,measured:2,unverified:2,measuredFraction:.5,meanCriticalEdgeResidual:.03});
 expect(c!.worst[0]).toMatchObject({landmarkId:'A'});expect(c!.cameras.map(x=>x.measured)).toEqual([1,1]);
});

test('运行洞察只读产物：轮次、关系走势、修复候选、调用成本和瓶颈提示',()=>{
 const dir=mkdtempSync(join(tmpdir(),'insight-'));try{
  const gen=join(dir,'generation'),space={spatialRelations:[{id:'R1',critical:true},{id:'R2',critical:false}]};
  const comp=(edge:number)=>({version:'v4',rows:[row('A','bound-instance-union',edge),row('B','unverified-binding-scope',null),row('C','unverified-binding-scope',null)]});
  for(const n of [0,1]){w(join(gen,'blockout',String(n),'space.json'),space);w(join(gen,'blockout',String(n),'reference-composition.json'),comp(n?.05:.03));}
  w(join(gen,'space-repair-1/preview/graybox-preview-audit.json'),{version:'graybox-space-preview-v14',used:1,measured:1,measurements:[{patchSha256:'aaaaaaaaaaaaff',referenceComposition:{rows:[row('A','bound-instance-union',.05,true,1,{edgeResidual:.02,visibilityLost:false})]}}]});
  w(join(gen,'space-repair-1/repair-receipt.json'),{preview:{patchSha256:'bbbbbbbbbbbbff'},changes:{instances:['I1']}});
  w(join(gen,'space-repair-1/scene-space-tool-calls.jsonl'),'{"event":"finished","name":"measure_graybox_space"}\n{"event":"finished","name":"preview_graybox_space"}\nnot-json\n');
  w(join(gen,'scene-space-recovery.json'),{role:'scene-space',attempts:[{status:'failed',fault:'timeout',durationMs:600000},{status:'passed',durationMs:1000}]});
  w(join(gen,'scene-space-receipt.json'),{usage:{cliReportedTokens:500}});
  const relations=(a:number,v:string)=>[{id:'R1',score:a,verdict:v},{id:'R2',score:4,verdict:'met'}];
  const job={id:'00000000-0000-0000-0000-000000000000',status:'failed',stage:'graybox',iterationPolicy:{minMeaningfulGain:2},stages:{space:{status:'passed',durationMs:5}},
   blockout:{rounds:[{round:0,path:'generation/blockout/0',startedAt:0,endedAt:10,passed:false,threshold:{space:3.5,confidence:.6},failed:['R1'],review:{score:2.6,confidence:.9,relations:relations(1,'missing')}},
    {round:1,path:'generation/blockout/1',startedAt:20,endedAt:30,passed:false,threshold:{space:3.5,confidence:.6},failed:['R1'],review:{score:2.65,confidence:.9,relations:relations(1.2,'partial')}}]}};
  const before=JSON.stringify(job),v=runInsight(job,dir,{calls:9,limits:{calls:40},repairs:1,requests:[{role:'plan'},{role:'scene-space'},{role:'scene-space'}]});
  expect(JSON.stringify(job)).toBe(before);
  expect(v.relations.find((r:any)=>r.id==='R1')).toMatchObject({critical:true,scores:[1,1.2],neverMet:true,delta:.2});
  expect(v.repairs[0]).toMatchObject({folder:'space-repair-1',toolCalls:{measure_graybox_space:1,preview_graybox_space:1},selectedWasMeasured:false,candidates:[{regressions:['A/1']}]});
  expect(v.providers[0]).toMatchObject({role:'scene-space',timeouts:1,lostMs:600000,tokens:500});
  expect(v.calls).toMatchObject({used:9,byRole:{plan:1,'scene-space':2}});
  const codes=v.findings.map((f:any)=>f.code);
  for(const c of ['measurement-blind-spot','persistent-relation-failure','missing-mass','repair-stall','measure-judge-disagreement','unmeasured-commit','provider-timeout'])expect(codes).toContain(c);
  expect(codes).not.toContain('low-evidence-confidence');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('无轮次或无产物时不臆造结论',()=>{
 expect(insightFindings({job:{},rounds:[],relations:[],repairs:[],providers:[]})).toEqual([]);
 const dir=mkdtempSync(join(tmpdir(),'insight-empty-'));try{const v=runInsight({id:'x',status:'queued'},dir);expect(v).toMatchObject({rounds:[],repairs:[],providers:[],findings:[],calls:null});}finally{rmSync(dir,{recursive:true,force:true});}
});

test('跨运行汇总按出现频次排序，修复增益按百分制',()=>{
 const run=(scores:number[],codes:string[])=>({status:'failed',relations:[{id:'R1',critical:true,neverMet:true,scores}],findings:codes.map(code=>({code})),providers:[{role:'scene-space',calls:1,timeouts:1,lostMs:5,durationMs:9,tokens:3}],rounds:scores.map(score=>({score}))});
 const a=aggregateInsights([run([2.6,2.8],['repair-stall','measurement-blind-spot']),run([3,3.1],['measurement-blind-spot'])]);
 expect(a).toMatchObject({runs:2,passed:0,repairs:2,meanRepairGain:3,findingFrequency:[{code:'measurement-blind-spot',count:2},{code:'repair-stall',count:1}],unmetRelations:[{id:'R1',runs:2,lastScores:[2.8,3.1]}],providerRoles:[{role:'scene-space',calls:2,timeouts:2}]});
});
