import {test,expect} from 'bun:test';
import {routeFromConfig,routeArguments,routeSummary,routeForSelection,assertLauncherUnchanged} from './codex-route';
import {cliReceipt} from './codex-provider';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const definition={name:'本地测试',base_url:'https://example.invalid/v1',env_key:'PROBE_API_KEY',wire_api:'responses',requires_openai_auth:false};
test('启动器供应商配置显式传给exec，公开回执不包含端点和凭证变量',()=>{
 const route=routeFromConfig({model_provider:'fixture',model_providers:{fixture:definition}},'a'.repeat(64));
 expect(routeArguments(route)).toContain('model_provider="fixture"');
 expect(routeArguments(route)).toContain('model_providers.fixture.requires_openai_auth=false');
 expect(routeArguments(route)).toContain('model_providers.fixture.env_key="PROBE_API_KEY"');
 const published=JSON.stringify(routeSummary(route));expect(published).not.toContain('example.invalid');expect(published).not.toContain('PROBE_API_KEY');
 expect(routeSummary(route).authentication).toBe('launcher-provider');
 const changed=routeFromConfig({model_provider:'fixture',model_providers:{fixture:{...definition,base_url:'https://other.invalid'}}},route.launcherSha256);
 expect(changed.configurationSha256).not.toBe(route.configurationSha256);
});
test('不隐式回退，拒绝不完整供应商定义和内联认证',()=>{
 expect(()=>routeFromConfig({model_provider:'missing'},'a')).toThrow();
 expect(()=>routeFromConfig({model_provider:'bad.id'},'a')).toThrow();
 for(const extra of [{experimental_bearer_token:'secret'},{auth:{command:'token'}},{http_headers:{Authorization:'secret'}}])expect(()=>routeFromConfig({model_provider:'fixture',model_providers:{fixture:{...definition,...extra}}},'a')).toThrow('不复制内联凭证');
 expect(routeArguments(routeFromConfig({model_provider:'openai'},'a'))).toEqual(['-c','model_provider="openai"']);
});
test('CLI回执必须匹配供应商和模型，旧订阅回执仍按openai验证',()=>{
 const log='OpenAI Codex v0.156.1\nmodel: fixture-astra\nprovider: fixture\nreasoning effort: xhigh';
 expect(cliReceipt(log,'fixture-astra','xhigh','fixture').cliProvider).toBe('fixture');
 expect(()=>cliReceipt(log,'fixture-astra','xhigh')).toThrow('MODEL_ROUTE_UNVERIFIED');
 expect(()=>cliReceipt(log.replace('fixture\nreasoning','openai\nreasoning'),'fixture-astra','xhigh','fixture')).toThrow();
});
test('启动器变化时停止调用，不能沿用旧版本身份',()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-route-test-')),file=join(dir,'launcher');writeFileSync(file,'first');
 try{const route=routeFromConfig({},createHash('sha256').update('first').digest('hex'));expect(()=>assertLauncherUnchanged(file,route)).not.toThrow();writeFileSync(file,'second');expect(()=>assertLauncherUnchanged(file,route)).toThrow('CODEX_ROUTE_CHANGED');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('新任务使用启动器模型，旧订阅模型保持原供应商且不污染默认路由',()=>{
 const route=routeFromConfig({model_provider:'fixture',model_providers:{fixture:definition}},'a');
 expect(routeForSelection(route,'astra-custom','astra-custom')).toBe(route);
 expect(routeForSelection(route,'astra-custom','gpt-6-astra')?.providerId).toBe('openai');
 expect(routeForSelection(route,'astra-custom')?.providerId).toBe('fixture');
 expect(routeForSelection(undefined,'astra-custom','gpt-6-astra')).toBeUndefined();
});
