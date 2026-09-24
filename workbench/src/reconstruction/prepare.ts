import {lstatSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,symlinkSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const W=resolve(import.meta.dirname,'../..'),BASE=resolve(W,'..'),P=join(BASE,'prototype'),ENGINE=join(BASE,'engine');
const read=(f:string)=>JSON.parse(readFileSync(f,'utf8')),save=(f:string,v:any)=>writeFileSync(f,JSON.stringify(v,null,2)+'\n');
const sha=(f:string)=>createHash('sha256').update(readFileSync(f)).digest('hex');
const toEngine=(p:number[])=>[p[0],p[2],-p[1]];

// 实验入口：只验证统一参考图重建与当前 Engine 的兼容性，不写入生产通过率。
export function prepareReferenceProject(root:string,reconstruction:string){
 const scene=read(join(reconstruction,'reconstruction-scene.json')),receipt=read(join(reconstruction,'reconstruction-receipt.json'));
 if(scene.version!=='reference-mesh-v1'||!scene.meshes?.length||!scene.views?.length||scene.views.length>4)throw Error('重建数据契约无效');
 const game=join(root,'game'),source=join(root,'source'),assets=join(game,'assets');
 for(const path of [source,assets,join(game,'node_modules/@forgeax')])mkdirSync(path,{recursive:true});
 const pin=read(join(P,'brief.json')),views=scene.views.map((v:any)=>({...v,position:toEngine(v.position),target:toEngine(v.target),up:toEngine(v.up)}));
 const brief={...pin,id:'reference-'+randomUUID(),name:'参考图空间重建 · 实验',semanticBrief:'由统一多图深度模型估计共同空间；可见表面使用参考图颜色，遮挡区域未补全，尚未经过完整场景质量验收。',entry:'reference.scene.ts',exportName:'reconstructed',args:[{scene}],packageId:randomUUID(),sourceKey:'scene/reference-reconstruction',budget:{maxTriangles:250000,maxMaterials:128,consumerBuildMs:90000}};
 save(join(root,'brief.json'),brief);save(join(root,'reconstruction-receipt.json'),receipt);
 copyFileSync(join(W,'src/reconstruction/reference.scene.txt'),join(source,'reference.scene.ts'));
 // 导出适配器参与生成摘要，生成后才替换材质构造方式；不改 Engine 或 Generator。
 copyFileSync(join(W,'src/reconstruction/prepare.ts'),join(source,'export-adapter.txt'));
 const cfg=read(join(P,'game/forge.json'));cfg.id=brief.id;cfg.name=brief.name;save(join(game,'forge.json'),cfg);save(join(game,'package.json'),{name:'reference-reconstruction',private:true,type:'module',packageManager:'pnpm@11.7.0'});
 if(!lstatSync(join(game,'node_modules/@forgeax/engine'),{throwIfNoEntry:false}))symlinkSync(join(ENGINE,'packages/engine'),join(game,'node_modules/@forgeax/engine'),'dir');
 const v=views[0];
 let world=readFileSync(join(P,'game/assets/world.pack.ts'),'utf8')
  .replace('const pos=[20,10,20] as const;',`const pos=${JSON.stringify(v.position)} as const;`)
  .replace('[0,5,0]',JSON.stringify(v.target)).replace('[0,1,0]',JSON.stringify(v.up))
  .replace('fov:Math.PI/3,aspect:16/9,near:0.1,far:160',`fov:${v.fov},aspect:${v.projectionAspect},autoAspect:false,near:0.01,far:1000`)
  .replace('clearColor:[0.06,0.10,0.13,1]','clearColor:[0.08,0.08,0.08,1]')
  .replace('Micro garden recording scene',brief.name).replace('Micro garden authored content','参考图重建表面');
 writeFileSync(join(assets,'world.pack.ts'),world);
 let camera=readFileSync(join(W,'src/native/camera.txt'),'utf8')
  .replace('let selected=0,','let viewportAspect=audit.views[0].width/audit.views[0].height;let selected=0,')
  .replace("channel.onmessage=e=>{if(e.data?.action==='view'&&[0,1].includes(e.data.index))view(e.data.index);};", "channel.onmessage=e=>{if(e.data?.action==='view'&&Number.isInteger(e.data.index)&&e.data.index>=0&&e.data.index<audit.views.length)view(e.data.index);if(e.data?.action==='viewport'&&Number.isFinite(e.data.aspect)&&e.data.aspect>0)viewportAspect=e.data.aspect;};")
  .replace("if(input.keyboard.justPressedCode('Digit1'))view(0);if(input.keyboard.justPressedCode('Digit2'))view(1);", "for(let i=0;i<audit.views.length;i++)if(input.keyboard.justPressedCode('Digit'+(i+1)))view(i);")
  .replace('pos,target,[0,1,0]','pos,target,audit.views[selected].up')
  .replace('ctx.world.set(camera,Camera,{fov:audit.views[selected].fov})','ctx.world.set(camera,Camera,{fov:audit.views[selected].fov,autoAspect:false,aspect:viewportAspect*audit.views[selected].projectionAspect/(audit.views[selected].width/audit.views[selected].height)})');
 writeFileSync(join(assets,'camera.plugin.ts'),camera);
 copyFileSync(join(W,'src/native/camera-motion.ts'),join(assets,'camera-motion.ts'));
 let ui=readFileSync(join(W,'src/ui-v3.txt'),'utf8')
  .replace('Space 巡航/暂停 · 方向键移动 · H 隐藏/恢复 · R 开始/停止录屏','重建实验：未见区域未补全 · WASD 移动 · Q/E 升降 · 拖动转向 · 数字键复位 · Space 巡航 · H 隐藏')
  .replace('const record=document.createElement',`for(const [index,v] of audit.views.entries()){const button=document.createElement('button');button.textContent=v.name;button.style.cssText='margin:8px 4px;padding:5px 9px;cursor:pointer';button.onclick=()=>{channel.postMessage({action:'view',index});const canvas=document.querySelector('canvas');if(canvas){canvas.tabIndex=0;canvas.focus();}};hud.append(button);}hud.append(document.createElement('br'));const record=document.createElement`)
  .replace('return()=>{channel.close();',`const aspectTimer=setInterval(()=>{const canvas=document.querySelector('canvas');if(canvas&&canvas.clientHeight)channel.postMessage({action:'viewport',aspect:canvas.clientWidth/canvas.clientHeight});},500);const focus=(e:PointerEvent)=>{if(e.target instanceof HTMLCanvasElement){e.target.tabIndex=0;e.target.focus();}};document.addEventListener('pointerdown',focus);return()=>{clearInterval(aspectTimer);document.removeEventListener('pointerdown',focus);channel.close();`);
 writeFileSync(join(assets,'ui.plugin.ts'),ui);
 save(join(assets,'scene-audit.json'),{name:brief.name,channelId:brief.packageId,specSha256:sha(join(W,'spec/production.md')),views,parts:scene.meshes.map((m:any)=>({id:m.name})),provenance:{kind:'reference-reconstruction-experiment',validationKind:'diagnostic',engineSha:pin.engineSha,generatorSha:pin.generatorSha,reconstruction:receipt,sceneSha256:sha(join(reconstruction,'reconstruction-scene.json')),qualityAssessment:'not-run',limitations:scene.limitations}});
 return {id:brief.id,meshes:scene.meshes.length,views:views.length,validationKind:'diagnostic'};
}

export function applyBakedAppearance(root:string){
 const dir=join(root,'game/assets/generated'),files=readdirSync(dir).filter(f=>f.endsWith('.pack.ts'));
 if(files.length!==1)throw Error('无法唯一定位当前导出的 Pack');
 const file=join(dir,files[0]),before=readFileSync(file,'utf8'),token='Materials.standard({';
 if(before.split(token).length!==2)throw Error('固定 Generator 的材质输出契约变化，停止适配');
 const textureToken="kind: 'texture', width: source.width, height: source.height,",mipToken="data: decodeSurfaceTexture(source), colorSpace: source.colorSpace, mipmap: true,";
 if(before.split(textureToken).length!==2||before.split(mipToken).length!==2)throw Error('固定 Generator 的纹理输出契约变化，停止适配');
 const helper=`\n// 原图颜色已包含拍摄光照，避免在 Engine 中重复打光。\nfunction referenceColorMaterial(opts:any){return Materials.unlit(opts.baseColor,{baseColorTexture:opts.baseColorTexture,castShadow:false,renderState:{cullMode:'back'}});}\n`;
 const args=JSON.stringify(read(join(root,'brief.json')).args),argumentLine='    const args: any[] = '+args+';';
 if(!before.includes(argumentLine))throw Error('固定 Generator 的输入绑定契约变化，停止适配');
 const closurePath=join(dir,'build-scene.ts'),closure=readFileSync(closurePath,'utf8'),defaultLine='export async function generateScene(args = '+args+') {';
 if(!closure.includes(defaultLine))throw Error('固定 Generator 的默认输入契约变化，停止适配');
 // 大数组不展开成数十万个 JS 语法节点。压缩仅改变传输，解码后仍是同一份输入。
 const payload=gzipSync(Buffer.from(args),{level:6}).toString('base64');
 writeFileSync(join(dir,'reference-arguments.ts'),`const encoded=${JSON.stringify(payload)};\nexport async function referenceArguments(){const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());}\n`);
 const importArgs="import {referenceArguments} from './reference-arguments.ts';\n";
 writeFileSync(closurePath,importArgs+closure.replace(defaultLine,'export async function generateScene(args?: any[]) {\n  args ??= await referenceArguments();'));
 const output=importArgs+before.replace(argumentLine,'    const args: any[] = await referenceArguments();').replace(token,'referenceColorMaterial({')
  .replace(textureToken,"kind: 'texture', shape: {viewDimension: '2d', extent: {width: source.width, height: source.height}},")
  .replace(mipToken,"data: decodeSurfaceTexture(source), colorSpace: source.colorSpace, mips: {kind: 'generate'},")+helper;
 writeFileSync(file,output);
 save(join(root,'evidence/reference-material-adapter.json'),{method:'当前 Engine 的 Materials.unlit',source:files[0],beforeSha256:createHash('sha256').update(before).digest('hex'),afterSha256:sha(file),adapterSha256:sha(join(root,'source/export-adapter.txt')),argumentSha256:createHash('sha256').update(args).digest('hex'),argumentBytes:Buffer.byteLength(args),compressedBytes:Buffer.byteLength(payload),appearance:'参考图表面颜色，包含原始光照',qualityAssessment:'not-run'});
}

if(import.meta.main){const [operation,root,data]=process.argv.slice(2);if(operation==='prepare')console.log(JSON.stringify(prepareReferenceProject(resolve(root),resolve(data))));else if(operation==='appearance')applyBakedAppearance(resolve(root));else throw Error('使用 prepare <project> <reconstruction> 或 appearance <project>');}
