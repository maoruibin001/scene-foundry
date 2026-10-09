import type {V} from '../geometry/mesh';

export const VOXEL_LATTICE_VERSION='voxel-lattice-v1';
export const VOXEL_LATTICE_CELL_SIZES=[.025,.05,.1,.125,.2,.25,.5,1] as const;
export const QUARTER_TURNS=Array.from({length:9},(_,i)=>(i-4)*Math.PI/2);
export const VOXEL_LATTICE_LIMITS={axis:192,gridCells:2_000_000} as const;
export type VoxelLattice={version:typeof VOXEL_LATTICE_VERSION;cellSize:number;origin:V};
const EPSILON=1e-6,ANGLE_EPSILON=1e-10;
const fail=(ok:any,message:string)=>{if(!ok)throw Error('VOXEL_LATTICE: '+message);};
const vector=(v:any):v is V=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
const nearInteger=(n:number)=>Number.isSafeInteger(Math.round(n))&&Math.abs(n-Math.round(n))<=EPSILON;

export function voxelLatticeSchema(){return {type:'object',properties:{version:{type:'string',enum:[VOXEL_LATTICE_VERSION]},cellSize:{type:'number',enum:[...VOXEL_LATTICE_CELL_SIZES]},origin:{type:'array',items:{type:'number',enum:[0]},minItems:3,maxItems:3}},required:['version','cellSize','origin'],additionalProperties:false};}
export function validateVoxelLattice(value:any):VoxelLattice{
 fail(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&['version','cellSize','origin'].every(k=>Object.hasOwn(value,k)),'格网必须明确version、cellSize与origin，不能添加替代参数');
 fail(value.version===VOXEL_LATTICE_VERSION,'未知共同格网版本');
 fail(VOXEL_LATTICE_CELL_SIZES.includes(value.cellSize),'cellSize必须来自冻结枚举 '+VOXEL_LATTICE_CELL_SIZES.join(','));
 fail(vector(value.origin)&&value.origin.every(n=>n===0),'共同origin必须为[0,0,0]；不得改变格网相位');
 return value;
}
/** Local coordinates default to zero; world instance positions use lattice.origin. */
export function assertLatticeVector(value:any,lattice:VoxelLattice,label:string,origin:V=[0,0,0]){
 const grid=validateVoxelLattice(lattice);fail(vector(value)&&vector(origin),label+'必须为有限三维米制坐标');
 fail(value.every((n:number,k:number)=>nearInteger((n-origin[k])/grid.cellSize)),label+'不在共同格网上；每轴必须为cellSize='+grid.cellSize+'米的整数倍，不自动取整或钳制');
}
export function assertLatticePose(pose:any,lattice:VoxelLattice,label:string){
 assertLatticeVector(pose?.position,lattice,label+'.position',lattice.origin);
 fail(vector(pose?.scale)&&pose.scale.every((n:number)=>n===1),label+'.scale必须为[1,1,1]；尺寸由整数构造表达，不能拉伸或压缩父格网');
 fail(vector(pose?.rotation)&&pose.rotation.every((n:number)=>Math.abs(n)<=Math.PI*2&&Math.abs(n-Math.round(n/(Math.PI/2))*Math.PI/2)<=ANGLE_EPSILON),label+'.rotation必须为90度整数转，不能任意旋转体积后重采样');
}
function rotateQuarter(point:V,angles:V):V{
 let [x,y,z]=point;
 // Integer quarter-turn arithmetic avoids deriving the grid from approximate trig values.
 for(let n=((Math.round(angles[0]/(Math.PI/2))%4)+4)%4;n>0;n--)[y,z]=[-z,y];
 for(let n=((Math.round(angles[1]/(Math.PI/2))%4)+4)%4;n>0;n--)[x,z]=[z,-x];
 for(let n=((Math.round(angles[2]/(Math.PI/2))%4)+4)%4;n>0;n--)[x,y]=[-y,x];
 return [x,y,z];
}
/** Pure planning admission: declared transformed bounds plus one border cell per side. */
export function voxelSpaceGrid(space:any){
 const lattice=validateVoxelLattice(space?.voxelLattice),program=space?.program;
 fail(Array.isArray(program?.templates)&&program.templates.length>0&&Array.isArray(program.instances)&&program.instances.length>0,'共同格网需要模板边界与实际实例');
 const templates=new Map<string,any>();
 for(const template of program.templates){
  fail(typeof template?.id==='string'&&!templates.has(template.id),'模板身份缺失或重复');
  assertLatticeVector(template.bounds?.min,lattice,'模板 '+template.id+'.bounds.min');assertLatticeVector(template.bounds?.max,lattice,'模板 '+template.id+'.bounds.max');
  fail(template.bounds.max.every((n:number,k:number)=>n>template.bounds.min[k]),'模板 '+template.id+'的边界必须有正跨度');templates.set(template.id,template);
 }
 const min:V=[Infinity,Infinity,Infinity],max:V=[-Infinity,-Infinity,-Infinity];
 for(const instance of program.instances){
  const template=templates.get(instance?.template);fail(template,'实例引用不存在的模板');assertLatticePose(instance,lattice,'实例 '+instance.id);
  for(let corner=0;corner<8;corner++){
   const local=[0,1,2].map(k=>corner&(1<<k)?template.bounds.max[k]:template.bounds.min[k]) as V;
   const rotated=rotateQuarter(local,instance.rotation),point=rotated.map((n,k)=>n+instance.position[k]) as V;
   assertLatticeVector(point,lattice,'实例 '+instance.id+'的世界边界',lattice.origin);
   for(let k=0;k<3;k++){min[k]=Math.min(min[k],point[k]);max[k]=Math.max(max[k],point[k]);}
  }
 }
 const low=min.map((n,k)=>Math.floor((n-lattice.origin[k])/lattice.cellSize+EPSILON)-1),high=max.map((n,k)=>Math.ceil((n-lattice.origin[k])/lattice.cellSize-EPSILON)+1);
 const size=high.map((n,k)=>n-low[k]) as V,cells=size.reduce((a,b)=>a*b,1);
 fail(size.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=VOXEL_LATTICE_LIMITS.axis),'变换后世界网格含边缘padding每轴最多192格，实际 '+size.join('×')+'；请重新规划一致比例，不能自动扩大格距');
 fail(Number.isSafeInteger(cells)&&cells<=VOXEL_LATTICE_LIMITS.gridCells,'变换后世界网格含padding最多2000000格，实际 '+cells+'；不能静默降低分辨率');
 return {cellSize:lattice.cellSize,origin:low.map((n,k)=>lattice.origin[k]+n*lattice.cellSize) as V,size,cells,bounds:{min,max}};
}
/** Old/ordinary spaces remain unchanged; explicit new strict requests cannot omit metadata. */
export function validateVoxelSpace<T>(space:T,options:{required?:boolean}={}):T{
 const value=space as any;
 if(value?.voxelLattice===undefined){fail(!options.required,'严格体素空间缺少voxelLattice；旧布局不能被静默升级为准确共格');return space;}
 voxelSpaceGrid(value);return space;
}
