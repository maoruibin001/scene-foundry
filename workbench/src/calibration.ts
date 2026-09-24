import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,read,save,digest} from './store';
export const CALIBRATION_POLICY={version:'calibration-v1',minPerClass:6,maxFalseAccepts:0,maxFalseRejectRate:0.2};
const root=join(DATA,'calibrations');mkdirSync(root,{recursive:true});
export function calibrationGate(record:any,profile:any){
 const reasons:string[]=[],cases=record?.cases??[],p=CALIBRATION_POLICY;
 if(!record||record.profileId!==profile?.id)reasons.push('评分标定尚未完成或版本不匹配');
 const fingerprints=cases.map((c:any)=>c.evidenceDigest);if(new Set(fingerprints).size!==cases.length)reasons.push('标定样本证据重复');
 const labeled=cases.filter((c:any)=>['passed','failed'].includes(c.expected)&&c.reviewedBy&&c.reviewerKind==='human'&&c.reviewedAt&&c.reason?.trim()&&c.evidenceDigest&&c.predicted&&c.reviewDigest);
 if(labeled.length!==cases.length)reasons.push('独立人工标签或实际评估证据不完整');
 const positives=labeled.filter((c:any)=>c.expected==='passed'),negatives=labeled.filter((c:any)=>c.expected==='failed');
 const falseAccepts=negatives.filter((c:any)=>c.predicted==='passed').length,falseRejects=positives.filter((c:any)=>c.predicted!=='passed').length;
 if(positives.length<p.minPerClass||negatives.length<p.minPerClass)reasons.push(`正反样本各需 ${p.minPerClass} 例`);
 if(falseAccepts>p.maxFalseAccepts)reasons.push('评分器仍将不合格样本放行');
 if(positives.length&&falseRejects/positives.length>p.maxFalseRejectRate)reasons.push('合格样本误拒率超过标定上限');
 return {status:reasons.length?'unverified':'certified',reasons,positives:positives.length,negatives:negatives.length,falseAccepts,falseRejects,policy:p,scope:'仅证明冻结标定样本上的一致性；不保证开放输入正确率'};
}
export function allCalibrations(){return readdirSync(root).filter(f=>f.endsWith('.json')).map(f=>read(join(root,f)));}
export function calibrationFor(profile:any){return allCalibrations().filter(r=>r.profileId===profile.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(r=>({...r,result:calibrationGate(r,profile)}))[0]??{result:calibrationGate(null,profile)};}
export function saveCalibration(record:any){record.updatedAt=new Date().toISOString();record.digest=digest(JSON.stringify(record.cases));save(join(root,record.id+'.json'),record);return record;}
