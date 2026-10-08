import {compileGeometryProgram} from './program';

/** Sparse structures need detail views: fitting a 40 m cable bundle can make its
 * millimetre surfaces subpixel. Only inspection cameras change, never geometry,
 * material, the reference camera, or Engine's nonblank capture requirement. */
export function assetInspectionCameras(program:any,brief:any){
 const center=brief.bounds.min.map((v:number,k:number)=>(v+brief.bounds.max[k])/2);
 const extent=brief.bounds.max.map((v:number,k:number)=>v-brief.bounds.min[k]);
 const radius=Math.hypot(...extent.map((v:number)=>v/2));
 let distance=Math.max(.5,radius/Math.sin(.65/2)*1.2),target=center,detail=false;
 // Texture pixels do not affect measurement; the rendered program keeps its
 // original material bindings. Compilation applies all part transforms.
 const compiled=compileGeometryProgram({...program,materials:program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))});
 let area=0,nearest=Infinity,anchor=center;
 for(const {geometry:g} of compiled.meshes){
  for(let i=0;i<g.indices.length;i+=3){
   const points=g.indices.slice(i,i+3).map((n:number)=>g.positions.slice(n*3,n*3+3));
   const a=points[1].map((n:number,k:number)=>n-points[0][k]),b=points[2].map((n:number,k:number)=>n-points[0][k]);
   area+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
   const middle=center.map((_:number,k:number)=>(points[0][k]+points[1][k]+points[2][k])/3);
   const d=Math.hypot(...middle.map((n:number,k:number)=>n-center[k]));
   if(d<nearest){nearest=d;anchor=middle;}
  }
 }
 const faceArea=Math.max(extent[0]*extent[1],extent[0]*extent[2],extent[1]*extent[2]);
 if(area>0&&area/faceArea<.1){detail=true;target=anchor;distance=Math.max(.25,Math.min(distance,Math.sqrt(area)/4));}
 return {detail,cameras:[[1,-1,.6],[-1,1,.8]].map((direction,i)=>({name:(detail?'资产局部细节检查 ':'资产检查 ')+(i+1),referenceIndex:null,position:target.map((v:number,k:number)=>v+distance*direction[k]/Math.hypot(...direction)),target:[...target],fov:.65})),measurement:{surfaceArea:area,boundsFaceArea:faceArea,distance}};
}
