/** Fixed Engine point-shadow receiver terms are normalized depth, not metres. */
export type PointShadow={normalBias:number;depthBias:number};
type Point={position:number[];color:number[];intensity:number;range:number;shadow?:PointShadow|null};
export const pointShadowSchema=()=>({anyOf:[{type:'object',additionalProperties:false,required:['normalBias','depthBias'],properties:{normalBias:{type:'number',minimum:0,maximum:.05},depthBias:{type:'number',minimum:0,maximum:.005}}},{type:'null'}]});
export function validatePointShadows(points:readonly Point[]){
 let count=0;
 for(const p of points){
  const s=p.shadow;if(s==null)continue;
  const finite=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
  if(typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['normalBias','depthBias'].includes(k))||!finite(s.normalBias,.05)||!finite(s.depthBias,.005)||!Number.isFinite(p.range)||p.range<=.1)throw Error('点光阴影参数无效');
  if(++count>2)throw Error('点光阴影数量超限：最多2个，保留实际渲染余量');
 }
}
const replaceOne=(s:string,a:string,b:string)=>{if(s.split(a).length!==2)throw Error('点光阴影导出契约变化');return s.replace(a,b);};
export function bindPointShadows(world:string,points:readonly Point[]){
 validatePointShadows(points);if(!points.some(p=>p.shadow!=null))return world;
 const imports=[...world.matchAll(/import \{([^;\n]+) \} from '@forgeax\/engine\/render';/g)];
 if(imports.length!==1||!imports[0][1].split(',').some(x=>x.trim()==='PointLight'))throw Error('点光阴影导出契约变化');
 const symbols=imports[0][1].split(',').map(x=>x.trim());const at=symbols.indexOf('perspective');if(at<0)throw Error('点光阴影导出契约变化');symbols.splice(at,0,'PointLightShadow');
 world=replaceOne(world,imports[0][0],`import { ${symbols.join(', ')} } from '@forgeax/engine/render';`);
 world=replaceOne(world,'Name,Transform]','PointLightShadow,Name,Transform]');
 for(const [i,p] of points.entries())if(p.shadow!=null){
  const original='localLight'+i+':{components:{Transform:{pos:'+JSON.stringify([p.position[0],p.position[2],-p.position[1]])+'},PointLight:'+JSON.stringify({color:p.color,intensity:p.intensity,range:p.range})+'}},';
  const shadow={mapSize:512,nearPlane:.1,farPlane:p.range,pcfKernelSize:3,normalBias:p.shadow.normalBias,depthBias:p.shadow.depthBias};
  world=replaceOne(world,original,original.slice(0,-3)+',PointLightShadow:'+JSON.stringify(shadow)+'}},');
 }
 return world;
}
export const POINT_SHADOW_RULES=`每个points项可显式设置shadow:{normalBias,depthBias}，无需遮挡时null。最多2个点光开启，使用固定Engine公开PointLightShadow、每面512像素、近面0.1米、远面等于该光range（须>0.1米）。这是实际几何的全向遮挡，不增加光源、不提供GI/灯罩透射；透明不投影表面不会被自动变成不透明。实际固定点光shader的normalBias是归一化深度的斜率系数0..0.05，depthBias是归一化深度下限0..0.005，二者都不是米，不能照搬directionalShadow的世界空间normalBias。依据受光几何尺度、距离和真实预览选择，过大将漏光，过小会有痤疮；不存在通用必过数值。保持必要亮度，不通过关灯/压暗隐藏缺陷，开启会增加GPU耗时。对于细槽或凹面，检查smoothAngle与实际曲面采样：粗网格过度平滑可能让插值法线朝灯而真实面背灯；阴影贴图有限分辨率无法解决所有这种近边缘误差。应结合精确部件、保留构型的曲面/法线修正及同机位预览，不能仅反复调色或调阴影偏移。`;
