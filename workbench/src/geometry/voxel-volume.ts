import {MeshBuilder,type V} from './mesh';

export type VoxelVolumeOperation={mode:'fill'|'erase';min:V;size:V;repeat?:{count:number;step:V}|null};
/** Integer half-open cell cuboids; the local minimum corner is origin, in metres. */
export type VoxelVolume={type:'voxelVolume';cellSize:number;origin:V;dimensions:V;operations:VoxelVolumeOperation[]};
export const VOXEL_VOLUME_LIMITS={axis:192,cells:2_000_000,operations:256,repeats:128,expandedOperations:2048,writes:16_000_000,occupiedCells:500_000,triangles:250_000,programCells:4_000_000,programWrites:32_000_000} as const;
export type VoxelVolumePlan={cells:number;writes:number;expandedOperations:number};
export type VoxelVolumeEvaluation=VoxelVolumePlan&{occupied:Uint8Array;occupiedCells:number};
export type VoxelVolumeFace={points:[V,V,V,V];normal:V};
export type VoxelVolumeMesh=VoxelVolumePlan&{faces:VoxelVolumeFace[];occupiedCells:number;exposedCellFaces:number;triangles:number};
function fail(ok:unknown,message:string):asserts ok{if(!ok)throw Error('整数体素构造：'+message);}
const finite=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const ints=(value:unknown,min:number,max:number):value is V=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isSafeInteger(n)&&n>=min&&n<=max);
const keys=(value:unknown,allowed:string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));

/** Admission is allocation-free, including all repeated writes and their end bounds. */
export function validateVoxelVolume(value:VoxelVolume):VoxelVolumePlan{
 const s=value;
 fail(keys(s,['type','cellSize','origin','dimensions','operations'])&&s.type==='voxelVolume','类型或字段无效');
 fail(finite(s.cellSize,.001,10),'cellSize 须为 .001..10 米的有限数');
 fail(Array.isArray(s.origin)&&s.origin.length===3&&s.origin.every(n=>finite(n,-100,100)),'origin 须为 -100..100 米的有限三维坐标');
 fail(ints(s.dimensions,1,VOXEL_VOLUME_LIMITS.axis),'dimensions 须为 1..192 的三个整数');
 fail(s.dimensions.every(n=>n*s.cellSize<=100),'单轴物理跨度不得超过 100 米');
 const cells=s.dimensions.reduce((n,v)=>n*v,1);
 fail(cells<=VOXEL_VOLUME_LIMITS.cells,'体积格数超过 '+VOXEL_VOLUME_LIMITS.cells+' 预算');
 fail(Array.isArray(s.operations)&&s.operations.length>=1&&s.operations.length<=VOXEL_VOLUME_LIMITS.operations,'operations 须包含 1..256 个有序填充或挖空操作');
 let writes=0,expandedOperations=0;
 for(let i=0;i<s.operations.length;i++){
  const op=s.operations[i];
  fail(keys(op,['mode','min','size','repeat'])&&(op.mode==='fill'||op.mode==='erase'),'operation '+i+' 的模式或字段无效');
  fail(ints(op.min,0,VOXEL_VOLUME_LIMITS.axis)&&ints(op.size,1,VOXEL_VOLUME_LIMITS.axis),'operation '+i+' 的 min/size 须为非负起点和正整数尺寸');
  let count=1,step:V=[0,0,0];
  if(op.repeat!=null){
   fail(keys(op.repeat,['count','step'])&&Number.isSafeInteger(op.repeat.count)&&op.repeat.count>=1&&op.repeat.count<=VOXEL_VOLUME_LIMITS.repeats&&ints(op.repeat.step,-VOXEL_VOLUME_LIMITS.axis,VOXEL_VOLUME_LIMITS.axis),'operation '+i+' 的 repeat 须为 1..128 次及整数 step');
   count=op.repeat.count;step=op.repeat.step;
  }
  for(let axis=0;axis<3;axis++){
   const last=op.min[axis]+step[axis]*(count-1);
   fail(Math.min(op.min[axis],last)>=0&&Math.max(op.min[axis],last)+op.size[axis]<=s.dimensions[axis],'operation '+i+' 或其重复越过 dimensions 边界；不会裁切越界结构');
  }
  expandedOperations+=count;writes+=op.size.reduce((n,v)=>n*v,1)*count;
  fail(expandedOperations<=VOXEL_VOLUME_LIMITS.expandedOperations,'展开操作超过 '+VOXEL_VOLUME_LIMITS.expandedOperations+' 预算');
  fail(writes<=VOXEL_VOLUME_LIMITS.writes,'格子写入超过 '+VOXEL_VOLUME_LIMITS.writes+' 预算');
 }
 return {cells,writes,expandedOperations};
}

/** Operations are ordered; every repetition completes before the next operation. */
export function evaluateVoxelVolume(s:VoxelVolume):VoxelVolumeEvaluation{
 const plan=validateVoxelVolume(s),occupied=new Uint8Array(plan.cells),[nx,ny]=s.dimensions;let occupiedCells=0;
 for(const op of s.operations){
  const count=op.repeat?.count??1,step=op.repeat?.step??[0,0,0],fill=op.mode==='fill'?1:0;
  for(let repeat=0;repeat<count;repeat++){
   const [x0,y0,z0]=op.min.map((n,k)=>n+repeat*step[k]),[sx,sy,sz]=op.size;
   for(let z=z0;z<z0+sz;z++)for(let y=y0;y<y0+sy;y++)for(let x=x0;x<x0+sx;x++){
    const index=x+nx*(y+ny*z);if(occupied[index]!==fill){occupiedCells+=fill?1:-1;occupied[index]=fill;}
   }
  }
 }
 fail(occupiedCells>0,'最终体积为空，不能输出空网格');
 fail(occupiedCells<=VOXEL_VOLUME_LIMITS.occupiedCells,'最终占用格数超过 '+VOXEL_VOLUME_LIMITS.occupiedCells+' 预算');
 return {...plan,occupied,occupiedCells};
}

/** Greedy rectangles cover only solid/empty boundaries, including through-hole walls. */
export function voxelVolumeMesh(s:VoxelVolume):VoxelVolumeMesh{
 const {occupied,occupiedCells,...plan}=evaluateVoxelVolume(s),dims=s.dimensions,[nx,ny]=dims,faces:VoxelVolumeFace[]=[];
 let exposedCellFaces=0;
 const at=(p:V)=>occupied[p[0]+nx*(p[1]+ny*p[2])];
 const world=(p:V):V=>p.map((n,k)=>s.origin[k]+n*s.cellSize) as V;
 for(let axis=0;axis<3;axis++){
  const u=(axis+1)%3,v=(axis+2)%3,width=dims[u],height=dims[v],mask=new Int8Array(width*height),cell:V=[0,0,0];
  for(let plane=0;plane<=dims[axis];plane++){
   for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    cell[u]=i;cell[v]=j;cell[axis]=plane-1;const before=plane>0?at(cell):0;
    cell[axis]=plane;const after=plane<dims[axis]?at(cell):0;
    const sign=before===after?0:before?1:-1;mask[i+width*j]=sign;if(sign)exposedCellFaces++;
   }
   for(let j=0;j<height;j++)for(let i=0;i<width;){
    const sign=mask[i+width*j];if(!sign){i++;continue;}
    let w=1,h=1;while(i+w<width&&mask[i+w+width*j]===sign)w++;
    outer:while(j+h<height){for(let k=0;k<w;k++)if(mask[i+k+width*(j+h)]!==sign)break outer;h++;}
    const corner=(du:number,dv:number):V=>{const p:V=[0,0,0];p[axis]=plane;p[u]=i+du;p[v]=j+dv;return world(p);};
    const normal:V=[0,0,0];normal[axis]=sign;
    const points:[V,V,V,V]=sign>0?[corner(0,0),corner(w,0),corner(w,h),corner(0,h)]:[corner(0,0),corner(0,h),corner(w,h),corner(w,0)];
    faces.push({points,normal});
    fail(faces.length*2<=VOXEL_VOLUME_LIMITS.triangles,'实际外露网格超过 '+VOXEL_VOLUME_LIMITS.triangles+' 三角形预算；不会丢弃几何');
    for(let dj=0;dj<h;dj++)mask.fill(0,i+width*(j+dj),i+w+width*(j+dj));i+=w;
   }
  }
 }
 return {...plan,occupiedCells,faces,exposedCellFaces,triangles:faces.length*2};
}
export const voxelVolumeFaces=(s:VoxelVolume)=>voxelVolumeMesh(s).faces;
export function drawVoxelVolume(g:MeshBuilder,material:string,s:VoxelVolume){for(const face of voxelVolumeFaces(s))g.quad(material,face.points);}

/** Optional repeat is nullable in model schemas; runtime also accepts its omission. */
export function voxelVolumeSchema(){
 const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
 const triple=(min:number,max:number)=>({type:'array',items:{type:'integer',minimum:min,maximum:max},minItems:3,maxItems:3});
 return obj({type:{type:'string',enum:['voxelVolume']},cellSize:{type:'number',minimum:.001,maximum:10},origin:{type:'array',items:{type:'number',minimum:-100,maximum:100},minItems:3,maxItems:3},dimensions:triple(1,VOXEL_VOLUME_LIMITS.axis),operations:{type:'array',minItems:1,maxItems:VOXEL_VOLUME_LIMITS.operations,items:obj({mode:{type:'string',enum:['fill','erase']},min:triple(0,VOXEL_VOLUME_LIMITS.axis),size:triple(1,VOXEL_VOLUME_LIMITS.axis),repeat:{anyOf:[{type:'null'},obj({count:{type:'integer',minimum:1,maximum:VOXEL_VOLUME_LIMITS.repeats},step:triple(-VOXEL_VOLUME_LIMITS.axis,VOXEL_VOLUME_LIMITS.axis)})]}})}});
}
export const VOXEL_VOLUME_RULES=`体素模式专用 voxelVolume 是整数格子体积构造，不逐个输出方块。cellSize 是米制格边长（.001..10），origin 是局部体积最小角的米制坐标，dimensions 是三个正整数（每轴最多192，格数乘积最多2000000，物理跨度每轴最多100米）。operations 按顺序执行填充 fill 或挖空 erase；min 为三个非负整数格子起点，size 为三个正整数格子尺寸，覆盖半开区间 [min,min+size)，必须完整位于 dimensions 内。repeat 填 null，或 {count:1..128,step:[整数X,整数Y,整数Z]}，同一操作的重复先全部执行，再执行下一操作；负 step 可以，但每次都不能越界。先填围墙，再挖贯通门洞；台阶、板缝和重复拱柱可用有界 repeat 表达。一个部件只有一种材质，异色结构用少量独立部件。最多256条操作、展开2048次、16000000次格子写入、最终占用500000格，实际外露三角形仍受250000预算。空体积、越界、超限都会被拒绝，不能用裁切或丢弃结构规避。体积构造仅输出外露面，内部相邻方块面不会输出；挖空顺序和贯通空隙会真实保留。优先保持原图中的主体比例、开口、桥跨空和水道可见范围，不因体素格式省略关键关系。部件 smoothAngle 设0保留体素硬边；部件及实例变换仍按普通几何执行。`;
