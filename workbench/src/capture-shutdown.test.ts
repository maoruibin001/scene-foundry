import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureShutdown} from './capture-shutdown.mjs';
test('并发正常关闭只清理一次',async()=>{
 let calls=0;const c=captureShutdown(async()=>{await Bun.sleep(10);calls++;});
 c.ready();await Promise.all([c.close(),c.close()]);expect(calls).toBe(1);
});
test('实际终止信号等待清理完成',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capture-shutdown-test-')),marker=join(dir,'closed'),ready=join(dir,'ready');
 const script=`import {captureShutdown} from ${JSON.stringify(join(import.meta.dirname,'capture-shutdown.mjs'))};import{writeFileSync}from'node:fs';const c=captureShutdown(async()=>{await Bun.sleep(30);writeFileSync(${JSON.stringify(marker)},'closed');});c.ready();writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
 const p=Bun.spawn([process.execPath,'--eval',script],{stdout:'pipe',stderr:'pipe'});
 try{const deadline=Date.now()+4000;while(!existsSync(ready)&&Date.now()<deadline&&p.exitCode===null)await Bun.sleep(10);expect(existsSync(ready)).toBe(true);p.kill('SIGTERM');expect(await p.exited).toBe(143);expect(readFileSync(marker,'utf8')).toBe('closed');}finally{if(p.exitCode===null){p.kill('SIGKILL');await p.exited;}rmSync(dir,{recursive:true,force:true});}
});
