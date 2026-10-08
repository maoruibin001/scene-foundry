import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {claimServiceLease,ServiceRestartBudget,assertServicePortsFree} from './service-supervisor';

test('全局服务锁拒绝第二个活跃协调器，退出只释放自己持有的锁',()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-service-'));try{const path=join(dir,'lease'),first=claimServiceLease(path,'candidate',12,()=>true);expect(()=>claimServiceLease(path,'other',13,()=>true)).toThrow('ALREADY_OWNED');const foreign={id:'foreign',pid:99};writeFileSync(join(path,'owner.json'),JSON.stringify(foreign));first.release();expect(JSON.parse(readFileSync(join(path,'owner.json'),'utf8'))).toEqual(foreign);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('重启后可收回已确认死亡的服务锁，不动未知所有者',()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-stale-'));try{const path=join(dir,'lease');claimServiceLease(path,'old',12,()=>true);const next=claimServiceLease(path,'new',13,()=>false);expect(next.owner.candidate).toBe('new');next.release();mkdirSync(path);expect(()=>claimServiceLease(path,'third',14,()=>false)).toThrow('OWNER_UNKNOWN');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('每个进程最多两次技术恢复；更换进程身份或正常健康事件不会重置预算',()=>{
 const budget=new ServiceRestartBudget();expect(budget.reserve('worker')).toBe(true);expect(budget.reserve('worker')).toBe(true);expect(budget.reserve('worker')).toBe(false);expect(budget.reserve('ui')).toBe(true);expect(budget.snapshot()).toEqual({worker:2,ui:1});expect(()=>new ServiceRestartBudget(3)).toThrow('上限');
});
test('同一失败指纹无新条件时提前停止，不机械耗完两次恢复',()=>{const b=new ServiceRestartBudget();expect(b.reserve('worker','same-cause')).toBe(true);expect(b.reserve('worker','same-cause')).toBe(false);expect(b.snapshot().worker).toBe(1);});
test('已有端口拒绝启动，保留原服务；释放后可正常检查',async()=>{
 const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 try{await expect(assertServicePortsFree([port])).rejects.toThrow('PORT_OCCUPIED');expect(server.listening).toBe(true);}finally{await new Promise<void>(r=>server.close(()=>r()));}
 await expect(assertServicePortsFree([port])).resolves.toBeUndefined();await expect(assertServicePortsFree([port,port])).rejects.toThrow('独立');await expect(assertServicePortsFree([80])).rejects.toThrow('端口');
});
