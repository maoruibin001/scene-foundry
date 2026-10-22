import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

/**
 * Judge findings of the delivered round, listed one per scored dimension, unmet requirement or criterion, non-passing
 * spec rule, and objective landmark-size deviation, so a person can confirm or dismiss each before a focused repair.
 * Verdicts are kept apart from the review: they never change scores, gates or the original report.
 */
export const JUDGE_ISSUES='judge-issues-v1';
export const ISSUE_LIMITS={dimensionBelow:4,criterionBelow:4,spanDeviation:.25};
const VERDICTS=['confirmed','dismissed','unsure'] as const;
const DIMENSIONS:Record<string,string>={coverage:'需求覆盖',spatial:'空间布局',shape:'形体',material:'材质',lighting:'光照',readability:'可读性'};
const read=(p:string)=>existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null;
const sha=(p:string)=>existsSync(p)?createHash('sha256').update(readFileSync(p)).digest('hex'):null;
const verdictFile=(dir:string)=>join(dir,'issue-verdicts.json');

export function judgeIssues(job:any,dir:string){
 const folder=read(join(dir,'delivery.json'))?.best?.folder??'.',base=join(dir,folder);
 const review=read(join(base,'review.json'))??job.review;
 if(!review)return {version:JUDGE_ISSUES,jobId:job.id,folder,issues:[],verdicts:{},reason:'该记录尚无评委评审'};
 const frames=(list:any)=>(Array.isArray(list)?list:[]).filter((f:string)=>/^[\w.-]+\.png$/.test(f)&&existsSync(join(base,'runtime',f))).map((f:string)=>join(folder,'runtime',f).replace(/^\.\//,''));
 const issues:any[]=[],requirement=new Map((job.plan?.requirements??[]).map((r:any)=>[r.id,r])),criterion=new Map((job.plan?.acceptanceCriteria??[]).map((c:any)=>[c.id,c]));
 for(const d of review.dimensions??[])if(Number.isFinite(d.score)&&d.score<ISSUE_LIMITS.dimensionBelow)
  issues.push({id:'dimension:'+d.id,source:'dimension',dimension:d.id,title:DIMENSIONS[d.id]??d.id,score:d.score,scale:5,reason:d.reason,frames:frames(d.frames)});
 for(const r of review.requirements??[])if(r.verdict!=='met')
  issues.push({id:'requirement:'+r.id,source:'requirement',title:(requirement.get(r.id) as any)?.text??r.id,verdict:r.verdict,critical:!!(requirement.get(r.id) as any)?.critical,reason:r.reason,frames:frames(r.frames)});
 for(const c of review.criteria??[])if(c.verdict!=='met'||Number.isFinite(c.score)&&c.score<ISSUE_LIMITS.criterionBelow){const plan:any=criterion.get(c.id);
  issues.push({id:'criterion:'+c.id,source:'criterion',dimension:plan?.dimension??null,title:plan?.description??c.id,score:c.score,scale:5,verdict:c.verdict,critical:!!plan?.critical,reason:c.reason,frames:frames(c.frames)});}
 for(const r of read(join(base,'spec-report.json'))?.rules??[])if(!['passed','not_applicable'].includes(r.status))
  issues.push({id:'spec:'+r.id,source:'spec',title:r.id+' '+r.title,verdict:r.status,critical:r.kind==='mandatory',reason:r.reason,frames:frames(r.frames)});
 // Box spans are measured on the current scene, so they only describe the delivered round when it is that scene.
 const composition=sha(join(base,'generated-scene.json'))===sha(join(dir,'generated-scene.json'))?read(join(dir,'reference-composition.json')):null;
 for(const row of composition?.rows??[]){const span=row.spanRatio;if(!Array.isArray(span)||row.status!=='measured-visible-extent')continue;
  const off=span.map((v:number,k:number)=>({axis:k?'高度':'宽度',v})).filter(({v})=>Number.isFinite(v)&&Math.abs(v-1)>ISSUE_LIMITS.spanDeviation);if(!off.length)continue;
  const visible=row.extent==='complete'?'':'（部分遮挡，只比较可见范围，整体尺寸未验证）';
  issues.push({id:`measurement:${row.landmarkId}:${row.referenceIndex}`,source:'measurement',title:row.label,referenceIndex:row.referenceIndex,critical:!!row.critical,extent:row.extent,
   reason:`参考机位${row.referenceIndex}：`+off.map(({axis,v})=>`${axis}${v<1?'偏小':'偏大'}${Math.round(Math.abs(v-1)*100)}%`).join('，')+visible,frames:frames([`reference-${row.referenceIndex}.png`])});}
 return {version:JUDGE_ISSUES,jobId:job.id,folder,score:read(join(base,'delivery-assessment.json'))?.score??null,issues,verdicts:read(verdictFile(dir))?.verdicts??{}};
}

/** Record one person's verdict on a listed issue; `verdict:null` clears it. */
export function recordIssueVerdict(job:any,dir:string,body:any){
 const {issueId,verdict}=body??{},note=body?.note==null?'':String(body.note).trim();
 if(!judgeIssues(job,dir).issues.some((i:any)=>i.id===issueId))throw Error('问题不在当前评委清单中');
 if(verdict!==null&&!VERDICTS.includes(verdict))throw Error('核对结论只能是确认、不是问题或不确定');
 if(note.length>1000)throw Error('说明最多 1000 字');
 const file=verdictFile(dir),current=read(file)?.verdicts??{};
 if(verdict===null)delete current[issueId];else current[issueId]={verdict,note,at:new Date().toISOString()};
 writeFileSync(file+'.tmp',JSON.stringify({version:JUDGE_ISSUES,jobId:job.id,verdicts:current},null,2)+'\n');renameSync(file+'.tmp',file);
 return current;
}
