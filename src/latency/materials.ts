import { SOURCES, NOVEL, QUESTION } from '../novel-materials.ts';
export { QUESTION };
export const TARGET = `[C01] ${SOURCES[0].title}\n${SOURCES[0].text}`;
export const MANUAL = SOURCES.map(source => `[${source.id}] ${source.title}\n${source.text}`).join('\n\n');
export const CONDITIONS = {
  short: { label: '短材料', description: '只读相关原文 C01' },
  long: { label: '完整长材料', description: '读30条、每条约2000汉字的原文' },
  repeat: { label: '原样再发长请求', description: '与长材料请求逐字一致' },
  prefix: { label: '改最前版本前缀', description: '原文不变，只将实验 A 改为 B' },
  detailed: { label: '长材料，展开解释', description: '同一问题，增加原文依据与人物关系的解释' },
} as const;
export type Condition = keyof typeof CONDITIONS;
export function requestBody(condition: Condition, model: string): string {
  const material = condition === 'short' ? TARGET : MANUAL;
  const instruction = condition === 'detailed'
    ? '先回答数量，再用约350字解释原文依据、大哥的工作及韩立为何向往它。引用资料编号，不新增情节。'
    : '只用一句话回答数量，并引用资料编号，不展开说明。';
  return JSON.stringify({ model, messages: [
    { role: 'system', content: `实验版本：${condition === 'prefix' ? 'B' : 'A'}\n只依据本次提供的小说原文回答，没有依据就说明未知，不用已知小说情节补全。` },
    { role: 'user', content: `${NOVEL}\n\n${material}\n\n问题：${QUESTION}\n${instruction}` },
  ], stream: true, stream_options: { include_usage: true }, temperature: 0,
  max_tokens: condition === 'detailed' ? 8192 : 4096 });
}
