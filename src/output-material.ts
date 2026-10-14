import { SOURCES } from './novel-materials.ts';
// 两种输出实验共用第二条原文，保留段落和用字。
export const MATERIAL = SOURCES[1].text;
export const STRUCTURED_RULE = '从所附小说原文提取片段结束时仍需执行的行动。已完成或取消的行动不列入 items；长期愿望不等于任务。没有待执行行动时 items 为空数组。owner 填原文明确行动者，未确定为 null；dueText 沿用原文时间，未知为 null。evidence 逐字引用支持行动的连续原句。只输出 JSON，每项恰好包含 task、owner、dueText、evidence 四个键，task 和 evidence 为字符串，owner 和 dueText 为字符串或 null。不续写或补造安排。';
export const SUMMARY_RULE = '只依据所附《凡人修仙传》原文写约120字阅读摘要，区分已发生事件和未决事项。不补造情节，不加标题。';
export const QUESTIONS_RULE = '只依据原文及摘要，提出2至3个阅读核对问题。每个问题单独一行，以1.、2.、3.开始，不加答案，不把已确定事实当作未知。';
