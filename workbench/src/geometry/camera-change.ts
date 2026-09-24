import {sceneVisibility} from './visibility';
import type {SceneInput} from './scene-contract';
import type {Texture} from './program';
import {digest} from '../store';

export const CAMERA_CHANGE_PROMPT='若输入有cameraChangeFeedback，它比较的是当前同一份几何在本轮机位与上一轮机位下的可见面积，已隔离几何修改影响。before为旧机位、after为当前机位；不是旧画面与新画面的像素评分。结合原始参考、当前实际截图及独立评审，检查相机小幅移动是否意外放大前景遮挡、裁切主体或丢失层次。必要时同时调整机位和布局，不要机械回退所有机位，也不要因为面积增加就删除正确的前景；先解决有实际画面证据的退步，再修其他差距。诊断不含光照和材质外观，不能代替最终 Engine 运行与独立评分。';
const cameraKey=(c:SceneInput['cameras'][number])=>c.referenceIndex===null?'name:'+c.name:'ref:'+c.referenceIndex;
const pose=(c:SceneInput['cameras'][number])=>({position:c.position,target:c.target,fov:c.fov});
const partKey=(p:{instanceId:string;partId:string})=>JSON.stringify([p.instanceId,p.partId]);

/** 同几何的机位反事实，仅反馈变化，不评分、不自动选择机位或放宽迭代停止条件。 */
export function cameraChangeFeedback(previous:SceneInput,current:SceneInput,textures:Record<string,Texture>={}){
 const pairs=current.cameras.flatMap(after=>{const before=previous.cameras.find(c=>cameraKey(c)===cameraKey(after));return before&&JSON.stringify(pose(before))!==JSON.stringify(pose(after))?[{before,after}]:[];});
 if(!pairs.length)return null;
 // 一次编译，成对渲染同一份当前几何；使用全部可见部件，不能把被摘要截断的部件误记为零。
 const report=sceneVisibility({...current,cameras:pairs.flatMap(p=>[p.before,p.after])},textures);
 const views=pairs.map(({before,after},index)=>{
  const a=report.views[index*2],b=report.views[index*2+1];
  const oldParts=new Map(a.parts.map(p=>[partKey(p),p])),newParts=new Map(b.parts.map(p=>[partKey(p),p]));
  const changes=[...new Set([...oldParts.keys(),...newParts.keys()])].map(key=>{
   const old=oldParts.get(key),next=newParts.get(key),meta=next??old!;
   return {instanceId:meta.instanceId,label:meta.label,templateId:meta.templateId,partId:meta.partId,materialId:meta.materialId,
    beforeFraction:old?.frameFraction??0,afterFraction:next?.frameFraction??0,change:+((next?.frameFraction??0)-(old?.frameFraction??0)).toFixed(5),beforeRect:old?.rect??null,afterRect:next?.rect??null};
  });
  return {cameraName:after.name,referenceIndex:after.referenceIndex,before:pose(before),after:pose(after),
   areaIncreases:changes.filter(p=>p.change>0).sort((a,b)=>b.change-a.change).slice(0,8),
   areaDecreases:changes.filter(p=>p.change<0).sort((a,b)=>a.change-b.change).slice(0,8)};
 });
 return {method:'camera-change-feedback-v1',previousSceneDigest:digest(JSON.stringify(previous)),currentSceneDigest:digest(JSON.stringify(current)),
  quality:'not-assessed',geometry:'当前几何完全一致，仅替换机位；旧机位不代表已通过验收',limitations:report.limitations,excludedMaterials:report.excludedMaterials,views};
}
