export { BACKGROUND, PREVIOUS_CHAPTER } from '../decisions/scenario.ts';
import { BACKGROUND, PREVIOUS_CHAPTER } from '../decisions/scenario.ts';
export const INITIAL_TASK = '按我选择并编辑的方案整理一份不超过200字的阅读笔记，附原文来源编号。';
export const SYSTEM = `共同整理《凡人修仙传》的阅读笔记。\n${BACKGROUND}\n\n[C01] ${PREVIOUS_CHAPTER}\n\n依据读者最新要求和编辑稿修改笔记，保留有依据的事实；不续写小说，不添加情节。提供完整当前稿时以它为修改基线。只输出本轮要求的笔记或核对结果；未知信息说明缺口，采用由读者决定。`;
