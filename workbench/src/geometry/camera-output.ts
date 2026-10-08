/** 场景相机的显示控制；未声明的历史场景保持原画面。 */
export type CameraOutput={antialias:'none'|'msaa';tonemap:'none'|'neutral';exposure:number};
const AA={none:'ANTIALIAS_NONE',msaa:'ANTIALIAS_MSAA'} as const;
const TONE={none:'TONEMAP_NONE',neutral:'TONEMAP_NEUTRAL'} as const;
export function cameraOutputSchema(){return {anyOf:[{type:'object',additionalProperties:false,properties:{antialias:{type:'string',enum:Object.keys(AA)},tonemap:{type:'string',enum:Object.keys(TONE)},exposure:{type:'number',minimum:.1,maximum:4}},required:['antialias','tonemap','exposure']},{type:'null'}]};}
export function validateCameraOutput(value:unknown):asserts value is CameraOutput|null|undefined{
 if(value==null)return;
 const v=value as CameraOutput;
 if(typeof v!=='object'||Array.isArray(v)||!Object.hasOwn(AA,v.antialias)||!Object.hasOwn(TONE,v.tonemap)||typeof v.exposure!=='number'||!Number.isFinite(v.exposure)||v.exposure<.1||v.exposure>4||Object.keys(v).some(k=>!['antialias','tonemap','exposure'].includes(k)))throw Error('相机显示参数无效');
 if(v.tonemap==='none'&&v.exposure!==1)throw Error('无色调映射时曝光不生效，exposure 必须为 1');
}
export function bindCameraOutput(world:string,value?:CameraOutput|null){
 validateCameraOutput(value);if(!value)return world;
 const importAnchor='perspective }',cameraAnchor='clearColor:';
 if(world.split(importAnchor).length!==2||world.split(cameraAnchor).length!==2)throw Error('相机显示导出模板契约变化');
 const aa=AA[value.antialias],tone=TONE[value.tonemap];
 return world.replace(importAnchor,`perspective, ${aa}, ${tone} }`).replace(cameraAnchor,`antialias:${aa},tonemap:${tone},exposure:${value.exposure},${cameraAnchor}`);
}
export const CAMERA_OUTPUT_RULES='cameraOutput 为整个场景各机位共享的真实 Engine 相机显示参数，null 保留历史默认（无抗锯齿、无色调映射、曝光1）。antialias 可选 none 或 msaa；msaa 使用固定引擎的4样本多重采样，改善细杆和轮廓锯齿，会增加GPU开销，不能修复穿模、裂缝或低清贴图。tonemap 可选 none 或 neutral；neutral 使用固定引擎的中性色调映射保留高光层次。exposure 是色调映射前线性曝光倍数0.1..4，非光源强度；tonemap=none 时必须为1，因为该路径不应用曝光。先依原图安排真实灯光和材质，再用实际预览选择显示参数，不靠过曝/过暗掩盖缺件，不假称增加了环境反射、间接光或灯罩散射；显示参数改变也必须经过独立评分。';
