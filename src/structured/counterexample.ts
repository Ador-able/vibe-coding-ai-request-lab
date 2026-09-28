import { inspectResponse } from './inspect.ts';

// 人工构造的反例，不是一次模型响应，也不加入实际调用记录。
export const COUNTEREXAMPLE = {
  material: '陈岚负责在周三下班前提交展板初稿。',
  output: { items: [{ task: '提交展板初稿', owner: '周宇', dueText: '周三下班前', evidence: '陈岚负责在周三下班前提交展板初稿。' }] },
};
export const COUNTEREXAMPLE_CHECK = inspectResponse({ content: JSON.stringify(COUNTEREXAMPLE.output) }, 'stop', COUNTEREXAMPLE.material);
