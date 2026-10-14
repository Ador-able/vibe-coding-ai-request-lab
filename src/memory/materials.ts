export { SOURCES, QUESTION } from '../novel-materials.ts';
import { SOURCES, QUESTION, MONTHLY_EXCERPT } from '../novel-materials.ts';
export type Source = { id: string; title: string; text: string };
export const ANSWER_RULE = '只依据提供的原文或摘要回答当前问题，用一句话给出数量和来源编号。资料没有提供所问数量就说明未知，不用你记忆中的小说补全。';
export const ORIGINAL_EXCERPT = MONTHLY_EXCERPT;
export const SOURCE_MAP = new Map(SOURCES.map(source => [source.id, source]));
export const CATALOG = SOURCES.map(({ id, title }) => ({ id, title }));
export function sourceText(ids: string[]) {
  return ids.map(id => { const source = SOURCE_MAP.get(id)!; return `[${id}] ${source.title}\n${source.text}`; }).join('\n\n');
}
export function answerMessages(material: string) {
  return [{ role: 'system', content: ANSWER_RULE }, { role: 'user', content: `${QUESTION}\n\n可用资料：\n${material}` }];
}
export const TEACHING_NOTE = { text: '第一章《山边小村》：韩立的大哥当铁匠学徒，每月有三十个铜板，管吃管住。', source_ids: ['C01'] };
