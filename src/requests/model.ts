import { APICallError, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { setTimeout as wait } from 'node:timers/promises';
import { observed } from './contract.ts';
import type { Cause, Fixture, Message, ProviderCall, RequestRecord, Timed } from './contract.ts';

type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;
type Stamp = <T>(value: T) => Timed<T>;

export function requestStream(record: RequestRecord, fixture: Fixture, controller: AbortController, stamp: Stamp, persist: () => void, afterThirdDelta: () => void) {
  let sdkAbortReason: unknown;
  const markAbort = (reason: unknown) => {
    const name = reason instanceof Error || reason instanceof DOMException ? reason.name : undefined;
    const cause: Cause = name === 'TimeoutError' ? 'timeout'
      : record.manualStopRequestedAt ? 'manual-stop' : record.connectionClosedAt ? 'connection-closed' : 'processing-error';
    record.state = cause === 'timeout' ? 'timed-out' : cause === 'manual-stop' || cause === 'connection-closed' ? 'cancelled' : 'failed';
    record.cause = cause; record.error = observed(reason);
  };
  const callback = (kind: string, event: unknown) => { record.callbacks.push(stamp({ kind, event: observed(event) })); persist(); };
  const providerError = (statusCode: number, isRetryable: boolean) => new APICallError({
    message: `教学模拟提供方返回${statusCode}，不是实际云服务HTTP响应。`,
    url: 'https://controlled.invalid/model', requestBodyValues: { instructions: record.instructions, prompt: record.input },
    statusCode, isRetryable, responseBody: JSON.stringify({ error: { type: 'controlled-exercise', statusCode } }),
  });
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    provider: 'official-mock', modelId: 'controlled-summary',
    doStream: async options => {
      const index = model.doStreamCalls.length;
      const call: ProviderCall = { index, beganAt: new Date().toISOString(), elapsedMs: stamp(null).elapsedMs,
        input: observed(options), result: 'pending', assignedParts: null, emittedParts: [], signalChanges: [] };
      record.providerCalls.push(call); persist();
      if (record.scenario === 'permission' || record.scenario === 'retry-before-stream' && index === 1) {
        const error = providerError(record.scenario === 'permission' ? 401 : 503, record.scenario !== 'permission');
        call.result = 'threw'; call.error = observed(error); persist(); throw error;
      }
      const textId = `${record.requestId}:text:${index}`;
      const parts: ProviderPart[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: `mock-${record.requestId}-${index}`, modelId: 'controlled-summary' },
        { type: 'text-start', id: textId },
        ...fixture.deltas.map(delta => ({ type: 'text-delta' as const, id: textId, delta })),
        { type: 'text-end', id: textId },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'controlled-stop' },
          usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined } } },
      ];
      if (record.scenario === 'error-during-stream') {
        parts.splice(6, parts.length - 6, { type: 'error', error: providerError(503, true) });
      }
      call.result = 'stream'; call.assignedParts = observed(parts); persist();
      const onAbort = () => {
        sdkAbortReason = options.abortSignal?.reason;
        call.signalChanges.push(stamp(observed(options.abortSignal))); persist();
      };
      options.abortSignal?.addEventListener('abort', onAbort, { once: true });
      let position = 0, deltaCount = 0;
      const cleanup = () => options.abortSignal?.removeEventListener('abort', onAbort);
      return { stream: new ReadableStream<ProviderPart>({
        async pull(streamController) {
          try {
            if (position === parts.length) { cleanup(); streamController.close(); return; }
            const part = parts[position]!;
            if (part.type === 'text-delta') await wait(160, undefined, { signal: options.abortSignal });
            options.abortSignal?.throwIfAborted();
            position++; call.emittedParts.push(stamp(observed(part))); persist(); streamController.enqueue(part);
            if (part.type === 'text-delta' && ++deltaCount === 3) afterThirdDelta();
          } catch (error) { cleanup(); call.error = observed(error); persist(); streamController.error(error); }
        },
        cancel(reason) { cleanup(); call.signalChanges.push(stamp({ kind: 'stream-consumer-cancel', reason: observed(reason) })); persist(); },
      }) };
    },
  });

  const result = streamText({
    model, instructions: record.instructions, prompt: record.input, maxRetries: 1,
    timeout: { totalMs: record.sdkOptions.totalTimeoutMs }, abortSignal: controller.signal,
    onStart: event => callback('core.onStart', event),
    onLanguageModelCallStart: event => callback('core.onLanguageModelCallStart', event),
    onLanguageModelCallEnd: event => callback('core.onLanguageModelCallEnd', event),
    onError: event => {
      callback('core.onError', event);
      if (sdkAbortReason !== undefined || controller.signal.aborted) markAbort(sdkAbortReason ?? controller.signal.reason);
      else { record.state = 'failed'; record.cause = APICallError.isInstance(event.error) ? 'provider-error' : 'processing-error'; record.error = observed(event.error); }
      persist();
    },
    onAbort: event => { markAbort(event.reason); callback('core.onAbort', event); },
    onEnd: event => callback('core.onEnd', event),
  });
  return result.toUIMessageStream<Message>({
    generateMessageId: () => `${record.requestId}:assistant`,
    messageMetadata: ({ part }) => {
      record.sdkParts.push(stamp(observed(part)));
      if (part.type === 'finish' && part.finishReason === 'stop' && record.state === 'running') {
        record.state = 'completed'; record.cause = null;
      }
      persist();
      return ['start', 'finish', 'abort', 'error'].includes(part.type)
        ? { requestId: record.requestId, fixtureKey: record.fixtureKey, state: record.state, cause: record.cause, origin: 'controlled-exercise' }
        : undefined;
    },
    onError: () => record.cause === 'timeout' ? '等待预算耗尽，输入和片段保留。'
      : record.scenario === 'permission' ? '模拟提供方拒绝处理；先检查授权条件。' : '模拟请求未能完成，输入和片段保留。',
    onEnd: event => {
      record.uiMessage = structuredClone(event.responseMessage);
      record.uiOutcome = observed(event.outcome);
      record.finishedAt = new Date().toISOString();
      if (record.state === 'running') { record.state = 'failed'; record.cause = 'processing-error'; }
      callback('ui.onEnd', event);
    },
  });
}
