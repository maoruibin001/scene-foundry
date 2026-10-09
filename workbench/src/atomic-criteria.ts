/** 冻结在生成之前的原子标准；新协议不重新解释历史评分。 */
export const ATOMIC_QUALITY_VERSION='scene-quality-v6';
export const EVIDENCE_QUALITY_VERSION='scene-quality-v7';
export const isAtomicQuality=(version:string)=>[ATOMIC_QUALITY_VERSION,EVIDENCE_QUALITY_VERSION].includes(version);
export const CRITERION_DIMENSIONS=['coverage','spatial','shape','material','readability'] as const;
export const ATOMIC_PLAN_PROMPT=`补充 acceptanceCriteria 原子验收清单，在生成之前冻结。每项只描述一个可观察事实，含 id、requirementId、dimension、description、source、evidence、critical、weight。
dimension 分工：coverage 只评物体/必要组成和明确数量是否实现；spatial 只评相对关系、比例、机位与遮挡；shape 只评轮廓和构造；material 只评表面、颜色、磨损及光照表现；readability 只评信息可辨程度。同一缺陷不能换个说法重复放入不同维度；不得用“完整复刻整个场景”作为额外加权条目。每项引用原 requirementId，保留所有需求，五个维度均须有依据支持的条目，每条原需求至少被一项覆盖。无法从图中确认的背面只记 assumptions，不作关键验收项。
id 为唯一字母数字下划线；weight 为1..5，仅用于同需求同维度内分配，不因拆更多条目增加该需求总权重。source 沿用原需求，evidence 为非空原始依据数组；推断项不可关键。关键需求至少一项关键标准；关键原需求必须在其所有原子项完整后才算实现，不能通过拆分取消关键性。description 明确通过边界而非模糊“更好看”。已有 frozenPlan 时保留 name、summary、requirements、capabilities、assumptions 不变，只补充此清单。`;
export const ATOMIC_JUDGE_PROMPT=`本次使用 scene-quality-v6 原子评审：逐条评 frozenPlan.acceptanceCriteria，返回 criteria=[{id,score,verdict,reason,frames}]，每项恰好一次。score 为0..5连续分：0=可观察的要求完全缺失；1=仅有少量特征；2=粗略实现但主要差距明显；3=主体成立仍有明显差距；4=接近参考但有具体残留；5=该项在所给画面中完整实现。可用0.1步长，必须说明仍未实现部分。met仅对应5，missing仅对应0，其他为partial。
严格按每项冻结dimension判分，街机是否存在及数量不因漆面不够写实重复扣coverage；漆面扣material，轮廓扣shape。整体完整复刻不是额外扣分项。不可见不等于缺失，也不得声称已验证：证据不足明确说明并降低confidence。只引用实际frameNames。总分和关键项判定由脚本按这些条目汇总；dimensions仍给出独立诊断，但不覆盖原子条目的确定性聚合。原 requirements 的 verdict 依其所有原子项汇总，理由说明残留。不能为达到目标倒推评分。`;
export const EVIDENCE_JUDGE_PROMPT=`本次使用 scene-quality-v7 原子评审。逐条评 frozenPlan.acceptanceCriteria，返回 criteria=[{id,score,verdict,reason,frames}]，每项恰好一次；不得删改任何冻结要求、关键性、权重或证据。
verdict 回答“description 明确写出的条件是否在实际画面中满足”，score 回答“在本条 dimension 上与参考目标的实现程度”。二者分别判断，不能把 met 偷换为满分或完美复刻。met=所列条件全部有可见证据；partial=至少一个所列条件仍缺失或证据不足；missing=要求的可观察内容完全缺失。必须指出未满足的是 description 中哪个条件，不能临时增加更严格的隐藏条件。
score 为0..5连续分，可用0.1步长：0=要求完全缺失；1=仅少量特征；2=主要差距明显；3=主体成立仍有明显差距；4=接近参考有具体残留；5=该维度在所给画面中没有可见差距。满足明确条件但存在允许的细节差异，可判 met 且 score 小于5；这不是加分或豁免缺失。missing 只能为0；不完整或不可核验不能判 met，不能以高总分抵消真实缺失。
例如要求“两个带把手的木柜”，两个木柜和各自把手清晰存在，轻微比例偏差仍在 shape 扣分，但不临时添加“尺寸与照片精确相同”的否决条件；少了一个把手必须 partial，不能按总体接近代替数量要求。要求“旧木表面具有磨损”，只有均匀色块或规则条纹仍不满足，不能因为颜色相近就判 met。具体材质、空间、遮挡、数量和禁止事项均按本条原文核验，不能用这些示例替代实际判断。
同一缺陷只在对应 dimension 计分；coverage 评必要组成和明确数量，spatial 评关系比例机位遮挡，shape 评轮廓构造，material 评表面颜色磨损与光照，readability 评可辨程度。只引用实际 frameNames；未观察的隐藏区域不作已验证结论。dimensions 仍给出对整体实际画面的独立诊断，不能从条目均值复制或为过关倒推；脚本同时要求原子聚合和整体诊断达到既定80分及每维3/5下限。原 requirements 的 verdict 按所含条目条件汇总。真实 Engine 硬门槛、规范和置信度保持独立。`;
export const atomicJudgePrompt=(version:string)=>version===EVIDENCE_QUALITY_VERSION?EVIDENCE_JUDGE_PROMPT:ATOMIC_JUDGE_PROMPT;
export function validateCriteria(plan:any){
 const rows=plan.acceptanceCriteria,reqs=new Map<string,any>((plan.requirements??[]).map((r:any)=>[r.id,r]));
 if(!Array.isArray(rows)||rows.length<5||rows.length>100||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('原子验收标准数量或身份无效');
 const texts=new Set<string>();
 for(const r of rows){const req=reqs.get(r.requirementId),key=r.description?.replace(/\s/g,'');
  if(req&&r.source!==req.source)throw Error('原子标准引用、维度、权重或依据无效：'+r.id+'；requirementId='+r.requirementId+' 的 source 必须沿用 '+req.source+'，当前为 '+r.source+'。保留原需求及原始依据；图像事实应引用具有图像依据的原需求，不能改写来源或降低关键性。');
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,55}$/.test(r.id)||!req||!CRITERION_DIMENSIONS.includes(r.dimension)||!key||texts.has(key)||!Number.isFinite(r.weight)||r.weight<1||r.weight>5||typeof r.critical!=='boolean'||r.source!==req.source||!Array.isArray(r.evidence)||!r.evidence.length||r.evidence.some((s:any)=>typeof s!=='string'||!s.trim()))throw Error('原子标准引用、维度、权重或依据无效：'+r.id);
  if(r.source==='inferred'&&r.critical)throw Error('推断标准不可设为关键');texts.add(key);
 }
 for(const req of reqs.values()){const own=rows.filter(r=>r.requirementId===req.id);if(!own.length||req.critical&&!own.some(r=>r.critical))throw Error('原子标准遗漏原需求或降低关键性：'+req.id);}
 if(CRITERION_DIMENSIONS.some(id=>!rows.some(r=>r.dimension===id)))throw Error('五个评分维度必须有冻结原子标准');return plan;
}
export function aggregateCriteria(plan:any,review:any,version=ATOMIC_QUALITY_VERSION){
 if(!isAtomicQuality(version))throw Error('未知原子评审版本：'+version);
 validateCriteria(plan);const rows=review.criteria;
 if(!Array.isArray(rows)||rows.length!==plan.acceptanceCriteria.length||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('原子评审条目缺失或重复');
 const judgments=new Map<string,any>(rows.map((r:any)=>[r.id,r]));
 for(const c of plan.acceptanceCriteria){const r=judgments.get(c.id);const verdictValid=r&&(version===ATOMIC_QUALITY_VERSION?r.verdict===(r.score===5?'met':r.score===0?'missing':'partial'):['met','partial','missing'].includes(r.verdict)&&(r.verdict==='missing'?r.score===0:r.score>0)&&(r.verdict!=='partial'||r.score<5));if(!r||!Number.isFinite(r.score)||r.score<0||r.score>5||!r.reason?.trim()||!Array.isArray(r.frames)||!r.frames.length||r.frames.some((f:any)=>typeof f!=='string'||!f.trim())||!verdictValid)throw Error('原子评审分值、判定或证据不一致：'+c.id);}
 const dimensions=CRITERION_DIMENSIONS.map(id=>{const groups=plan.requirements.map((req:any)=>({req,criteria:plan.acceptanceCriteria.filter((c:any)=>c.dimension===id&&c.requirementId===req.id)})).filter((g:any)=>g.criteria.length);
  let sum=0,weight=0;for(const {req,criteria} of groups){const cw=criteria.reduce((n:number,c:any)=>n+c.weight,0);sum+=(req.weight??1)*criteria.reduce((n:number,c:any)=>n+judgments.get(c.id).score*c.weight,0)/cw;weight+=req.weight??1;}
  const criteria=plan.acceptanceCriteria.filter((c:any)=>c.dimension===id);return {id,score:sum/weight,frames:[...new Set(criteria.flatMap((c:any)=>judgments.get(c.id).frames))],reason:criteria.map((c:any)=>c.id+'：'+judgments.get(c.id).reason).join('；')};});
 const requirements=plan.requirements.map((req:any)=>{const cs=plan.acceptanceCriteria.filter((c:any)=>c.requirementId===req.id),js=cs.map((c:any)=>judgments.get(c.id));return {id:req.id,verdict:js.every((r:any)=>r.verdict==='met')?'met':js.every((r:any)=>r.verdict==='missing')?'missing':'partial',reason:js.map((r:any)=>r.id+'：'+r.reason).join('；'),frames:[...new Set(js.flatMap((r:any)=>r.frames))]};});
 const criticalMissing=[...new Set([...plan.acceptanceCriteria.filter((c:any)=>c.critical&&judgments.get(c.id).verdict!=='met').map((c:any)=>c.requirementId),...plan.requirements.filter((req:any)=>req.critical&&requirements.find((r:any)=>r.id===req.id).verdict!=='met').map((req:any)=>req.id)])];
 return {dimensions,criticalMissing,criteria:rows,requirements};
}
