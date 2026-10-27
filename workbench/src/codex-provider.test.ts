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
 for(const role of ['plan','generate','judge','repair','scene-space','scene-blockout','scene-surface','scene-refine','scene-spatial-refine','geometry-asset']){const visit=(s:any)=>{if(s.type==='object'){expect(s.additionalProperties).toBe(false);expect(s.required).toEqual(Object.keys(s.properties));Object.values(s.properties).forEach(visit)}if(s.items)visit(s.items);s.anyOf?.forEach(visit)};visit(modelSchema(role));}
});

test('全部输出契约不包含服务端不支持的正则前后查找',()=>{
 const walk=(s:any)=>{if(!s||typeof s!=='object')return;if(typeof s.pattern==='string')expect(s.pattern).not.toMatch(/\(\?[=!<]/);Object.values(s).forEach(v=>Array.isArray(v)?v.forEach(walk):walk(v));};
 for(const role of ['scene-refine','scene-spatial-refine','scene-space','scene-blockout','scene-surface','scene-layout','geometry-asset','scene-generation','geometry','plan','judge','repair'])walk(modelSchema(role));
});
test('无损重编码只换压缩流：像素一致、字节不同、校验和有效；非 PNG 拒绝',async()=>{
 const {losslessPngReencode}=await import('./codex-provider');const {deflateSync,inflateSync}=await import('node:zlib');
 const chunk=(type:string,data:Buffer)=>{const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4,'latin1');tail.writeUInt32BE(Bun.hash.crc32(Buffer.concat([head.subarray(4),data]))>>>0);return Buffer.concat([head,data,tail]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(32,4);ihdr[8]=8;ihdr[9]=2;
 const raw=Buffer.concat(Array.from({length:32},(_,y)=>Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:64*3},(_,x)=>(x*7+y*13)&255))]))),packed=deflateSync(raw,{level:1});
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',packed.subarray(0,40)),chunk('IDAT',packed.subarray(40)),chunk('IEND',Buffer.alloc(0))]);
 const out=losslessPngReencode(png);expect(out.equals(png)).toBe(false);
 const parts:any[]=[];for(let p=8;p<out.length;){const n=out.readUInt32BE(p),type=out.toString('latin1',p+4,p+8),data=out.subarray(p+8,p+8+n);expect(out.readUInt32BE(p+8+n)).toBe(Bun.hash.crc32(Buffer.concat([Buffer.from(type,'latin1'),data]))>>>0);parts.push({type,data});p+=12+n;}
 expect(parts.map(c=>c.type)).toEqual(['IHDR','IDAT','IEND']);expect(parts[0].data.equals(ihdr)).toBe(true);expect(inflateSync(parts[1].data).equals(raw)).toBe(true);
 expect(()=>losslessPngReencode(Buffer.from([255,216,255,0]))).toThrow('PNG');
});
test('worker contract travels in the prompt, never as model_instructions_file (it made every codex6 relay call fail on 2026-10-27)',async()=>{
 const src=await Bun.file(new URL('./codex-provider.ts',import.meta.url)).text();
 expect(src).not.toContain('model_instructions_file');
 expect(src).toContain("input:worker+'\\n\\n'+codexPrompt(");
});
