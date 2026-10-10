export function validationLimitReached(boundary){return Boolean(boundary&&boundary.unlimited!==true&&boundary.remainingRounds<=0);}
export function validationBoundaryHint(boundary){
 const count=boundary.unlimited===true?'验证次数不限，累计已登记 '+boundary.usedRounds+' 轮':'本批最多 '+boundary.maxRounds+' 轮，已用 '+boundary.usedRounds+' 轮，剩余 '+boundary.remainingRounds+' 轮';
 const mode=boundary.generationMode==='qualified'?'生成至通过；连续无改善停止并保留诊断':boundary.generationMode==='bounded'?'每个输入最多两次成品修正':'新输入采用首轮验证';
 return count+'；'+mode+'，失败和续接均保留记录';
}
export function validationRoundText(round){return round.unlimited===true?'授权验证第 '+round.index+' 轮 · 不设总次数上限；原始评分和调用历史保留。':'授权验证第 '+round.index+' / '+round.maxRounds+' 轮；失败与中断计入上限，原始评分和调用历史保留。';}
