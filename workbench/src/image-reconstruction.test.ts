import {test,expect} from 'bun:test';
import {freezeImageGoal,validateImageGoal,imageReconstructionReport,assessImageReconstruction,IMAGE_ATTRIBUTES} from './image-reconstruction';
const images=[{id:'a'.repeat(64)},{id:'b'.repeat(64)}];
const goal=freezeImageGoal(images)!;
const runtime={images:['reference-1.png','reference-2.png','inspection.png'],hashes:['c'.repeat(64),'d'.repeat(64),'e'.repeat(64)],distManifestDigest:'f'.repeat(64),referenceFrames:[{referenceIndex:1,file:'reference-1.png'},{referenceIndex:2,file:'reference-2.png'},{referenceIndex:null,file:'inspection.png'}]};
const rows=()=>images.map((_,n)=>({referenceIndex:n+1,referenceSha256:images[n].id,frames:['reference-'+(n+1)+'.png'],attributes:Object.fromEntries(IMAGE_ATTRIBUTES.map(a=>[a.id,{status:'close',reason:'可见主体、关系和表面接近对应原图'}]))}));
test('原始图片、顺序和允许偏差都冻结；派生图不能替换目标',()=>{
 expect(validateImageGoal(goal,images).id).toBe(goal.id);
 expect(()=>validateImageGoal({...goal,minimum:'same_topic'})).toThrow('修改');
 expect(()=>validateImageGoal(goal,[...images].reverse())).toThrow('不一致');
 expect(()=>freezeImageGoal([images[0],images[0]])).toThrow('不重复');
 expect(freezeImageGoal([])).toBeNull();
 const edited=freezeImageGoal(images,'把灯改为红色')!;expect(validateImageGoal(edited,images,'把灯改为红色').promptPriority).toBe('explicit_user_modifications_only');
 expect(()=>validateImageGoal(edited,images,'把灯改为蓝色')).toThrow('文字');
});
test('局部差异可以大体一致；任何主要属性明显变化都独立判失败',()=>{
 const r=rows();r[0].attributes.materials.status='minor_difference';
 expect(imageReconstructionReport(goal,r,runtime)).toMatchObject({status:'passed',level:'broadly_consistent'});
 r[1].attributes.layout={status:'major_difference',reason:'通道和吧台位置明显不同'};
 expect(imageReconstructionReport(goal,r,runtime)).toMatchObject({status:'failed',level:'major_differences'});
});
test('漏看第二张图、重复第一张图和引用不存在的图不能冒充完成对照',()=>{
 expect(()=>imageReconstructionReport(goal,rows().slice(0,1),runtime)).toThrow('逐张');
 expect(()=>imageReconstructionReport(goal,[rows()[0],rows()[0]],runtime)).toThrow('重复');
 const r=rows();r[1].frames=['invented.png'];expect(()=>imageReconstructionReport(goal,r,runtime)).toThrow('不存在');
});
test('检查机位和另一张原图的机位不能替代对应参考机位',()=>{
 const r=rows();r[1].frames=['inspection.png','reference-1.png'];
 expect(imageReconstructionReport(goal,r,runtime)).toMatchObject({status:'needs_review',level:'unverified'});
 expect(imageReconstructionReport(goal,r,{...runtime,referenceFrames:[]})).toMatchObject({status:'needs_review'});
 expect(()=>imageReconstructionReport(goal,rows(),{...runtime,referenceFrames:[...runtime.referenceFrames,{referenceIndex:2,file:'reference-1.png'}]})).toThrow('归属');
 expect(()=>imageReconstructionReport(goal,rows(),{...runtime,hashes:[runtime.hashes[0],runtime.hashes[0],runtime.hashes[2]]})).toThrow('重复机位');
});
test('证据不足和资产未齐不能显示成品还原通过；不能删掉某个视觉属性',()=>{
 const r=rows();r[0].attributes.shape={status:'unverified',reason:'关键轮廓被遮挡'};
 expect(imageReconstructionReport(goal,r,runtime).status).toBe('needs_review');
 expect(imageReconstructionReport(goal,rows(),runtime,true)).toMatchObject({status:'needs_review',scope:'partial'});
 delete r[0].attributes.shape;expect(()=>imageReconstructionReport(goal,r,runtime)).toThrow('全部视觉属性');
});
test('五张不同参考图分别绑定对应机位、原图和截图SHA，不用平均掩盖最后一图',()=>{
 const input=Array.from({length:5},(_,n)=>({id:String(n+1).repeat(64)})),g=freezeImageGoal(input)!;
 const rt={images:input.map((_,n)=>'reference-'+(n+1)+'.png'),hashes:input.map((_,n)=>(n+6).toString(16).repeat(64)),distManifestDigest:'f'.repeat(64),referenceFrames:input.map((_,n)=>({referenceIndex:n+1,file:'reference-'+(n+1)+'.png'}))};
 const findings=input.map((i,n)=>({referenceIndex:n+1,referenceSha256:i.id,frames:[rt.images[n]],attributes:structuredClone(rows()[0].attributes)}));
 const report=imageReconstructionReport(g,findings,rt);expect(report.status).toBe('passed');expect(report.references[4].frameHashes).toEqual([{file:'reference-5.png',sha256:rt.hashes[4]}]);
 findings[4].attributes.subjects={status:'major_difference',reason:'主要建筑轮廓缺失'};expect(imageReconstructionReport(g,findings,rt).status).toBe('failed');
});
test('错原图SHA、错索引、未知判定和无效截图SHA全部不能成为一致',()=>{
 let r=rows();r[0].referenceSha256=images[1].id;expect(()=>imageReconstructionReport(goal,r,runtime)).toThrow('摘要不匹配');
 r=rows();r[1].referenceIndex=3;expect(()=>imageReconstructionReport(goal,r,runtime)).toThrow();
 r=rows();r[0].attributes.camera.status='looks_good';expect(()=>imageReconstructionReport(goal,r,runtime)).toThrow('判定');
 expect(()=>imageReconstructionReport(goal,rows(),{...runtime,hashes:['bad']})).toThrow('摘要');
 expect(assessImageReconstruction({images,reconstructionGoal:goal},{referenceMatch:r},runtime).imageReconstruction.status).toBe('needs_review');
});
test('新任务缺对照报告只标未核实，旧任务不补评分、不生成虚假的一致状态',()=>{
 expect(assessImageReconstruction({images,reconstructionGoal:goal},{},runtime).imageReconstruction).toMatchObject({status:'needs_review',level:'unverified'});
 expect(assessImageReconstruction({images},{},runtime)).toEqual({});
});
