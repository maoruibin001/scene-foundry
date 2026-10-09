import {compileGeometryProgram,type Texture} from '../geometry/program';
import {validateScene,type SceneInput} from '../geometry/scene-contract';
import {digest} from '../store';
import {VOXEL_GRID_VERSION,VOXEL_LIMITS,compileVoxelScene,type VoxelProgram} from './program';
import {prepareNativeRaster,rasterNativeVolume} from './native-raster';

type V=[number,number,number];
const sub=(a:V,b:V)=>a.map((n,k)=>n-b[k]) as V;
const dot=(a:V,b:V)=>a.reduce((s,n,k)=>s+n*b[k],0);
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const fail=(s:string):never=>{throw Error('VOXELIZATION: '+s);};
const encoded=(v:number)=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055)));
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const rgb=(n:number):V=>[n>>>16&255,n>>>8&255,n&255];
const pack=(v:V)=>(v[0]<<16)|(v[1]<<8)|v[2];

/** Triangle/cell SAT prevents diagonal sampling from sealing openings or losing thin surfaces. */
export function triangleCellOverlap(vertices:V[],center:V,strictCellInterior=false){
 const p=vertices.map(v=>sub(v,center)),edges=[sub(p[1],p[0]),sub(p[2],p[1]),sub(p[0],p[2])];
 for(let k=0;k<3;k++){
  const low=Math.min(...p.map(v=>v[k])),high=Math.max(...p.map(v=>v[k]));
  if(strictCellInterior?low>=.5-1e-8||high<=-.5+1e-8:low>.500001||high<-.500001)return false;
 }
 const axes=[cross(edges[0],edges[1]),...edges.flatMap(e=>[cross(e,[1,0,0]),cross(e,[0,1,0]),cross(e,[0,0,1])])];
 for(const a of axes){const r=.5*(Math.abs(a[0])+Math.abs(a[1])+Math.abs(a[2]))+1e-7,values=p.map(v=>dot(a,v));if(Math.min(...values)>r||Math.max(...values)<-r)return false;}
 return true;
}

/** Weighted median-cut quantizes actual surface colors rather than asking a model to invent a palette. */
export function measuredPalette(histogram:Map<number,number>,limit=64){
 if(!histogram.size)fail('没有可见表面颜色');
 let bins=[Array.from(histogram,([color,count])=>({color,count,v:rgb(color)}))];
 const range=(b:typeof bins[number])=>[0,1,2].map(k=>{let min=255,max=0;for(const x of b){min=Math.min(min,x.v[k]);max=Math.max(max,x.v[k]);}return max-min;});
 while(bins.length<limit){let selected=-1,score=0;
  for(let i=0;i<bins.length;i++){const b=bins[i];if(b.length<2)continue;const s=Math.max(...range(b))*b.reduce((n,x)=>n+x.count,0);if(s>score){selected=i;score=s;}}
  if(selected<0)break;const bin=bins[selected],r=range(bin),axis=r.indexOf(Math.max(...r));bin.sort((a,b)=>a.v[axis]-b.v[axis]||a.color-b.color);
  const half=bin.reduce((n,x)=>n+x.count,0)/2;let sum=0,split=1;for(let i=0;i<bin.length-1;i++){sum+=bin[i].count;split=i+1;if(sum>=half)break;}
  bins.splice(selected,1,bin.slice(0,split),bin.slice(split));
 }
 return bins.map(b=>{const n=b.reduce((s,x)=>s+x.count,0);return pack([0,1,2].map(k=>Math.round(b.reduce((s,x)=>s+x.v[k]*x.count,0)/n)) as V);}).sort((a,b)=>a-b);
}

export function voxelizeScene(source:SceneInput,plan:any,referenceCount:number,textures:Record<string,Texture>,options:{resolution?:number;maxRasterTests?:number;paletteSize?:number}={}){
 validateScene(source,plan,referenceCount);
 if(source.entities.length>VOXEL_LIMITS.entities)fail('实体数量超过体素上限，不能删除主体来适配');
 const compiled=compileGeometryProgram(source.program,textures),extent=sub(compiled.bounds.max,compiled.bounds.min),resolution=options.resolution??128;
 if(!Number.isInteger(resolution)||resolution<16||resolution>190)fail('目标分辨率须为16–190');
 const native=prepareNativeRaster(source.program,compiled);
 let unit=native.unit??Math.max(.001,Math.max(...extent)/(resolution-2));
 const dimensions=()=>extent.map(n=>Math.ceil(n/unit)+2) as V;let size=native.size??dimensions();
 while(size.reduce((a,b)=>a*b,1)>VOXEL_LIMITS.gridCells||Math.max(...size)>192){unit*=1.02;size=dimensions();}
 if(unit>1)fail('场景尺度超过受支持格尺寸');
 const origin=native.origin??compiled.bounds.min.map(n=>n-unit) as V,cells=size.reduce((a,b)=>a*b,1),owners=new Uint8Array(cells),colorGrid=new Uint32Array(cells),distances=new Float32Array(cells);distances.fill(Infinity);
 const entities=source.program.instances.map(i=>{const e=source.entities.find(e=>e.instanceId===i.id)!;return {id:i.id,label:i.label,category:e.category,role:e.role,requirementIds:i.requirementIds,operations:[]};});
 const ownerIds=new Map(entities.map((e,i)=>[e.id,i+1])),priority=(owner:number)=>owner?({ground:0,context:1,subject:2}[entities[owner-1].role]):-1;
 const index=(v:V)=>v[0]+size[0]*(v[1]+size[1]*v[2]);let rasterTests=0,overlaps=0;
 const maxTests=options.maxRasterTests??32_000_000;
 const write=(v:V,owner:number,color:number,distance:number)=>{const key=index(v),old=owners[key];if(old&&old!==owner)overlaps++;
  if(old&&old!==owner&&(priority(old)>priority(owner)||priority(old)===priority(owner)&&distances[key]<distance))return;
  if(old===owner&&distances[key]<distance)return;
  owners[key]=owner;colorGrid[key]=color;distances[key]=distance;
 };
 const texturePixels=new Map<string,Buffer>();
 const sample=(material:any,uv:V)=>{
  const surface=material.surface,base=surface.baseColor as number[];if(base[3]<.99)fail('不透明体素不能悄悄代替透明材质：'+material.id);
  let value=base.slice(0,3);const t=surface.baseColorTexture;
  if(t){let pixels=texturePixels.get(material.id);if(!pixels){pixels=Buffer.from(t.rgba8,'base64');texturePixels.set(material.id,pixels);}
   const wrap=(v:number)=>v-Math.floor(v),x=Math.min(t.width-1,Math.floor(wrap(uv[0])*t.width)),y=Math.min(t.height-1,Math.floor((1-wrap(uv[1]))*t.height)),k=(y*t.width+x)*4;
   if(pixels[k+3]<128)return null;value=value.map((n,i)=>n*(t.colorSpace==='srgb'?linear(pixels![k+i]/255):pixels![k+i]/255));
  }
  return pack(value.map(encoded) as V);
 };
 for(const mesh of compiled.meshes){const g=mesh.geometry,owner=ownerIds.get(mesh.entityId)!,hits=new Map<number,{z:number;sign:number;color:number}[]>();
  const volume=native.meshes.get(mesh.name);
  if(volume){
   const color=pack(g.material.surface.baseColor.slice(0,3).map(encoded) as V);
   const mapped=rasterNativeVolume(volume,{unit,origin,size},cell=>write(cell,owner,color,0),maxTests-rasterTests);rasterTests+=mapped.gridWrites;
   continue;
  }
  for(let t=0;t<g.indices.length;t+=3){const ids=g.indices.slice(t,t+3),vertices=ids.map((i:number)=>[0,1,2].map(k=>(g.positions[i*3+k]-origin[k])/unit) as V),edges=[sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])],normal=cross(edges[0],edges[1]);
   const axis=[0,1,2].reduce((a,k)=>Math.abs(normal[k])>Math.abs(normal[a])?k:a,0);if(Math.abs(normal[axis])<1e-10)continue;
   const [u,v]=[0,1,2].filter(k=>k!==axis),den=(vertices[1][u]-vertices[0][u])*(vertices[2][v]-vertices[0][v])-(vertices[1][v]-vertices[0][v])*(vertices[2][u]-vertices[0][u]);
   const weights=(a:number,b:number)=>{const s=((a-vertices[0][u])*(vertices[2][v]-vertices[0][v])-(b-vertices[0][v])*(vertices[2][u]-vertices[0][u]))/den,q=((vertices[1][u]-vertices[0][u])*(b-vertices[0][v])-(vertices[1][v]-vertices[0][v])*(a-vertices[0][u]))/den;return [1-s-q,s,q];};
   const low=(k:number)=>Math.max(0,Math.floor(Math.min(...vertices.map(p=>p[k]))-1e-6)),high=(k:number)=>Math.min(size[k]-1,Math.floor(Math.max(...vertices.map(p=>p[k]))+1e-6));
   for(let a=low(u);a<=high(u);a++)for(let b=low(v);b<=high(v);b++){
    const w=weights(a+.5,b+.5),plane=w.reduce((n,q,k)=>n+q*vertices[k][axis],0),uv=ids.reduce((r:V,id:number,k:number)=>[r[0]+w[k]*g.uvs[id*2],r[1]+w[k]*g.uvs[id*2+1],0],[0,0,0] as V),color=sample(g.material,uv);if(color===null)continue;
    const lo=Math.max(low(axis),Math.floor(plane-1.501)),hi=Math.min(high(axis),Math.floor(plane+1.501));
    for(let c=lo;c<=hi;c++){if(++rasterTests>maxTests)fail('体素化计算超出有界预算；几何与输入保留');const cell=[0,0,0] as V;cell[u]=a;cell[v]=b;cell[axis]=c;
     if(triangleCellOverlap(vertices,cell.map(n=>n+.5) as V,native.meshes.size>0))write(cell,owner,color,Math.abs(c+.5-plane));
    }
   }
   // Closed meshes use winding intervals; open surfaces remain a bounded voxel shell.
   if(Math.abs(normal[2])>1e-10){const d=(vertices[1][0]-vertices[0][0])*(vertices[2][1]-vertices[0][1])-(vertices[1][1]-vertices[0][1])*(vertices[2][0]-vertices[0][0]);
    for(let x=low(0);x<=high(0);x++)for(let y=low(1);y<=high(1);y++){
     if(++rasterTests>maxTests)fail('体素化计算超出有界预算');const a=((x+.5-vertices[0][0])*(vertices[2][1]-vertices[0][1])-(y+.5-vertices[0][1])*(vertices[2][0]-vertices[0][0]))/d,b=((vertices[1][0]-vertices[0][0])*(y+.5-vertices[0][1])-(vertices[1][1]-vertices[0][1])*(x+.5-vertices[0][0]))/d;
     if(a< -1e-7||b< -1e-7||a+b>1+1e-7)continue;const w=[1-a-b,a,b],z=w.reduce((n,q,k)=>n+q*vertices[k][2],0),uv=ids.reduce((r:V,id:number,k:number)=>[r[0]+w[k]*g.uvs[id*2],r[1]+w[k]*g.uvs[id*2+1],0],[0,0,0] as V),color=sample(g.material,uv);if(color===null)continue;
     const key=x+size[0]*y,list=hits.get(key)??[];list.push({z,sign:Math.sign(normal[2]),color});hits.set(key,list);
    }
   }
  }
  for(const [key,raw] of hits){raw.sort((a,b)=>a.z-b.z);const unique:typeof raw=[];
   for(const h of raw){const last=unique.at(-1);if(last&&Math.abs(last.z-h.z)<1e-6){if(last.sign!==h.sign)last.sign=0;}else unique.push({...h});}
   // A nonzero final winding is an open mesh; do not invent enclosed volume beneath it.
   if(unique.reduce((n,h)=>n+h.sign,0)!==0)continue;let winding=0;
   for(let i=0;i<unique.length-1;i++){winding+=unique[i].sign;if(!winding)continue;
    for(let z=Math.max(0,Math.ceil(unique[i].z-.5));z<Math.min(size[2],Math.ceil(unique[i+1].z-.5));z++){
     if(++rasterTests>maxTests)fail('体素填充超出有界预算');const x=key%size[0],y=Math.floor(key/size[0]);if(!owners[index([x,y,z])])write([x,y,z],owner,unique[i].color,Infinity);
    }
   }
  }
 }
 const counts=new Uint32Array(entities.length+1),histogram=new Map<number,number>();let filled=0;
 for(let i=0;i<cells;i++)if(owners[i]){filled++;counts[owners[i]]++;histogram.set(colorGrid[i],(histogram.get(colorGrid[i])??0)+1);}
 if(filled>VOXEL_LIMITS.filledCells)fail('占用格超出50万上限；未删除资产或降低验收标准');
 const lost=entities.filter((_,i)=>!counts[i+1]);if(lost.length)fail('离散化丢失实体：'+lost.map(e=>e.id).join(','));
 const colors=measuredPalette(histogram,Math.min(options.paletteSize??64,64)),cache=new Map<number,number>();
 const nearest=(color:number)=>{if(cache.has(color))return cache.get(color)!;const value=rgb(color);let best=0,d=Infinity;colors.forEach((c,i)=>{const v=rgb(c),s=v.reduce((n,x,k)=>n+(x-value[k])**2,0);if(s<d){d=s;best=i;}});cache.set(color,best+1);return best+1;};
 const runs:[number,number,number,number][]=[];
 for(let i=0;i<cells;i++)if(owners[i]){const owner=owners[i],color=nearest(colorGrid[i]),last=runs.at(-1);if(last&&last[0]+last[1]===i&&last[2]===owner&&last[3]===color)last[1]++;else runs.push([i,1,owner,color]);}
 const program:VoxelProgram={version:VOXEL_GRID_VERSION,name:source.program.name,size,cellSize:unit,origin,sourceSceneSha256:digest(JSON.stringify(source)),runs,palette:colors.map((c,i)=>({id:'voxel_color_'+i,color:'#'+c.toString(16).padStart(6,'0')})),entities,
  cameras:source.cameras.map(c=>({...c,position:c.position as V,target:c.target as V,projection:c.projection??'perspective',orthographicHeight:c.orthographicHeight??null})),lighting:source.lighting,assumptions:source.assumptions};
 const result=compileVoxelScene(program,plan,referenceCount);
 for(const key of ['observedBindings','spatialRelations','spatialOpenings','spatialContacts'])if((source as any)[key])(result.scene as any)[key]=structuredClone((source as any)[key]);
 const report={version:'geometry-voxelization-v1',sourceSceneSha256:program.sourceSceneSha256,sourceTriangles:compiled.triangles,requestedResolution:resolution,gridSize:size,cellSize:unit,origin,filled,measuredSourceColors:histogram.size,paletteSize:colors.length,rasterTests,overlapCandidates:overlaps,entities:entities.map((e,i)=>({id:e.id,cells:counts[i+1]})),geometryErrorBoundMeters:Math.sqrt(3)*unit,...(native.provenance.nativeMeshes?{nativeLattice:native.provenance}:{}),scope:'实际验证几何与材质采样后的整数占用格；图片还原仍须独立验收'};
 return {program,...result,report};
}
