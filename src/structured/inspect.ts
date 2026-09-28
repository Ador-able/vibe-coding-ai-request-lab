import { isObject } from '../recorded-model.ts';
import { ExtractionSchema } from './schema.ts';
import type { Inspection } from './contract.ts';

export function inspectResponse(message: unknown, finishReason: string | null | undefined, material: string): Inspection {
  const result: Inspection = { checks: [
    { label: '完整结束', status: 'skip', detail: '未检查' },
    { label: 'JSON解析', status: 'skip', detail: '未检查' },
    { label: '字段结构', status: 'skip', detail: '未检查' },
    { label: '原句定位', status: 'skip', detail: '未检查' },
  ], data: null, evidence: null };
  const fail = (index: number, detail: string) => { result.checks[index] = { ...result.checks[index], status: 'fail', detail }; return result; };
  if (isObject(message) && typeof message.refusal === 'string' && message.refusal.trim() || finishReason === 'content_filter') {
    return fail(0, '响应表示拒绝，未当作提取结果。');
  }
  if (finishReason !== 'stop') return fail(0, finishReason === 'length' ? '输出因长度限制未完整结束。' : `结束状态为${finishReason ?? '未提供'}，未确认完整完成。`);
  if (!isObject(message) || typeof message.content !== 'string' || !message.content.trim()) return fail(0, '响应没有可解析的正文。');
  result.checks[0] = { label: '完整结束', status: 'pass', detail: 'finish_reason=stop，且有正文、无拒绝标记。' };
  let value: unknown;
  try { value = JSON.parse(message.content); } catch { return fail(1, '正文不是有效JSON；没有删除围栏、补括号或重试。'); }
  result.checks[1] = { label: 'JSON解析', status: 'pass', detail: '原始正文可直接解析为JSON。' };
  const parsed = ExtractionSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '根对象'}：${issue.code === 'unrecognized_keys' ? '含未允许的额外字段' : '字段缺失或类型不符'}`);
    return fail(2, details.join('；'));
  }
  result.data = parsed.data;
  result.checks[2] = { label: '字段结构', status: 'pass', detail: '同一Zod定义的safeParse通过；未核验语义。' };
  // 字符串包含只证明引文可定位，不证明它支持这项任务、负责人或日期。
  result.evidence = parsed.data.items.map((item, index) => {
    const start = item.evidence.trim() ? material.indexOf(item.evidence) : -1;
    return { index, found: start >= 0, start: start >= 0 ? start : null };
  });
  const found = result.evidence.filter((item) => item.found).length;
  result.checks[3] = { label: '原句定位', status: !result.evidence.length ? 'skip' : found === result.evidence.length ? 'pass' : 'fail',
    detail: result.evidence.length ? `${found}/${result.evidence.length}条原句存在；仍需人工检查引用是否支持提取内容。` : '没有条目需要定位；是否漏提仍需核查。' };
  return result;
}
