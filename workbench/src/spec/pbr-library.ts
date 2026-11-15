/**
 * Poly Haven(CC0)PBR 贴图库:按资产名下载 1k 的 diffuse / nor_gl / arm(R=AO,G=粗糙度,B=金属度,与 glTF 金属粗糙度贴图同通道),
 * 缩到 size² 解码成 RGBA8 并 gzip 缓存在数据目录。引擎在 Node 构建期没有 JPEG 解码器,所以贴图以原始像素进 pack。
 * 规格材质写 surface.pattern = 'polyhaven:<资产名>' 即引用;同一资产只下载一次,来源与 md5 记在 meta.json。
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DATA} from '../store';

export const PBR_DIR=()=>process.env.PIPELINE_PBR_DIR??join(DATA,'pbr');
const MAPS={color:'Diffuse',normal:'nor_gl',arm:'arm'} as const;
export type PbrMaps={asset:string;size:number;color:string;normal:string;arm:string};

export async function ensurePbr(asset:string,size=512):Promise<PbrMaps>{
 if(!/^[a-z0-9_]+$/.test(asset))throw Error('Poly Haven 资产名无效:'+asset);
 const dir=join(PBR_DIR(),asset);mkdirSync(dir,{recursive:true});
 const done=join(dir,`maps-${size}.json`);if(existsSync(done))return JSON.parse(readFileSync(done,'utf8'));
 const files=await (await fetch('https://api.polyhaven.com/files/'+asset)).json() as any,meta:any={asset,source:'https://polyhaven.com/a/'+asset,license:'CC0',maps:{}};
 const out:any={asset,size};
 for(const [key,name] of Object.entries(MAPS)){
  const f=files[name]?.['1k']?.jpg??files[name]?.['1k']?.png;if(!f)throw Error(`Poly Haven ${asset} 缺 ${name} 1k 贴图`);
  const jpg=join(dir,`${key}-1k.${f.url.endsWith('.png')?'png':'jpg'}`);
  if(!existsSync(jpg))writeFileSync(jpg,new Uint8Array(await (await fetch(f.url)).arrayBuffer()));
  // PIL 解码 + 缩放 → 原始 RGBA8(颜色贴图保持 sRGB 字节,法线/ARM 为线性数据)。
  const raw=spawnSync('python3',['-I','-c',`import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA').resize((${size},${size}),Image.LANCZOS);sys.stdout.buffer.write(im.tobytes())`,jpg],{maxBuffer:size*size*4+1024});
  if(raw.status!==0||raw.stdout.length!==size*size*4)throw Error(`解码 ${jpg} 失败:`+raw.stderr);
  out[key]=gzipSync(raw.stdout,{level:9}).toString('base64');meta.maps[key]={url:f.url,md5:f.md5};
 }
 writeFileSync(join(dir,'meta.json'),JSON.stringify(meta,null,2));writeFileSync(done,JSON.stringify(out));
 return out;
}
