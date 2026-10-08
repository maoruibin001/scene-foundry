import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertNodeRuntime,assertExecutionRuntime,assertProductionReady} from './runtime-preflight';
import {pipelineDataDir,reconstructionPython} from './runtime-paths.mjs';

test('missing service Node fails immediately with executable cause',()=>{
 const dir=mkdtempSync(join(tmpdir(),'engine-runtime-empty-'));
 try{expect(()=>assertNodeRuntime({...process.env,PATH:dir})).toThrow('RUNTIME_PREFLIGHT_FAILED');expect(()=>assertNodeRuntime({...process.env,PATH:dir})).toThrow('Node.js');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('deployed Node returns its actual executable and version',()=>{
 const runtime=assertNodeRuntime();expect(runtime.node.executable).toContain('node');expect(runtime.node.version).toMatch(/^v\d+\.\d+\.\d+/);expect(Date.parse(runtime.checkedAt)).toBeGreaterThan(0);
});
test('a PATH entry that exists but cannot execute is rejected',()=>{
 const dir=mkdtempSync(join(tmpdir(),'engine-runtime-nonexec-'));writeFileSync(join(dir,'node'),'not an executable');
 try{expect(()=>assertNodeRuntime({...process.env,PATH:dir})).toThrow('RUNTIME_PREFLIGHT_FAILED');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('a broken launcher error remains actionable without leaking environment',()=>{
 const dir=mkdtempSync(join(tmpdir(),'engine-runtime-broken-'));writeFileSync(join(dir,'node'),'#!/bin/sh\necho runtime-unavailable >&2\nexit 23\n');chmodSync(join(dir,'node'),0o755);
 try{expect(()=>assertNodeRuntime({...process.env,PATH:dir,PRIVATE_TEST_VALUE:'hidden-test-value'})).toThrow('exit=23');expect(()=>assertNodeRuntime({...process.env,PATH:dir})).toThrow('runtime-unavailable');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('successful non-JSON launcher output is not accepted as runtime proof',()=>{
 const dir=mkdtempSync(join(tmpdir(),'engine-runtime-invalid-'));writeFileSync(join(dir,'node'),'#!/bin/sh\necho ready\n');chmodSync(join(dir,'node'),0o755);
 try{expect(()=>assertNodeRuntime({...process.env,PATH:dir})).toThrow('未返回有效');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('Node and Bun consumers use the same configured shared data directory',()=>{
 const env={PIPELINE_DATA_DIR:join(tmpdir(),'shared scene data')};expect(pipelineDataDir(env)).toBe(env.PIPELINE_DATA_DIR);expect(reconstructionPython(env)).toBe(join(env.PIPELINE_DATA_DIR,'reconstruction-env/bin/python'));
});
test('missing capture dependencies fail before generation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'engine-python-empty-'));
 try{expect(()=>assertExecutionRuntime({...process.env,PIPELINE_DATA_DIR:dir})).toThrow('Python 环境不可用');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('configured runtime checks real Node, image libraries and capture browser',()=>{
 const runtime=assertExecutionRuntime();expect(runtime.python.executable).toBeTruthy();expect(runtime.python.configuredExecutable).toBe(reconstructionPython());expect(runtime.captureBrowser).toBeTruthy();
});
test('完整前置检查包含固定 Engine 依赖；任何前置失败均不允许进入模型步骤',()=>{
 let paid=0,dependencyChecks=0;const launch=()=>{assertProductionReady(()=>({node:{}} as any),()=>{dependencyChecks++;throw Error('DEPENDENCY_PREFLIGHT_FAILED');});paid++;};
 expect(launch).toThrow('DEPENDENCY_PREFLIGHT_FAILED');expect(paid).toBe(0);expect(dependencyChecks).toBe(1);
 expect(assertProductionReady(()=>({node:{}} as any),()=>{dependencyChecks++;}).fixedDependenciesVerified).toBe(true);
});
