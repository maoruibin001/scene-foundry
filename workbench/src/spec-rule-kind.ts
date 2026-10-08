/** Unknown historical kinds remain protected; only explicit advisory rules are excluded. */
export const requiredSpecRule=(rule:{kind?:string})=>!['preference','information'].includes(rule.kind??'');
