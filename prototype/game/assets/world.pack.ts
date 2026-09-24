import { AssetGuid, definePack, definePackageId } from '@forgeax/engine/pack/source';
import { Camera, DirectionalLight, Skylight, perspective } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import { quat } from '@forgeax/engine/math';
import { ok } from '@forgeax/engine/types';
const packageId=definePackageId('60fb39fb-420e-4aa5-8189-fd9c4d8369e7');
import identity from './generated-identity.ts';
const gardenGuid=AssetGuid.derive(definePackageId(identity.packageId),identity.sourceKey);
export default definePack({
 schemaVersion:'2.0.0',packageId,name:'Micro garden recording scene',
 sceneComponents:[Camera,DirectionalLight,Skylight,Name,Transform],
 build(){
  const pos=[20,10,20] as const;
  const q=quat.fromLookAt(quat.create(),pos,[0,5,0],[0,1,0]);
  return ok({'scene/main':{kind:'scene',entities:{
   garden:{components:{Name:{value:'Micro garden authored content'}},instance:{source:AssetGuid.format(gardenGuid)}},
   camera:{components:{Name:{value:'Recording camera'},Transform:{pos,quat:Array.from(q)},Camera:{...perspective({fov:Math.PI/3,aspect:16/9,near:0.1,far:160}),clearColor:[0.06,0.10,0.13,1]}}},
   sun:{components:{Name:{value:'Warm daylight'},DirectionalLight:{direction:[-0.35,-0.85,-0.40],color:[1,0.94,0.82],intensity:3.2,castShadow:true,shadowDistance:65,mapSize:1024,cascadeCount:3,shadowFilter:2}}},
   ambient:{components:{Name:{value:'Cool ambient'},Skylight:{color:[0.65,0.83,1],intensity:0.85}}}
  }}});
 }
});
