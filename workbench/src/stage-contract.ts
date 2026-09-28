import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {digest} from './store';
import {modelSchema} from './model-schema';
/** 对本地静态依赖做内容摘要；UI、报告或管线标签变更不再使所有生成缓存失效。 */
export function dependencyFingerprint(entries:string[],root=import.meta.dirname){
 const seen=new Set<string>(),rows:string[]=[];
 const visit=(file:string)=>{file=resolve(root,file);if(seen.has(file))return;seen.add(file);
  if(!existsSync(file))throw Error('缓存依赖不存在：'+file);
  const content=readFileSync(file,'utf8');rows.push(relative(root,file)+':'+digest(content));
  const imports=content.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g);
  for(const match of imports){const path=resolve(dirname(file),match[1]),target=[path,path+'.ts',path+'.mjs',path+'.js',resolve(path,'index.ts')].find(p=>existsSync(p)&&statSync(p).isFile());if(target)visit(target);}
 };entries.forEach(visit);return digest(rows.sort().join('\n'));
}
const entries:Record<string,string[]>={plan:['grounding.ts','recipe.ts','atomic-criteria.ts'],'scene-observation':['geometry/reference-observations.ts'],'scene-space':['geometry/layout-stages.ts','geometry/reference-observations.ts'],'scene-surface':['geometry/layout-stages.ts'],'scene-blockout':['geometry/blockout.ts'],'geometry-asset':['geometry/layout.ts','geometry/asset-input.ts','geometry/asset-evidence.py']};
let memo=new Map<string,string>();
export function stageContract(input:any){
 const key=JSON.stringify([input.role,input.schemaContext??null]);if(memo.has(key))return memo.get(key)!;
 const files=entries[input.role];if(!files)throw Error('此阶段没有可复用契约：'+input.role);
 const hash=digest(JSON.stringify({schema:modelSchema(input.role,input.schemaContext),sources:dependencyFingerprint(files),protocol:'validated-stage-v2'}));memo.set(key,hash);return hash;
}
