import { createParser, type EventSourceMessage } from 'eventsource-parser';

// 字节可能从汉字中间断开，事件也可能横跨多个网络块。
export async function* readEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<EventSourceMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const queue: EventSourceMessage[] = [];
  const parser = createParser({ onEvent: (event) => queue.push(event), onError: () => { throw new Error('SSE 格式不正确'); } });
  try {
    while (true) {
      const { done, value } = await reader.read();
      parser.feed(done ? decoder.decode() : decoder.decode(value, { stream: true }));
      while (queue.length) yield queue.shift()!;
      if (done) break;
    }
    // 不把未以空行结束的半条事件补造成完整事件。
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
