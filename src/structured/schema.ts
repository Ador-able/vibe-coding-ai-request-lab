import { z } from 'zod';

// nullable表示值未知，字段本身仍需存在；内外两层均拒绝额外字段。
export const ExtractionSchema = z.strictObject({
  items: z.array(z.strictObject({
    task: z.string().describe('尚需执行的待办事项'),
    owner: z.string().nullable().describe('原文明确的负责人，未确定为null'),
    dueText: z.string().nullable().describe('原文明确的截止时间文字，未确定为null'),
    evidence: z.string().describe('支持此项待办的连续原句，逐字保留'),
  })),
});
export const JSON_SCHEMA = z.toJSONSchema(ExtractionSchema, { target: 'draft-07' });
export type Extraction = z.infer<typeof ExtractionSchema>;
