export type ErrorCode =
  | 'INVALID_QUESTION'
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'MODEL_HTTP_ERROR'
  | 'MODEL_NETWORK_ERROR'
  | 'MODEL_TIMEOUT'
  | 'MODEL_RESPONSE_INVALID'
  | 'MODEL_RESPONSE_INCOMPLETE'
  | 'REQUEST_CANCELLED';

export type Stage = {
  name: '收到请求' | '请求模型' | '收到模型回复' | '返回页面';
  elapsedMs: number;
  detail: string;
};

export type RequestTrace = {
  requestId: string;
  model: string | null;
  stages: Stage[];
  modelHttpStatus?: number;
  modelDurationMs?: number;
};

export type AskPayload =
  | { ok: true; answer: string }
  | { ok: false; error: { code: ErrorCode; message: string } };

export type AskResult = AskPayload & { trace: RequestTrace };
