import { SOURCES, CORPUS_INFO } from '../novel-materials.ts';
import { SCENARIOS, type Catalog, type Fixture, type FixtureKey } from './contract.ts';

export async function loadCatalog(): Promise<Catalog> {
  const fixtures = {} as Record<FixtureKey, Fixture>;
  for (const [index, key] of (['A', 'B'] as const).entries()) {
    const source = SOURCES[index];
    // 状态演练回显现成原文，不冒充云模型生成。
    const answer = source.text.slice(0, 800);
    fixtures[key] = { key, title: `《凡人修仙传》· ${source.title}`,
      instructions: '受控回显下面的小说原文，用于观察停止、超时与失败。', input: source.text,
      answer, deltas: answer.match(/[\s\S]{1,24}/g)!, answerOrigin: 'teacher-controlled-original-echo',
      source: { kind: 'original-excerpt', sourceId: source.id, ...CORPUS_INFO } };
  }
  return { sdkVersion: '7.0.122', fixtures, scenarios: SCENARIOS, files: [] };
}
