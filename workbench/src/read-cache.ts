import {statSync,readFileSync} from 'node:fs';
/** 仅复用同 inode/大小/mtime/ctime 文件，返回拷贝，避免调用方改坏缓存。 */
export class JsonReadCache{
 private rows=new Map<string,{key:string,value:any}>();
 constructor(readonly maxEntries=1000){}
 read(path:string){const s=statSync(path),key=[s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');let row=this.rows.get(path);
  if(!row||row.key!==key){row={key,value:JSON.parse(readFileSync(path,'utf8'))};this.rows.delete(path);this.rows.set(path,row);while(this.rows.size>this.maxEntries)this.rows.delete(this.rows.keys().next().value!);}
  return structuredClone(row.value);
 }
}
