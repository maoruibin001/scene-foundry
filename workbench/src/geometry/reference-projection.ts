import {compileGeometryProgram} from './program';
import {project} from './camera-fit';
export function contentBox(box:number[],content:number[]){
 if(!validRect(box)||!validRect(content))throw Error('参考图内容区或地标坐标无效');
 if(box[0]<content[0]-.001||box[1]<content[1]-.001||box[2]>content[2]+.001||box[3]>content[3]+.001)throw Error('地标超出已记录的参考图内容区');
 return box.map((v,i)=>(v-content[i%2])/(content[i%2+2]-content[i%2]));
}
export const validRect=(r:any)=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r.every((v:number)=>v>=0&&v<=1)&&r[0]<r[2]&&r[1]<r[3];
/** 只对有明确内容裁切及实例对应的记录作几何投影，不把 AABB 当作可见轮廓。 */
export function referenceProjection(scene:any,observation:any){
 const report:any={version:'reference-projection-v1',scope:'三维完整包围投影与原图标注比较；局部遮挡不自动判错，无法确定的旧裁切不猜测。',rows:[],unverified:[]};
 if(!observation){report.unverified.push('缺少参考图观察记录');return report;}
 const compiled=compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))});
 for(const l of observation.landmarks??[]){
  const binding=scene.observedBindings?.find((b:any)=>b.landmarkId===l.id);
  if(!binding){report.unverified.push(l.id+' 缺少实例对应');continue;}
  for(const view of l.views){
   const camera=scene.cameras.find((c:any)=>c.referenceIndex===view.referenceIndex),content=observation.cameras?.find((c:any)=>c.referenceIndex===view.referenceIndex)?.contentRect;
   if(!camera||!validRect(content)){report.unverified.push(l.id+' / '+view.referenceIndex+' 缺少机位或原图内容区');continue;}
   const expected=contentBox(view.box,content),points:number[][]=[];
   for(const m of compiled.meshes.filter((m:any)=>binding.instanceIds.includes(m.entityId))){const v=m.geometry.positions;for(let k=0;k<v.length;k+=3)points.push(project(camera,v.slice(k,k+3)));}
   if(!points.length||points.some(p=>p[2]<=.1)){report.unverified.push(l.id+' / '+view.referenceIndex+' 几何缺失或穿越近裁面');continue;}
   const rect=[Infinity,Infinity,-Infinity,-Infinity];for(const p of points){rect[0]=Math.min(rect[0],p[0]);rect[1]=Math.min(rect[1],p[1]);rect[2]=Math.max(rect[2],p[0]);rect[3]=Math.max(rect[3],p[1]);}
   const observedFull=view.extent==='complete',error=Math.sqrt(rect.reduce((n,v,k)=>n+(v-expected[k])**2,0)/4),area=(r:number[])=>Math.max(0,r[2]-r[0])*Math.max(0,r[3]-r[1]);
   report.rows.push({landmarkId:l.id,referenceIndex:view.referenceIndex,expected,projected:rect,extent:view.extent??'unknown',edgeRmse:observedFull?error:null,occupancyRatio:observedFull?area(rect)/area(expected):null,status:observedFull?'measured':'occlusion-unverified',evidence:view.evidence});
  }
 }
 return report;
}
