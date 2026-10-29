import {readFileSync} from 'node:fs';
import {digest} from '../store';
import {reconstructionPython} from '../runtime-paths.mjs';
import {referenceFrame} from './reference-frame.mjs';
import {poseFromAnchor,sceneProbe,type ViewPose} from './measured-pose';
import {lockAnchorCamera,type AnchorCamera} from './measured-camera';

/** 从可信输入读尺寸；覆盖模型或历史任务携带的画幅，不修改来源场景。带测量视场（measured-fov-v1）的参考图同样固定透视参考机位的 fov；
 * 带测量相对位姿（measured-pose-v1）的参考图，以参考图 1 的机位为锚点推出其余透视参考机位的位置与朝向。 */
// Scenes this function returned. The graybox preview binds a candidate and hands that object to the repair renderer, which binds again;
// the measured locks are not idempotent (camera 1's locked height depends on the depth seen from where it already stands, and the
// derived pose drifts by ~1e-15), so the second pass changed the scene hash and every repair preview failed (v27, 2026-10-29).
// The visual repair derives each candidate from the bound source and the renderer binds that copy again (v31, 2026-10-29: every
// candidate preview failed "实际预览回执与候选不一致"), so the identity check is not enough: a locked camera carries `measuredLock`, the
// digest of the pose it was locked to, and a scene whose reference cameras all still match their stamps is returned unchanged. A camera a
// patch moved no longer matches and is locked again.
const BOUND=new WeakSet<object>();
const lockStamp=(c:any)=>digest(JSON.stringify([c.position,c.target,c.fov]));
const locks=(images:{vfov?:number;pose?:ViewPose;camera?:AnchorCamera}[])=>images.some(i=>Number.isFinite(i.vfov)||i.pose||i.camera);
export function bindReferenceFrames<T extends {cameras:any[]}>(scene:T,images:{path:string;vfov?:number;pose?:ViewPose;camera?:AnchorCamera}[]):T{
 if(BOUND.has(scene))return scene;
 const reference=scene.cameras.filter(c=>c.referenceIndex!==null&&c.projection!=='orthographic');
 if(locks(images)&&reference.length&&reference.every(c=>c.frame&&c.measuredLock===lockStamp(c))){BOUND.add(scene);return scene;}
 const bound=bindOnce(scene,images);
 if(locks(images))bound.cameras=bound.cameras.map(c=>c.referenceIndex!==null&&c.projection!=='orthographic'?{...c,measuredLock:lockStamp(c)}:c);
 BOUND.add(bound);return bound;
}
function bindOnce<T extends {cameras:any[]}>(scene:T,images:{path:string;vfov?:number;pose?:ViewPose;camera?:AnchorCamera}[]):T{
 if(!images.length)return {...scene,cameras:scene.cameras.map(({frame,...c})=>c)};
 const p=Bun.spawnSync([reconstructionPython(),'-c','import json,sys; from PIL import Image; print(json.dumps([list(Image.open(p).size) for p in sys.argv[1:]]))',...images.map(i=>i.path)],{stdout:'pipe',stderr:'pipe'});
 if(p.exitCode)throw Error('无法读取原始参考图尺寸：'+new TextDecoder().decode(p.stderr).slice(-600));
 const sizes=JSON.parse(new TextDecoder().decode(p.stdout));
 const program=(scene as any).program,measured=images[0]?.camera,original=scene.cameras.find(c=>c.referenceIndex===1&&c.projection!=='orthographic');
 const probe=original&&program&&(measured||images.some(i=>i.pose?.lockSpacing))?sceneProbe(program):undefined;
 // measured-camera-v1：先按测量值固定参考机位 1 的高度与俯仰，其余参考机位再从它推出
 const anchor=original&&measured&&probe?{...original,...lockAnchorCamera(original,measured,probe)}:original;
 // measured-pose-v2：机位间距 = 测得比例 × 场景从参考机位 1 看到的中位深度，只在需要时计算一次
 const depth=anchor&&images.some(i=>i.pose?.lockSpacing)?probe?.depth(anchor):undefined;
 const frames=sizes.map(([w,h]:number[],i:number)=>({...referenceFrame(w,h),referenceSha256:digest(readFileSync(images[i].path))}));
 return {...scene,cameras:scene.cameras.map(({frame,measuredLock,...camera})=>{
  if(camera.referenceIndex===null)return camera;
  const actual=frames[camera.referenceIndex-1];if(!actual)throw Error('参考机位没有对应原图');
  const vfov=images[camera.referenceIndex-1].vfov;
  const pose=images[camera.referenceIndex-1].pose;
  // 位姿只在两端都是透视参考机位时锁定；锚点（参考图 1）保持场景给出的机位
  const placed=camera.referenceIndex===1&&anchor!==original&&camera.projection!=='orthographic'?{position:anchor!.position,target:anchor!.target}:pose&&anchor&&camera.referenceIndex!==1&&camera.projection!=='orthographic'?poseFromAnchor(anchor,camera,pose,depth,probe?.clearance):{};
  return {...camera,frame:actual,...placed,...(Number.isFinite(vfov)&&camera.projection!=='orthographic'?{fov:vfov}:{})};
 })};
}
