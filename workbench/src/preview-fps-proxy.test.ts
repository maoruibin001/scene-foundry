import {afterEach,test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createPreviewFpsProxyRegistry,previewEngineURL} from './preview-fps-proxy';
const scriptSource=readFileSync(new URL('../public/preview-fps.js',import.meta.url),'utf8');
const owned:{close():void}[]=[];
afterEach(()=>{for(const x of owned.splice(0))x.close();});
function registry(){const r=createPreviewFpsProxyRegistry({scriptSource});owned.push(r);return r;}
function engine(handler:(req:Request)=>Response){
 for(let port=19775;port<19800;port++)try{const server=Bun.serve({hostname:'127.0.0.1',port,fetch:handler});owned.push({close:()=>server.stop(true)});return server;}catch(e:any){if(e?.code!=='EADDRINUSE')throw e;}
 throw Error('fixture has no free Engine preview port');
}

test('only local root Engine URLs within the real launcher port range are accepted',()=>{
 for(const value of ['http://localhost:19775/','http://127.0.0.1:19799/','http://[::1]:19782/'])expect(previewEngineURL(value).port).toBe(new URL(value).port);
 for(const value of ['https://localhost:19775/','http://example.com:19775/','http://localhost:19800/','http://localhost:19774/','http://localhost:19884/','http://u:p@localhost:19775/','http://localhost:19775/asset.js','http://localhost:19775/?target=x','http://localhost:19775/#x','not a URL',null])expect(()=>previewEngineURL(value)).toThrow();
 expect(()=>createPreviewFpsProxyRegistry({scriptSource:''})).toThrow('脚本');
});

test('response-only decoration preserves absolute asset paths, scope headers, source scripts and current Engine origin',async()=>{
 const seen:any[]=[];const source='<html><body><canvas id="app"></canvas><script type="module" src="/assets/main.js"></script></body></html>';
 const server=engine(req=>{seen.push({url:new URL(req.url).pathname,headers:new Headers(req.headers)});if(new URL(req.url).pathname==='/assets/main.js')return new Response('engine bytes',{headers:{'Content-Type':'text/javascript'}});return new Response(source,{headers:{'Content-Type':'text/html','Content-Length':String(source.length),'ETag':'original','Cross-Origin-Embedder-Policy':'require-corp'}});});
 const r=registry(),url=await r.wrapURL(server.url.href);expect(url).not.toBe(server.url.href);expect(await r.wrapURL(server.url.href)).toBe(url);
 const response=await fetch(url),html=await response.text();expect(html.replace('<script type="module" src="/__scene-foundry-preview-fps.js"></script>','')).toBe(source);expect(html).toContain('src="/assets/main.js"');expect(html).toContain('src="/__scene-foundry-preview-fps.js"');expect(html.indexOf('__scene-foundry')).toBeLessThan(html.indexOf('</body>'));
 expect(response.headers.get('Cache-Control')).toBe('no-store');expect(response.headers.get('ETag')).toBeNull();expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
 const js=await fetch(new URL('/__scene-foundry-preview-fps.js',url));expect(await js.text()).toBe(scriptSource);expect(seen).toHaveLength(1);
 const asset=await fetch(new URL('/assets/main.js?immutable=1',url),{headers:{Cookie:'should-not-leak=1',Authorization:'secret',Origin:new URL(url).origin}});expect(await asset.text()).toBe('engine bytes');expect(seen.at(-1).headers.get('cookie')).toBeNull();expect(seen.at(-1).headers.get('authorization')).toBeNull();expect(seen.at(-1).headers.get('origin')).toBeNull();
 expect(seen.map(x=>x.url)).toEqual(['/','/assets/main.js']);
});

test('binary assets and range headers stream without buffering or HTML decoration',async()=>{
 const bytes=new Uint8Array([0,255,1,16,45,76]),requests:any[]=[];
 const server=engine(req=>{requests.push({url:req.url,headers:new Headers(req.headers)});return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,2));controller.enqueue(bytes.slice(2));controller.close();}}),{status:206,headers:{'Content-Type':'application/wasm','Content-Range':'bytes 2-7/8','Content-Length':String(bytes.length)}});});
 const url=await registry().wrapURL(server.url.href),response=await fetch(new URL('/assets/geometry.wasm',url),{headers:{Range:'bytes=2-7'}});
 expect(response.status).toBe(206);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('Content-Range')).toBe('bytes 2-7/8');expect(requests[0].headers.get('range')).toBe('bytes=2-7');
});

test('preview serving is read-only, rejects foreign Origin, redirects and cross-origin URL forms',async()=>{
 const requests:any[]=[];const server=engine(req=>{requests.push({url:req.url,headers:new Headers(req.headers)});return new Response(null,{status:302,headers:{Location:'http://example.com/','Set-Cookie':'bad=1'}});});
 const r=registry(),url=await r.wrapURL(server.url.href);
 expect((await fetch(url,{method:'POST',body:'no writes'})).status).toBe(405);expect((await fetch(url,{headers:{Origin:'https://other.example'}})).status).toBe(403);expect(requests).toHaveLength(0);
 const redirected=await fetch(url);expect(redirected.status).toBe(502);expect(redirected.headers.get('Set-Cookie')).toBeNull();expect(requests).toHaveLength(1);
 const cross=await fetch(url+'//example.com/');expect(cross.status).toBe(502);expect(requests.every(req=>new URL(req.url).origin===server.url.origin)).toBe(true);
});

test('HEAD is bodyless; non-main HTML and compressed assets keep their original bytes',async()=>{
 const compressed=gzipSync('compressed immutable asset');
 const server=engine(req=>{const path=new URL(req.url).pathname;if(path==='/asset.gz')return new Response(compressed,{headers:{'Content-Type':'text/plain','Content-Encoding':'gzip'}});if(path==='/index.html')return new Response(gzipSync('<html><body>compressed document</body></html>'),{headers:{'Content-Type':'text/html','Content-Encoding':'gzip'}});return new Response('<html><body>untouched</body></html>',{headers:{'Content-Type':'text/html'}});});
 const url=await registry().wrapURL(server.url.href),head=await fetch(url,{method:'HEAD'});expect(await head.text()).toBe('');expect(head.headers.get('Cache-Control')).toBe('no-store');
 const secondary=await fetch(new URL('/unrelated.html',url));expect(await secondary.text()).not.toContain('__scene-foundry');
 const asset=await fetch(new URL('/asset.gz',url));expect(await asset.text()).toBe('compressed immutable asset');const html=await fetch(new URL('/index.html',url));expect(html.headers.get('Content-Encoding')).toBeNull();const decorated=await html.text();expect(decorated).toContain('compressed document');expect(decorated).toContain('/__scene-foundry-preview-fps.js');
});

test('the registry limits its owned listeners and close prevents new previews',async()=>{
 const r=registry(),urls=new Set<string>();for(let i=0;i<8;i++)urls.add(await r.wrapURL(`http://127.0.0.1:${19775+i}/`));expect(urls.size).toBe(8);
 await expect(r.wrapURL('http://127.0.0.1:19783/')).rejects.toThrow('八个');r.close();await expect(r.wrapURL('http://127.0.0.1:19775/')).rejects.toThrow('关闭');
});
