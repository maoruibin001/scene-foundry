import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {SceneSpec} from './schema';
import {applyAppearanceRevision} from './appearance-continuation';
import {callSpecNode,type NodeModel} from './node-models';

/** Report the physical consequence of positional-light limits, rather than copying
 * small-scene intensities into a large scene. Values are unoccluded, on-axis lux;
 * the Engine's range fade, shadows and scattering still require actual capture. */
export function radiometryAudit(spec:SceneSpec){
 const target=spec.shots[0]?.target;if(!target)return [];
 return spec.lighting.states.flatMap(st=>st.lights.flatMap(l=>{
  if(l.kind!=='spot'||!l.position||!l.direction||st.post.fog?.light!==l.id||!st.post.volumetric)return [];
  const v=target.map((n,i)=>n-l.position![i]),d2=v.reduce((s,x)=>s+x*x,0),length=Math.sqrt(d2),dot=v.reduce((s,x,i)=>s+x*l.direction![i],0)/(length*Math.hypot(...l.direction));
  if(d2<1||!Number.isFinite(dot)||dot<Math.cos((l.innerConeDeg??0)*Math.PI/180)||length>=(l.range??0)||l.intensity/d2>=10)return [];
  return [{state:st.id,light:l.id,target,distance: length,distanceSquared:d2,currentCandela:l.intensity,nominalLux:l.intensity/d2,oldUniversalCapCandela:10000,oldCapNominalLux:10000/d2,admittedCandela:2000000,unit:'candela',referenceShot:spec.shots[0].id}];
 }));
}
export function applyRadiometry(spec:SceneSpec,decisions:{state:string;light:string;targetLux:number;reason:string}[]){
 const audit=radiometryAudit(spec),seen=new Set<string>();
 if(!audit.length||decisions.length!==audit.length)throw Error('RADIOMETRY_DECISIONS_INCOMPLETE');
 const conversions=decisions.map(d=>{const key=d.state+'/'+d.light,a=audit.find(a=>a.state===d.state&&a.light===d.light);if(!a||seen.has(key)||!Number.isFinite(d.targetLux)||d.targetLux<10||d.targetLux>500||typeof d.reason!=='string'||!d.reason.trim())throw Error('RADIOMETRY_DECISION_INVALID');seen.add(key);const candela=Number((d.targetLux*a.distanceSquared).toFixed(6));if(candela>2000000)throw Error('RADIOMETRY_EXCEEDS_ADMITTED_INTENSITY');return {...a,targetLux:d.targetLux,candela,reason:d.reason};});
 const revision={id:'radiometric-calibration-v1',summary:'Calibrate only admitted volumetric spot illuminance using real visual evidence and frozen scene distance',patches:conversions.map(c=>({target:'light' as const,id:c.light,state:c.state,set:{intensity:c.candela},reason:c.reason}))};
 return {...applyAppearanceRevision(spec,revision),audit,conversions,revision};
}
export async function calibrateRadiometry(spec:SceneSpec,review:any,images:{path:string;mime:string}[],dir:string,selection:NodeModel,signal?:AbortSignal){
 const audit=radiometryAudit(spec);if(!audit.length||review?.evidence?.status!=='visible'||images.length<2)throw Error('RADIOMETRY_REAL_EVIDENCE_REQUIRED');
 mkdirSync(dir,{recursive:true});
 const schema={type:'object',additionalProperties:false,required:['decisions'],properties:{decisions:{type:'array',minItems:audit.length,maxItems:audit.length,items:{type:'object',additionalProperties:false,required:['state','light','targetLux','reason'],properties:{state:{type:'string'},light:{type:'string'},targetLux:{type:'number',minimum:10,maximum:500},reason:{type:'string',maxLength:350}}}}}};
 const out=await callSpecNode({role:'spec-radiometric-calibration',signal,images,system:'你是通用场景管线的照度校准节点，不是评委。对照第一张概念图与后续真实六机位，只选择审计列出的局部体积聚光灯在冻结参考目标处的合理目标照度（lux），不要修改几何、机位、材质、雾或曝光。原先所有灯型统一10000上限误把candela当小场景无量纲参数，导致大空间几lux；编译器将按I_cd=E_lux*d²计算光强，最大2000000cd，不做静默截断。targetLux允许10..500；考虑明亮顶光与可见束、主体清晰和局部过曝风险，按实际参考选择，勿一律取最大值。计算是未遮挡轴线名义值，不能保证最终画面。每个审计灯恰好一条，不添加其他字段。说明选择依据，不宣称通过。',text:JSON.stringify({audit,review,lighting:spec.lighting,bounds:spec.bounds,shots:spec.shots,geometry:'frozen',target:{overall:70,minDimension:2},budget:'one calibration followed by one independent review; no further automatic retry'})},dir,selection,schema);
 const decisions=JSON.parse(out.text).decisions,r=applyRadiometry(spec,decisions);
 for(const [name,value] of [['radiometry-before.json',audit],['radiometric-conversion.json',r.conversions],['revision.json',r.revision],['continuation.json',r.receipt],['revised-spec.json',r.spec]])writeFileSync(join(dir,name as string),JSON.stringify(value,null,2));
 return r;
}
