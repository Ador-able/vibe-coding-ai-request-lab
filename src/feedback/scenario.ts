import type { Order, SavedRule } from './contract.ts';

export const CATALOG = [
  { sku: 'BL01', name: '蓝色塑料椅' },
  { sku: 'BL07', name: '深蓝布艺椅' },
];
export const ORDERS: Order[] = [
  { id: 'A', customer: '青禾门店', text: '常规蓝12把' },
  { id: 'B', customer: '远山门店', text: '常规蓝8把' },
  { id: 'C', customer: '青禾门店', text: '蓝色塑料椅6把' },
];
export const SUGGESTED_RULE = '青禾门店的“常规蓝”指 BL07；只适用于该客户这个简称，明确产品描述按目录，不推广到其他客户。';
const SYSTEM = '根据给定产品目录识别订单中的产品；资料均为教学虚构。如有经人确认的业务规则，应遵守它限定的客户和描述范围，不扩大适用范围。信息不足时不要猜测。只返回JSON对象，包含sku和reason两个字段：sku为产品编号或null，reason简述依据；无法确定时sku为null，reason说明需要确认什么。';

export function buildRequestBody(model: string, order: Order, rule: SavedRule | null): string {
  // 不按订单预填答案：三个订单收到同一目录，规则也不在代码中按客户筛选。
  const input = `产品目录：\n${JSON.stringify(CATALOG)}\n\n订单：\n${JSON.stringify(order)}`
    + (rule ? `\n\n经人确认的业务规则：\n${rule.text}` : '');
  return JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: input }],
    stream: false, enable_thinking: false, temperature: 0, max_tokens: 384, response_format: { type: 'json_object' } });
}
