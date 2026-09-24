import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated} from '../contracts';
import {save,read,digest,runDir,ROOT} from '../store';
import {compileGeometryProgram} from './program';
import {validateScene} from './scene-contract';
import {fitCamera,project,ray,rayScene,type Match} from './camera-fit';
import {recoverCodexOutput} from '../codex-output-recovery';
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const vector=(n:number)=>({type:'array',items:{type:'number',minimum:0,maximum:1},minItems:n,maxItems:n});
export function alignmentSchema(){return obj({version:{type:'string',enum:['camera-observations-v1']},views:{type:'array',minItems:1,maxItems:6,items:obj({referenceIndex:{type:'integer',minimum:1,maximum:6},contentRect:vector(4),points:{type:'array',maxItems:20,items:obj({label:{type:'string'},referenceUV:vector(2),renderUV:vector(2),confidence:{type:'number',minimum:0,maximum:1}})},uncertainty:{type:'string'}})}});}
export const ALIGNMENT_PROMPT=`你只做图像中的同名点观测，不修改或生成场景，不推演几何代码。全部说明使用中文。原始参考图片在前，随后是 ForgeaX Engine 生成的对应机位截图，顺序由输入标明。
对每一组原图与截图，找出同一个实际物体上的同一局部位置，例如一个窗格横竖框的交点、桌面的明确转角、柜体同一角或结构交界。每组尽可能给16个高置信度对应点，分散在左右上下、近中远和至少三个不同物体上。不要把两个不同物体的相似点配成同名点。遮挡、缺失、看不清或形态不对应的点不要猜，宁可少给。
referenceUV与renderUV均为各自整张图片的归一化坐标：左上[0,0]，右下[1,1]。选择落在实体表面内侧、离遮挡轮廓至少几个像素的明确位置，避免射线落到远处背景。label描述具体点在两图中的身份；confidence表示对应的可信程度。
contentRect=[左,上,右,下]只排除原图四周黑边和署名栏，不能裁掉场景以改善构图。没有边框则[0,0,1,1]。实际截图没有边框。不要改写需求或评价得分，不要按两幅图中位置相近来猜对应。若视角、遮挡或已有形态让足够可靠的对应无法成立，points留空并在uncertainty里说明。`;
export function validateObservations(v:any,count:number){
 const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1,vec=(x:any,n:number)=>Array.isArray(x)&&x.length===n&&x.every(finite);
 if(v?.version!=='camera-observations-v1'||!Array.isArray(v.views)||v.views.length!==count||new Set(v.views.map((x:any)=>x.referenceIndex)).size!==count)throw Error('每个参考机位必须有独立观测');
 for(const w of v.views){if(!Number.isInteger(w.referenceIndex)||w.referenceIndex<1||w.referenceIndex>count||!vec(w.contentRect,4)||w.contentRect[2]-w.contentRect[0]<.7||w.contentRect[3]-w.contentRect[1]<.7||!Array.isArray(w.points)||w.points.length>20||typeof w.uncertainty!=='string')throw Error('观测范围无效，不允许裁掉主体');
  const ids=new Set();for(const p of w.points){if(typeof p.label!=='string'||!p.label.trim()||ids.has(p.label)||!vec(p.referenceUV,2)||!vec(p.renderUV,2)||!finite(p.confidence))throw Error('对应点身份或坐标无效');ids.add(p.label);for(let k=0;k<2;k++)if(p.referenceUV[k]<w.contentRect[k]||p.referenceUV[k]>w.contentRect[k+2])throw Error('对应点在内容区外');}
 }return v;
}
function dimensions(path:string){const p=Bun.spawnSync([join(ROOT,'data/reconstruction-env/bin/python'),'-c','from PIL import Image;import sys,json;print(json.dumps(Image.open(sys.argv[1]).size))',path]);if(p.exitCode!==0)throw Error('无法读取参考图片尺寸');return JSON.parse(new TextDecoder().decode(p.stdout));}
export async function alignCameras(job:any,plan:any,images:{path:string;mime:string}[],dir:string,signal:AbortSignal){
 const sourceDir=runDir(job.reuseSceneFrom),source=read(join(sourceDir,'generated-scene.json')),runtime=read(join(sourceDir,'runtime/runtime.json')),folder=join(dir,'refinement');mkdirSync(folder,{recursive:true});
 const sha=digest(JSON.stringify(source)),refs=images.map(i=>digest(readFileSync(i.path)));if(JSON.stringify(refs)!==JSON.stringify(job.images.map((i:any)=>i.id)))throw Error('校准输入图片来源不符');
 const frames=images.map((_,i)=>{const f=runtime.referenceFrames.find((f:any)=>f.referenceIndex===i+1);if(!f||!/^reference-\d+\.png$/.test(f.file))throw Error('缺少参考机位实际画面');const path=join(sourceDir,'runtime',f.file);if(digest(readFileSync(path))!==runtime.hashes[runtime.images.indexOf(f.file)])throw Error('参考机位画面摘要不符');return {referenceIndex:i+1,file:f.file,size:dimensions(path)};});
 const input={referenceImageCount:images.length,referenceSizes:images.map(i=>dimensions(i.path)),renderFrames:frames,originalPrompt:job.prompt};
 save(join(folder,'source.json'),{sourceJobId:job.reuseSceneFrom,sourceDigest:sha,referenceSha256:refs,method:'对应点观测、实际网格射线、留出点验证的相机校准',qualityBefore:read(join(sourceDir,'quality.json'))});
 const request={role:'scene-alignment',modelSettings:job.modelSettings,signal,maxTokens:7000,images:[...images,...frames.map(f=>({path:join(sourceDir,'runtime',f.file),mime:'image/png'}))],system:ALIGNMENT_PROMPT,text:JSON.stringify(input)};
 let observed;
 if(job.recoverySourceJobId){const previous=read(join(runDir(job.recoverySourceJobId),'job.json'));if(previous.refinementMode!=='camera-alignment'||previous.reuseSceneFrom!==job.reuseSceneFrom)throw Error('恢复记录的校准来源不同');observed=recoverCodexOutput(request,join(runDir(previous.id),'generation/refinement'));validateObservations(observed.value,images.length);save(join(folder,'scene-alignment-receipt.json'),observed.receipt);save(join(folder,'recovered-from.json'),{jobId:previous.id,originalStatus:previous.status,sourceDigest:sha});}
 else observed=await callValidated(request,folder,v=>validateObservations(v,images.length));
 save(join(folder,'observations.json'),observed.value);signal.throwIfAborted();
 const meshes=compileGeometryProgram({...source.program,materials:source.program.materials.map((m:any)=>({...m,textureId:null}))}).meshes,cast=rayScene(meshes),scene=structuredClone(source),reports:any[]=[];
 for(const view of observed.value.views){
  const camera=source.cameras.find((c:any)=>c.referenceIndex===view.referenceIndex),frame=frames[view.referenceIndex-1],pose=runtime.poses.find((p:any)=>p.name===frame.file),rect=view.contentRect,size=input.referenceSizes[view.referenceIndex-1],aspect=frame.size[0]/frame.size[1],contentAspect=size[0]*(rect[2]-rect[0])/(size[1]*(rect[3]-rect[1]));
  if(!pose||pose.running||!Number.isFinite(pose.fov)||Math.hypot(...camera.position.map((v:number,k:number)=>v-[pose.position[0],-pose.position[2],pose.position[1]][k]))>.001||Math.abs(pose.fov-camera.fov)>.0001)throw Error('校准截图机位与场景来源不一致');
  const expectedDirection=ray(camera,[.5,.5]),actualTarget=[pose.target[0],-pose.target[2],pose.target[1]],actualDirection=ray({...camera,target:actualTarget},[.5,.5]);if(Math.hypot(...expectedDirection.map((v,k)=>v-actualDirection[k]))>.001)throw Error('截图的观察方向与生成机位不符');
  if(Math.abs(contentAspect/aspect-1)>.05){reports.push({referenceIndex:view.referenceIndex,accepted:false,reason:'参考内容与实际画面的宽高比不同，需要先按对应宽高比采集画面'});continue;}
  const matches:Match[]=[],rejected:any[]=[];
  for(const point of view.points){if(point.confidence<.75){rejected.push({label:point.label,reason:'对应置信度不足'});continue;}const uv=point.renderUV,hit=cast(camera.position,ray(camera,uv,aspect));if(!hit){rejected.push({label:point.label,reason:'射线没有命中实际可见网格'});continue;}
   const neighbors=[[2,0],[-2,0],[0,2],[0,-2]].map(d=>cast(camera.position,ray(camera,[uv[0]+d[0]/frame.size[0],uv[1]+d[1]/frame.size[1]],aspect)));
   if(neighbors.filter(h=>h?.meshId===hit.meshId).length<3){rejected.push({label:point.label,reason:'点位邻近遮挡轮廓，网格命中不稳定'});continue;}
   const expected=point.referenceUV.map((v:number,k:number)=>(v-rect[k])/(rect[k+2]-rect[k]));matches.push({label:point.label,point:hit.point,meshId:hit.meshId,observed:uv,expected,confidence:point.confidence});
  }
  const spread=[0,1].map(k=>Math.max(...matches.map(m=>m.expected[k]))-Math.min(...matches.map(m=>m.expected[k])));
  if(matches.length<10||spread[0]<.3||spread[1]<.2||new Set(matches.map(m=>m.meshId)).size<3){reports.push({referenceIndex:view.referenceIndex,accepted:false,reason:'可靠对应点不足或分布集中，不能可靠求解相机',matches,rejected});continue;}
  const fitted=fitCamera(camera,matches,aspect),occluded=fitted.report.rows.filter(m=>{const uv=project(fitted.camera,m.point,aspect),hit=cast(fitted.camera.position,ray(fitted.camera,uv,aspect));return !hit||Math.hypot(...hit.point.map((v,k)=>v-m.point[k]))>.04;}).length;
  const accepted=fitted.report.accepted&&occluded<=matches.length*.15;reports.push({referenceIndex:view.referenceIndex,...fitted.report,accepted,occluded,rejected,beforeCamera:camera,afterCamera:fitted.camera});if(accepted)scene.cameras[source.cameras.indexOf(camera)]=fitted.camera;
 }
 const report={method:'camera-alignment-v1',sourceJobId:job.reuseSceneFrom,sourceDigest:sha,referenceSha256:refs,quality:'not-assessed',acceptedViews:reports.filter(r=>r.accepted).length,views:reports,limitations:['固定所有几何和材质，只检验机位是否存在可测量偏差。','同名点由模型观察，留出点验证不能替代重新运行与独立视觉验收。','几何比例、缺失结构和纹理缺陷不能靠相机校准解决。']};save(join(folder,'alignment.json'),report);job.cameraAlignment=report;
 if(!report.acceptedViews)throw Error('相机校准未得到可靠收益：观测与拟合报告已保存，原场景保持不变；停止追加生成和评分');
 validateScene(scene,plan,images.length);if(digest(JSON.stringify(read(join(sourceDir,'generated-scene.json'))))!==sha)throw Error('校准期间原场景发生变化');
 const changed=reports.filter(r=>r.accepted).map(r=>r.afterCamera);save(join(folder,'patch.json'),{method:report.method,cameras:changed});save(join(folder,'scene.json'),scene);save(join(folder,'receipt.json'),{sourceJobId:job.reuseSceneFrom,sourceDigest:sha,sceneDigest:digest(JSON.stringify(scene)),unchangedTemplates:scene.program.templates.length,changedTemplates:0,addedTemplates:0,quality:'not-assessed',modelReceipt:observed.receipt});
 job.visualRefinement={method:report.method,sourceJobId:job.reuseSceneFrom,sourceScore:read(join(sourceDir,'quality.json')).score,unchangedTemplates:scene.program.templates.length,changedTemplates:0,addedTemplates:0};return scene;
}
