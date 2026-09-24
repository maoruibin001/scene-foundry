import {
  openSync,
  closeSync,
  readSync,
  statSync,
  realpathSync,
  opendirSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
export const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const safeId = (id: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id);
export class Reader {
  root: string;
  cache = new Map<
    string,
    { stamp: string; value: any; bytes: number; hash: string }
  >();
  cacheBytes = 0;
  constructor(root: string) {
    this.root = realpathSync(root);
  }
  path(rel: string) {
    const path = resolve(this.root, rel);
    if (!path.startsWith(this.root + sep)) throw Error("路径越界");
    const real = realpathSync(path);
    if (!real.startsWith(this.root + sep)) throw Error("符号链接越界");
    return real;
  }
  list(rel: string, max = 128): string[] {
    let dir;
    const names: string[] = [];
    try {
      dir = opendirSync(this.path(rel));
      for (let i = 0; i < max; i++) {
        const e = dir.readSync();
        if (!e) break;
        names.push(e.name);
      }
    } catch {
    } finally {
      dir?.closeSync();
    }
    return names.sort();
  }
  session(maxBytes = 8 * 1024 * 1024) {
    let readBytes = 0,
      reads = 0;
    const warnings: string[] = [];
    const json = (rel: string): any => {
      try {
        const path = this.path(rel),
          st = statSync(path, { bigint: true }),
          bytes = Number(st.size),
          stamp = `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
        if (!st.isFile() || bytes > 2 * 1024 * 1024) {
          warnings.push(`${rel} 超过单文件 2 MiB 限额或不是文件`);
          return null;
        }
        const old = this.cache.get(rel);
        if (old?.stamp === stamp) return old.value;
        if (readBytes + bytes > maxBytes || reads >= 128) {
          warnings.push("达到本轮读取上限，稍后刷新继续");
          return null;
        }
        reads++;
        readBytes += bytes;
        const fd = openSync(path, "r");
        let raw: Buffer;
        try {
          raw = Buffer.alloc(bytes);
          const n = readSync(fd, raw, 0, raw.length, 0);
          raw = raw.subarray(0, n);
        } finally {
          closeSync(fd);
        }
        const after = statSync(path, { bigint: true });
        if (`${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` !== stamp)
          throw Error("写入中");
        const value = JSON.parse(raw.toString("utf8"));
        if (old) {
          this.cacheBytes -= old.bytes;
          this.cache.delete(rel);
        }
        while (
          this.cacheBytes + raw.length > 32 * 1024 * 1024 &&
          this.cache.size
        ) {
          const key = this.cache.keys().next().value!;
          this.cacheBytes -= this.cache.get(key)!.bytes;
          this.cache.delete(key);
        }
        this.cache.set(rel, {
          stamp,
          value,
          bytes: raw.length,
          hash: sha(raw),
        });
        this.cacheBytes += raw.length;
        return value;
      } catch (e: any) {
        if (e.code !== "ENOENT")
          warnings.push(`${rel} 暂不可读（写入中或格式不兼容）`);
        return null;
      }
    };
    return { json, warnings, stats: () => ({ readBytes, reads }) };
  }
  digest(rel: string) {
    return this.cache.get(rel)?.hash ?? null;
  }
}
