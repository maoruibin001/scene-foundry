import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {publishIntegrationPayload,verifiedCandidateEnvironment} from './payload';
test('environment and volumetric sidecars survive the atomic generated-directory publication',()=>{
 const p=mkdtempSync(join(tmpdir(),'integration-payload-'));try{
 const source=join(p,'source'),assets=join(p,'game/assets'),generated=join(assets,'generated'),stage=join(p,'staging');for(const d of [source,generated,stage])mkdirSync(d,{recursive:true});
 const entities={camera:{components:{Camera:{exposure:1}}}},profile={renderPath:'deferred'},env={version:'source-environment-adoption-v1',lightingMode:'spec',entities,profile,volumetric:true},fog='// actual effect';
 writeFileSync(join(source,'integration-environment.json'),JSON.stringify(env));writeFileSync(join(source,'integration-volumetric-fog.ts'),fog);writeFileSync(join(assets,'world.pack.ts'),'const entities='+JSON.stringify(entities)+' as any;\n');writeFileSync(join(p,'render-profile.json'),JSON.stringify(profile));writeFileSync(join(assets,'volumetric-fog.plugin.ts'),fog);
 publishIntegrationPayload(source,stage);renameSync(generated,join(p,'.previous-generated'));renameSync(stage,generated);
 const r=verifiedCandidateEnvironment(generated);expect(r.payloadEvidence.recoveredFromPrepareBackup).toBe(false);expect(readFileSync(r.fogSource,'utf8')).toBe(fog);
 // Existing outputs can recover only the exact payload matching the built world.
 rmSync(join(p,'.previous-generated'),{recursive:true});renameSync(generated,join(p,'.previous-generated'));mkdirSync(generated);
 expect(verifiedCandidateEnvironment(generated).payloadEvidence.recoveredFromPrepareBackup).toBe(true);
 writeFileSync(join(assets,'world.pack.ts'),'const entities={} as any;\n');expect(()=>verifiedCandidateEnvironment(generated)).toThrow('WORLD_MISMATCH');
 writeFileSync(join(assets,'world.pack.ts'),'const entities='+JSON.stringify(entities)+' as any;\n');writeFileSync(join(assets,'volumetric-fog.plugin.ts'),'different scattering');expect(()=>verifiedCandidateEnvironment(generated)).toThrow('FOG_MISMATCH');
 }finally{rmSync(p,{recursive:true,force:true});}
});
test('a declared volumetric payload cannot be published without its effect source',()=>{const p=mkdtempSync(join(tmpdir(),'integration-payload-'));try{writeFileSync(join(p,'integration-environment.json'),JSON.stringify({version:'source-environment-adoption-v1',volumetric:true}));expect(()=>publishIntegrationPayload(p,join(p,'stage'))).toThrow('PAYLOAD_MISSING');}finally{rmSync(p,{recursive:true,force:true});}});
