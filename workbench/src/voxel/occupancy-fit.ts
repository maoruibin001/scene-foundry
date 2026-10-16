import {evaluateVoxelVolume,type VoxelVolume} from '../geometry/voxel-volume';
import {VOXEL_LIMITS} from './limits';

export const VOXEL_OCCUPANCY='voxel-occupancy-v1';
/** Only new voxel jobs created under the policy hollow over-budget graybox templates; historical jobs keep failing on the summed bound as before. */
export function voxelOccupancyRule(job:any){return job?.voxelOccupancyPolicy===VOXEL_OCCUPANCY;}
/** Measured on the first r2 tower plan: three nearly solid back/side walls summed to 512229 cells against the 500000 bound while every template passed alone. */
export const VOXEL_OCCUPANCY_LIMITS={target:.8,boxesPerPart:4,operations:48,axis:64,minimumBox:64};

type V=[number,number,number];
const index=(d:V,x:number,y:number,z:number)=>x+d[0]*(y+d[1]*z);
/** Cells whose whole 3×3×3 neighbourhood lies inside the volume and is occupied. Erasing any subset of them leaves a closed shell of the part's own cells. */
export function interiorCells(shape:VoxelVolume){
 const d=shape.dimensions as V;let cur=evaluateVoxelVolume(shape).occupied.slice();
 // A box minimum filter is separable: erode by one cell along x, then y, then z; outside the volume counts as empty.
 for(let axis=0;axis<3;axis++){const next=new Uint8Array(cur.length);
  for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++){const p=[x,y,z] as V;if(p[axis]===0||p[axis]===d[axis]-1)continue;
   const a=[...p] as V,b=[...p] as V;a[axis]--;b[axis]++;next[index(d,x,y,z)]=cur[index(d,x,y,z)]&cur[index(d,...a)]&cur[index(d,...b)];}
  cur=next;}
 return cur;
}
/** Largest axis-aligned box of set cells: every z-range is reduced to a 2D mask, then the maximal rectangle comes from row histograms. */
export function largestBox(mask:Uint8Array,d:V){
 let best={cells:0,min:[0,0,0] as V,size:[0,0,0] as V};const plane=new Uint8Array(d[0]*d[1]),h=new Int32Array(d[0]+1);
 for(let z0=0;z0<d[2];z0++){plane.fill(1);
  for(let z1=z0;z1<d[2];z1++){let any=0;for(let i=0;i<plane.length;i++){plane[i]&=mask[i+plane.length*z1];any|=plane[i];}if(!any)break;
   const depth=z1-z0+1;h.fill(0);
   for(let y=0;y<d[1];y++){for(let x=0;x<d[0];x++)h[x]=plane[x+d[0]*y]?h[x]+1:0;
    const stack:number[]=[];
    for(let x=0;x<=d[0];x++){while(stack.length&&h[stack[stack.length-1]]>=h[x]){const top=stack.pop()!,height=h[top],left=stack.length?stack[stack.length-1]+1:0,width=x-left,cells=width*height*depth;
      if(height&&cells>best.cells)best={cells,min:[left,y-height+1,z0],size:[width,height,depth]};}
     stack.push(x);}
   }
  }
 }
 return best;
}
/** Faces between occupied cells and empty cells reachable from outside the volume; used to prove hollowing is invisible. */
export function exteriorSurface(shape:VoxelVolume){
 const d=shape.dimensions as V,occupied=evaluateVoxelVolume(shape).occupied,p:V=[d[0]+2,d[1]+2,d[2]+2],outside=new Uint8Array(p[0]*p[1]*p[2]);
 const solid=(x:number,y:number,z:number)=>x>0&&y>0&&z>0&&x<=d[0]&&y<=d[1]&&z<=d[2]&&occupied[index(d,x-1,y-1,z-1)]===1;
 const queue=[0];outside[0]=1;const faces:string[]=[];
 while(queue.length){const i=queue.pop()!,x=i%p[0],y=Math.floor(i/p[0])%p[1],z=Math.floor(i/(p[0]*p[1]));
  for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const nx=x+dx,ny=y+dy,nz=z+dz;if(nx<0||ny<0||nz<0||nx>=p[0]||ny>=p[1]||nz>=p[2])continue;
   if(solid(nx,ny,nz)){faces.push(nx+','+ny+','+nz+':'+(-dx)+','+(-dy)+','+(-dz));continue;}
   const j=index(p,nx,ny,nz);if(!outside[j]){outside[j]=1;queue.push(j);}}}
 return faces.sort();
}

/** When the summed occupancy bound of an assembled voxel graybox exceeds the scene budget, erase the largest hidden interior boxes of its biggest parts.
 * Only cells enclosed by the part's own occupied cells are removed, so every exterior face, opening and contact stays where it was; instances, poses, templates and bounds are untouched. */
export function fitVoxelOccupancy(space:any,value:{templates:any[]}){
 const L=VOXEL_OCCUPANCY_LIMITS,limit=VOXEL_LIMITS.filledCells,counts=new Map<string,number>();
 for(const instance of space.program.instances)counts.set(instance.template,(counts.get(instance.template)??0)+1);
 const templates=structuredClone(value.templates),rows:any[]=[];let before=0;
 for(const template of templates)for(const part of template.parts??[]){if(part.shape?.type!=='voxelVolume')continue;
  const n=counts.get(template.id)??0,occupied=evaluateVoxelVolume(part.shape).occupiedCells;before+=n*occupied;
  if(n&&part.shape.dimensions.every((k:number)=>k<=L.axis))rows.push({template,part,n,mask:null,box:null,added:0});}
 const report:any={version:VOXEL_OCCUPANCY,unit:'实例展开后的占用格上界（各部件占用×实例数，不扣除重叠）',limit,target:Math.floor(limit*L.target),before,after:before,changes:[]};
 if(before<=limit)return {value,report:{...report,status:'within-budget'}};
 let total=before;
 while(total>report.target){
  let pick:any=null;
  for(const row of rows){if(row.added>=L.boxesPerPart||row.part.shape.operations.length>=L.operations)continue;
   row.mask??=interiorCells(row.part.shape);row.box??=largestBox(row.mask,row.part.shape.dimensions);
   if(row.box.cells>=L.minimumBox&&(!pick||row.box.cells*row.n>pick.box.cells*pick.n))pick=row;}
  if(!pick)break;
  const {min,size,cells}=pick.box,d=pick.part.shape.dimensions;
  for(let z=min[2];z<min[2]+size[2];z++)for(let y=min[1];y<min[1]+size[1];y++)for(let x=min[0];x<min[0]+size[0];x++)pick.mask[index(d,x,y,z)]=0;
  pick.part.shape.operations.push({mode:'erase',min,size,repeat:null});pick.added++;pick.box=null;total-=cells*pick.n;
  report.changes.push({templateId:pick.template.id,partId:pick.part.id,instances:pick.n,erase:{min,size},cells,expandedCells:cells*pick.n});
 }
 // Re-measure from the rewritten volumes rather than trusting the bookkeeping.
 report.after=templates.reduce((s:number,t:any)=>s+(counts.get(t.id)??0)*(t.parts??[]).reduce((v:number,p:any)=>v+(p.shape?.type==='voxelVolume'?evaluateVoxelVolume(p.shape).occupiedCells:0),0),0);
 if(report.after!==total)throw Error('VOXEL_OCCUPANCY：挖空后占用复核不一致');
 report.status=report.after<=limit?'hollowed':'insufficient';
 report.note='仅挖去3×3×3邻域均为同部件实体的内部格，部件自身保留至少一格闭合外壳；外部可见表面、开口与接触不变。不足时仍由原有总占用校验拒绝。';
 return {value:report.changes.length?{...value,templates}:value,report};
}
