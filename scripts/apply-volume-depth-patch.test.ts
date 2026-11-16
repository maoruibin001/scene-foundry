import {test,expect} from 'bun:test';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync,symlinkSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';import {tmpdir} from 'node:os';
const patch=resolve(import.meta.dir,'../patches/engine-volume-depth-v1'),manifest=JSON.parse(readFileSync(join(patch,'manifest.json'),'utf8')),shared=resolve(import.meta.dir,'../engine');
function fixture(){const root=mkdtempSync(join(tmpdir(),'volume-sdk-test-'));for(const f of manifest.files){const dest=join(root,f.path);mkdirSync(dirname(dest),{recursive:true});cpSync(join(shared,f.path),dest);}writeFileSync(join(root,'.scene-foundry-isolated-sdk.json'),JSON.stringify({purpose:'engine-volume-depth-validation',source:shared}));return root;}
function apply(root:string){return Bun.spawnSync(['bun',join(import.meta.dir,'apply-volume-depth-patch.ts'),root],{stdout:'pipe',stderr:'pipe'});}
test('only the admitted private SDK gets the exact pinned patch and readback digests',()=>{const root=fixture();try{expect(apply(root).exitCode).toBe(0);const r=JSON.parse(readFileSync(join(root,'engine-volume-depth-patch.json'),'utf8'));expect(r.files).toHaveLength(manifest.files.length);expect(readFileSync(join(root,manifest.files[0].path),'utf8')).toBe(readFileSync(join(patch,'volume-integrate.wgsl'),'utf8'));expect(apply(root).exitCode).not.toBe(0);}finally{rmSync(root,{recursive:true,force:true});}});
test('wrong input or source alias rejects the whole patch before either file is mutated',()=>{const root=fixture();try{const shader=join(root,manifest.files[0].path),runtime=join(root,manifest.files[1].path),before=readFileSync(shader,'utf8');writeFileSync(runtime,'unrecognized runtime');expect(apply(root).exitCode).not.toBe(0);expect(readFileSync(shader,'utf8')).toBe(before);writeFileSync(join(root,'.scene-foundry-isolated-sdk.json'),JSON.stringify({purpose:'engine-volume-depth-validation',source:root}));expect(apply(root).exitCode).not.toBe(0);}finally{rmSync(root,{recursive:true,force:true});}});
test('a symlink to an external SDK is refused and leaves that external file untouched',()=>{const root=fixture(),external=mkdtempSync(join(tmpdir(),'volume-external-test-'));try{const f=manifest.files[0],dest=join(root,f.path),outside=join(external,'shader.wgsl');cpSync(dest,outside);rmSync(dest);symlinkSync(outside,dest);const before=readFileSync(outside,'utf8');expect(apply(root).exitCode).not.toBe(0);expect(readFileSync(outside,'utf8')).toBe(before);}finally{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});}});

test('coarse and depth resolve use the same admitted module but retain distinct compute entries',()=>{
 const ops=JSON.parse(readFileSync(join(patch,'runtime-replacements.json'),'utf8')),op=ops.find((o:any)=>o.new.startsWith('function computeProgram('));expect(op).toBeDefined();
 const labels:string[]=[],owner={compute:new Map()},module={};
 const compute=new Function('programsFor','witness','sameWitness','return ('+op.new.trim()+')')(
  ()=>owner,(_ctx:any,source:any,label:string)=>{labels.push(label);if(label!=='volume_integrate')throw Error('unadmitted module');return {source,module};},(a:any,b:any)=>a?.source===b.source&&a.module===b.module,
 );
 const source={};const coarse=compute({},source,'volume_integrate_coarse'),resolve=compute({},source,'volume_integrate');expect(labels).toEqual(['volume_integrate','volume_integrate']);expect(owner.compute.size).toBe(2);expect(coarse.module).toBe(resolve.module);
});

test('dense fallback graph resets each frame and orders job production before consumption',()=>{
 const ops=JSON.parse(readFileSync(join(patch,'runtime-replacements.json'),'utf8'));
 const source=ops.find((o:any)=>o.new.startsWith('function addVolumetricFogPasses(')).new.split('\n\n// src/pipeline/')[0];
 const addPasses=new Function('VOLUME_PACKING_Z','return ('+source+'\n)')(4),calls:any[]=[];
 const graph=Object.fromEntries(['addComputePass','addCopyPass','addRasterPass'].map(kind=>[kind,(name:string,descriptor:any)=>{calls.push({kind,name,...descriptor});return {ok:true};}]));
 const result=addPasses(graph,{resources:{extent:{width:33,height:23,depth:48},resolvedExtent:{width:33,height:23},coarseExtent:{width:5,height:3},fallbackJobs:'jobs',fallbackCount:'count'},linearHdr:{view:'hdr'}});
 expect(result.ok).toBe(true);
 const names=calls.map(c=>c.name);expect(names.indexOf('volume-fallback-reset')).toBeLessThan(names.indexOf('volume-integrate'));expect(names.indexOf('volume-integrate')).toBeLessThan(names.indexOf('volume-integrate-fallback'));expect(names.indexOf('volume-integrate-fallback')).toBeLessThan(names.indexOf('volume-temporal'));
 const reset=calls.find(c=>c.name==='volume-fallback-reset'),writes:any[]=[];
 for(let frame=0;frame<2;frame++)reset.encodeDirect(null,{runtime:{device:{queue:{writeBuffer:(buffer:any,offset:number,bytes:Uint32Array)=>{writes.push({buffer,offset,bytes:[...bytes]});return {unwrap:()=>{}};}}}}},{buffer:(id:string)=>{expect(id).toBe('count');return {unwrap:()=>'actual-count-buffer'};}});
 expect(writes).toEqual([{buffer:'actual-count-buffer',offset:0,bytes:[0]},{buffer:'actual-count-buffer',offset:0,bytes:[0]}]);
 expect(calls.find(c=>c.name==='volume-integrate').accesses).toContainEqual({resource:'jobs',usage:'storage-write'});expect(calls.find(c=>c.name==='volume-integrate-fallback').accesses).toContainEqual({resource:'jobs',usage:'storage-read'});
});

test('fallback uses two storage buffers without adding sampled textures or duplicating bindings',()=>{
 const ops=JSON.parse(readFileSync(join(patch,'runtime-replacements.json'),'utf8')),source=ops.find((o:any)=>o.new.startsWith('computeEntries.volume_integrate_coarse')).new.split('function computeDescriptor')[0];
 const entries:any={volume_integrate:[{binding:8,storageTexture:{access:'write-only'}}]};new Function('computeEntries','VOLUME_RESOLVED_FORMAT',source)(entries,'rgba16float');
 expect(entries.volume_integrate_coarse[0].storageTexture.access).toBe('write-only');
 for(const label of ['volume_integrate','volume_integrate_fallback']){expect(entries[label].map((b:any)=>b.binding)).toEqual([8,30,31]);expect(entries[label][0].storageTexture.access).toBe('read-only');expect(entries[label].slice(1).every((b:any)=>b.buffer.type==='storage')).toBe(true);}
});

test('post-prepare witness revalidation also resolves the admitted integrate module',async()=>{
 const ops=JSON.parse(readFileSync(join(patch,'runtime-replacements.json'),'utf8'));
 const witnessOp=ops.find((o:any)=>o.new.startsWith('function witness('));expect(witnessOp).toBeDefined();
 const labels:string[]=[],module={},factory={createShaderModule:(descriptor:any)=>{labels.push(descriptor.label);if(!['volume_inject','volume_integrate','volume_temporal','volume_composite'].includes(descriptor.label))throw Error('unadmitted module');return {ok:true,value:module};}};
 const witness=new Function('shaderSourceDescriptor','return ('+witnessOp.new+'\n)')((source:any,label:string)=>({source,label}));
 const context={shaderModuleFactory:factory,deviceScope:{isAlive:()=>true}};
 const prepareOp=ops.find((o:any)=>o.new.startsWith('async function prepareVolumePrograms('));
 const same=(a:any,b:any)=>a.source===b.source&&a.module===b.module;
 const run=(moduleWitness:any)=>new Function('computeProgram','compositeProgram','prepare','computeDescriptor','compositeDescriptor','sameWitness','witness','unavailable3','return ('+prepareOp.new+'\n)')(
  (ctx:any,source:any,label:string)=>moduleWitness(ctx,source,label==='volume_integrate_coarse'?'volume_integrate':label),
  (ctx:any,source:any)=>moduleWitness(ctx,source,'volume_composite'),
  async()=>{},()=>{},()=>{},same,moduleWitness,(message:string)=>new Error(message),
 )(context,{inject:{},integrate:{},temporal:{},composite:{}},'rgba16float');
 const oldWitness=new Function('shaderSourceDescriptor','return ('+witnessOp.old+'\n)')((source:any,label:string)=>({source,label}));
 await expect(run(oldWitness)).rejects.toThrow('unadmitted module');
 labels.length=0;
 await run(witness);
 expect(labels.filter(l=>l==='volume_integrate')).toHaveLength(6);
 expect(labels).not.toContain('volume_integrate_coarse');
});
