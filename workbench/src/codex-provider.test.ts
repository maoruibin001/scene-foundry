import {test,expect} from 'bun:test';
import {codexEnvironment,cliReceipt,resolveCodexBin} from './codex-provider';
import {modelSchema,normalizeModelValue} from './model-schema';
test('subscription subprocess receives no API credentials or endpoint overrides',()=>{
 const env=codexEnvironment({HOME:'/test',PATH:'/bin',CODEX_HOME:'/codex',OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret',OPENAI_BASE_URL:'https://alternate',ANTHROPIC_API_KEY:'secret',PIPELINE_PROVIDER_API_KEY:'secret'});
 expect(env).toEqual({HOME:'/test',PATH:'/bin',CODEX_HOME:'/codex'});
});
test('default launcher resolves the local codex CLI rather than a custom wrapper',()=>{
 expect(resolveCodexBin()).toBe(Bun.which('codex')??'codex');
 expect(resolveCodexBin('/missing/custom/codex')).toBe('/missing/custom/codex');
});
test('CLI route mismatch is rejected, no fabricated returned model',()=>{
 const log='OpenAI Codex v0.154.0\nmodel: gpt-5.6-luna\nprovider: openai\nreasoning effort: low\nsession id: abc\ntokens used\n1,234';
 const receipt=cliReceipt(log,'gpt-5.6-luna','low');expect(receipt.cliModel).toBe('gpt-5.6-luna');expect(receipt.returnedModel).toBeNull();expect(receipt.usage.cliReportedTokens).toBe(1234);
 expect(()=>cliReceipt(log,'gpt-6-astra')).toThrow('MODEL_ROUTE_UNVERIFIED');expect(()=>cliReceipt(log.replace('openai','alternate'),'gpt-5.6-luna')).toThrow();
});
test('nullable schema relation values preserve IR defaults',()=>{
 const ir=normalizeModelValue('generate',{relations:[{radius:null,gap:null},{radius:6,gap:0}]});expect(ir.relations).toEqual([{}, {radius:6,gap:0}]);
 for(const role of ['plan','generate','judge','repair','scene-space','scene-surface','scene-refine','scene-spatial-refine','geometry-asset']){const visit=(s:any)=>{if(s.type==='object'){expect(s.additionalProperties).toBe(false);expect(s.required).toEqual(Object.keys(s.properties));Object.values(s.properties).forEach(visit)}if(s.items)visit(s.items);s.anyOf?.forEach(visit)};visit(modelSchema(role));}
});

test('全部输出契约不包含服务端不支持的正则前后查找',()=>{
 const walk=(s:any)=>{if(!s||typeof s!=='object')return;if(s.pattern)expect(s.pattern).not.toMatch(/\(\?[=!<]/);Object.values(s).forEach(v=>Array.isArray(v)?v.forEach(walk):walk(v));};
 for(const role of ['scene-refine','scene-spatial-refine','scene-space','scene-surface','scene-layout','geometry-asset','scene-generation','geometry','plan','judge','repair'])walk(modelSchema(role));
});
