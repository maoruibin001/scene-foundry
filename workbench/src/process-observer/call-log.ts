import { openSync, closeSync, fstatSync, readSync, statSync } from 'node:fs';
import { Reader, sha } from './reader';

export const CALL_FILES = {
  input: { suffix: 'prompt.json', label: '调用输入', tail: false },
  inputReceipt: { suffix: 'input-receipt.json', label: '输入附件与配置', tail: false },
  log: { suffix: 'cli.log', label: '执行日志', tail: true },
  stdout: { suffix: 'stdout.log', label: '标准输出', tail: true },
  response: { suffix: 'response.txt', label: '最终结果', tail: false },
  partial: { suffix: 'partial-response.txt', label: '未完成输出', tail: false },
} as const;
export const TEXT_LIMIT = 128 * 1024;

// Read only a bounded window, even when a producer appends a large log.
export function callLog(reader: Reader, base: string, call: string, stream: string) {
  if (!Object.hasOwn(CALL_FILES, stream)) throw Error('不支持的调用记录类型');
  const available = Object.entries(CALL_FILES).map(([id, spec]) => {
    try {
      const stat = statSync(reader.path(`${base}/${call}-${spec.suffix}`));
      return { id, label: spec.label, exists: stat.isFile(), bytes: stat.size };
    } catch { return { id, label: spec.label, exists: false, bytes: null }; }
  });
  const spec = CALL_FILES[stream as keyof typeof CALL_FILES];
  const file = `${call}-${spec.suffix}`;
  let fd: number;
  try { fd = openSync(reader.path(`${base}/${file}`), 'r'); }
  catch (error: any) {
    if (error.code === 'ENOENT') return { stream, file, available, state: 'missing', text: '', bytes: null, readBytes: 0 };
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error('调用记录不是普通文件');
    const start = spec.tail ? Math.max(0, stat.size - TEXT_LIMIT) : 0;
    const raw = Buffer.alloc(Math.min(stat.size, TEXT_LIMIT));
    const n = readSync(fd, raw, 0, raw.length, start);
    let offset = 0;
    if (start > 0) while (offset < n && (raw[offset] & 0xc0) === 0x80) offset++;
    const text = new TextDecoder().decode(raw.subarray(offset,n), { stream: true })
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    return { stream, file, available, state: n ? 'present' : 'empty', text,
      bytes: stat.size, readBytes: n, start, truncated: stat.size > n,
      window: spec.tail ? 'tail' : 'head', modifiedAt: stat.mtime.toISOString(), sha256: sha(raw.subarray(0,n)) };
  } finally { closeSync(fd); }
}
