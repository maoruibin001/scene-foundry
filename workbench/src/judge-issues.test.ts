import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {judgeIssues,recordIssueVerdict} from './judge-issues';

const save=(p:string,v:any)=>writeFileSync(p,JSON.stringify(v));
// Study add64324 in miniature: the delivered round is iterations/0, passed at 75 but with material at 1.6.
function run(sameScene=true){
 const dir=mkdtempSync(join(tmpdir(),'judge-issues-')),base=join(dir,'iterations/0');mkdirSync(join(base,'runtime'),{recursive:true});
 for(const f of ['reference-1.png','continuous-3.png'])writeFileSync(join(base,'runtime',f),'');
 save(join(dir,'delivery.json'),{best:{folder:'iterations/0'}});save(join(base,'delivery-assessment.json'),{score:75.15});
 save(join(base,'review.json'),{dimensions:[{id:'material',score:1.6,reason:'桌柜与皮椅呈金黄金属感',frames:['reference-1.png','continuous-3.png','missing.png','../x.png']},{id:'spatial',score:4.2,reason:'锚点成立',frames:[]}],
  requirements:[{id:'r06',verdict:'partial',reason:'桌椅金属化',frames:['reference-1.png']},{id:'r01',verdict:'met',reason:'',frames:[]}],
  criteria:[{id:'a36',score:1.1,verdict:'unmet',reason:'椅面金黄反射',frames:[]},{id:'a02',score:5,verdict:'met',reason:'',frames:[]}]});
 save(join(base,'spec-report.json'),{rules:[{id:'S06',title:'轮廓可读',kind:'mandatory',status:'failed',reason:'窗格不可读',frames:[]},{id:'S12',title:'交互',status:'not_applicable'},{id:'S01',status:'passed'}]});
 save(join(base,'generated-scene.json'),{v:1});save(join(dir,'generated-scene.json'),{v:sameScene?1:2});
 save(join(dir,'reference-composition.json'),{rows:[{landmarkId:'lm_lamp',label:'落地灯',referenceIndex:1,status:'measured-visible-extent',extent:'occluded',spanRatio:[1.1,.72]},{landmarkId:'lm_desk',label:'书桌',referenceIndex:1,status:'measured-visible-extent',extent:'complete',spanRatio:[1.05,.95]}]});
 const job={id:'job-1',plan:{requirements:[{id:'r06',text:'保留写实材质',critical:false}],acceptanceCriteria:[{id:'a36',dimension:'material',description:'皮扶手椅呈棕色皮革',critical:true}]},review:null};
 return {dir,job};
}

test('the delivered round lists low dimensions, unmet items, failed rules and size deviations with its own frames',()=>{
 const {dir,job}=run(),r=judgeIssues(job,dir);
 expect(r.folder).toBe('iterations/0');expect(r.score).toBe(75.15);
 expect(r.issues.map((i:any)=>i.id)).toEqual(['dimension:material','requirement:r06','criterion:a36','spec:S06','measurement:lm_lamp:1']);
 expect(r.issues[0].frames).toEqual(['iterations/0/runtime/reference-1.png','iterations/0/runtime/continuous-3.png']);
 expect(r.issues[2]).toMatchObject({dimension:'material',title:'皮扶手椅呈棕色皮革',critical:true});
 expect(r.issues[4].reason).toBe('参考机位1：高度偏小28%（部分遮挡，只比较可见范围，整体尺寸未验证）');
 // Size spans measured on a later scene do not describe this round.
 const later=run(false);expect(judgeIssues(later.job,later.dir).issues.some((i:any)=>i.source==='measurement')).toBe(false);
});

test('verdicts are stored beside the review, validated, and cleared with null',()=>{
 const {dir,job}=run(),before=readFileSync(join(dir,'iterations/0/review.json'),'utf8');
 expect(recordIssueVerdict(job,dir,{issueId:'criterion:a36',verdict:'confirmed',note:' 应为深棕哑光 '})['criterion:a36']).toMatchObject({verdict:'confirmed',note:'应为深棕哑光'});
 expect(judgeIssues(job,dir).verdicts['criterion:a36'].verdict).toBe('confirmed');
 expect(()=>recordIssueVerdict(job,dir,{issueId:'criterion:a02',verdict:'confirmed'})).toThrow('不在当前评委清单');
 expect(()=>recordIssueVerdict(job,dir,{issueId:'spec:S06',verdict:'approved'})).toThrow('核对结论');
 expect(recordIssueVerdict(job,dir,{issueId:'criterion:a36',verdict:null})).toEqual({});
 expect(readFileSync(join(dir,'iterations/0/review.json'),'utf8')).toBe(before);
});
