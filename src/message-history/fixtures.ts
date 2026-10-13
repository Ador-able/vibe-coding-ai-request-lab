import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validateMessages } from './contract.ts';
import type { Catalog, CompletionState, FixtureKey, FixtureSummary, ImportPhase, Message } from './contract.ts';

const materialDirectory = resolve('fixtures/message-history');
const historySchema = z.looseObject({
  id: z.uuid(), material: z.string(), state: z.enum(['completed', 'stopped']), finalMessage: z.unknown(),
});
type Fixture = FixtureSummary & {
  finalMessage: Message;
  snapshots: Map<ImportPhase, Message>;
};
export type Fixtures = {
  catalog: Catalog;
  rule: string;
  byKey: Map<FixtureKey, Fixture>;
  bySourceId: Map<string, Fixture>;
};

export async function loadFixtures(): Promise<Fixtures> {
  const filenames = [
    '01-历史完整结束.json', '02-受控停止接收.json', '03-完整小说资料.txt',
    '04-四个实际请求与完整正文.json', '05-完整拟用UI数组.json',
    '06-同一消息的完整快照.json', '07-两个人工校正UI.json',
    '08-下一轮完整规则.prompt.txt', '09-迁移到小说工作台.prompt.txt',
  ];
  const buffers = await Promise.all(filenames.map(filename => readFile(resolve(materialDirectory, filename))));
  const files = buffers.map((buffer, index) => ({
    filename: filenames[index], bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }));
  const histories = [historySchema.parse(JSON.parse(buffers[0].toString('utf8'))),
    historySchema.parse(JSON.parse(buffers[1].toString('utf8')))];
  const arrays = JSON.parse(buffers[4].toString('utf8')) as {
    sourceRecordId: string; sourceRecordState: string; messages: Message[];
  }[];
  const snapshots = JSON.parse(buffers[5].toString('utf8')) as {
    snapshots: { originalOneBasedIndex: number; inputCompletionState: string; message: Message }[];
  };
  const feedback = JSON.parse(buffers[6].toString('utf8')) as { sourceRecordId: string; message: Message }[];
  const byKey = new Map<FixtureKey, Fixture>();
  const bySourceId = new Map<string, Fixture>();

  for (const [index, history] of histories.entries()) {
    const key: FixtureKey = index === 0 ? 'normal' : 'stopped';
    const input = arrays.find(item => item.sourceRecordId === history.id);
    const correction = feedback.find(item => item.sourceRecordId === history.id);
    assert(input && correction, '固定来源必须有完整用户材料及对应校正。');
    assert.equal(input.sourceRecordState, history.state);
    await validateMessages(input.messages);
    await validateMessages([history.finalMessage, correction.message]);
    assert.equal(input.messages.length, 2);
    assert.deepEqual(input.messages[1], history.finalMessage);
    const fixture: Fixture = {
      key, sourceRecordId: history.id, sourceRecordState: history.state,
      userMessage: input.messages[0], finalMessage: input.messages[1],
      feedbackMessage: correction.message,
      phases: key === 'normal' ? ['snapshotEarly', 'snapshotLater', 'final'] : ['final'],
      snapshots: new Map(),
    };
    if (key === 'normal') {
      for (const [index, snapshot] of snapshots.snapshots.entries()) {
        await validateMessages([snapshot.message]);
        assert.equal(snapshot.message.id, fixture.finalMessage.id);
        assert.equal(snapshot.inputCompletionState, 'incomplete');
        fixture.snapshots.set(index === 0 ? 'snapshotEarly' : 'snapshotLater', snapshot.message);
      }
      assert.equal(fixture.snapshots.size, 2);
    }
    byKey.set(key, fixture);
    bySourceId.set(history.id, fixture);
  }
  return {
    byKey, bySourceId, rule: buffers[7].toString('utf8'),
    catalog: {
      fixtures: [...byKey.values()].map(({ snapshots, finalMessage, ...summary }) => summary),
      files, sdkVersion: '7.0.122', modelCalls: 0,
    },
  };
}

export function historyImport(fixture: Fixture, phase: ImportPhase): { message: Message; state: CompletionState } {
  if (phase === 'final') return {
    message: fixture.finalMessage,
    state: fixture.sourceRecordState === 'completed' ? 'completed' : 'stopped',
  };
  const message = fixture.snapshots.get(phase);
  if (!message) throw new Error('这份历史原件没有所选快照。');
  return { message, state: 'incomplete' };
}
