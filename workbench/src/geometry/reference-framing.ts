import {readFileSync} from 'node:fs';
import {digest} from '../store';
import {reconstructionPython} from '../runtime-paths.mjs';
import {referenceFrame} from './reference-frame.mjs';

/** 从可信输入读尺寸；覆盖模型或历史任务携带的画幅，不修改来源场景。 */
export function bindReferenceFrames<T extends {cameras:any[]}>(scene:T,images:{path:string}[]):T{
 if(!images.length)return {...scene,cameras:scene.cameras.map(({frame,...c})=>c)};
 const p=Bun.spawnSync([reconstructionPython(),'-c','import json,sys; from PIL import Image; print(json.dumps([list(Image.open(p).size) for p in sys.argv[1:]]))',...images.map(i=>i.path)],{stdout:'pipe',stderr:'pipe'});
 if(p.exitCode)throw Error('无法读取原始参考图尺寸：'+new TextDecoder().decode(p.stderr).slice(-600));
 const sizes=JSON.parse(new TextDecoder().decode(p.stdout));
 const frames=sizes.map(([w,h]:number[],i:number)=>({...referenceFrame(w,h),referenceSha256:digest(readFileSync(images[i].path))}));
 return {...scene,cameras:scene.cameras.map(({frame,...camera})=>{
  if(camera.referenceIndex===null)return camera;
  const actual=frames[camera.referenceIndex-1];if(!actual)throw Error('参考机位没有对应原图');
  return {...camera,frame:actual};
 })};
}
