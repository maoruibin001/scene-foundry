import {readFileSync,realpathSync} from 'node:fs';import {resolve,relative,isAbsolute,dirname} from 'node:path';import {createHash} from 'node:crypto';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export type EffectOwner={file:string;expectedSha256:string;anchor:string;rootVariable:string};
/** One explicit lifecycle hook in the existing owner; no second scene owner or
 * replacement gameplay script. Validate the complete edit before writing assets. */
export function prepareEffectOwner(game:string,owner:EffectOwner){
 const root=realpathSync(game),file=realpathSync(resolve(root,owner.file)),rel=relative(root,file);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||!/^[$A-Za-z_][$\w]*$/.test(owner.rootVariable))throw Error('EFFECT_OWNER_OUTSIDE_PROJECT');
 const before=readFileSync(file,'utf8');if(sha(before)!==owner.expectedSha256)throw Error('EFFECT_OWNER_DRIFT');
 let modulePath=relative(dirname(file),resolve(root,'assets/pipeline-revisions/active-effects.ts')).replaceAll('\\','/');if(!modulePath.startsWith('.'))modulePath='./'+modulePath;
 const imported=`import {installPipelineEffects} from ${JSON.stringify(modulePath)};`,call=`yield installPipelineEffects(ctx,${owner.rootVariable});`;
 if(before.includes(imported)&&before.includes(call))return {file,source:before,beforeSha256:sha(before),afterSha256:sha(before)};
 if(before.includes('installPipelineEffects')||!owner.anchor||before.split(owner.anchor).length!==2)throw Error('EFFECT_OWNER_ANCHOR_INVALID');
 const source=imported+'\n'+before.replace(owner.anchor,call+'\n'+owner.anchor);
 return {file,source,beforeSha256:sha(before),afterSha256:sha(source)};
}
export function sameRotation(a:readonly number[],b:readonly number[]){return a?.length===4&&b?.length===4&&[...a,...b].every(Number.isFinite)&&Math.abs(Math.hypot(...a)-1)<1e-5&&Math.abs(Math.hypot(...b)-1)<1e-5&&[1,-1].some(sign=>a.every((n,i)=>Math.abs(n-sign*b[i])<=1e-6));}
