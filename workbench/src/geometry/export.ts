import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
/** 将固定 Generator 的纹理描述适配到固定 Engine 契约，保留标准 PBR 材质。 */
export function adaptGeometryExport(root:string){
 const folder=join(root,'game/assets/generated'),packs=readdirSync(folder).filter(f=>f.endsWith('.pack.ts'));
 if(packs.length!==1)throw Error('导出的 Pack 不唯一');
 const pack=join(folder,packs[0]),before=readFileSync(pack,'utf8'),args=JSON.stringify(JSON.parse(readFileSync(join(root,'brief.json'),'utf8')).args);
 const texture="kind: 'texture', width: source.width, height: source.height,",mips="data: decodeSurfaceTexture(source), colorSpace: source.colorSpace, mipmap: true,",argumentLine='    const args: any[] = '+args+';';
 if(before.split(texture).length!==2||before.split(mips).length!==2||!before.includes(argumentLine))throw Error('固定 Generator 的纹理或输入契约变化');
 const closurePath=join(folder,'build-scene.ts'),closure=readFileSync(closurePath,'utf8'),signature='export async function generateScene(args = '+args+') {';
 if(!closure.includes(signature))throw Error('固定 Generator 的场景入口契约变化');
 const payload=gzipSync(Buffer.from(args),{level:6}).toString('base64');
 writeFileSync(join(folder,'scene-arguments.ts'),`const data=${JSON.stringify(payload)};\nexport async function sceneArguments(){const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());}\n`);
 const importer="import {sceneArguments} from './scene-arguments.ts';\n";
 writeFileSync(closurePath,importer+closure.replace(signature,'export async function generateScene(args?: any[]) {\n args ??= await sceneArguments();'));
 const output=importer+before.replace(argumentLine,'    const args: any[] = await sceneArguments();').replace(texture,"kind: 'texture', shape: {viewDimension: '2d', extent: {width: source.width, height: source.height}},").replace(mips,"data: decodeSurfaceTexture(source), colorSpace: source.colorSpace, mips: {kind: 'generate'},");
 writeFileSync(pack,output);
 writeFileSync(join(root,'evidence/geometry-export-adapter.json'),JSON.stringify({material:'Materials.standard',beforeSha256:hash(before),afterSha256:hash(output),adapterSha256:hash(readFileSync(join(root,'source/export-adapter.txt'))),argumentSha256:hash(args),argumentBytes:Buffer.byteLength(args),compressedBytes:Buffer.byteLength(payload)},null,2)+'\n');
}
if(import.meta.main)adaptGeometryExport(resolve(process.argv[2]));
