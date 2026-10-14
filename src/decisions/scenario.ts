import { SOURCES } from '../novel-materials.ts';
export const BACKGROUND = '阅读《凡人修仙传》第一章，选择一份便于自己复习的笔记方案。全部内容依据原文，不续写小说、不添加人物或情节。';
export const PREVIOUS_CHAPTER = SOURCES[0].text;
export const GOAL = '提出两份简短阅读笔记方案：A 按事件顺序，B 按人物关系。每份说明记录哪些信息及如何回查原文。';
export const DIRECTIONS = ['A 事件顺序', 'B 人物关系'] as const;
export const SYSTEM = '依据所附原文提出两份阅读笔记方案，供读者选择和编辑，不续写故事。只返回JSON对象，包含“方案A”“方案B”；每份包含“阅读方案”“理由”“取舍”“待问”四个非空字符串。阅读方案不超过150字，其余各用一句话说明。不能把方案或推测写成小说事实。';
export function requestBody(model: string) {
  return JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `${BACKGROUND}\n\n[C01] ${PREVIOUS_CHAPTER}\n\n任务：${GOAL}` }],
    stream: false, temperature: 0, max_tokens: 4096, response_format: { type: 'json_object' } });
}
