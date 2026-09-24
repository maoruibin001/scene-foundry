import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureCodexProcess} from './codex-process';
import {validateCodexImages} from './codex-provider';
async function until(check:()=>boolean){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('子进程未在期限内就绪');await Bun.sleep(10);}}
test('输出逐步落盘且完整保留跨块中文，退出后保存终态',async()=>{
 const root=mkdtempSync(join(tmpdir(),'codex-process-test-')),prefix=join(root,'test-'),release=join(root,'continue'),controller=new AbortController();let run:any;
 try{
  run=captureCodexProcess({args:[process.execPath,'-e',`const {existsSync}=require('node:fs');process.stderr.write('已开始');process.stdout.write(new Uint8Array([228]));const timer=setInterval(()=>{if(existsSync(${JSON.stringify(release)})){clearInterval(timer);process.stdout.write(new Uint8Array([184,173]));process.stderr.write('已完成');}},10);`],cwd:root,env:{PATH:process.env.PATH!},input:'',prefix,timeoutMs:4000,signal:controller.signal});
  await until(()=>existsSync(prefix+'stdout.log')&&readFileSync(prefix+'stdout.log').length===1);expect(JSON.parse(readFileSync(prefix+'execution.json','utf8')).status).toBe('running');expect(readFileSync(prefix+'stdout.log')).toEqual(Buffer.from([228]));writeFileSync(release,'continue');
  const result=await run;expect(result.stdout).toBe('中');expect(result.stderr).toBe('已开始已完成');expect(result.trace.status).toBe('completed');expect(result.trace.exitCode).toBe(0);expect(result.trace.stdoutBytes).toBe(3);
 }finally{controller.abort();await run?.catch(()=>{});rmSync(root,{recursive:true,force:true})}
});
test('超时或取消保留日志，不能被标记为已完成',async()=>{
 const root=mkdtempSync(join(tmpdir(),'codex-process-timeout-')),controller=new AbortController();let cancelled:any;
 try{
  const args=[process.execPath,'-e',`process.stderr.write('等待响应');setTimeout(()=>{},5000)`];
  const timed=await captureCodexProcess({args,cwd:root,env:{PATH:process.env.PATH!},input:'',prefix:join(root,'timeout-'),timeoutMs:100});expect(timed.timedOut).toBe(true);expect(timed.trace.status).toBe('timed_out');expect(readFileSync(join(root,'timeout-cli.log'),'utf8')).toBe(timed.stderr);
  const prefix=join(root,'cancel-');cancelled=captureCodexProcess({args,cwd:root,env:{PATH:process.env.PATH!},input:'',prefix,timeoutMs:4000,signal:controller.signal});await until(()=>existsSync(prefix+'cli.log')&&readFileSync(prefix+'cli.log','utf8').includes('等待响应'));controller.abort();const result=await cancelled;expect(result.cancelled).toBe(true);expect(result.trace.status).toBe('cancelled');expect(result.timedOut).toBe(false);expect(result.stderr).toBe('等待响应');
 }finally{controller.abort();await cancelled?.catch(()=>{});rmSync(root,{recursive:true,force:true})}
});
test('缺失、非图片与伪造MIME在启动CLI前拒绝，保存真实内容哈希',()=>{
 const root=mkdtempSync(join(tmpdir(),'codex-input-test-')),path=join(root,'reference.png');
 try{
  expect(()=>validateCodexImages([{path,mime:'image/png'}])).toThrow('PROVIDER_INPUT_INVALID');writeFileSync(path,'not an image');expect(()=>validateCodexImages([{path,mime:'image/png'}])).toThrow('格式');
  writeFileSync(path,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XsAAAAASUVORK5CYII=','base64'));const proof=validateCodexImages([{path,mime:'image/png'}]);expect(proof[0].sha256).toHaveLength(64);expect(proof[0].bytes).toBeGreaterThan(10);expect(()=>validateCodexImages([{path,mime:'image/jpeg'}])).toThrow('格式');
 }finally{rmSync(root,{recursive:true,force:true})}
});
