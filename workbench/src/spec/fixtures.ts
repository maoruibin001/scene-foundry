/** 规格单测与冒烟用的最小合法规格。 */
import {SCENE_SPEC_VERSION,type SceneSpec} from './schema';

const src=[{kind:'doc' as const,ref:'卷二 B2'}];
export function sampleSpec():SceneSpec{
 return {version:SCENE_SPEC_VERSION,id:'sample',name:'样例大厅',units:'m',up:'+Z',bounds:{min:[-24,-27.5,-3],max:[24,27.5,20]},
  sources:[{id:'doc',title:'手册',kind:'doc',path:'handbook.txt'}],
  materials:[{id:'steel',label:'钢',baseColor:[0.3,0.32,0.35,1],metallic:0.9,roughness:0.3,emissive:null,emissiveIntensity:0,transmission:0,ior:1.5,thickness:0,clearcoat:0,clearcoatRoughness:0,sources:src}],
  families:[{id:'CORE',label:'核心',description:'黑色球体',priority:'P0',generator:{id:'GEN-CORE-01',params:{diameter:8}},materialSlots:{shell:'steel'},authority:'master',sources:src}],
  objects:[{id:'CORE_001',label:'核心',family:'CORE',parent:null,transform:{position:[0,0,7],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{},authority:'master',sources:src,confidence:1,notes:''}],
  lighting:{defaultState:'L0',states:[{id:'L0',label:'稳定故障',ambient:{color:[0.5,0.6,0.7],intensity:0.2},background:[0.02,0.03,0.04],
   lights:[{id:'key',kind:'directional',position:null,direction:[-0.3,0.2,-0.9],color:[0.9,0.95,1],intensity:2,range:null,innerConeDeg:null,outerConeDeg:null,width:null,height:null,castShadow:true}],
   post:{tonemap:'aces',exposure:1,bloom:{threshold:1,intensity:0.3,radius:0.4},gtao:true,ssr:null,fog:null,planarReflections:[]}}]},
  shots:[{id:'entry',label:'入口',position:[0,-25,1.65],target:[0,0,7],fovDeg:60}],
  constraints:[{id:'mainPathWidth',description:'主路净宽',value:3,unit:'m',status:'P',sources:src}],
  acceptance:[{id:'coreAt',description:'核心位置',critical:true,kind:'position',object:'CORE_001',position:[0,0,7],tolerance:0.05}],
  styleRefs:[{id:'main',path:'concept-05.jpg',caption:'主视觉基准'}],
  provenance:{createdAt:'2026-11-04T00:00:00Z',method:'test',model:null}};
}
