import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,read,save} from './store';

// Graded human calibration: optional per-dimension human scores (0–5) that dynamically adjust the
// machine score toward human judgement. Complements the binary pass/fail certification in calibration.ts.
// When there is no human data the correction is the identity, so default behaviour is unchanged.
export const HUMAN_CALIBRATION='human-calibration-v1';
export function humanCalibrationRule(job:any){return job?.humanCalibrationPolicy===HUMAN_CALIBRATION;}
export const CAL_DIMENSIONS=['coverage','spatial','shape','material','readability'] as const;
export const CAL_POLICY={minApply:8,minSlope:3,scaleClamp:[0.5,2] as const,biasClamp:[-2,2] as const,biasOnlyClamp:[-1.5,1.5] as const};

const clamp=(x:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,x));
const round=(x:number,n=4)=>Math.round(x*10**n)/10**n;

/** Fit a per-dimension affine correction judge→human. n<minSlope: shift only (slope 1); else least squares. */
export function fitDimension(pairs:[number,number][],policy=CAL_POLICY){
 const n=pairs.length;
 if(!n)return {n:0,scale:1,bias:0,mae:null as number|null,corr:null as number|null};
 const xs=pairs.map(p=>p[0]),ys=pairs.map(p=>p[1]);
 const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
 const rawMae=round(pairs.reduce((s,[x,y])=>s+Math.abs(y-x),0)/n);
 if(n<policy.minSlope){const bias=clamp(my-mx,policy.biasOnlyClamp[0],policy.biasOnlyClamp[1]);return {n,scale:1,bias:round(bias),mae:rawMae,corr:null};}
 let sxx=0,sxy=0,syy=0;for(let i=0;i<n;i++){sxx+=(xs[i]-mx)**2;sxy+=(xs[i]-mx)*(ys[i]-my);syy+=(ys[i]-my)**2;}
 const slope=sxx<1e-9?1:clamp(sxy/sxx,policy.scaleClamp[0],policy.scaleClamp[1]);
 const bias=clamp(my-slope*mx,policy.biasClamp[0],policy.biasClamp[1]);
 const corr=sxx<1e-9||syy<1e-9?null:round(sxy/Math.sqrt(sxx*syy));
 return {n,scale:round(slope),bias:round(bias),mae:rawMae,corr};
}

/** Build the calibration model from (judge,human) dimension-score samples. `applied` gates whether the
 *  correction touches the real gate; below minApply it is observed-only (shown in previews, not applied). */
export function buildCalibrationModel(samples:{judge:Record<string,number>;human:Record<string,number>}[],policy=CAL_POLICY){
 const dims:Record<string,ReturnType<typeof fitDimension>>={};
 let used=0;
 for(const dim of CAL_DIMENSIONS){
  const pairs=samples.filter(s=>Number.isFinite(s.judge?.[dim])&&Number.isFinite(s.human?.[dim])).map(s=>[s.judge[dim],s.human[dim]] as [number,number]);
  dims[dim]=fitDimension(pairs,policy);used=Math.max(used,pairs.length);
 }
 const maes=CAL_DIMENSIONS.map(d=>dims[d].mae).filter((m):m is number=>m!=null);
 const overallMae=maes.length?round(maes.reduce((a,b)=>a+b,0)/maes.length):null;
 return {version:HUMAN_CALIBRATION,samples:samples.length,dimensionSamples:used,applied:used>=policy.minApply,minApply:policy.minApply,overallMae,dimensions:dims,policy};
}

/** Correction applied to one dimension score. Identity unless the model is applied (or force, for previews). */
export function calibrateScore(dim:string,score:number,model:any,force=false){
 const d=model?.dimensions?.[dim];
 if((!model?.applied&&!force)||!d)return score;
 return clamp(d.scale*score+d.bias,0,5);
}
/** A calibrate(dim,score) function for qualityGate; identity when model absent/not-applied. */
export function calibrator(model:any){return (dim:string,score:number)=>calibrateScore(dim,score,model);}
/** Show the correction's effect on an already-scored job even before it is applied (force=true). Pairs
 *  against each dimension's raw (pre-calibration) score to avoid a feedback loop. */
export function calibratePreview(dimensions:any[],model:any){
 const rows=(dimensions??[]).map((d:any)=>{const base=Number.isFinite(d.rawScore)?d.rawScore:d.score;const cal=calibrateScore(d.id,base,model,true);return {id:d.id,weight:d.weight,base:round(base,2),calibrated:round(cal,2),basePoints:base/5*d.weight,calibratedPoints:cal/5*d.weight};});
 const sum=(k:'basePoints'|'calibratedPoints')=>round(rows.reduce((a,r)=>a+r[k],0),1);
 return {applied:!!model?.applied,rows,rawComposite:sum('basePoints'),calibratedComposite:sum('calibratedPoints')};
}

// ---- storage (separate from the binary DATA/calibrations certification store) ----
const scoresDir=join(DATA,'human-scores');
const modelPath=join(DATA,'human-calibration','model.json');

export function saveHumanScore(record:any){
 mkdirSync(scoresDir,{recursive:true});
 const row={...record,reviewerKind:'human',at:record.at??null};
 save(join(scoresDir,record.jobId+'.json'),row);return row;
}
export function listHumanScores(){
 if(!existsSync(scoresDir))return [] as any[];
 return readdirSync(scoresDir).filter(f=>f.endsWith('.json')).map(f=>read(join(scoresDir,f)));
}
/** Rebuild and persist the model from stored human scores paired with each job's stored judge dimensions. */
export function rebuildCalibrationModel(resolveJudge:(jobId:string)=>Record<string,number>|null,builtAt:string|null=null){
 const samples=listHumanScores().map(r=>{const judge=resolveJudge(r.jobId);return judge?{judge,human:r.dimensions}:null;}).filter(Boolean) as any[];
 const model={...buildCalibrationModel(samples),builtAt,sources:samples.length};
 mkdirSync(join(DATA,'human-calibration'),{recursive:true});save(modelPath,model);return model;
}
export function currentCalibrationModel(){return existsSync(modelPath)?read(modelPath):buildCalibrationModel([]);}
