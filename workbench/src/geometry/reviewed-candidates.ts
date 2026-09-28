import {existsSync,readFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import {previewPerformance} from './preview-performance';

export const REVIEWED_SELECTION_SCHEMA={type:'object',properties:{selectedPatchSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},reason:{type:'string',minLength:1,maxLength:2000}},required:['selectedPatchSha256','reason'],additionalProperties:false};
export function reviewedCandidates(options:{folder:string;validate:(patch:any)=>any;apply:(patch:any)=>any}){
 const candidates=new Map<string,{index:number;patch:any;images:{path:string;mime:string}[];performance:any}>();
 function add(row:any,restoring=false){
  if(!Number.isInteger(row.index)||row.index<1)throw Error('候选记录编号无效');
  const dir=join(options.folder,String(row.index)),patch=read(join(dir,'patch.json'));
  if(digest(stable(patch))!==row.patchSha256)throw Error('候选补丁摘要不符');
  options.validate(patch);const scene=options.apply(patch);
  if(digest(stable(scene))!==row.sceneSha256)throw Error('候选场景摘要不符');
  const receiptFile=join(dir,'engine-preview-receipt.json'),images:{path:string;mime:string}[]=[];let performance:any=null;
  if(existsSync(receiptFile)){
   const receipt=read(receiptFile);
   performance=previewPerformance(receipt.frames??[]);
   if(receipt.sceneSha256!==digest(JSON.stringify(scene)))throw Error('实际预览回执与候选不一致');
   if(!receipt.frames?.length)throw Error('候选缺少实际截图');
   for(const frame of receipt.frames){
    if(basename(frame.file)!==frame.file)throw Error('候选截图路径无效');
    const path=join(dir,'capture',frame.file);
    if(digest(readFileSync(path))!==frame.sha256)throw Error('候选截图摘要不符');
    images.push({path,mime:'image/png'});
   }
  }else if(restoring)throw Error('恢复候选缺少实际预览回执');
  candidates.set(row.patchSha256,{index:row.index,patch,images,performance});
 }
 return {add,
  has:(patch:any)=>candidates.has(digest(stable(patch))),
  hashes:()=>[...candidates.keys()],
  context:()=>({candidates:[...candidates].map(([hash,c])=>({selectedPatchSha256:hash,previewIndex:c.index,reason:c.patch.reason,imageCount:c.images.length,performance:c.performance})),images:[...candidates.values()].flatMap(c=>c.images)}),
  resolve(value:any){
   if(!value||Object.keys(value).sort().join(',')!=='reason,selectedPatchSha256'||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000)throw Error('最终结果必须选择已成功预览的候选编号并说明理由');
   const selected=candidates.get(value.selectedPatchSha256);if(!selected)throw Error('REPAIR_PREVIEW_REQUIRED：未找到成功预览的候选编号');
   const patch=read(join(options.folder,String(selected.index),'patch.json'));
   if(digest(stable(patch))!==value.selectedPatchSha256)throw Error('已选候选补丁发生变化');
   options.validate(patch);
   save(join(options.folder,'selected-candidate.json'),{...value,previewIndex:selected.index,quality:'not-assessed',selectedAt:new Date().toISOString()});
   return patch;
  }};
}
