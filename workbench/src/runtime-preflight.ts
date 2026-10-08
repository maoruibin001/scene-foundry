import {assertStorageAvailable} from './storage-preflight';
import {spawnSync} from 'node:child_process';
import {reconstructionPython} from './runtime-paths.mjs';
import {captureBrowserExecutable} from './capture-browser.mjs';
import {assertFixedDependencies} from './dependency-preflight';
import {catalogCandidates} from './geometry/material-catalog';

/** Engine commands inherit this PATH, so validate it before any model work. */
export function assertNodeRuntime(env:NodeJS.ProcessEnv=process.env){
 const result=spawnSync('node',['-p','JSON.stringify({executable:process.execPath,version:process.version})'],{env,encoding:'utf8',timeout:5000,maxBuffer:4096});
 if(result.error||result.status!==0){
  const cause=result.error?.message??`exit=${result.status} signal=${result.signal??'none'} ${(result.stderr??'').slice(0,300)}`;
  throw Error('RUNTIME_PREFLIGHT_FAILED：ForgeaX Engine 需要后台服务 PATH 中可执行的 Node.js；未开始模型调用。'+cause);
 }
 let runtime:any;try{runtime=JSON.parse(result.stdout);}catch{throw Error('RUNTIME_PREFLIGHT_FAILED：Node.js 未返回有效的运行身份；未开始模型调用。');}
 if(typeof runtime.executable!=='string'||!runtime.executable||!/^v\d+\.\d+\.\d+/.test(runtime.version??''))throw Error('RUNTIME_PREFLIGHT_FAILED：Node.js 运行身份缺失；未开始模型调用。');
 return {version:'execution-runtime-v1',node:runtime,checkedAt:new Date().toISOString()};
}

export function assertExecutionRuntime(env:NodeJS.ProcessEnv=process.env){
 const runtime=assertNodeRuntime(env),python=reconstructionPython(env);
 const result=spawnSync(python,['-c','import json,sys,cv2,numpy,PIL;print(json.dumps({"executable":sys.executable,"version":sys.version.split()[0]}))'],{env,encoding:'utf8',timeout:10000,maxBuffer:4096});
 if(result.error||result.status!==0)throw Error('RUNTIME_PREFLIGHT_FAILED：共享数据目录的图像与录屏 Python 环境不可用；未开始模型调用。'+(result.error?.message??(result.stderr??'').slice(0,500)));
 let identity:any;try{identity=JSON.parse(result.stdout);}catch{throw Error('RUNTIME_PREFLIGHT_FAILED：Python 未返回有效运行身份；未开始模型调用。');}
 return {...runtime,python:{...identity,configuredExecutable:python},captureBrowser:captureBrowserExecutable()};
}

/** Admission and queue execution both use the same complete, model-free check. */
export function assertProductionReady(checkRuntime=assertExecutionRuntime,checkDependencies=assertFixedDependencies,checkStorage=assertStorageAvailable,checkMaterials=catalogCandidates){
 const storage=checkStorage(),runtime=checkRuntime();checkDependencies();const materials=checkMaterials();return {...runtime,storage,fixedDependenciesVerified:true,materialCatalog:materials.map(m=>({id:m.id,channels:m.channels}))};
}
