import {createHash} from 'node:crypto';
import {validateSceneSpec,type SceneSpec} from './schema';
import {reviseSpec,type SpecRevision} from './revise';
export const specDigest=(s:SceneSpec)=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
/** Continue the previous immutable scene. A stale base never starts a new branch silently. */
export function continueSpec(base:SceneSpec,request:{baseSpecSha256:string;revision:SpecRevision}){
 validateSceneSpec(base);const before=specDigest(base);
 if(request.baseSpecSha256!==before)throw Error('STALE_SOURCE_SCENE');
 const spec=reviseSpec(base,request.revision),touched=new Set(request.revision.patches.map(p=>p.id));
 const retained=base.objects.filter(o=>!touched.has(o.id));
 for(const o of retained){const current=spec.objects.find(x=>x.id===o.id);if(JSON.stringify(current)!==JSON.stringify(o))throw Error('UNREQUESTED_OBJECT_CHANGE:'+o.id);}
 const sourceObjects=base.objects.filter(o=>o.sourceMesh);
 const receipt={version:'scene-continuation-v1',baseSpecSha256:before,resultSpecSha256:specDigest(spec),revision:request.revision.id,
  retainedObjects:retained.map(o=>o.id),retainedSourceMeshes:sourceObjects.filter(o=>!touched.has(o.id)).map(o=>({object:o.id,metadataSha256:o.sourceMesh!.metadataSha256,binarySha256:o.sourceMesh!.binarySha256})),
  changedObjects:spec.objects.filter(o=>JSON.stringify(o)!==JSON.stringify(base.objects.find(x=>x.id===o.id))).map(o=>o.id),patches:request.revision.patches};
 return {spec,receipt};
}

export function validateContinuationReceipt(base:SceneSpec,result:SceneSpec,receipt:ReturnType<typeof continueSpec>['receipt']){
 if(!receipt||receipt.version!=='scene-continuation-v1'||receipt.baseSpecSha256!==specDigest(base)||receipt.resultSpecSha256!==specDigest(result))throw Error('INVALID_SCENE_CONTINUATION_RECEIPT');
 return true;
}
