/** The dedicated voxel UI can share one server or proxy to its own worker/data. */
export function voxelRequest(request:Request){
 const url=new URL(request.url),path=url.pathname;
 const namespaced=path.startsWith('/api/voxel/')||path.startsWith('/voxel/files/')||path.startsWith('/voxel/process/');
 if(!namespaced)return {request,namespaced:false};
 url.pathname=path.startsWith('/api/voxel/')?'/api/'+path.slice('/api/voxel/'.length):path.slice('/voxel'.length);
 return {request:new Request(url,request),namespaced:true};
}
export function voxelInput(body:any,references:any){
 if(!Array.isArray(body.imageIds)||!body.imageIds.length)throw Error('体素场景需要上传 1–5 张原始参考图');
 const input={...body,sceneKind:'voxel'};
 if(!input.baselineId){const baseline=references.create({...input,generationSettings:{sceneKind:'voxel'}});references.approve(baseline.id,'uploaded-image-goal');input.baselineId=baseline.id;}
 return input;
}
