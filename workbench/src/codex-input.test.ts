import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexInputSize,assertCodexInputSize,CODEX_INPUT_LIMIT} from './codex-input';
import {withProviderRecovery,providerFault} from './provider-recovery';
test('大小检查包含系统正文、工具续接、协议、图片路径和包装余量',()=>{
 const kit:any={instructions:'反馈',definitions:[{name:'inspect_scene_parts'}],outputSchema:{type:'object'},continuation:()=>({text:'x'.repeat(5000),images:[{path:'/saved.png',mime:'image/png'}]})};
 const input={system:'中文规范',text:'请求',images:[{path:'/reference.jpg',mime:'image/jpeg'}],tools:kit},before=input.text;
 const size=assertCodexInputSize(input);expect(size.promptChars).toBeGreaterThan(5000);expect(size.toolChars).toBeGreaterThan(20);expect(size.imagePathChars).toBeGreaterThan(80);expect(input.text).toBe(before);
 const base=codexInputSize({system:'',text:''}).totalChars;
 expect(assertCodexInputSize({system:'',text:'x'.repeat(CODEX_INPUT_LIMIT-base)}).totalChars).toBe(CODEX_INPUT_LIMIT);
 expect(()=>assertCodexInputSize({system:'',text:'x'.repeat(CODEX_INPUT_LIMIT-base+1)})).toThrow('PROVIDER_INPUT_TOO_LARGE');
 expect(()=>assertCodexInputSize({system:'',text:'ok',tools:{...kit,continuation:()=>({text:'x'.repeat(CODEX_INPUT_LIMIT),images:[]})}})).toThrow('PROVIDER_INPUT_TOO_LARGE');
});
test('超长输入和真实接口大小错误不自动重试',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'input-preflight-'));let attempts=0;
 try{await expect(withProviderRecovery({role:'scene-refine'},dir,async()=>{attempts++;assertCodexInputSize({system:'',text:'x'.repeat(CODEX_INPUT_LIMIT)});})).rejects.toThrow('PROVIDER_INPUT_TOO_LARGE');expect(attempts).toBe(1);
 expect(providerFault('PROVIDER_CODEX_FAILED: input_too_large')).toMatchObject({kind:'input',recoverable:false});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('正常模型入口在账本与启动器之前拦截超长输入',()=>{
 const dir=mkdtempSync(join(tmpdir(),'input-ledger-')),ledger=join(dir,'ledger.json'),script=join(dir,'test.ts');mkdirSync(join(dir,'request'));
 writeFileSync(ledger,JSON.stringify({enabled:true,maxCalls:1,attempts:[]}));
 writeFileSync(script,`import {callModel} from ${JSON.stringify(join(import.meta.dirname,'provider.ts'))};try{await callModel({role:'plan',system:'测试',text:'x'.repeat(1048576),maxTokens:1},${JSON.stringify(join(dir,'request'))});process.exit(2)}catch(e){if(!String(e).includes('PROVIDER_INPUT_TOO_LARGE'))throw e;}`);
 try{const result=Bun.spawnSync([process.execPath,script],{cwd:dir,env:{...process.env,PIPELINE_PROVIDER:'codex-cli',PIPELINE_CODEX_BIN:'/no-model-may-run',PIPELINE_DATA_DIR:join(dir,'data'),PIPELINE_ACCEPTANCE_CONTROL_FILE:ledger},stdout:'pipe',stderr:'pipe'});expect(new TextDecoder().decode(result.stderr)).toBe('');expect(result.exitCode).toBe(0);expect(JSON.parse(readFileSync(ledger,'utf8')).attempts).toHaveLength(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
