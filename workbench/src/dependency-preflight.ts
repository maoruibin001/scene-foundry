import {join,resolve} from 'node:path';
import {ROOT,read} from './store';
import {engineRevision} from '../../prototype/bin/engine-identity';
/** spec-pack 场景由 workbench 生成器库自足，只需校验 Engine 固定版本；
 * 不要求私有 scene-generator 仓库存在（那是普通程序化场景生成路径的依赖）。 */
export function assertSpecPackDependencies(base=resolve(ROOT,'..')){
 const pin=read(join(base,'prototype/brief.json'));
 const head=engineRevision(join(base,'engine'));
 if(head.sha!==pin.engineSha)throw Error('DEPENDENCY_PREFLIGHT_FAILED：engine 固定版本无法确认；在模型调用前停止。'+String(head.error??'').slice(0,300));
 if(!head.clean)throw Error('DEPENDENCY_PREFLIGHT_FAILED：engine 源码偏离固定提交或无法完成校验');
}

export function assertFixedDependencies(base=resolve(ROOT,'..')){
 const pin=read(join(base,'prototype/brief.json'));
 for(const [name,expected] of [['engine',pin.engineSha],['scene-generator',pin.generatorSha]]){
  const head=engineRevision(join(base,name));
  if(head.sha!==expected)throw Error('DEPENDENCY_PREFLIGHT_FAILED：'+name+' 固定版本无法确认；在模型调用前停止。'+String(head.error??'').slice(0,300));
  if(!head.clean)throw Error('DEPENDENCY_PREFLIGHT_FAILED：'+name+' 源码偏离固定提交或无法完成校验');
 }
}
