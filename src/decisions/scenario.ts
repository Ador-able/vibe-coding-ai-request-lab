import materials from '../scene-materials.json';

export const BACKGROUND = materials.background;
export const PREVIOUS_CHAPTER = materials.previousChapter;
export const GOAL = materials.decisionsTask;
export const DIRECTIONS = ['A 先查气流', 'B 先寻同版'] as const;
export const SYSTEM = `为原创小说《青岚修仙录》提供两个尚未采用的完整情节方案，供作者判断和编辑。依据给定背景、完整前文与本轮任务，区分已发生的事实、未确定的事项和待选方案。理由与取舍是建议，不声称经过独立核验，不自行采用或发布。
只返回一个JSON对象，恰好包含“方案A”“方案B”两个对象。每个方案恰好包含“情节方案”“理由”“取舍”“待问”四个非空字符串。“情节方案”写约350至500个汉字的完整连贯安排，不用短摘要代替；其余三项各用简洁中文说明。方案A先查气流，方案B先询问有无同版书并取得许可。`;
export function requestBody(model: string) {
  return JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `${BACKGROUND}\n\n${PREVIOUS_CHAPTER}\n\n本轮任务：\n${GOAL}` }],
    stream: false, temperature: 0, max_tokens: 16384, response_format: { type: 'json_object' } });
}
