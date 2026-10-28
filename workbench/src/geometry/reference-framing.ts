import {readFileSync} from 'node:fs';
import {digest} from '../store';
import {reconstructionPython} from '../runtime-paths.mjs';
import {referenceFrame} from './reference-frame.mjs';
import {anchorMedianDepth,poseFromAnchor,type ViewPose} from './measured-pose';

/** 从可信输入读尺寸；覆盖模型或历史任务携带的画幅，不修改来源场景。带测量视场（measured-fov-v1）的参考图同样固定透视参考机位的 fov；
 * 带测量相对位姿（measured-pose-v1）的参考图，以参考图 1 的机位为锚点推出其余透视参考机位的位置与朝向。 */
export function bindReferenceFrames<T extends {cameras:any[]}>(scene:T,images:{path:string;vfov?:number;pose?:ViewPose}[]):T{
 if(!images.length)return {...scene,cameras:scene.cameras.map(({frame,...c})=>c)};
 const p=Bun.spawnSync([reconstructionPython(),'-c','import json,sys; from PIL import Image; print(json.dumps([list(Image.open(p).size) for p in sys.argv[1:]]))',...images.map(i=>i.path)],{stdout:'pipe',stderr:'pipe'});
 if(p.exitCode)throw Error('无法读取原始参考图尺寸：'+new TextDecoder().decode(p.stderr).slice(-600));
 const sizes=JSON.parse(new TextDecoder().decode(p.stdout));
 const anchor=scene.cameras.find(c=>c.referenceIndex===1&&c.projection!=='orthographic');
 // measured-pose-v2：机位间距 = 测得比例 × 场景从参考机位 1 看到的中位深度，只在需要时计算一次
 const program=(scene as any).program,depth=anchor&&program&&images.some(i=>i.pose?.lockSpacing)?anchorMedianDepth(program,anchor):undefined;
 const frames=sizes.map(([w,h]:number[],i:number)=>({...referenceFrame(w,h),referenceSha256:digest(readFileSync(images[i].path))}));
 return {...scene,cameras:scene.cameras.map(({frame,...camera})=>{
  if(camera.referenceIndex===null)return camera;
  const actual=frames[camera.referenceIndex-1];if(!actual)throw Error('参考机位没有对应原图');
  const vfov=images[camera.referenceIndex-1].vfov;
  const pose=images[camera.referenceIndex-1].pose;
  // 位姿只在两端都是透视参考机位时锁定；锚点（参考图 1）保持场景给出的机位
  const placed=pose&&anchor&&camera.referenceIndex!==1&&camera.projection!=='orthographic'?poseFromAnchor(anchor,camera,pose,depth):{};
  return {...camera,frame:actual,...placed,...(Number.isFinite(vfov)&&camera.projection!=='orthographic'?{fov:vfov}:{})};
 })};
}
