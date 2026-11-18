/**
 * 规格 → 生成器契约的前置检查。
 * 复用导出器确定性的 plan 前半段（不生成网格、不写文件），把"要等 build 后才发现
 * 关键参数无解 / 生成器缺失"提前到规格入库时。语义与 planSpecExport 保持一致，
 * 不另写一套校验规则，避免前置检查与实际导出对同一份规格给出不同结论。
 */
import {prepareExportPlacements} from './export-pack';
import type {SceneSpec} from './schema';

export type SpecPrecheck={
 unresolved:{object:string;family:string;key:string;reason:string}[];
 errors:string[];
 proxies:number;
 dropped:number;
};

export function specPrecheck(spec:SceneSpec):SpecPrecheck{
 const {report}=prepareExportPlacements(spec);
 return {
  unresolved:report.unresolved,
  errors:report.errors,
  proxies:report.proxies.length,
  dropped:report.dropped.length,
 };
}

/** 会阻止产出完整成品的问题：缺关键参数映射 / 契约错误。灰模代理与非结构性参数丢弃只作提示。 */
export function specPrecheckMessage(r:SpecPrecheck):string{
 const lines=[...r.errors,...r.unresolved.map(u=>`${u.object}.${u.key}: ${u.reason}`)];
 return lines.slice(0,8).join(';');
}
