import { SOURCES, CORPUS_INFO } from '../novel-materials.ts';
import { validateMessages } from './contract.ts';
import type { Catalog, CompletionState, FixtureKey, FixtureSummary, ImportPhase, Message } from './contract.ts';

type Fixture = FixtureSummary & { finalMessage: Message; snapshots: Map<ImportPhase, Message> };
export type Fixtures = { catalog: Catalog; rule: string; byKey: Map<FixtureKey, Fixture>; bySourceId: Map<string, Fixture> };
export async function loadFixtures(): Promise<Fixtures> {
  const byKey = new Map<FixtureKey, Fixture>(), bySourceId = new Map<string, Fixture>();
  for (const [index, key] of (['normal', 'stopped'] as const).entries()) {
    const source = SOURCES[index];
    const id = index === 0 ? 'bf429dc5-1857-48e3-bf19-65c2494b1bbc' : 'd8609f26-b07b-49ce-a2e6-bb1a202d087d';
    const sourceRecordState = key === 'normal' ? 'completed' : 'stopped';
    const userMessage: Message = { id: `${key}-user`, role: 'user', parts: [{ type: 'text', text: `原文回显练习；不是模型生成。\n[${source.id}] ${source.title}\n${source.text}` }] };
    const answer = source.text.slice(0, key === 'normal' ? 800 : 250);
    const message = (text: string, state: 'running' | 'completed' | 'stopped'): Message => ({
      id: `${key}-echo`, role: 'assistant', parts: [{ type: 'text', text }],
      metadata: { model: '无模型 · 原文回显', state, stages: [], source: { kind: 'teacher-controlled-original-echo', sourceId: source.id, ...CORPUS_INFO } },
    });
    const finalMessage = message(answer, sourceRecordState);
    const feedbackMessage: Message = { id: `${key}-review`, role: 'user', parts: [{ type: 'data-review-note',
      data: { targetMessageId: `${key}-echo`, text: '这段是受控原文回显，不是生成摘要。下一轮请只核对引用和完成状态。' } }] };
    await validateMessages([userMessage, finalMessage, feedbackMessage]);
    const fixture: Fixture = { key, sourceRecordId: id, sourceRecordState, userMessage, finalMessage, feedbackMessage,
      phases: key === 'normal' ? ['snapshotEarly', 'snapshotLater', 'final'] : ['final'],
      snapshots: key === 'normal' ? new Map([['snapshotEarly', message(answer.slice(0, 150), 'running')], ['snapshotLater', message(answer.slice(0, 400), 'running')]]) : new Map() };
    byKey.set(key, fixture); bySourceId.set(id, fixture);
  }
  return { byKey, bySourceId, rule: '只核对所附《凡人修仙传》原文和消息状态。回显不代表模型生成；未完成消息不能当作完整答案。',
    catalog: { fixtures: [...byKey.values()].map(({ snapshots, finalMessage, ...summary }) => summary), files: [], sdkVersion: '7.0.122', modelCalls: 0 } };
}
export function historyImport(fixture: Fixture, phase: ImportPhase): { message: Message; state: CompletionState } {
  if (phase === 'final') return { message: fixture.finalMessage, state: fixture.sourceRecordState };
  const message = fixture.snapshots.get(phase);
  if (!message) throw new Error('这份接收示例没有所选快照。');
  return { message, state: 'incomplete' };
}
