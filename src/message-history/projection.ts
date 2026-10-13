import { convertToModelMessages } from 'ai';
import { validateMessages } from './contract.ts';
import type { ConversationView, Message, PreparedInput } from './contract.ts';

export async function prepareInput(view: ConversationView, rule: string): Promise<PreparedInput> {
  const sourceUiMessages = await validateMessages(view.messages);
  const states = new Map(view.entries.map(entry => [entry.messageId, entry.completionState]));
  const excluded: PreparedInput['excluded'] = [];
  const selected = sourceUiMessages.filter(message => {
    const state = states.get(message.id)!;
    if (message.role !== 'assistant' || state === 'completed') return true;
    excluded.push({ messageId: message.id, completionState: state,
      reason: '本轮明确不把整条未完成助手消息作为成功历史；数据库仍保留原件。' });
    return false;
  });
  const p0 = await convertToModelMessages<Message>(sourceUiMessages);
  const p1 = await convertToModelMessages<Message>(selected);
  const p2 = await convertToModelMessages<Message>(selected, {
    convertDataPart(part) {
      if (part.type === 'data-review-note') return { type: 'text', text: `人工校正：${part.data.text}` };
      return undefined;
    },
  });
  return {
    conversationId: view.conversation.id, sdkVersion: '7.0.122', modelCalled: false,
    sourceUiMessages, storedEntries: view.entries, excluded,
    projections: {
      P0: { chosenUiMessages: sourceUiMessages, modelMessages: p0 },
      P1: { chosenUiMessages: selected, modelMessages: p1 },
      P2: { chosenUiMessages: selected, modelMessages: p2 },
    },
    nextInput: { system: rule, messages: p2 },
  };
}
