import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {DATA,ROOT,read,save} from '../store';
import type {ToolContent} from '../codex-tools';

export function validateRegion(rect:any){if(!Array.isArray(rect)||rect.length!==4||rect.some(n=>!Number.isFinite(n)||n<0||n>1)||rect[0]>=rect[2]||rect[1]>=rect[3])throw Error('区域须为0..1的左上x、左上y、右下x、右下y，且面积为正');return rect as number[];}
export type RegionImage={label:string;path:string;rect:number[]};
export async function inspectVisualRegion(images:RegionImage[],folder:string,signal:AbortSignal):Promise<ToolContent[]>{
 for(const image of images)validateRegion(image.rect);save(join(folder,'region-request.json'),{images});
 const p=Bun.spawn([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/visual-region.py'),folder],{stdout:'pipe',stderr:'pipe',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error('局部像素检查失败：'+(err||out).slice(-1500));
 const result=read(join(folder,'region-result.json'));
 return [{type:'text',text:JSON.stringify(result)},...result.images.map((image:any)=>({type:'image' as const,mimeType:'image/png',data:readFileSync(join(folder,image.file)).toString('base64')}))];
}
