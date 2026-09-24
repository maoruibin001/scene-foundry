import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bindWindowEmission} from './material-binding';
const root=resolve(process.argv[2]),generated=join(root,'game/assets/generated');
// 固定生成器仍输出旧纹理布局；在管线消费者边界转换为当前 Engine 的 shape/mips 契约。
for(const file of readdirSync(generated).filter(f=>f.endsWith('.pack.ts'))){const path=join(generated,file),source=readFileSync(path,'utf8');if(source.includes("kind: 'texture', width: source.width, height: source.height,")){const next=source.replace("kind: 'texture', width: source.width, height: source.height,","kind: 'texture', shape: {viewDimension: '2d', extent: {width: source.width, height: source.height}},").replace("data: decodeSurfaceTexture(source), colorSpace: source.colorSpace, mipmap: true,","data: decodeSurfaceTexture(source), colorSpace: source.colorSpace, mips: {kind: 'generate'},");if(next.includes('mipmap: true'))throw Error('纹理导出契约未完整转换');writeFileSync(path,next);}}
const {generateScene}=await import(pathToFileURL(join(generated,'build-scene.ts')).href);
const {projectScene}=await import(pathToFileURL(join(generated,'platform/engineBridge.ts')).href);
const scene=projectScene(await generateScene());
if(scene.materials.some((m:any)=>m.key.startsWith('windowview')))for(const file of readdirSync(generated).filter(f=>f.endsWith('.pack.ts'))){const p=join(generated,file);writeFileSync(p,bindWindowEmission(readFileSync(p,'utf8')));}
const path=join(root,'game/assets/scene-audit.json'),audit=JSON.parse(readFileSync(path,'utf8'));
audit.parts=scene.entities.filter((e:any)=>e.mesh).map((e:any)=>({id:e.name,bindingKey:e.slug}));
audit.geometry={bounds:scene.bounds,triangles:scene.triangleCount,nonFlat:scene.bounds.max.every((v:number,i:number)=>v-scene.bounds.min[i]>1)};
if(!audit.parts.length)throw Error('原生场景为空');
writeFileSync(path,JSON.stringify(audit,null,2));
console.log(JSON.stringify({parts:audit.parts.length,bindings:'exported projectScene'}));
