import {existsSync} from 'node:fs';
import {join} from 'node:path';
/** Feedback is the final voxel image; edits target its frozen, validated construction source. */
export function sourceSceneFile(job:any,folder:string){
 const voxel=join(folder,'voxel-source-scene.json');
 return job.sceneKind==='voxel'&&existsSync(voxel)?voxel:join(folder,'generated-scene.json');
}
