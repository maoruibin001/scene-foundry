import {describe,it,expect} from 'bun:test';
import {createSupportSurface,deriveSupportSurface} from './support-surface';
import {bindingWrapper} from './adopt-candidate';
describe('existing game incremental bridge',()=>{
 it('rebinds the stable scene entity without rebuilding the game root or scripts',()=>{const s=bindingWrapper('./base.ts','scene/old',[{entity:'door',mesh:'mesh-guid'}]);expect(s).toContain('base.build(ctx)');expect(s).toContain('e.components.MeshFilter=');expect(s).not.toContain('Transform=');expect(s).toContain('INTEGRATION_ENTITY_MISSING');});
 it('uses upward source triangles, retains holes and disc clearance',()=>{
 const p=new Float32Array([0,0,0,0,0,10,10,0,0,10,0,10]);const data=deriveSupportSurface(p,new Uint16Array([0,1,2,2,1,3]));const stand=createSupportSurface(data,.35);expect(stand(5,5)).toBe(true);expect(stand(.1,5)).toBe(false);expect(stand(11,5)).toBe(false);expect(stand(NaN,5)).toBe(false);
 });
 it('rejects floors without upward support instead of filling a pit',()=>expect(()=>deriveSupportSurface(new Float32Array([0,0,0,10,0,0,0,0,10]),new Uint16Array([0,1,2]))).toThrow('NO_UPWARD'));
 it('blocks body-height walls including vertical projected degenerate triangles',()=>{const data={height:0,triangles:[[0,0,0,10,10,0],[10,0,0,10,10,10]],obstacles:[[4,0,4,10,4,10]]};const stand=createSupportSurface(data,.35);expect(stand(5,5)).toBe(true);expect(stand(4.1,5)).toBe(false);});
});
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {adoptCandidate} from './adopt-candidate';
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'pipeline-adoption-test-')),game=join(root,'game'),intake=join(root,'intake'),library=join(root,'library');
 for(const p of [join(game,'assets'),intake,library])mkdirSync(p,{recursive:true});
 const original='// existing game source';writeFileSync(join(game,'assets/original.pack.ts'),original);
 const bin=Buffer.alloc(80),pos=new Float32Array(bin.buffer,bin.byteOffset,9);pos.set([0,0,0,0,0,10,10,0,0]);new Uint16Array(bin.buffer,bin.byteOffset+36,3).set([0,1,2]);new Float32Array(bin.buffer,bin.byteOffset+44,6).set([0,0,0,10,0,10]);
 const meta=JSON.stringify({rest:{kind:'mesh',submeshes:[{indexOffset:0,indexCount:3,materialSlot:0,topology:'triangle-list'}],materialSlots:[{slotName:'floor'}]},layout:{'attributes.position':{type:'Float32Array',offset:0,length:9},indices:{type:'Uint16Array',offset:36,length:3},aabb:{type:'Float32Array',offset:44,length:6}}});
 writeFileSync(join(library,'floor.bin'),bin);writeFileSync(join(library,'floor.json'),meta);
 const source={pack:'assets/original.pack.ts',sceneKey:'scene/old',packSha256:hash(original),transforms:['a','b'].map(id=>({id,sourceKey:id,engine:{pos:[0,0,0],quat:[0,0,0,1],scale:[1,1,1]}})),meshSources:[{source:'mesh/floor',ref:{metadata:'floor.json',binary:'floor.bin',metadataSha256:hash(meta),binarySha256:hash(bin),slots:{floor:'m'}}}]};
 writeFileSync(join(intake,'source-intake.json'),JSON.stringify(source));
 const request=(revision:string,id:string,base:string,pkg:string)=>{
  const candidate=join(root,revision);mkdirSync(join(candidate,'cooked'),{recursive:true});writeFileSync(join(candidate,'cooked/changed.bin'),bin);
  writeFileSync(join(candidate,'spec-data.ts'),'export default '+JSON.stringify({packageId:pkg,name:'test',entities:[{id,mesh:'changed',pos:[0,0,0],quat:[0,0,0,1],scale:[1,1,1]}],meshes:[{key:'changed',slots:{floor:'m'},cooked:{sha256:hash(bin).slice(0,16)}}],materials:[{key:'m',options:{roughness:.5}}]}));
  const receipt=join(candidate,'receipt.json');writeFileSync(receipt,JSON.stringify({changedObjects:[id],retainedObjects:['other'],baseSpecSha256:base,resultSpecSha256:revision}));
  return {game,candidate,intake,receipt,sourceLibrary:library,floorSource:'mesh/floor',revision,supportHeight:0,runtime:{gate:'static-open' as const,radius:.35}};
 };
 return {root,game,original,request};
}
it('applies consecutive revisions without stacking wrappers or losing the previous changed entity',async()=>{
 const f=fixture();try{
 const a=await adoptCandidate(f.request('r1','a','base','019fb7ce-1100-7000-8000-000000000001'));
 const b=await adoptCandidate(f.request('r2','b','r1','019fb7ce-1100-7000-8000-000000000002'));
 expect(b.bindings.map((n:any)=>n.entity)).toEqual(['a','b']);expect(b.previousRevision).toBe('r1');
 expect(readFileSync(join(f.game,'assets/original.pipeline-base.ts'),'utf8')).toBe(f.original);
 expect(readFileSync(join(f.game,'assets/original.pack.ts'),'utf8')).toContain(a.bindings[0].mesh);
 const before=readFileSync(join(f.game,'assets/original.pack.ts'),'utf8');
 await expect(adoptCandidate(f.request('r3','a','wrong-base','019fb7ce-1100-7000-8000-000000000003'))).rejects.toThrow('STALE_CONTINUATION');
 expect(readFileSync(join(f.game,'assets/original.pack.ts'),'utf8')).toBe(before);expect(existsSync(join(f.game,'assets/pipeline-revisions/r3'))).toBe(false);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
it('refuses a changed binary and leaves the existing game untouched',async()=>{
 const f=fixture();try{
 const request=f.request('r1','a','base','019fb7ce-1100-7000-8000-000000000001');writeFileSync(join(request.candidate,'cooked/changed.bin'),'corrupt');
 await expect(adoptCandidate(request)).rejects.toThrow('CANDIDATE_MESH_DRIFT');expect(readFileSync(join(f.game,'assets/original.pack.ts'),'utf8')).toBe(f.original);expect(existsSync(join(f.game,'assets/original.pipeline-base.ts'))).toBe(false);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
import {environmentWrapperFragment} from './environment-adoption';
it('adopts explicit pipeline lighting and camera effects without replacing geometry or camera transforms',()=>{
 const x=environmentWrapperFragment({removeKeys:['oldSky'],components:['Camera','Name','Transform','SpotLight','Skylight'],entities:{camera:{components:{Camera:{exposure:.8},Transform:{pos:[1,2,3]},Name:{value:'capture'}}},ambient:{components:{Skylight:{intensity:.1}}}}});
 expect(x.body).toContain('ENV_WOULD_REMOVE_GEOMETRY');expect(x.body).toContain('"exposure":0.8');expect(x.body).not.toContain('"pos"');expect(x.definition).toContain('RenderComponents');
});
