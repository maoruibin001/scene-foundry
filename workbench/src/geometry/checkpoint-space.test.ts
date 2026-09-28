import {test,expect} from 'bun:test';
import {checkpointSpatialInput,assertCheckpointSpace} from './checkpoint-space';

const space={version:'scene-space-v1',assumptions:['背面未知'],program:{version:'geometry-v1',name:'测试',templates:[{id:'wall',bounds:{min:[0,0,0],max:[4,1,3]},origin:'左下',description:'门洞',maxParts:8}],instances:[{id:'one',template:'wall',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}]},cameras:[{position:[0,-5,2],target:[0,0,1],fov:1}],spatialRelations:[{id:'door',critical:true,instanceIds:['one']}],openings:[{id:'door',bounds:[0,1]}]};
function surfaced(){const layout:any=structuredClone(space);layout.version='scene-layout-v1';layout.assumptions.push('材质推断');layout.textures=[{id:'brick'}];layout.lighting={intensity:1};layout.textureReuse=[];layout.program.materials=[{id:'m'}];layout.program.templates[0].materialIds=['m'];layout.program.instances[0].surfaceOverrides=[{sourceMaterialId:'m',targetMaterialId:'m'}];return layout;}
test('recovery returns the exact pre-material snapshot and accepts surface enrichment',()=>{expect(checkpointSpatialInput(surfaced(),space)).toBe(space);expect(()=>assertCheckpointSpace(space,surfaced())).not.toThrow();});
test('recovery rejects camera, geometry, relation and opening changes before reuse',()=>{
 for(const mutate of [(x:any)=>x.cameras[0].fov=2,(x:any)=>x.program.instances[0].position[0]=1,(x:any)=>x.program.templates[0].bounds.max[0]=8,(x:any)=>x.program.templates[0].description='填死门洞',(x:any)=>x.spatialRelations[0].critical=false,(x:any)=>x.openings[0].bounds[0]=2]){const changed=surfaced();mutate(changed);expect(()=>checkpointSpatialInput(changed,space)).toThrow('SPATIAL_GATE_CHANGED');}
});
test('post-acceptance layout changes cannot silently replace checkpoint geometry',()=>{const revised=structuredClone(space);revised.program.instances[0].scale[0]=2;expect(()=>assertCheckpointSpace(revised,surfaced())).toThrow('SPATIAL_GATE_CHANGED');});
test('legacy checkpoint retains its original input when no spatial snapshot exists',()=>{const layout=surfaced();expect(checkpointSpatialInput(layout)).toBe(layout);});
