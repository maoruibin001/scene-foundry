import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {runDir,read,save} from './store';
const folder=(id:string)=>join(runDir(id),'weighted-receipts');
export function listReweights(id:string){const dir=folder(id);return existsSync(dir)?readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>read(join(dir,n))).sort((a,b)=>b.createdAt-a.createdAt):[];}
/** Receipts are separate and idempotent; the original job and scored package stay immutable. */
export function saveReweight(id:string,receipt:any){
 if(receipt.sourceJobId!==id||receipt.kind!=='reweight-only'||!/^[a-f0-9]{64}$/.test(receipt.id))throw Error('权重回执来源无效');
 const dir=folder(id),file=join(dir,receipt.id+'.json');mkdirSync(dir,{recursive:true});if(existsSync(file))return read(file);
 const result={...receipt,weights:receipt.dimensionWeights,weightedScore:receipt.score,rawWeightedScore:receipt.rawScore,evidenceSignature:receipt.sourceAssessmentSha256,createdAt:Date.now()};save(file,result);return result;
}
