import {test,expect} from 'bun:test';
import {imageReconstructionHTML} from '../public/image-reconstruction-ui.js';
import {freezeImageGoal,imageReconstructionReport,IMAGE_ATTRIBUTES} from './image-reconstruction';
test('70分已通过也不会把明显不同的原图对照显示成通过，理由不能注入HTML',()=>{
 const goal=freezeImageGoal([{id:'a'.repeat(64)}]);
 const attributes=Object.fromEntries(IMAGE_ATTRIBUTES.map(a=>[a.id,{status:'close',reason:'接近'}]));attributes.layout={status:'major_difference',reason:'<script>错误布局</script>'};
 const report=imageReconstructionReport(goal,[{referenceIndex:1,referenceSha256:'a'.repeat(64),frames:['reference-1.png'],attributes}],{images:['reference-1.png'],hashes:['c'.repeat(64)],distManifestDigest:'f'.repeat(64),referenceFrames:[{referenceIndex:1,file:'reference-1.png'}]});
 const html=imageReconstructionHTML({id:'test',status:'passed',deliveryAssessment:{standard:'basic70',status:'passed'},reconstructionGoal:goal,imageReconstruction:report,runtime:{distManifestDigest:report.distManifestDigest}});
 expect(html).toContain('存在明显差异');expect(html).toContain('badge failed');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
 expect(imageReconstructionHTML({id:'old',status:'passed'})).toBe('');
 expect(imageReconstructionHTML({reconstructionGoal:goal})).toContain('等待成品原图对照');
 expect(imageReconstructionHTML({reconstructionGoal:goal,imageReconstruction:{...report,status:'passed',level:'close'},runtime:{distManifestDigest:'old-build'}})).toContain('证据不匹配');
});
test('详情采用实际交付候选的报告和路径，不能把根目录报告套到另一轮',()=>{
 const goal=freezeImageGoal([{id:'a'.repeat(64)}]),root={goalId:goal.id,distManifestDigest:'b'.repeat(64),status:'failed',level:'major_differences',references:[]};
 const best={kind:'scene',distManifestDigest:'c'.repeat(64),reconstructionGoal:goal,imageReconstruction:{...root,distManifestDigest:'c'.repeat(64),status:'passed',level:'close'},imageReconstructionFile:'iterations/1/image-reconstruction.json'};
 const job={id:'test',reconstructionGoal:goal,imageReconstruction:root,runtime:{distManifestDigest:root.distManifestDigest},delivery:{best}};
 let html=imageReconstructionHTML(job);expect(html).toContain('可见范围接近参考');expect(html).toContain('/iterations/1/image-reconstruction.json');expect(html).not.toContain('存在明显差异');
 html=imageReconstructionHTML({...job,delivery:{best:{...best,imageReconstruction:null,imageReconstructionFile:null}}});expect(html).toContain('没有有效的原图对照报告');expect(html).not.toContain('/image-reconstruction.json');
 html=imageReconstructionHTML({...job,delivery:{best:{...best,kind:'graybox'}}});expect(html).toContain('证据不匹配');expect(html).not.toContain('可见范围接近参考');
});
