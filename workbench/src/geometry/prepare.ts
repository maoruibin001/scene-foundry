import {lstatSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {compileGeometryProgram,type GeometryProgram,type Texture} from './program';
import {bounds} from '../recipe';
import type {SceneInput} from './scene-contract';
import {cameraClearance,planCameraTour} from './camera-tour';
const W=resolve(import.meta.dirname,'../..'),BASE=resolve(W,'..'),P=join(BASE,'prototype'),ENGINE=join(BASE,'engine');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),save=(p:string,v:any)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');

// 独立导出入口，尚不替代工作台的默认规划、相机和验收流程。
export function prepareGeometryProject(root:string,program:GeometryProgram,textures:Record<string,Texture>={},options?:{id:string;summary:string;scene:SceneInput;provenance:any}){
 const result=compileGeometryProgram(program,textures),{min,max}=result.bounds;
 const game=join(root,'game'),source=join(root,'source'),assets=join(game,'assets');
 for(const p of [join(source,'geometry'),assets,join(game,'node_modules/@forgeax')])mkdirSync(p,{recursive:true});
 const objects=result.meshes.map(m=>{
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],v=m.geometry.positions;
  for(let n=0;n<v.length;n+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[n+k]);hi[k]=Math.max(hi[k],v[n+k]);}
  return {id:m.name,entityId:m.entityId,role:options?.scene.entities.find(e=>e.instanceId===m.entityId)?.role??'subject',position:[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,lo[2]],size:hi.map((n,k)=>Math.max(.001,n-lo[k]))};
 });
 const camera=bounds({objects}),{center:c,radius:r,height:h}=camera,pin=read(join(P,'brief.json'));
 const existing=existsSync(join(root,'brief.json'))?read(join(root,'brief.json')):null;
 const brief={...pin,id:options?.id??existing?.id??'geometry-'+randomUUID(),name:program.name,semanticBrief:options?.summary??'由统一几何操作组合的 ForgeaX 场景；本产物只验证编译和运行，不代表视觉还原通过。',entry:'generated.scene.ts',exportName:'generated',args:[{program,textures}],packageId:existing?.packageId??randomUUID(),sourceKey:'scene/generated',budget:{maxTriangles:250000,maxMaterials:128,consumerBuildMs:90000}};
 save(join(root,'brief.json'),brief);save(join(root,'geometry-program.json'),program);
 copyFileSync(join(W,'src/geometry/program.scene.txt'),join(source,'generated.scene.ts'));
 for(const f of ['mesh.ts','program.ts','constraints.ts','distribution.ts'])copyFileSync(join(W,'src/geometry',f),join(source,'geometry',f));
 copyFileSync(join(W,'src/geometry/export.ts'),join(source,'export-adapter.txt'));
 const cfg=read(join(P,'game/forge.json'));cfg.id=brief.id;cfg.name=program.name;save(join(game,'forge.json'),cfg);save(join(game,'package.json'),{name:'geometry-program-scene',private:true,type:'module',packageManager:'pnpm@11.7.0'});
 if(!lstatSync(join(game,'node_modules/@forgeax/engine'),{throwIfNoEntry:false}))symlinkSync(join(ENGINE,'packages/engine'),join(game,'node_modules/@forgeax/engine'),'dir');
 let world=readFileSync(join(P,'game/assets/world.pack.ts'),'utf8').replace('const pos=[20,10,20] as const;',`const pos=${JSON.stringify([c[0]+r/Math.sqrt(2),c[1]+h,c[2]+r/Math.sqrt(2)])} as const;`).replace('[0,5,0]',JSON.stringify(c)).replace('Micro garden recording scene','通用几何场景').replace('Micro garden authored content','组合几何');
 const toEngine=(v:number[])=>[v[0],v[2],-v[1]],clear=options?cameraClearance(result.meshes):null;
 const views=options?.scene.cameras.map(v=>{const tour=planCameraTour(v,clear!);return {...v,position:toEngine(v.position),target:toEngine(v.target),cruise:{...tour,origin:toEngine(tour.origin),displacement:toEngine(tour.displacement)}};});
 if(views)save(join(root,'camera-tours.json'),{version:'camera-tour-v1',views});
 if(options&&views){
  const v=views[0],light=options.scene.lighting;
  // 保留模板0.1米近裁面：24位深度下0.03米会使远处相邻薄层产生可见闪烁。
  world=world.replace(JSON.stringify([c[0]+r/Math.sqrt(2),c[1]+h,c[2]+r/Math.sqrt(2)]),JSON.stringify(v.position)).replace(JSON.stringify(c),JSON.stringify(v.target)).replace('fov:Math.PI/3','fov:'+v.fov).replace('far:160','far:1000');
  world=world.replace('direction:[-0.35,-0.85,-0.40],color:[1,0.94,0.82],intensity:3.2','direction:'+JSON.stringify(toEngine(light.direction))+',color:'+JSON.stringify(light.color)+',intensity:'+light.intensity).replace('color:[0.65,0.83,1],intensity:0.85','color:'+JSON.stringify(light.ambientColor)+',intensity:'+light.ambientIntensity);
  world=world.replace('Camera, DirectionalLight, Skylight, perspective','Camera, DirectionalLight, Skylight, PointLight, perspective').replace('sceneComponents:[Camera,DirectionalLight,Skylight,Name,Transform]','sceneComponents:[Camera,DirectionalLight,Skylight,PointLight,Name,Transform]').replace('ambient:{components:',light.points.map((p,i)=>'localLight'+i+':{components:{Transform:{pos:'+JSON.stringify(toEngine(p.position))+'},PointLight:'+JSON.stringify({color:p.color,intensity:p.intensity,range:p.range})+'}},').join('')+'ambient:{components:');
 }
 writeFileSync(join(assets,'world.pack.ts'),world);
 copyFileSync(join(W,'src/camera-v3.txt'),join(assets,'camera.plugin.ts'));copyFileSync(join(W,'src/ui-v3.txt'),join(assets,'ui.plugin.ts'));
 if(views){
  // 自由相机的运动算法无场景初值；所有机位来自本次生成数据。
  const controller=readFileSync(join(W,'src/native/camera.txt'),'utf8').replace("[0,1].includes(e.data.index)","Number.isInteger(e.data.index)&&e.data.index>=0&&e.data.index<audit.views.length").replace("if(input.keyboard.justPressedCode('Digit1'))view(0);if(input.keyboard.justPressedCode('Digit2'))view(1);","for(let n=0;n<audit.views.length;n++)if(input.keyboard.justPressedCode('Digit'+(n+1)))view(n);").replace("cameraControls:'free-inspection-v2'","fov:audit.views[selected].fov,motionBlockReason:motion.blockReason??null,cameraControls:'free-inspection-v2'");
  writeFileSync(join(assets,'camera.plugin.ts'),controller);copyFileSync(join(W,'src/native/camera-motion.ts'),join(assets,'camera-motion.ts'));
  let ui=readFileSync(join(W,'src/ui-v3.txt'),'utf8').replace('Space 巡航/暂停 · 方向键移动 · H 隐藏/恢复 · R 开始/停止录屏','WASD 移动 · Q/E 升降 · 拖动转向 · 数字键选择机位 · Space 连续观测 · H 隐藏 · R 录屏');
  ui=ui.replace('const hud=document.createElement',"const motionStatus=document.createElement('div');motionStatus.setAttribute('role','status');const hud=document.createElement").replace('hud.append(help);','hud.append(help,motionStatus);').replace('sources.add(e.data.sourceId);',"sources.add(e.data.sourceId);motionStatus.textContent=e.data.motionBlockReason??'';");
  ui=ui.replace('const record=document.createElement',`for(const [index,v] of audit.views.entries()){const b=document.createElement('button');b.textContent=v.name;b.style.cssText='margin:8px 4px;padding:5px 9px;cursor:pointer';b.onclick=()=>{channel.postMessage({action:'view',index});const canvas=document.querySelector('canvas');if(canvas){canvas.tabIndex=0;canvas.focus();}};hud.append(b);}hud.append(document.createElement('br'));const record=document.createElement`);
  ui=ui.replace('const keys=(e:KeyboardEvent)=>{',"const keys=(e:KeyboardEvent)=>{if(e.target instanceof HTMLCanvasElement&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();");
  ui=ui.replace('return()=>{channel.close();',"const focus=(e:PointerEvent)=>{if(e.target instanceof HTMLCanvasElement){e.target.tabIndex=0;e.target.focus();}};document.addEventListener('pointerdown',focus);return()=>{document.removeEventListener('pointerdown',focus);channel.close();");writeFileSync(join(assets,'ui.plugin.ts'),ui);
 }
 const provenance=options?{kind:'general-scene-generation',validationKind:'generation',...options.provenance}:{kind:'generic-geometry-compiler',validationKind:'compiler-smoke',referenceImages:[]};
 save(join(assets,'scene-audit.json'),{name:program.name,channelId:brief.packageId,specSha256:createHash('sha256').update(readFileSync(join(W,'spec/production.md'))).digest('hex'),camera,...(views?{views}:{}),parts:objects.map(o=>({id:o.id,entityId:o.entityId})),entities:program.instances,landmarks:objects.map(o=>({...o,position:[o.position[0],o.position[2]+o.size[2]/2,-o.position[1]]})),geometry:{nonFlat:max.every((v,i)=>v-min[i]>.1)},provenance:{...provenance,engineSha:pin.engineSha,generatorSha:pin.generatorSha,qualityAssessment:'not-run'}});
 return {brief,objects,meshes:result.meshes.length,triangles:result.triangles,materials:result.materialCount,bounds:{min,max}};
}
