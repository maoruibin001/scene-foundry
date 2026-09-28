import {spatialInstances} from './spatial-order';

/** Strip only fields added by applySurface; retain every geometry and camera constraint. */
export function spatialContract(layout:any){
 const {version,textures,textureReuse,lighting,assumptions,program,...space}=layout;
 const {materials,templates,instances,...geometry}=program;
 return {...space,program:{...geometry,templates:templates.map(({materialIds,...brief}:any)=>brief),instances:spatialInstances(instances)}};
}
function canonical(value:any):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function assertCheckpointSpace(space:any,layout:any){
 if(canonical(spatialContract(space))!==canonical(spatialContract(layout)))throw Error('SPATIAL_GATE_CHANGED：检查点空间与布局几何不一致，不能复用旧布局资产');
}
/** Use the hash-verified pre-material space so recovery matches the original graybox. */
export function checkpointSpatialInput(layout:any,savedSpace?:any){
 if(!savedSpace)return layout;
 assertCheckpointSpace(savedSpace,layout);
 return savedSpace;
}
