import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {ROOT,read} from './store';
export function assertFixedDependencies(base=resolve(ROOT,'..')){
 const pin=read(join(base,'prototype/brief.json'));
 for(const [name,expected] of [['engine',pin.engineSha],['scene-generator',pin.generatorSha]]){
  const cwd=join(base,name),head=spawnSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8',timeout:5000,maxBuffer:4096});
  if(head.error||head.status!==0||head.stdout.trim()!==expected)throw Error('DEPENDENCY_PREFLIGHT_FAILED：'+name+' 固定版本无法确认；在模型调用前停止。'+String(head.error?.message??head.stderr??'').slice(0,300));
  const dirty=spawnSync('git',['diff','--quiet','HEAD'],{cwd,timeout:5000});if(dirty.status!==0)throw Error('DEPENDENCY_PREFLIGHT_FAILED：'+name+' 源码偏离固定提交或无法完成校验');
 }
}
