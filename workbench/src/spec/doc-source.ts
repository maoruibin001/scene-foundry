/**
 * 设计文档源:把 HTML 文档拆成章节文本与表格单元格。表格保留原单元格,冻结数值从这里确定性读取,
 * 不经模型改写;章节文本只供模型理解语义。内嵌 base64 图片单独抽出,作为风格参考候选。
 */
import {createHash} from 'node:crypto';

export type DocTable={index:number;section:string;header:string[];rows:string[][]};
export type DocSection={index:number;heading:string;level:number;text:string};
export type DocImage={index:number;mime:'image/jpeg'|'image/png';bytes:Uint8Array;alt:string;caption:string};
export type DocSource={title:string;sha256:string;sections:DocSection[];tables:DocTable[];images:DocImage[]};

const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
export function decodeEntities(s:string){
 return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,k:string)=>k[0]==='#'?String.fromCodePoint(k[1]==='x'||k[1]==='X'?parseInt(k.slice(2),16):parseInt(k.slice(1),10)):ENTITIES[k.toLowerCase()]??m);
}
const plain=(s:string)=>decodeEntities(s.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t ]+/g,' ').replace(/ *\n */g,'\n').trim();

export function parseHtmlDocument(source:string):DocSource{
 const sha256=createHash('sha256').update(source).digest('hex');
 let body=source.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'');
 const title=plain(body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]??'');
 const images:DocImage[]=[];
 body=body.replace(/<img\b[^>]*>/gi,tag=>{
  const m=tag.match(/src="data:image\/(jpe?g|png);base64,([A-Za-z0-9+/=]+)"/i);if(!m)return '';
  images.push({index:images.length,mime:m[1].toLowerCase()==='png'?'image/png':'image/jpeg',bytes:Uint8Array.from(Buffer.from(m[2],'base64')),alt:decodeEntities(tag.match(/alt="([^"]*)"/i)?.[1]??''),caption:''});
  return `[[image:${images.length-1}]]`;
 });
 // Tables are replaced by markers so section text keeps their position without duplicating cells.
 const tables:DocTable[]=[];
 body=body.replace(/<table\b[\s\S]*?<\/table>/gi,table=>{
  const rows=[...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(r=>[...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c=>plain(c[1]))).filter(r=>r.length);
  tables.push({index:tables.length,section:'',header:rows[0]??[],rows:rows.slice(1)});
  return `\n[[table:${tables.length-1}]]\n`;
 });
 const sections:DocSection[]=[];
 const parts=body.split(/(<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>)/i);
 let heading='',level=0;
 for(const part of parts){
  const h=part.match(/^<h([1-6])\b[^>]*>([\s\S]*?)<\/h[1-6]>$/i);
  if(h){heading=plain(h[2]);level=Number(h[1]);continue;}
  const text=plain(part.replace(/<\/(p|li|div|tr|section)>/gi,'\n'));
  if(!text&&!heading)continue;
  sections.push({index:sections.length,heading,level,text});
  for(const m of text.matchAll(/\[\[table:(\d+)\]\]/g))tables[Number(m[1])].section=heading;
  for(const m of text.matchAll(/\[\[image:(\d+)\]\]([^\n\[]{0,240})/g))images[Number(m[1])].caption=m[2].trim();
 }
 return {title,sha256,sections,tables,images};
}

/** 按表头精确匹配找表;表头不符即报错,避免文档改版后静默读错列。 */
export function findTable(doc:DocSource,header:string[],occurrence=0):DocTable{
 const hits=doc.tables.filter(t=>t.header.length===header.length&&t.header.every((h,i)=>h===header[i]));
 const table=hits[occurrence];
 if(!table)throw Error(`DOC_TABLE_MISSING:找不到表头为 ${header.join(' | ')} 的第 ${occurrence+1} 张表`);
 return table;
}
