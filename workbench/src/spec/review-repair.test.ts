import {test,expect} from 'bun:test';
import {verifiedVisualReview,STYLE_DIMENSIONS,visualReferences} from './visual-review';
import {normalizationTemplate,mergeFamilies} from './normalize-doc';
import {planSpecExport} from './export-pack';
import {sampleSpec} from './fixtures';
test('视觉评审保留全部参考图及顺序，缺参考图在调用模型前拒绝',()=>{
 const refs=Array.from({length:8},(_,i)=>({caption:i===4?'主视觉基准':'其他视角',id:i}));
 expect(visualReferences(refs)).toEqual(refs);expect(()=>visualReferences([])).toThrow('VISUAL_REFERENCE_MISSING');
});
test('不可见、占位分、缺图、重复维度都不可作为有效视觉评审',()=>{
 const good={evidence:{status:'visible',observations:[{imageIndex:0,description:'左侧红色方块，右侧蓝色圆形，白色背景'}]},overall:71,verdict:'partial',dimensions:STYLE_DIMENSIONS.map(id=>({id,score:3,reason:'实际可见细节'})),issues:[],summary:'图形可见'};
 expect(verifiedVisualReview(good,1).overall).toBe(71);
 for(const v of [{...good,evidence:{...good.evidence,status:'unavailable'}},{...good,summary:'图片像素不可见'}, {...good,evidence:{...good.evidence,observations:[]}}])expect(()=>verifiedVisualReview(v,1)).toThrow('VISUAL_EVIDENCE_UNAVAILABLE');
 expect(()=>verifiedVisualReview({...good,dimensions:good.dimensions.map(d=>({...d,id:'lighting'}))},1)).toThrow('VISUAL_REVIEW_INVALID');
});
test('默认是通用模板，材质数值保留用户意图而不强制成大厅参数',()=>{
 expect(normalizationTemplate(undefined)).toBe('general');expect(normalizationTemplate('critical-zerog-hall')).toBe('critical-zerog-hall');expect(()=>normalizationTemplate('random')).toThrow();
 const base=sampleSpec().materials[0];const {materials}=mergeFamilies({materials:[{...base,id:'CORE_TEST',transmission:0.8,ior:1.5,opacity:undefined,emissive:[1,1,1],emissiveIntensity:8}],families:[]},[]);
 expect(materials[0].transmission).toBe(.8);expect(materials[0].opacity).toBeUndefined();expect(materials[0].emissiveIntensity).toBe(8);
});
test('无效关键参数和未知路径保留待决代理，不以默认形状冒充规格',()=>{
 const s=sampleSpec();s.families[0].generator={id:'GEN-NODE-01',params:{height:-12}};s.objects[0].params={};s.objects[0].transform.position=[0,0,0];s.acceptance=[];
 let plan=planSpecExport(s);expect(plan.report.unresolved.length).toBeGreaterThan(0);expect(plan.meshes[0].generator).toBe('proxy');expect(plan.report.unresolved.some(x=>x.key==='height')).toBe(true);
 s.objects[0].params={size:[2,3,4]};s.families[0].generator.params={path:'沿指定墙面弯曲'};plan=planSpecExport(s);expect(plan.report.unresolved.some(x=>x.key==='path')).toBe(true);
 expect(plan.meshes[0].aabb).toEqual([-1,0,-1.5,1,4,1.5]);expect(s.objects[0].params.size).toEqual([2,3,4]);
});

test('通用文档正常规格化不注入科幻模板、不修改冻结观感或用户尺寸',async()=>{
 const {mkdtempSync,writeFileSync,chmodSync,readFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {normalizeDocument}=await import('./normalize-doc');
 const root=mkdtempSync(join(tmpdir(),'normalization-general-')),html=join(root,'source.html'),fake=join(root,'fake-cbc4');
 const s=sampleSpec(),material={...s.materials[0],id:'WOOD',label:'原木',baseColor:[.8,.5,.2,1],metallic:0,roughness:.85,emissiveIntensity:0,surface:null};
 const common={kind:'doc',ref:'工作坊说明'};
 const families={materials:[material],families:[{id:'TABLE',label:'木桌',description:'普通木工作台',priority:'P0',covers:[],generatorId:null,generatorParams:[],materialSlots:[{slot:'proxy',material:'WOOD'}],authority:'master',sources:[common]}],excludedLeaves:[]};
 const objects={bounds:{min:[-6,-6,0],max:[6,6,5]},objects:[{id:'TABLE_1',label:'木桌',family:'TABLE',parent:null,position:[1,2,0],rotationDeg:[0,0,0],scale:[1,1,1],params:[{name:'size',number:null,numbers:[2,1,1],text:null,flag:null}],authority:'master',sources:[common],confidence:1,notes:''}],excludedMasters:[]};
 const staging={states:[{...s.lighting.states[0],post:{...s.lighting.states[0].post,exposure:2,bloom:null,fog:null},ambient:{color:[1,1,1],intensity:.7},background:[.8,.8,.8]}],defaultState:'L0',shots:s.shots,constraints:[],acceptance:[]};
 writeFileSync(html,'<html><title>普通木工作坊</title><h1>普通木工作坊</h1><p>原木桌，无科幻结构，明亮自然光。</p></html>');
 for(const [id,data] of Object.entries({families,objects,staging}))writeFileSync(join(root,id+'.json'),JSON.stringify({type:'result',subtype:'success',modelUsage:{'hy4-preview-ioa':{}},structured_output:data}));
 writeFileSync(fake,`#!/bin/sh\ncat > received-input.jsonl\nif test -f spec-general-families-input-receipt.json; then f=families; elif test -f spec-general-objects-input-receipt.json; then f=objects; else f=staging; fi\n# receipts for previous roles persist; choose the role from latest receipt mtime via schema argument instead\ncase "$*" in *'"bounds"'*) f=objects;; *'"states"'*) f=staging;; esac\ncat '${root}/'"$f"'.json'\n`);chmodSync(fake,0o755);
 const before=process.env.PIPELINE_CBC4_BIN;process.env.PIPELINE_CBC4_BIN=fake;
 try{const node={provider:'cbc4' as const,model:'hy4-preview-ioa',reasoningEffort:'medium'};const {spec}=await normalizeDocument(html,join(root,'out'),'high',undefined,{families:node,objects:node,staging:node,styleReview:node});expect(spec.id).not.toBe('critical-zerog-hall');expect(spec.objects[0].params.size).toEqual([2,1,1]);expect(spec.lighting.states[0].post.exposure).toBe(2);expect(spec.lighting.states[0].post.tonemap).toBe('aces');expect(spec.lighting.states[0].post.bloom).toBeNull();expect(spec.materials[0].roughness).toBe(.85);expect(spec.provenance.method).toContain('template=general');
 const text=JSON.parse(readFileSync(join(root,'out/calls/received-input.jsonl'),'utf8')).message.content.at(-1).text;expect(text).not.toContain('湿冷重工业');expect(text).not.toContain('MAT_AERO_WHITE');
 }finally{if(before===undefined)delete process.env.PIPELINE_CBC4_BIN;else process.env.PIPELINE_CBC4_BIN=before;}
});

test('cbc5 是独立冻结路由，不能被当作 cbc4 或任意模型别名',async()=>{
 const {validateNodeModels}=await import('./node-models');
 expect(validateNodeModels({styleReview:{provider:'cbc5',model:'hy4flash-dev',reasoningEffort:'medium'}}).styleReview.provider).toBe('cbc5');
 expect(()=>validateNodeModels({styleReview:{provider:'cbc5',model:'hy4-preview-ioa',reasoningEffort:'medium'}})).toThrow('cbc5');
 const {approveSpecReview}=await import('./workflow-v2');
 const job={specJob:'spec-job-v1',status:'needs_review',specGate:{ownerApproval:'pending'},runtime:{hard:{runtime:true,noErrors:true}},specExport:{unresolved:1,proxies:1}};
 expect(()=>approveSpecReview(job,{distManifestDigest:'x',images:{}})).toThrow('关键参数');
});
