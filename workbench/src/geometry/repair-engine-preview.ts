import {bindReferenceFrames} from './reference-framing';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ROOT,DATA,save,read,digest} from '../store';
import {renderPool} from '../concurrency';
import {prepareGeometryProject} from './prepare';
import {resolveTextureReuse} from './texture-library';
import {assertVisibilityCamera} from './visibility-evidence';
import {reservePreviewPort,previewMatches} from '../preview-endpoint';
export async function renderRepairPreview(scene:any,images:{path:string;mime:string}[],refs:string[],folder:string,signal:AbortSignal){
 scene=bindReferenceFrames(scene,images);return renderPool.use(folder,signal,async()=>{
  const authored=scene;
  const limit=AbortSignal.any([signal,AbortSignal.timeout(220000)]),base=resolve(ROOT,'..'),project=join(folder,'project'),materials=join(folder,'materials'),capture=join(folder,'capture');
  for(const p of [project,materials,capture])mkdirSync(p,{recursive:true});
  let step=0;const command=async(args:string[],cwd=project)=>{limit.throwIfAborted();const p=Bun.spawn(args,{cwd,env:{...process.env,ASSET_PIPELINE_ROOT:project,FORGEAX_SHARED_APP_INPUTS_MANIFEST:join(base,'engine/shared-build-inputs/manifest.json')},stdout:'pipe',stderr:'pipe',signal:limit});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);writeFileSync(join(folder,`command-${++step}.log`),out+err);if(code)throw Error('候选预览步骤失败 '+args[1]+'：'+err.slice(-1200));};
  save(join(materials,'texture-request.json'),{references:images,textures:scene.textures,reused:resolveTextureReuse(scene,refs)});
  await command([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/textures.py'),materials],folder);
  if(scene.voxelizationTarget){
   save(join(folder,'voxelization-input.json'),{source:scene,plan:{requirements:scene.voxelizationTarget.requirements},referenceCount:images.length,textures:read(join(materials,'texture-registry.json')),options:{resolution:scene.voxelizationTarget.resolution}});
   await command(['bun',join(ROOT,'src/voxel/convert.ts'),folder],folder);scene=read(join(folder,'voxelized-scene.json'));
  }
  prepareGeometryProject(project,scene.program,read(join(materials,'texture-registry.json')),{id:'repair-preview-'+crypto.randomUUID(),summary:'模型修正过程中的真实预览，尚未验收',scene,provenance:{validationKind:'repair-preview',sourceSceneSha256:digest(JSON.stringify(scene))}});
  await command(['bun',join(base,'prototype/bin/pipeline.ts'),'generate']);
  await command(['bun',join(ROOT,'src/geometry/export.ts'),project]);
  await command(['bun',join(ROOT,'src/sync-bindings.ts'),project]);
  await command(['bun',join(base,'prototype/bin/pipeline.ts'),'build']);
  const {port,release}=await reservePreviewPort();
  const game=join(project,'game'),url=`http://localhost:${port}/`,p=Bun.spawn(['node',join(base,'engine/packages/engine/dist/bin/forgeax.mjs'),'project','preview','--root',game,'--port',String(port),'--json'],{cwd:game,stdout:'pipe',stderr:'pipe',signal:limit});
  void p.exited.then(release,release);const expectedManifest=digest(readFileSync(join(game,'dist/forgeax-dist.json')));
  const logs=Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text()]);
  try{
   let ready=false;for(let n=0;n<80;n++){limit.throwIfAborted();if(p.exitCode!==null)break;try{if(await previewMatches(url,expectedManifest)){ready=true;break;}}catch{}await Bun.sleep(250);}
   if(!ready)throw Error('候选预览启动失败');
   await command(['node',join(ROOT,'src/geometry/repair-preview-capture.mjs'),game,url,capture]);
   const receipt=read(join(capture,'preview-capture.json'));if(receipt.frames.length!==scene.cameras.length)throw Error('候选预览缺少机位');
   receipt.sceneSha256=digest(JSON.stringify(authored));receipt.renderedSceneSha256=digest(JSON.stringify(scene));receipt.distManifestDigest=expectedManifest;receipt.voxelized=Boolean(authored.voxelizationTarget);receipt.frames=receipt.frames.map((f:any,i:number)=>{const bytes=readFileSync(join(capture,f.file));assertVisibilityCamera(scene.cameras[i],f.pose,i,bytes.readUInt32BE(16),bytes.readUInt32BE(20));return {...f,sha256:digest(bytes)};});
   if(receipt.report?.pageErrors?.length||receipt.report?.consoleErrors?.length)throw Error('候选预览出现Engine错误');
   save(join(folder,'engine-preview-receipt.json'),receipt);return receipt.frames.map((f:any)=>({type:'image' as const,mimeType:'image/png',data:readFileSync(join(capture,f.file)).toString('base64')}));
  }finally{if(p.exitCode===null)p.kill();await p.exited;writeFileSync(join(folder,'preview.log'),(await logs).join('\n'));}
 });
}
