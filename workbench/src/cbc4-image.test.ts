import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cbc4ImageToolPaths} from './cbc4-image';
test('只接收单次工具回执与隔离目录中的图片，不能冒用其他文件',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cbc-image-test-')),file=join(dir,'out.png');writeFileSync(file,'fake');
 const receipt=(path:string)=>JSON.stringify([{type:'image_gen_tool_result',status:'completed',images:[{localPath:path}]}]);
 expect(cbc4ImageToolPaths(receipt(file),dir)).toEqual([realpathSync(file)]);
 expect(()=>cbc4ImageToolPaths(receipt('/etc/hosts'),dir)).toThrow('隔离目录');
 expect(()=>cbc4ImageToolPaths(JSON.stringify([{type:'result',result:'hello'}]),dir)).toThrow('成功生图');
 expect(()=>cbc4ImageToolPaths(JSON.stringify([{type:'image_gen_tool_result',status:'completed',images:[{localPath:file},{localPath:file}]}]),dir)).toThrow('一张图片');
});
test('cbc4 生图适配器启用 dontAsk 权限限制、只接受隔离图片并持久化 auditDir 回执',async()=>{
 const {generateCbc4ReferenceImage}=await import('./cbc4-image');const {chmodSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'cbc-image-cli-')),auditDir=join(dir,'audit'),argsLog=join(dir,'args.txt'),bin=join(dir,'cbc4');
 writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' "$@" > "${argsLog}"\nprintf '\\211PNG\\r\\n\\032\\n123' > image.png\nprintf '{"type":"image_gen_tool_result","status":"completed","images":[{"localPath":"%s/image.png"}]}\\n' "$PWD"\n`);chmodSync(bin,0o755);
 const before=process.env.PIPELINE_CBC4_BIN;process.env.PIPELINE_CBC4_BIN=bin;
 try{
  const out=await generateCbc4ReferenceImage('scene',1,'hunyuan-image-v2',auditDir);
  expect(out).toHaveLength(1);expect(out[0].mime).toBe('image/png');expect(out[0].bytes.length).toBe(11);
  const argsText=readFileSync(argsLog,'utf8');
  expect(argsText).toContain('--permission-mode\ndontAsk');
  expect(argsText).toContain('--tools\nImageGen');
  expect(argsText).toContain('--allowedTools\nImageGen');
  expect(argsText).toContain('--text-to-image-model\nhunyuan-image-v2');
  const receipt=JSON.parse(readFileSync(join(auditDir,'cbc4-image-receipt.json'),'utf8'));
  expect(receipt.provider).toBe('cbc4');
  expect(receipt.requestedImageModel).toBe('hunyuan-image-v2');
  expect(receipt.imageCount).toBe(1);
  expect(typeof receipt.durationMs).toBe('number');
  expect(receipt.sha256s).toEqual([createHash('sha256').update(out[0].bytes).digest('hex')]);
  expect(generateCbc4ReferenceImage('scene',2)).rejects.toThrow('仅允许一张');
 }
 finally{if(before===undefined)delete process.env.PIPELINE_CBC4_BIN;else process.env.PIPELINE_CBC4_BIN=before;}
});
