import {compileGeometryProgram} from './program';
import {enclosureVoids} from './interior-enclosure';

export const SKY_NORMALIZATION='sky-normalization-v1';
/**
 * Canal 38c83a76 (2026-10-21) failed S13 in every round and in three re-judges of identical frames on its sky: "天空异常深色长薄片"
 * was the sky template's own low_thin_cloud part, lit from below, and "直线色阶拼接/竖直接缝" came from a non-tileable reference crop
 * wrapped once around the dome. A sky shell is the instance whose geometry encloses every camera with a wide horizontal span; its
 * materials gain emission at their mean colour, and a textured one is replaced by its row means, which match across the wrap.
 */
export const SKY_LIMITS={span:60,emission:.85};
const meshesOf=(scene:any)=>compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))}).meshes;
const linear=(v:number)=>Math.pow(v/255,2.2);

/** Instances whose geometry encloses every camera and spans at least SKY_LIMITS.span horizontally. */
export function skyShells(scene:any){
 const boxes=new Map<string,{lo:number[];hi:number[]}>();
 for(const m of meshesOf(scene)){const id=String(m.name).split('__')[0],p=m.geometry.positions,b=boxes.get(id)??{lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<p.length;i++){b.lo[i%3]=Math.min(b.lo[i%3],p[i]);b.hi[i%3]=Math.max(b.hi[i%3],p[i]);}boxes.set(id,b);}
 return [...boxes].filter(([,b])=>Math.min(b.hi[0]-b.lo[0],b.hi[1]-b.lo[1])>=SKY_LIMITS.span&&scene.cameras.every((c:any)=>c.position.every((v:number,k:number)=>v>b.lo[k]&&v<b.hi[k]))).map(([id])=>id);
}
/** Row means of a texture: every row one colour, so the left and right edges meet wherever the dome wraps. */
function rowMeans(t:any){
 const bytes=Buffer.from(t.rgba8,'base64'),out=Buffer.alloc(bytes.length),sum=[0,0,0,0];
 for(let y=0;y<t.height;y++){const row=[0,0,0,0];for(let x=0;x<t.width;x++)for(let k=0;k<4;k++)row[k]+=bytes[(y*t.width+x)*4+k];
  for(let k=0;k<4;k++){row[k]=Math.round(row[k]/t.width);sum[k]+=row[k];}
  for(let x=0;x<t.width;x++)for(let k=0;k<4;k++)out[(y*t.width+x)*4+k]=row[k];}
 return {texture:{...t,rgba8:out.toString('base64')},mean:sum.slice(0,3).map(v=>v/t.height)};
}
/** Give an outdoor scene's sky shell seamless, self-lit materials; interiors and scenes without a shell are returned unchanged. */
export function withNormalizedSky(scene:any,textures:Record<string,any>){
 const report:any={version:SKY_NORMALIZATION,shells:[],materials:[]};
 if(enclosureVoids(scene).interior)return {scene,textures,report:{...report,reason:'室内场景不处理天空'}};
 const shells=skyShells(scene);if(!shells.length)return {scene,textures,report:{...report,reason:'没有包围全部机位的天空外壳'}};
 const next=structuredClone(scene),nextTextures={...textures},made=new Map<string,string>();
 const skyMaterial=(id:string)=>{if(made.has(id))return made.get(id)!;const m=next.program.materials.find((x:any)=>x.id===id);if(!m)return id;
  const copy:any={...structuredClone(m),id:id+'__sky'};let mean=m.color.slice(0,3);
  if(m.textureId&&textures[m.textureId]){const r=rowMeans(textures[m.textureId]);nextTextures[m.textureId+'__sky']=r.texture;copy.textureId=m.textureId+'__sky';mean=r.mean.map(linear).map((v:number,k:number)=>v*m.color[k]);}
  copy.emission={color:mean.map((v:number)=>+Math.min(1,v).toFixed(4)),intensity:SKY_LIMITS.emission};
  next.program.materials.push(copy);made.set(id,copy.id);report.materials.push({from:id,to:copy.id,texture:copy.textureId??null,emission:copy.emission});return copy.id;};
 for(const id of shells){const instance=next.program.instances.find((i:any)=>i.id===id),template=next.program.templates.find((t:any)=>t.id===instance.template);
  // Rewrite in place (the template cap is 16); clone only when another instance shares the template and keeps its own materials.
  const shared=next.program.instances.some((i:any)=>i.id!==id&&i.template===template.id),parts=template.parts.map((p:any)=>({...p,material:skyMaterial(p.material)}));
  const own=shared?{...structuredClone(template),id:template.id+'__sky_'+id,parts}:Object.assign(template,{parts});
  if(shared){next.program.templates.push(own);instance.template=own.id;}
  instance.surfaceOverrides=(instance.surfaceOverrides??[]).map((o:any)=>({...o,sourceMaterialId:skyMaterial(o.sourceMaterialId),targetMaterialId:skyMaterial(o.targetMaterialId)}));
  report.shells.push({instanceId:id,template:own.id});}
 next.assumptions=[...(next.assumptions??[]),'天空外壳由管线改为无缝自发光材质（'+SKY_NORMALIZATION+'）'];
 return {scene:next,textures:nextTextures,report};
}
