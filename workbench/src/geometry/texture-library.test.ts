import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importTextureResource,loadTextureResource,textureCandidates,resolveTextureReuse} from './texture-library';
test('已有像素可跨任务复用，来源不同和损坏资源不能命中',()=>{
 const root=mkdtempSync(join(tmpdir(),'material-library-'));
 try{const ref='a'.repeat(64),texture={width:1,height:1,rgba8:Buffer.from([120,90,40,255]).toString('base64'),colorSpace:'srgb' as const};
 const id=importTextureResource({label:'旧木材',description:'均匀漫射光的平面木纹',referenceSha256:[ref],texture,source:{jobId:'previous',kind:'generated-material'}},root);
 expect(textureCandidates([ref],root)).toHaveLength(1);expect(textureCandidates(['b'.repeat(64)],root)).toHaveLength(0);
 const bindings={textures:[{id:'surface'}],textureReuse:[{textureId:'surface',assetId:id,reason:'同参考输入且木纹方向适合'}]};
 expect(resolveTextureReuse(bindings,[ref],root)[0].texture).toEqual(texture);
 expect(()=>resolveTextureReuse({...bindings,textureReuse:[...bindings.textureReuse,...bindings.textureReuse]},[ref],root)).toThrow('重复');
 expect(()=>resolveTextureReuse({...bindings,textures:[]},[ref],root)).toThrow('无效');
 const file=join(root,id+'.json'),resource=JSON.parse(readFileSync(file,'utf8'));resource.texture.rgba8=Buffer.from([1,2,3,255]).toString('base64');writeFileSync(file,JSON.stringify(resource));
 expect(()=>loadTextureResource(id,[ref],root)).toThrow('损坏');expect(textureCandidates([ref],root)).toHaveLength(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
