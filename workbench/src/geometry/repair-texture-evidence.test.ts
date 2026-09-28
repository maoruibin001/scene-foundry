import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importTextureResource} from './texture-library';
import {repairReusableTextureEvidence} from './repair-texture-evidence';
import {digest} from '../store';
test('修复能看到同输入复用候选的真实像素及来源，不混入其他输入、不改资源',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reuse-evidence-')),library=join(root,'library');mkdirSync(library);
 const input={label:'暖色磨损面',description:'已有材质',referenceSha256:['a'.repeat(64)],texture:{width:2,height:2,rgba8:Buffer.from(Array(4).fill([120,60,20,255]).flat()).toString('base64'),colorSpace:'srgb' as const},source:{kind:'test-fixture'}};
 const id=importTextureResource(input,library);importTextureResource({...input,referenceSha256:['b'.repeat(64)]},library);const before=readFileSync(join(library,id+'.json'));
 try{const result=await repairReusableTextureEvidence(input.referenceSha256,root,AbortSignal.timeout(10000),library);expect(result.context).toHaveLength(1);expect(result.context[0]).toMatchObject({sheetId:'asset-01',assetId:id,provenance:input.source,pixelSha256:digest(Buffer.from(input.texture.rgba8,'base64'))});expect(readFileSync(result.images[0].path).length).toBeGreaterThan(100);expect(readFileSync(join(library,id+'.json'))).toEqual(before);expect((await repairReusableTextureEvidence(['c'.repeat(64)],root,AbortSignal.timeout(10000),library)).images).toEqual([]);}finally{rmSync(root,{recursive:true,force:true});}
});
