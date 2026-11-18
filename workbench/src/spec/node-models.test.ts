import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CBC4_MODELS,validateNodeModels,nodeCacheHash,parseCbcResult} from './node-models';
test('每个实际模型节点独立冻结配置，支持 hy4-preview-ioa / hy4std 与 medium 推理强度，禁止未知节点与模型冒充',()=>{
 expect(CBC4_MODELS).toEqual(['hy4-preview-ioa','hy4std']);
 expect(validateNodeModels({styleReview:{provider:'codex',model:'gpt-6-luna',reasoningEffort:'medium'}}).styleReview.reasoningEffort).toBe('medium');
 const nodes=validateNodeModels({
  families:{provider:'cbc4',model:'hy4-preview-ioa',reasoningEffort:'high'},
  staging:{provider:'cbc4',model:'hy4std',reasoningEffort:'medium'},
 });
 expect(nodes.families.provider).toBe('cbc4');
 expect(nodes.staging).toEqual({provider:'cbc4',model:'hy4std',reasoningEffort:'medium'});
 expect(nodes.objects.provider).toBe('claude10');
 expect(()=>validateNodeModels({unknown:{}})).toThrow('未知模型节点');
 expect(()=>validateNodeModels({families:{provider:'cbc4',model:'other',reasoningEffort:'high'}})).toThrow('cbc4');
 expect(()=>validateNodeModels({families:{provider:'cbc4',model:'hy4std',reasoningEffort:'low'}})).toThrow('模型配置无效');
 expect(()=>validateNodeModels({families:{provider:'claude10',model:'claude-opus-5-5',reasoningEffort:'medium'}})).toThrow('模型配置无效');
 expect(()=>validateNodeModels({families:{provider:'codex',model:'gpt-5.4',reasoningEffort:'medium'}})).toThrow('模型配置无效');
});
test('缓存包含模型配置及图片实际内容',()=>{
 const p=join(mkdtempSync(join(tmpdir(),'spec-nodes-')),'x.png');writeFileSync(p,'one');
 const a=validateNodeModels(null).families,b={provider:'cbc4' as const,model:'hy4-preview-ioa',reasoningEffort:'high'};
 const hash=(m:any)=>nodeCacheHash('t',{},'d',{},m,[{path:p,mime:'image/png'}]);
 const first=hash(a);expect(hash(b)).not.toBe(first);writeFileSync(p,'two');expect(hash(a)).not.toBe(first);
});
test('cbc4 需结构化结果（含 result JSON 字符串回退）且有模型回显时必须精确匹配',()=>{
 const good=JSON.stringify({type:'result',subtype:'success',modelUsage:{'hy4-preview-ioa':{}},structured_output:{ok:true}});
 expect(JSON.parse(parseCbcResult(good,'hy4-preview-ioa').text)).toEqual({ok:true});
 expect(()=>parseCbcResult(good,'other')).toThrow('MODEL_ROUTE_UNVERIFIED');
 expect(()=>parseCbcResult(good,'hy4std')).toThrow('MODEL_ROUTE_UNVERIFIED');
 expect(parseCbcResult(JSON.stringify({type:'result',subtype:'success',structured_output:{ok:true}}),'hy4-preview-ioa').receipt.returnedModel).toBeNull();
 const fallback=JSON.stringify({type:'result',subtype:'success',modelUsage:{hy4std:{}},result:'  {"ok":true,"mode":"fallback"}  '});
 const parsedFallback=parseCbcResult(fallback,'hy4std');
 expect(JSON.parse(parsedFallback.text)).toEqual({ok:true,mode:'fallback'});
 expect(parsedFallback.receipt.returnedModel).toBe('hy4std');
 expect(()=>parseCbcResult(JSON.stringify({type:'result',subtype:'success',result:'not json'}),'hy4std')).toThrow('CBC4_INVALID_OUTPUT：缺少结构化结果');
 expect(()=>parseCbcResult(JSON.stringify({type:'result',subtype:'success',result:'[1,2,3]'}),'hy4std')).toThrow('CBC4_INVALID_OUTPUT：缺少结构化结果');
});
test('cbc5 视觉节点的启动器回执短名按显式别名接受，未知模型仍拒绝',()=>{
 const receipt=JSON.stringify({type:'result',subtype:'success',modelUsage:{hy4flash:{}},structured_output:{ok:true}});
 const parsed=parseCbcResult(receipt,'hy4flash-dev');
 expect(JSON.parse(parsed.text)).toEqual({ok:true});
 expect(parsed.receipt.returnedModel).toBe('hy4flash');
 expect(()=>parseCbcResult(receipt,'hy4-preview-ioa')).toThrow('MODEL_ROUTE_UNVERIFIED');
 expect(()=>parseCbcResult(receipt,'hy4std')).toThrow('MODEL_ROUTE_UNVERIFIED');
});
test('cbc4 节点通过受限 CLI（dontAsk）传递图像、所选模型并保存输入与路由回执',async()=>{
 const {callSpecNode}=await import('./node-models');
 const dir=mkdtempSync(join(tmpdir(),'cbc-node-')),bin=join(dir,'cbc4-fake'),img=join(dir,'ref.png');
 const {chmodSync,readFileSync}=await import('node:fs');
 writeFileSync(img,Buffer.from([137,80,78,71,13,10,26,10,1,2,3]));
 writeFileSync(bin,`#!/bin/sh\ntest -f spec-families-input-receipt.json || exit 42\nprintf '%s\\n' "$@" > args.txt\ncat > input.jsonl\nprintf '%s\\n' '{"type":"result","subtype":"success","modelUsage":{"hy4std":{}},"result":"{\\"ok\\":true}"}'\n`);chmodSync(bin,0o755);
 const before=process.env.PIPELINE_CBC4_BIN;process.env.PIPELINE_CBC4_BIN=bin;
 try{const r=await callSpecNode({role:'spec-families',system:'system',text:'task',images:[{path:img,mime:'image/png'}]},dir,{provider:'cbc4',model:'hy4std',reasoningEffort:'medium'},{type:'object'});
  expect(JSON.parse(r.text)).toEqual({ok:true});expect(r.receipt.returnedModel).toBe('hy4std');
  const argsText=readFileSync(join(dir,'args.txt'),'utf8');
  expect(argsText).toContain('--permission-mode\ndontAsk');
  expect(argsText).toContain('--strict-mcp-config');
  expect(argsText).toContain('--tools\nStructuredOutput');
  expect(argsText).toContain('--allowedTools\nStructuredOutput');
  expect(argsText).toContain('--model\nhy4std');
  expect(argsText).toContain('--effort\nmedium');
  expect(JSON.parse(readFileSync(join(dir,'input.jsonl'),'utf8')).message.content[0].source.media_type).toBe('image/png');
  expect(existsSync(join(dir,'spec-families-input-receipt.json'))).toBe(true);
  const inputReceipt=JSON.parse(readFileSync(join(dir,'spec-families-input-receipt.json'),'utf8'));
  expect(inputReceipt.model).toBe('hy4std');
  expect(inputReceipt.imageCount).toBe(1);
  const routeReceipt=JSON.parse(readFileSync(join(dir,'spec-families-route.json'),'utf8'));
  expect(routeReceipt.executable).toBe(bin);
  expect(routeReceipt.role).toBe('spec-families');
  expect(routeReceipt.imageCount).toBe(1);
  expect(routeReceipt.returnedModel).toBe('hy4std');
  expect(typeof routeReceipt.durationMs).toBe('number');
 }finally{if(before===undefined)delete process.env.PIPELINE_CBC4_BIN;else process.env.PIPELINE_CBC4_BIN=before;}
});
