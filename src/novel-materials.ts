import corpus from '../materials/凡人修仙传/原文片段.json';
export const NOVEL = '《凡人修仙传》';
export const SOURCES = corpus.sources;
export const FAMILY_FACTS = { age: 10, family_rank: 4 } as const;
export const FAMILY_EXCERPT = SOURCES[0].text.split(/\r?\n/).find(text => text.includes('他在家里排行老四，今年刚十岁'))!.trim();
export const MONTHLY_EXCERPT = SOURCES[0].text.split(/\r?\n/).find(text => text.includes('一个月还有三十个铜板拿'))!.trim();
export const QUESTION = '第一章《山边小村》中，韩立的大哥当铁匠学徒时，一个月能拿多少铜板？';
export const CORPUS_INFO = { novel: NOVEL, author: corpus.author, originalSha256: corpus.originalSha256,
  sourceSha256: corpus.sourceSha256, records: SOURCES.length, hanCount: SOURCES.reduce((sum, source) => sum + source.hanCount, 0) };
