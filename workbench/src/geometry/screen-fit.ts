import {project} from './camera-fit';
import {compileGeometryProgram} from './program';
import type {V} from './mesh';
import type {SceneInput} from './scene-contract';

export type ScreenTarget={instanceId:string;reason:string;views:{referenceIndex:number;rect:number[]}[]};
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error('图像位置约束：'+message)};
/** 模型提供可核验的二维目标，数值求解只调整地面 XY 和一致缩放；不改机位、形状或落地高度。 */
export function fitScreenTargets(source:SceneInput,targets:ScreenTarget[]){
 assert(Array.isArray(targets)&&targets.length<=8&&new Set(targets.map(t=>t.instanceId)).size===targets.length,'对象重复或超限');
 if(!targets.length)return {instances:[],reports:[]};
 const meshes=compileGeometryProgram({...source.program,materials:source.program.materials.map(m=>({...m,textureId:null}))}).meshes;
 const instances:any[]=[],reports:any[]=[];
 for(const target of targets){
  const instance=source.program.instances.find(i=>i.id===target.instanceId);
  assert(instance&&target.reason?.trim(),'未知实例或缺少依据');
  assert(!(source.spatialOpenings??[]).some(o=>o.instanceId===target.instanceId),'不能整体移动冻结开口宿主');
  assert(target.views.length>=2&&target.views.length<=6&&new Set(target.views.map(v=>v.referenceIndex)).size===target.views.length,'必须有至少两个不同参考机位');
  const cameras=target.views.map(v=>{const camera=source.cameras.find(c=>c.referenceIndex===v.referenceIndex);
   assert(camera,'未知参考机位');const r=v.rect;assert(Array.isArray(r)&&r.length===4&&r.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&r[0]<r[2]&&r[1]<r[3],'目标矩形须在去除黑边后的内容画面内');return camera!;});
  const points:number[][]=[],unique=new Set<string>();
  for(const m of meshes.filter(m=>m.entityId===target.instanceId)){const p=m.geometry.positions;for(let i=0;i<p.length;i+=3){const v=p.slice(i,i+3),key=v.join(',');if(!unique.has(key)){unique.add(key);points.push(v);}}}
  assert(points.length>0,'实例没有几何');
  const origin=instance!.position,minZ=Math.min(...points.map(p=>p[2])),floorOffset=minZ-origin[2];
  const bounds=(x:number[],view:number)=>{const pts=points.map(p=>project(cameras[view],[origin[0]+x[0]+(p[0]-origin[0])*x[2],origin[1]+x[1]+(p[1]-origin[1])*x[2],minZ+(p[2]-minZ)*x[2]]));
   if(pts.some(p=>p[2]<=.1))return null;
   return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];};
  const errors=(x:number[])=>target.views.map((v,i)=>{const r=bounds(x,i);return r?Math.sqrt(r.reduce((s,n,k)=>s+((n-v.rect[k])*(k%2?1:16/9))**2,0)/4):10;});
  const cost=(x:number[])=>errors(x).reduce((s,n)=>s+n*n,0)+.00002*(x[0]**2+x[1]**2+(x[2]-1)**2);
  const span=Math.max(...points.map(p=>Math.hypot(p[0]-origin[0],p[1]-origin[1]))),travel=Math.min(1.5,Math.max(.4,span));
  const ranges=[[-travel,travel],[-travel,travel],[.7,1.3]],before=errors([0,0,1]);let x=[0,0,1],value=cost(x),steps=[travel/2,travel/2,.1];
  for(let iteration=0;iteration<60;iteration++){let improved=false;for(let k=0;k<3;k++)for(const sign of [-1,1]){const test=[...x];test[k]=Math.max(ranges[k][0],Math.min(ranges[k][1],x[k]+sign*steps[k]));const next=cost(test);if(next<value-1e-12){x=test;value=next;improved=true;}}if(!improved)steps=steps.map(s=>s*.5);if(Math.max(...steps)<.00002)break;}
  const after=errors(x),mean=(v:number[])=>v.reduce((s,n)=>s+n,0)/v.length;
  const accepted=mean(before)>.006&&mean(after)<mean(before)*.8&&after.every((e,i)=>e<=before[i]+.003)&&Math.max(...after)<.06;
  reports.push({instanceId:target.instanceId,accepted,before,after,targets:target.views,projected:target.views.map((_,i)=>bounds(x,i)),deltaXY:x.slice(0,2),uniformScale:x[2],scope:'仅为同一固定相机下的投影误差，不是视觉质量或遮挡通过；未通过则保留原实例'});
  if(accepted)instances.push({...instance,position:[origin[0]+x[0],origin[1]+x[1],minZ-floorOffset*x[2]] as V,scale:instance!.scale.map(n=>n*x[2]) as V});
 }
 return {instances,reports};
}

/** 显式暴露贴图使用部件与 UV；未贴图并不自动判错，由原图和截图决定。 */
export function surfaceBindings(scene:SceneInput){return scene.program.materials.map(m=>({...m,parts:scene.program.templates.flatMap(t=>t.parts.filter(p=>p.material===m.id).map(p=>({templateId:t.id,partId:p.id,shape:p.shape.type,uvScale:p.uvScale??[1,1],uvTransform:p.uvTransform??null,instances:scene.program.instances.filter(i=>i.template===t.id).map(i=>({id:i.id,override:i.surfaceOverrides?.find(o=>o.sourceMaterialId===m.id)??null}))})))}));}
