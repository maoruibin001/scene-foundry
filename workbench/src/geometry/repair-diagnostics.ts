import {compileGeometryProgram} from './program';
import {surfaceAudit} from './surface-audit';

/** 在真实变换后的三角面上求垂直支承点；仅提供诊断，不代替视觉验收或自动移动几何。 */
export function supportDiagnostics(scene:any){
 const meshes=compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))}).meshes;
 const triangles:any[]=[],groups=new Map<string,number[][]>();
 for(const m of meshes){const p=m.geometry.positions,points=groups.get(m.entityId)??[];groups.set(m.entityId,points);
  for(let i=0;i<p.length;i+=3)points.push(p.slice(i,i+3));
  const ix=m.geometry.indices;for(let i=0;i<ix.length;i+=3){const [a,b,c]=ix.slice(i,i+3).map(n=>p.slice(n*3,n*3+3));
   const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)>1e-8)triangles.push({id:m.entityId,a,b,c,den});
  }
 }
 const rows=[];for(const [id,points] of groups){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  const bottoms=points.filter(p=>p[2]<=min[2]+.005),seen=new Set(),samples=[];
  for(const p of bottoms){const key=p.slice(0,2).map(n=>n.toFixed(3)).join(',');if(seen.has(key))continue;seen.add(key);samples.push(p);if(samples.length===8)break;}
  const contacts=samples.map(p=>{let support:any=null;for(const t of triangles){if(t.id===id)continue;
   const u=((t.b[1]-t.c[1])*(p[0]-t.c[0])+(t.c[0]-t.b[0])*(p[1]-t.c[1]))/t.den,v=((t.c[1]-t.a[1])*(p[0]-t.c[0])+(t.a[0]-t.c[0])*(p[1]-t.c[1]))/t.den;
   if(u<-.00001||v<-.00001||u+v>1.00001)continue;const z=u*t.a[2]+v*t.b[2]+(1-u-v)*t.c[2];
   if(z>p[2]+.03||support&&z<=support.z)continue;support={instanceId:t.id,z,gap:p[2]-z};
  }return {point:p,support};});
  rows.push({instanceId:id,min,max,baseSamples:contacts});
 }
 return {rows,scope:'Z向上，真实变换后的三角形；最多8个最低顶点向下采样。正gap为与该下方表面的垂直间距；悬挂、桥梁和背景可以合理无支承，不自动判错。画面是否悬空及屋顶拼接仍须对照参考与Engine预览。'};
}

/** 保留完整审计文件，模型只接收实际绑定、分组和最明显的异常。 */
export function compactSurfaceAudit(scene:any,textures:any){
 const audit=surfaceAudit(scene,textures),materials=scene.program.materials.map((m:any)=>{
  const rows=audit.rows.filter(r=>r.materialId===m.id),issues=[...new Set(rows.flatMap(r=>r.issues))];
  return {...m,meshCount:rows.length,textureSize:rows.find(r=>r.textureSize)?.textureSize??null,issues};
 });
 return {materials,lighting:audit.lighting,issueMeshes:audit.rows.filter(r=>r.issues.length).sort((a,b)=>(b.p95Stretch??0)-(a.p95Stretch??0)).slice(0,24),scope:audit.scope};
}
