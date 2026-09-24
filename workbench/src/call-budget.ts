/** Unlimited is explicit; malformed limits never silently disable the guard. */
export function parseCallLimit(value:string|undefined):number|null {
 if(value==='unlimited')return null;
 const limit=Number(value??10);
 if(!Number.isSafeInteger(limit)||limit<1)throw Error('PIPELINE_MAX_CALLS 必须为正整数或 unlimited');
 return limit;
}
export function callAllowance(limit:number|null,used:number,required=1){return limit===null||used+required<=limit;}
export function budgetSnapshot(limit:number|null,used:number){return {used,max:limit,remaining:limit===null?null:Math.max(0,limit-used),unlimited:limit===null,limitKind:limit===null?'debug-unlimited':'local-task-call-cap'};}
