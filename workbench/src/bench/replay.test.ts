import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {benchSource,landmarkBoxes,benchRegressions,landmarkOffsets,BENCH_LIMITS} from './replay';
import {benchReportHTML} from './report';

const save=(p:string,v:any)=>writeFileSync(p,JSON.stringify(v));
function run(){
 const data=mkdtempSync(join(tmpdir(),'bench-')),dir=join(data,'runs/job-1');mkdirSync(join(dir,'iterations/0'),{recursive:true});mkdirSync(join(dir,'generation'),{recursive:true});mkdirSync(join(data,'uploads'));
 writeFileSync(join(data,'uploads/a.png'),'');save(join(dir,'job.json'),{id:'job-1',sceneKind:'voxel',prompt:'营地',images:[{id:'a'.repeat(64),file:'a.png',mime:'image/png'}]});
 save(join(dir,'delivery.json'),{best:{folder:'iterations/0'}});save(join(dir,'iterations/0/generated-scene.json'),{cameras:[]});save(join(dir,'iterations/0/delivery-assessment.json'),{score:79.5});
 save(join(dir,'generation/reference-observations.json'),{landmarks:[{id:'cabin',label:'木屋',views:[{referenceIndex:1,box:[.4,.2,.7,.6]},{referenceIndex:2,box:[.1,.1,.2,.2]}]},{id:'sky',views:[{referenceIndex:1,box:null}]}]});
 return dir;
}

test('the delivered round, its references and observation boxes are the replay source',()=>{
 const src=benchSource(run());
 expect(src).toMatchObject({jobId:'job-1',kind:'voxel',folder:'iterations/0',score:79.5,refs:['a'.repeat(64)]});expect(src.scenePath.endsWith('iterations/0/generated-scene.json')).toBe(true);
 expect(landmarkBoxes(src.observation,1)).toEqual([{id:'cabin',label:'木屋',box:[.4,.2,.7,.6]}]);expect(landmarkBoxes(src.observation,3)).toEqual([]);
});

test('landmarks beyond the limits are listed worst first, and regressions against a baseline are flagged',()=>{
 const colour=(cabin:number,diff?:number)=>({references:[{referenceIndex:1,global:{dL:0,dChroma:0,dHue:0},...(diff===undefined?{}:{baselineDiffL:diff}),landmarks:[{id:'cabin',label:'木屋',dL:cabin,dChroma:0,dHue:0},{id:'rug',label:'地毯',dL:-2,dChroma:12,dHue:5}]}]});
 expect(landmarkOffsets(colour(-20)).map((l:any)=>l.id)).toEqual(['cabin','rug']);expect(landmarkOffsets(colour(-3)).map((l:any)=>l.id)).toEqual(['rug']);
 const baseline={colour:colour(-3),fps:{system:{median:69}}};
 expect(benchRegressions({colour:colour(-3,1),fps:{system:{median:68}}},baseline)).toEqual([]);
 expect(benchRegressions({colour:colour(-20,BENCH_LIMITS.baselineDiffL+1),fps:{system:{median:40}}},baseline).map((f:any)=>f.kind)).toEqual(['frame-changed','landmark-further','fps-drop']);
 expect(benchRegressions({error:'构建失败'},{colour:colour(-3)}).map((f:any)=>f.kind)).toEqual(['render-failed']);
});

test('the report shows skipped and failed scenes and escapes labels',()=>{
 const html=benchReportHTML({createdAt:'t',set:'s',baseline:null,limits:BENCH_LIMITS,results:[{id:'a',skipped:'本机没有该记录'},{id:'b',error:'<x>'},
  {id:'c',kind:'scene',deliveredScore:75,durationMs:1000,fps:{system:{median:45,canvas:[2048,1152]}},frames:[{referenceIndex:1,reference:'c/r.png',frame:'c/f.png',baseline:'c/d.png'}],colour:{references:[{referenceIndex:1,global:{dL:-8,dChroma:-7},landmarks:[]}]},offLandmarks:[{label:'<窗>',referenceIndex:1,dL:-30,dChroma:-9,dHue:-4}]}]});
 expect(html).toContain('本机没有该记录');expect(html).toContain('&lt;x&gt;');expect(html).toContain('&lt;窗&gt;');expect(html).toContain('参考 / 原交付 / 当前');expect(html).toContain('class="bad">45 FPS');
});
