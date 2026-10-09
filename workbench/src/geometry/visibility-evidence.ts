import {cameraAspect} from './reference-frame.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {DATA,ROOT,digest,save} from '../store';
import {sceneVisibility,visibilityContext} from './visibility';
import type {SceneInput} from './scene-contract';
import type {Texture} from './program';

const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function evidenceFileURL(path:string,folder:string){for(const file of [path,folder]){const local=relative(DATA,file);if(local.startsWith('..')||local.startsWith('/'))throw Error('诊断证据位于数据目录外');}return './'+relative(folder,path).split('/').map(encodeURIComponent).join('/');}

export function assertVisibilityCamera(camera:SceneInput['cameras'][number],pose:any,index:number,width:number,height:number,requireProjection=false){
 const convert=(p:number[])=>[p[0],p[2],-p[1]],same=(a:any,b:number[])=>Array.isArray(a)&&a.length===3&&a.every((v,k)=>Number.isFinite(v)&&Math.abs(v-b[k])<1e-4);
 if(pose?.selectedView!==index||!same(pose.position,convert(camera.position))||!same(pose.target,convert(camera.target))||!Number.isFinite(pose.fov)||Math.abs(pose.fov-camera.fov)>1e-5||!height||Math.abs(width/height-cameraAspect(camera))>1e-4)throw Error('可见性诊断与实际采集机位、视场或画幅不一致');
 const p=pose?.cameraProjection;if(requireProjection&&!p)throw Error('缺少实际相机投影回执');if(p){const expected=camera.projection==='orthographic'?1:0;if(p.projection!==expected)throw Error('实际相机投影与声明不一致');if(!Number.isFinite(p.near)||!Number.isFinite(p.far)||Math.abs(p.near-.1)>1e-5||Math.abs(p.far-1000)>1e-4)throw Error('实际相机裁剪范围与诊断不一致');if(expected===1){const h=camera.orthographicHeight!,a=cameraAspect(camera),checks=[[p.left,-h*a/2],[p.right,h*a/2],[p.bottom,-h/2],[p.top,h/2]];if(checks.some(([v,w])=>!Number.isFinite(v)||Math.abs(v-w)>1e-4))throw Error('实际正交相机范围与声明不一致');}else if(!Number.isFinite(p.fov)||Math.abs(p.fov-camera.fov)>1e-5||!Number.isFinite(p.aspect)||Math.abs(p.aspect-cameraAspect(camera))>1e-4)throw Error('实际透视相机视场或宽高比不一致');}

}

export function prepareVisibilityEvidence(source:SceneInput,textures:Record<string,Texture>,folder:string,sourceDir:string,runtime:any,frames:string[]){
 const started=Date.now(),report=sceneVisibility(source,textures),path=join(folder,'visibility.json');save(path,report);
 const command=Bun.spawnSync([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/visibility-map.py'),path],{stdout:'pipe',stderr:'pipe'});
 if(command.exitCode!==0)throw Error('几何诊断图绘制失败：'+new TextDecoder().decode(command.stderr).slice(-1800));
 const rendered=JSON.parse(new TextDecoder().decode(command.stdout));if(rendered.length!==report.views.length)throw Error('几何诊断机位不完整');
 const images=rendered.map((r:any,index:number)=>{
  const view=report.views[index],frame=runtime.referenceFrames?.[index];
  if(r.cameraName!==view.cameraName||r.referenceIndex!==view.referenceIndex||r.file!==`visibility-${index+1}.png`||frame?.referenceIndex!==view.referenceIndex||!frames.includes(frame.file))throw Error('几何诊断图与实际参考机位不一致');
  const actual=join(sourceDir,'runtime',frame.file),actualHash=digest(readFileSync(actual));
  if(actualHash!==runtime.hashes[runtime.images.indexOf(frame.file)])throw Error('几何诊断的实际画面摘要不一致');
  const png=readFileSync(actual);if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('实际画面不是有效PNG');
  assertVisibilityCamera(source.cameras[index],runtime.poses?.[index],index,png.readUInt32BE(16),png.readUInt32BE(20),true);
  return {...r,path:join(folder,r.file),mime:'image/png',sha256:digest(readFileSync(join(folder,r.file))),actualFrame:frame.file,actualFramePath:actual,actualFrameSha256:actualHash};
 });
 const context={...visibilityContext(report),occlusionEncoding:'front/behind 为[图中实例编号,部件ID]；身份从palette查询。遮挡本身不代表错误。',diagnosticImages:images.map(({path,mime,actualFramePath,...r}:any)=>r)};
 save(join(folder,'visibility-context.json'),context);
 save(join(folder,'visibility-receipt.json'),{method:report.method,sourceProgramSha256:digest(JSON.stringify(source.program)),sourceCamerasSha256:digest(JSON.stringify(source.cameras)),reportSha256:digest(readFileSync(path)),contextSha256:digest(JSON.stringify(context)),images:context.diagnosticImages,durationMs:Date.now()-started,modelCalls:0,quality:'not-assessed'});
 const page=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>空间可见性诊断</title><style>body{font:16px system-ui;background:#f4f5f0;color:#243d33;margin:36px;max-width:1440px}p{line-height:1.6}section{background:white;padding:24px;margin:24px 0;border-radius:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}code{font-size:13px;overflow-wrap:anywhere}a{color:#285f50}summary{cursor:pointer}@media(max-width:850px){.pair{grid-template-columns:1fr}}</style><h1>空间可见性诊断</h1><p>对照实际 Engine 画面与不透明几何编号图，定位实例、部件和前后遮挡。此图辅助修正，不是质量评分或参考图分割。</p><p>${escape(report.limitations)}</p><p><a href="visibility-context.json">查看完整定位数据</a> · <a href="visibility-receipt.json">来源与耗时回执</a></p>${images.map((im:any,index:number)=>`<section><h2>${escape(im.cameraName)}</h2><div class="pair"><div><p>原候选实际 Engine 画面</p><img src="${escape(evidenceFileURL(im.actualFramePath,folder))}" alt="实际生成画面"></div><div><p>编译几何编号图 · 数字对应下方实例</p><img src="${escape(im.file)}" alt="几何可见性诊断图"></div></div><details><summary>实例编号与可见部件</summary><table><thead><tr><th>编号</th><th>实例</th><th>几何采样占比</th><th>主要可见部件</th></tr></thead><tbody>${report.views[index].instances.map(i=>`<tr><td>${i.number}</td><td>${escape(i.label)}<br><code>${escape(i.instanceId)}</code></td><td>${(i.frameFraction*100).toFixed(2)}%</td><td>${i.visibleParts.slice(0,4).map(p=>`<code>${escape(p.partId)}</code>`).join('<br>')}</td></tr>`).join('')}</tbody></table></details></section>`).join('')}</html>`;
 writeFileSync(join(folder,'visibility.html'),page);
 return {context,images:images.map(({path,mime}:any)=>({path,mime})),pagePath:join(folder,'visibility.html')};
}
