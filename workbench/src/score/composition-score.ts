/**
 * Program-only composition score: every row compares an original-image landmark box with the visible extent of the
 * bound instances, rasterised from the scene's own compiled mesh at the frozen reference camera. No model call;
 * identical evidence always gives an identical score. Only the original-image boxes come from a model (observe).
 */
export const COMPOSITION_SCORE_VERSION='composition-score-v1';
/** residualScale: an edge RMSE at or beyond it scores 0 (about the 90th percentile of 2,880 graybox rows). */
/** missFit: a critical row below it counts as a miss; the mean dilutes one broken landmark among dozens, the miss count does not. */
export const COMPOSITION_SCORE={residualScale:.15,criticalWeight:2,minPixels:8,missFit:.25} as const;
type Row={landmarkId:string;referenceIndex:number;critical?:boolean;comparisonScope?:string;status:string;pixels:number|null;edgeResidual:number|null;boundInstanceEvidence?:{pixels:number}};
/** A resolvable binding with nothing visible is a miss, not a pass; only rows whose binding cannot be resolved are excluded. */
export function rowFit(row:Row,c=COMPOSITION_SCORE){
 if(row.comparisonScope==='unverified-binding-scope')return {state:'unresolved' as const,fit:null};
 if(row.status==='measured-visible-extent'&&Number.isFinite(row.edgeResidual))return {state:'measured' as const,fit:Math.max(0,1-(row.edgeResidual as number)/c.residualScale)};
 if((row.pixels??0)<c.minPixels)return {state:'absent' as const,fit:0};
 return {state:'unresolved' as const,fit:null};
}
export function compositionScore(report:{rows:Row[]},c=COMPOSITION_SCORE){
 const rows=report.rows.map(r=>({landmarkId:r.landmarkId,referenceIndex:r.referenceIndex,critical:!!r.critical,...rowFit(r,c)}));
 const scored=rows.filter(r=>r.fit!==null),weight=(r:{critical:boolean})=>r.critical?c.criticalWeight:1;
 const mean=(xs:typeof scored)=>{const w=xs.reduce((n,r)=>n+weight(r),0);return w?100*xs.reduce((n,r)=>n+weight(r)*(r.fit as number),0)/w:null;};
 const count=(s:string)=>rows.filter(r=>r.state===s).length;
 return {version:COMPOSITION_SCORE_VERSION,parameters:c,score:mean(scored),criticalScore:mean(scored.filter(r=>r.critical)),
  criticalMisses:scored.filter(r=>r.critical&&(r.fit as number)<c.missFit).length,rows:rows.length,measured:count('measured'),absent:count('absent'),unresolved:count('unresolved'),coverage:rows.length?scored.length/rows.length:0,
  perRow:rows,scope:'仅衡量原图地标框与实际编译网格可见范围的位置和大小一致性；不含材质、颜色、光照和细节。原图框来自观察记录，不是分割真值。unresolved 行不计分，coverage 报告其占比。'};
}
