/** Unlimited is explicit; malformed limits never silently disable the guard. */
export function parseCallLimit(value:string|undefined):number|null {
 if(value==='unlimited')return null;
 const limit=Number(value??10);
 if(!Number.isSafeInteger(limit)||limit<1)throw Error('PIPELINE_MAX_CALLS 必须为正整数或 unlimited');
 return limit;
}
export function callAllowance(limit:number|null,used:number,required=1){return limit===null||used+required<=limit;}
export function budgetSnapshot(limit:number|null,used:number){return {used,max:limit,remaining:limit===null?null:Math.max(0,limit-used),unlimited:limit===null,limitKind:limit===null?'debug-unlimited':'local-task-call-cap'};}
/** 与本轮 Codex 启动器共享同一份持久化调用账本，预检和重试也计入。 */
export function acceptanceBudget(value:any){
 if(!value||typeof value.enabled!=='boolean'||!Number.isSafeInteger(value.maxCalls)||value.maxCalls<1||!Array.isArray(value.attempts))throw Error('统一验收预算记录无效');
 return {...budgetSnapshot(value.maxCalls,value.attempts.length),remaining:value.enabled?Math.max(0,value.maxCalls-value.attempts.length):0,limitKind:'unified-acceptance',scope:'本轮统一验收，含预检、复评、生成和重试'};
}

/** 后续评审调用不被当前步骤的自动重试消耗；每次真正发出请求前检查。 */
export function requiredCalls(reserved=0){
 if(!Number.isSafeInteger(reserved)||reserved<0)throw Error('保留调用数必须为非负整数');
 return reserved+1;
}
