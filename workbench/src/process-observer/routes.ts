import { liveOutput } from "./live-output";
import { Source } from './source';
import { join } from 'node:path';

// Mounted by the pipeline workbench; construction never starts a second service.
export function createProcessRoutes(dataRoot: string, publicRoot: string) {
  const source = new Source(dataRoot);
  // xterm's DOM renderer inserts theme/font styles; scripts remain same-origin only.
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src http://localhost:* http://127.0.0.1:*; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
  };
  return (req: Request): Response | null => {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/process/') && !u.pathname.startsWith('/process/')) return null;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) || (req.headers.get('origin') && req.headers.get('origin') !== u.origin)) return json({error:'只允许同源本地读取'},403);
    if (req.method !== 'GET') return json({error:'过程视图仅支持读取'},405);
    try {
      if (u.pathname === '/api/process/index') return json(source.index());
      if (u.pathname === '/api/process/detail') return json(source.detail(u.searchParams.get('key') ?? ''));
      if (u.pathname === '/api/process/asset-preview') return new Response(source.assetPreview(u.searchParams.get('key') ?? '',u.searchParams.get('asset') ?? ''), {headers:{...headers,'Content-Type':'image/svg+xml; charset=utf-8'}});
      if (u.pathname === '/api/process/live') return liveOutput(source,u.searchParams.get('key') ?? '',u.searchParams.get('call') ?? '',u.searchParams.get('stream') ?? 'log',req.signal);
      if (u.pathname === '/api/process/call') return json(source.call(u.searchParams.get('key') ?? '', u.searchParams.get('call') ?? '', u.searchParams.get('stream') ?? 'log'));
      if (u.pathname === '/api/process/media') return new Response(Bun.file(source.media(u.searchParams.get('path') ?? '')), {headers});
      const assets: Record<string,string> = {'/process/':'index.html','/process/app.js':'app.js','/process/call-console.js':'call-console.js','/process/style.css':'style.css','/process/vendor/xterm.mjs':'vendor/xterm.mjs','/process/vendor/xterm.css':'vendor/xterm.css'};
      if (assets[u.pathname]) return new Response(Bun.file(join(publicRoot,assets[u.pathname])),{headers});
      return json({error:'未找到'},404);
    } catch (error) { return json({error:String(error)},400); }
  };
}
