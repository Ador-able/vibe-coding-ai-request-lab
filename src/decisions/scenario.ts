import { SOURCES } from '../novel-materials.ts';
export const BACKGROUND = '阅读《凡人修仙传》完整原文片段C03，准备一份便于课堂复习的短摘要。全部内容依据原文，不续写小说、不添加人物或情节。';
export const PREVIOUS_CHAPTER = SOURCES[2].text;
export const GOAL = '交出两份完整短摘要：A 按韩立进入竹林、休息、再赶路的事件经过；B 突出考核路线、截止时点和师兄保护。各80至120个汉字，供人选择与直接修改。';
export const DIRECTIONS = ['A 事情经过', 'B 考核条件'] as const;
export const SYSTEM = '依据所附完整原文，交出两份完整短摘要，不续写故事。只返回JSON对象，包含“方案A”“方案B”；每份包含“阅读方案”“理由”“取舍”“待问”四个非空字符串。“阅读方案”填写80至120个汉字的摘要全文，不写整理步骤或方案介绍；其余各用一句话，说明具体依据、推迟了什么重点，以及需要人选择的取舍。理由属于建议，不声称读者效果已经验证。不能把建议或推测写成小说事实，不替人选择、采用或发布。';
export function requestBody(model: string) {
  return JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `${BACKGROUND}\n\n[C03] ${PREVIOUS_CHAPTER}\n\n任务：${GOAL}` }],
    stream: false, temperature: 0, max_tokens: 8192, response_format: { type: 'json_object' } });
}
