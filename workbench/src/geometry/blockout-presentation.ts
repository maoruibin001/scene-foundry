import {spatialInstances} from './spatial-order';
/** Diagnostic clay rendering. No reference colors, textures, geometry or camera changes. */
export const BLOCKOUT_PRESENTATION = 'neutral-clay-v2';
export function readableBlockout(scene:any) {
 const levels=[.24,.64,.38,.76,.49,.31,.57];
 const materials=scene.program.templates.map((t:any,n:number)=>({id:'clay_'+n,color:[levels[n%levels.length],levels[n%levels.length],levels[n%levels.length],1],roughness:1,metallic:0,textureId:null}));
 const templates=scene.program.templates.map((t:any,n:number)=>({...t,parts:t.parts.map((p:any)=>({...p,material:materials[n].id}))}));
 const points=scene.cameras.map((c:any)=>({position:[c.position[0],c.position[1],c.position[2]+1.5],color:[1,1,1],intensity:12,range:30}));
 return {...scene,textures:[],textureReuse:[],program:{...scene.program,instances:spatialInstances(scene.program.instances),materials,templates},lighting:{direction:[.3,.4,-1],color:[1,1,1],intensity:2,ambientColor:[1,1,1],ambientIntensity:.16,points}};
}
