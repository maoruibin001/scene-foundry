import {JUDGE_CONSENSUS_BAND} from './judge-consensus';

export const VOXEL_ACCEPTANCE='voxel-objective-acceptance-v1';
/** Only new voxel jobs created under the policy accept a graybox on objective evidence; historical and ordinary jobs keep the judge threshold. */
export function voxelAcceptanceRule(job:any){return job?.voxelAcceptancePolicy===VOXEL_ACCEPTANCE;}
/**
 * Calibrated on 26 voxel graybox rounds (tower, temple, mecha; 2026-10-16/17). The judge scored every correct layout 2.8–3.2 and stopped
 * on the 3.5 proportion threshold, while the one mirrored mecha scored 2.3–2.4. Measured landmark extents separate them without the judge:
 * centre-x error .030–.058 against .383–.406 when mirrored; weighted critical edge residual .037–.086 against .243–.261; complete-extent
 * residual ≤.075 against ≥.545. No round had a critical landmark invisible or a critical relation missing; critical relation minimums were
 * 1.5–2 only where a main element was visibly wrong (mirror, temple water channel, tower river).
 */
export const VOXEL_ACCEPTANCE_LIMITS={criticalScore:2.5,mirrorError:.12,mirrorRatio:.5,minimumRows:4,edgeResidual:.10,completeResidual:.15,visiblePixels:8};
const WEIGHT:Record<string,number>={complete:1,partial:.6,occluded:.4};
const cx=(b:number[])=>(b[0]+b[2])/2,round=(v:number)=>Math.round(v*1e4)/1e4;
/**
 * Jobs under this policy have the observation tag each relation layout or detail. The 2026-10-19 cyberpunk street had 19 of 20 relations
 * critical, facade details among them (window voids behind railings, sign stacking, shop recess, lamp); the measured layout passed in all
 * three rounds (edge .034–.039, complete .046–.068) while two to four facade-detail rows stayed at 1.5–2.3 (the left balcony windows at
 * 1.5 every round, 0.375 m recesses in a uniform grey render) and the job stopped on no gain. Detail rows go to the asset stage, which owns those components; untagged rows stay gated.
 * A diagnosed voxel continuation (allowed only under a changed mechanism, and re-judged) also runs under the policy: it keeps the source
 * observation and tags its frozen relations once.
 */
export const VOXEL_RELATION_SCALE='voxel-relation-scale-v1';
export const RELATION_SCALES=['layout','detail'] as const;
export function relationScaleRule(job:any){return job?.voxelRelationScalePolicy===VOXEL_RELATION_SCALE;}
/** Critical relations the graybox gate holds to the floor. */
export function grayboxCriticalIds(space:any){return new Set<string>(space.spatialRelations.filter((r:any)=>r.critical&&r.scale!=='detail').map((r:any)=>r.id));}
const measured=(r:any)=>r.status==='measured-visible-extent'&&Array.isArray(r.visible)&&Array.isArray(r.expected)&&Number.isFinite(r.edgeResidual);

/**
 * Runnable, semantically complete and aligned to the reference landmarks: the build and multi-view capture already passed before review.
 * The judge still decides semantics (no missing critical relation, no critical relation grossly wrong, enough evidence); its overall
 * proportion score is recorded as advisory and no longer blocks on its own.
 */
export function objectiveAcceptance(gate:any,space:any,composition:any,observation:any){
 const L=VOXEL_ACCEPTANCE_LIMITS,review=gate.review,checks:any[]=[];
 const critical=grayboxCriticalIds(space),relations=review.relations.filter((x:any)=>critical.has(x.id));
 checks.push({id:'evidence',passed:review.confidence>=gate.threshold.confidence,detail:'评审置信度 '+review.confidence+'，门槛 '+gate.threshold.confidence});
 const missing=relations.filter((x:any)=>x.verdict==='missing').map((x:any)=>x.id);
 checks.push({id:'critical-present',passed:!missing.length,detail:missing.length?'关键关系缺失：'+missing.join('、'):'无关键关系缺失'});
 const low=relations.filter((x:any)=>x.score<L.criticalScore).map((x:any)=>x.id+' '+x.score);
 checks.push({id:'critical-floor',passed:!low.length,detail:low.length?'关键关系明显错误（<'+L.criticalScore+'）：'+low.join('、'):'关键关系均 ≥'+L.criticalScore});
 const rows:any[]=Array.isArray(composition?.rows)?composition.rows:[],landmarks=(observation?.landmarks??[]).filter((l:any)=>l.critical);
 const hidden=landmarks.filter((l:any)=>!rows.some(r=>r.landmarkId===l.id&&((measured(r)&&r.pixels>=L.visiblePixels)||r.boundInstanceEvidence?.pixels>=L.visiblePixels))).map((l:any)=>l.id);
 checks.push({id:'critical-visible',passed:!!observation&&!!landmarks.length&&!hidden.length,detail:!observation?'缺少原图观察记录':!landmarks.length?'没有关键地标':hidden.length?'关键地标在参考机位不可见：'+hidden.join('、'):landmarks.length+' 个关键地标均可见'});
 const mirror:any[]=[];
 for(const index of [...new Set(rows.filter(measured).map(r=>r.referenceIndex))]){
  const own=rows.filter(r=>measured(r)&&r.referenceIndex===index);if(own.length<L.minimumRows)continue;
  const direct=own.reduce((s,r)=>s+Math.abs(cx(r.visible)-cx(r.expected)),0)/own.length,mirrored=own.reduce((s,r)=>s+Math.abs(cx(r.visible)-(1-cx(r.expected))),0)/own.length;
  mirror.push({referenceIndex:index,rows:own.length,direct:round(direct),mirrored:round(mirrored),mirroredLayout:direct>=L.mirrorError&&mirrored<=direct*L.mirrorRatio});
 }
 const flipped=mirror.filter(m=>m.mirroredLayout);
 checks.push({id:'not-mirrored',passed:!!mirror.length&&!flipped.length,detail:!mirror.length?'可测地标不足，无法排除左右镜像':flipped.length?'参考机位 '+flipped.map(m=>m.referenceIndex+'（中心误差 '+m.direct+'，翻转后 '+m.mirrored+'）').join('、')+' 左右镜像':'左右方向与原图一致'});
 const criticalRows=rows.filter(r=>r.critical&&measured(r)),weight=criticalRows.reduce((s,r)=>s+(WEIGHT[r.extent]??.4),0);
 const edge=weight?criticalRows.reduce((s,r)=>s+(WEIGHT[r.extent]??.4)*r.edgeResidual,0)/weight:null;
 checks.push({id:'landmark-alignment',passed:edge!==null&&edge<=L.edgeResidual,detail:edge===null?'没有可测关键地标':'关键地标加权边缘残差 '+round(edge)+'，上限 '+L.edgeResidual});
 const complete=criticalRows.filter(r=>r.extent==='complete'),worst=complete.length?Math.max(...complete.map(r=>r.edgeResidual)):null;
 checks.push({id:'complete-extent',passed:worst===null||worst<=L.completeResidual,detail:worst===null?'无完整可见关键地标，仅按加权残差判断':'完整可见关键地标最大残差 '+round(worst)+'，上限 '+L.completeResidual});
 const failed=checks.filter(c=>!c.passed);
 return {version:VOXEL_ACCEPTANCE,passed:!failed.length,checks,reasons:failed.map(c=>c.detail),metrics:{criticalMinimum:relations.length?Math.min(...relations.map((x:any)=>x.score)):null,edgeResidual:edge===null?null:round(edge),completeResidual:worst===null?null:round(worst),mirror},
  advisory:{score:review.score,threshold:gate.threshold.space,passed:gate.passed,failed:gate.failed,note:'评审综合分仅作参考；成品仍须独立70分交付验收'},...deferred(review,space)};
}
// Only present when the space tags detail rows, so recorded rounds still re-derive equal.
function deferred(review:any,space:any){
 const detail=space.spatialRelations.filter((r:any)=>r.critical&&r.scale==='detail');if(!detail.length)return {};
 return {deferredDetail:{note:'细节级关键关系不阻断灰模，交由资产阶段实现',relations:detail.map((r:any)=>{const x=review.relations.find((x:any)=>x.id===r.id);return {id:r.id,score:x?.score??null,verdict:x?.verdict??null};})}};
}
/** Re-review only when the measured checks pass and a critical row sits within one review's ordinary spread of the floor, so the judge alone decides. */
export function objectiveMarginal(gate:any,space:any){
 const o=gate.objective,band=JUDGE_CONSENSUS_BAND.critical+1e-9;
 if(!o||o.checks.some((c:any)=>MEASURED.includes(c.id)&&!c.passed))return false;
 const critical=grayboxCriticalIds(space);
 return gate.review.relations.some((x:any)=>critical.has(x.id)&&Math.abs(x.score-VOXEL_ACCEPTANCE_LIMITS.criticalScore)<=band);
}
const MEASURED=['critical-visible','not-mirrored','landmark-alignment','complete-extent'];
/**
 * Repair input for a round the objective checks rejected. The repair model otherwise sees only the judge review, so a blocker the judge
 * did not score (the 2026-10-18 temple rear pool: 0 pixels in all four rounds, relations 2.5–3) never became a repair target.
 */
export function objectiveRepairFeedback(gate:any,composition:any){
 const o=gate?.objective;if(!o||o.passed)return null;
 const failed=o.checks.filter((c:any)=>!c.passed),rows:any[]=Array.isArray(composition?.rows)?composition.rows:[];
 const hidden=failed.some((c:any)=>c.id==='critical-visible')?rows.filter(r=>r.critical&&!((measured(r)&&r.pixels>=VOXEL_ACCEPTANCE_LIMITS.visiblePixels)||r.boundInstanceEvidence?.pixels>=VOXEL_ACCEPTANCE_LIMITS.visiblePixels))
  .map(r=>({landmarkId:r.landmarkId,referenceIndex:r.referenceIndex,instanceIds:r.instanceIds??[],extent:r.extent,expected:r.expected??null,pixels:r.pixels??0})):[];
 return {version:VOXEL_ACCEPTANCE,failed:failed.map((c:any)=>({id:c.id,detail:c.detail})),hiddenLandmarks:hidden};
}
const GEOMETRY=['evidence','not-mirrored','landmark-alignment','complete-extent'];
/**
 * What still stands between a round and objective acceptance, in the gate's own terms: failed whole-layout checks first, then critical
 * relations missing or below the floor plus hidden critical landmarks. The judge's 3.0 row list is not the acceptance target under the
 * policy; the 2026-10-18 temple round 1 went from 7 such blockers to 2 and was still retained against, and counted as no gain, because
 * one relation dropped from 2.5 to 2.0.
 */
export function objectiveBlockers(gate:any,space:any){
 const o=gate?.objective;if(!o)return null;
 const critical=grayboxCriticalIds(space),relations=gate.review.relations.filter((x:any)=>critical.has(x.id));
 const relationIds=relations.filter((x:any)=>x.verdict==='missing'||x.score<VOXEL_ACCEPTANCE_LIMITS.criticalScore).map((x:any)=>x.id);
 // The hidden landmark ids are only on the check detail; the saved objective shape stays unchanged so recorded rounds still re-derive equal.
 const visible=o.checks.find((c:any)=>c.id==='critical-visible'),hidden=visible&&!visible.passed?(String(visible.detail).split('：')[1]?.split('、').filter(Boolean)??['?']):[];
 const geometry=o.checks.filter((c:any)=>GEOMETRY.includes(c.id)&&!c.passed).map((c:any)=>c.id);
 return {geometry,relations:relationIds,hidden,items:relationIds.length+hidden.length};
}
/** Negative when `a` is closer to objective acceptance than `b`. */
export function compareObjectiveBlockers(a:any,b:any){return a.geometry.length-b.geometry.length||a.items-b.items;}
/**
 * Plateau score under the policy, in its own ledger family: 25 per failed layout check and 5 per blocker item, so closing one item is a
 * gain over the 2-point minimum whatever the judge does; the judge score adds at most 1, which ranks equal-blocker rounds but is never a gain.
 */
export const OBJECTIVE_PROGRESS='voxel-objective-progress-v1';
export function objectiveProgressScore(gate:any,space:any){
 const b=objectiveBlockers(gate,space);if(!b)return null;
 return Math.round((100-25*b.geometry.length-5*b.items+gate.review.score/5)*100)/100;
}
/** The recorded row keeps the judge verdict beside the objective one; `passed` is the objective verdict every later stage reads. */
export function withObjectiveAcceptance(gate:any,space:any,composition:any,observation:any){
 const objective=objectiveAcceptance(gate,space,composition,observation);
 return {...gate,passed:objective.passed,vlmPassed:gate.passed,objective};
}
