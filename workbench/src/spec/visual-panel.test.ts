import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {aggregateVisualPanel,jointVisualFeedback,runVisualPanel,subscriptionLauncherSelection} from './visual-panel';
import {STYLE_DIMENSIONS} from './visual-review';
import {styleGate} from '../spec-run';
import {validateNodeModels} from './node-models';
import {VISUAL_PANEL_SELECTION} from './visual-panel-config';
const review=(overall:number)=>({evidence:{status:'visible',observations:[{imageIndex:0,description:'左边红色方形，右边蓝色圆形，白色背景。'}]},overall,verdict:'partial',dimensions:STYLE_DIMENSIONS.map(id=>({id,score:3,reason:'真实可见的形体光色'})),strengths:['结构清楚'],issues:['光影仍可改善'],summary:'观察到红蓝两个形体'});
const entry=(id:string,overall:number)=>({id,model:id,reasoningEffort:'medium',status:'completed',review:review(overall)});
test('最高有效整份报告，不拼维度、不把失败当零分、不以少数评委冒充完整',()=>{
 const a=entry('a',58),b=entry('b',76),c=entry('c',65),x=aggregateVisualPanel([a,b,c]);
 expect(x.winner).toBe('b');expect(x.review).toBe(b.review);expect(x.median).toBe(65);expect(x.spread).toBe(18);expect(x.complete).toBe(true);
 expect(jointVisualFeedback([a,b,c]).judges.map(j=>j.overall)).toEqual([58,76,65]);
 const partial=aggregateVisualPanel([a,b,{id:'c',status:'failed',error:'no image'}]);expect(partial.min).toBe(58);expect(partial.validCount).toBe(2);expect(partial.complete).toBe(false);
 expect(styleGate({...b.review,panel:partial}).passed).toBe(false);
 b.review.dimensions[0].score=1;expect(styleGate({...b.review,panel:x}).passed).toBe(false);
 expect(()=>aggregateVisualPanel([{status:'failed'}])).toThrow('NO_VALID_REVIEW');
});
test('panel is visual-only; historical settings readable, new default uses subscription panel',()=>{
 expect(validateNodeModels(null).styleReview).toEqual(VISUAL_PANEL_SELECTION);
 expect(validateNodeModels({styleReview:{model:VISUAL_PANEL_SELECTION.model,reasoningEffort:'medium',provider:'codex'}}).styleReview).toEqual(VISUAL_PANEL_SELECTION);
 expect(()=>validateNodeModels({families:VISUAL_PANEL_SELECTION})).toThrow('联合评审');
 expect(()=>validateNodeModels({styleReview:{...VISUAL_PANEL_SELECTION,reasoningEffort:'high'}})).toThrow('联合评审');
 expect(subscriptionLauncherSelection('#!/bin/sh\nexec codex --yolo --model gpt-6-luna -c \'model_reasoning_effort="medium"\' "$@"\n')).toEqual({model:'gpt-6-luna',reasoningEffort:'medium'});
 expect(()=>subscriptionLauncherSelection('#!/bin/sh\nexec codex "$@"')).toThrow('CONFIG_UNVERIFIED');
});
test('three independent calls receive identical original bytes; persist full reports, failed response and frozen model routes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'visual-panel-'));try{
  const image=join(dir,'original.png'),bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);writeFileSync(image,bytes);
  const members=['codex1','codex2','codex3'].map((id,i)=>({id,model:'gpt-fixture-'+i,reasoningEffort:'medium',executable:'/fixture/'+id,route:{providerId:'openai',definition:null,launcherSha256:id,configurationSha256:id}}));
  const seen:any[]=[];const fake:any=async(input:any,folder:string,model:string,schema:any,execution:any)=>{seen.push({input,folder,model,execution});expect(readFileSync(input.images[0].path)).toEqual(bytes);expect(input.text).toBe('same frozen request');return {text:JSON.stringify(model.endsWith('2')?{...review(99),evidence:{status:'unavailable'}}:review(model.endsWith('1')?74:61)),receipt:{cliProvider:'openai',authentication:'chatgpt-subscription',cliModel:model,cliReasoningEffort:'medium',cliSandbox:'read-only',usage:{cliReportedTokens:100}}};};
  const out=join(dir,'out'),result=await runVisualPanel({role:'spec-style-judge',system:'same rubric',text:'same frozen request',images:[{path:image,mime:'image/png'}]},out,{members,call:fake});
  const r=JSON.parse(result.text);expect(seen.length).toBe(3);expect(new Set(seen.map(x=>x.folder)).size).toBe(3);expect(new Set(seen.map(x=>x.input.images[0].path)).size).toBe(1);
  expect(r.overall).toBe(74);expect(r.panel.winner).toBe('codex2');expect(r.panel.complete).toBe(false);expect(r.jointFeedback.judges.length).toBe(2);
  expect(existsSync(join(out,'codex3/raw-response.json'))).toBe(true);expect(existsSync(join(out,'codex3/failure.json'))).toBe(true);
  expect(JSON.parse(readFileSync(join(out,'input.json'),'utf8')).transformation).toBe('none-original-file-bytes');expect(readFileSync(image)).toEqual(bytes);
  await expect(runVisualPanel({role:'spec-style-judge',system:'s',text:'t'},out,{members,call:fake})).rejects.toThrow('ALREADY_EXISTS');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
