import {join,resolve} from 'node:path';
import {ROOT,read} from './store';
import {engineRevision} from '../../prototype/bin/engine-identity';
export function assertFixedDependencies(base=resolve(ROOT,'..')){
 const pin=read(join(base,'prototype/brief.json'));
 for(const [name,expected] of [['engine',pin.engineSha],['scene-generator',pin.generatorSha]]){
  const head=engineRevision(join(base,name));
  if(head.sha!==expected)throw Error('DEPENDENCY_PREFLIGHT_FAILED：'+name+' 固定版本无法确认；在模型调用前停止。'+String(head.error??'').slice(0,300));
  if(!head.clean)throw Error('DEPENDENCY_PREFLIGHT_FAILED：'+name+' 源码偏离固定提交或无法完成校验');
 }
}
