import {compileGeometryProgram} from './program';
import {project} from './camera-fit';

export const RELATION_INSTANCE_SCALE='relation-instance-scale-v1';
export const RELATION_INSTANCE_SCALE_PROMPT='relationInstanceScale逐实例列出未通过关系所绑定实例的世界尺寸、参考机位深度和完整投影框（不受遮挡影响，frameCut表示超出画幅）。地标观察框是整组实例的并集，看不出组内近中远是否逐段变化；flags指出同一地标同模板实例：uniformHeight为不同深度世界高度几乎相同，contiguous为相邻实例几何相接成连续体块，fartherNotSmaller为更远且未截断的实例投影不比更近的小。关系描述近大远小、逐段缩小、层叠递退时，先按原图逐个调整这些实例的scale与position（缩小远处实例、拉开间距或错落高度），再考虑重建组或扩大bounds；共享模板改动影响全部实例，不能代替逐实例尺度。这只是几何定位证据，不是评分或通过条件。';
const round=(n:number)=>+n.toFixed(4);

/** Per-instance size of the landmarks a failed relation binds: the union observation box cannot show a group's near-to-far steps. */
export function relationInstanceScale(scene:any,observation:any,review:any){
 const failed=(review?.relations??[]).filter((r:any)=>Number.isFinite(r.score)&&r.score<3);
 const relations=failed.map((r:any)=>({review:r,relation:(observation?.relations??[]).find((o:any)=>o.id===r.id)})).filter((x:any)=>x.relation?.landmarkIds?.length);
 if(!relations.length)return null;
 const compiled=compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))});
 const points=new Map<string,number[][]>();
 for(const mesh of compiled.meshes){const id=mesh.name.split('__')[0],list=points.get(id)??[],p=mesh.geometry.positions;for(let i=0;i<p.length;i+=3)list.push([p[i],p[i+1],p[i+2]]);points.set(id,list);}
 const world=(id:string)=>{const list=points.get(id)??[];if(!list.length)return null;return [0,1,2].map(k=>[Math.min(...list.map(p=>p[k])),Math.max(...list.map(p=>p[k]))]);};
 const gap=(a:number[][],b:number[][])=>Math.max(...[0,1,2].map(k=>Math.max(a[k][0]-b[k][1],b[k][0]-a[k][1])));
 return {version:RELATION_INSTANCE_SCALE,quality:'not-assessed',relations:relations.map(({review:r,relation}:any)=>{
  const bound=relation.landmarkIds.flatMap((landmarkId:string)=>(scene.observedBindings?.find((b:any)=>b.landmarkId===landmarkId)?.instanceIds??[]).map((instanceId:string)=>({landmarkId,instance:scene.program.instances.find((i:any)=>i.id===instanceId)}))).filter((x:any)=>x.instance&&world(x.instance.id));
  const indices=[...new Set<number>((observation.landmarks??[]).filter((l:any)=>relation.landmarkIds.includes(l.id)).flatMap((l:any)=>(l.views??[]).map((v:any)=>v.referenceIndex)))].sort();
  const views=indices.map(referenceIndex=>{const camera=scene.cameras.find((c:any)=>c.referenceIndex===referenceIndex);if(!camera)return null;
   const instances=bound.map(({landmarkId,instance}:any)=>{const box=world(instance.id)!,uv=(points.get(instance.id)??[]).map(p=>project(camera,p)),ahead=uv.filter(p=>p[2]>.1);
    const rect=ahead.length?[Math.min(...ahead.map(p=>p[0])),Math.min(...ahead.map(p=>p[1])),Math.max(...ahead.map(p=>p[0])),Math.max(...ahead.map(p=>p[1]))]:null;
    return {instanceId:instance.id,landmarkId,templateId:instance.template,scale:instance.scale,worldSize:box.map(([a,b])=>round(b-a)),box,
     depth:round(project(camera,box.map(([a,b])=>(a+b)/2))[2]),projected:rect?.map(round)??null,projectedHeight:rect?round(rect[3]-rect[1]):null,
     frameCut:!rect||ahead.length<uv.length||rect[0]<0||rect[1]<0||rect[2]>1||rect[3]>1};});
   const flags:any[]=[];
   for(const landmarkId of relation.landmarkIds)for(const templateId of new Set(instances.filter((i:any)=>i.landmarkId===landmarkId).map((i:any)=>i.templateId))){
    const row=instances.filter((i:any)=>i.landmarkId===landmarkId&&i.templateId===templateId).sort((a:any,b:any)=>a.depth-b.depth);if(row.length<2)continue;
    const heights=row.map((i:any)=>i.worldSize[2]),ids=row.map((i:any)=>i.instanceId);
    if(Math.min(...heights)>=.95*Math.max(...heights))flags.push({kind:'uniformHeight',landmarkId,templateId,instanceIds:ids,worldHeights:heights});
    const touching=row.slice(1).map((b:any,k:number)=>[row[k],b])
     // A gap of a few percent of the bodies still reads as one wall from the reference camera.
     .filter(([a,b]:any)=>gap(a.box,b.box)<=.03*Math.max(...a.worldSize,...b.worldSize)).map(([a,b]:any)=>[a.instanceId,b.instanceId]);
    if(touching.length)flags.push({kind:'contiguous',landmarkId,templateId,pairs:touching});
    const visible=row.filter((i:any)=>!i.frameCut&&i.projectedHeight!==null);
    const larger=visible.slice(1).map((b:any,k:number)=>[visible[k],b]).filter(([a,b]:any)=>b.depth>a.depth*1.1&&b.projectedHeight>=a.projectedHeight).map(([a,b]:any)=>({nearer:a.instanceId,farther:b.instanceId}));
    if(larger.length)flags.push({kind:'fartherNotSmaller',landmarkId,templateId,pairs:larger});
   }
   return {referenceIndex,cameraName:camera.name,instances:instances.map(({box,...i}:any)=>i),flags};}).filter(Boolean);
  return {relationId:r.id,score:r.score,critical:!!relation.critical,description:relation.description,landmarkIds:relation.landmarkIds,views};
 })};
}
