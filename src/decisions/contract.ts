import type { RequestRecord } from '../context/contract.ts';

export type Option = { direction: string; title: string; text: string; reason: string; tradeoff: string; unknowns: string };
export type Options = [Option, Option];
export type OptionIndex = 0 | 1;
export type Draft = { title: string; text: string };
export type Decision = { status: 'unselected' | 'editing' | 'rejected'; selected: OptionIndex | null; drafts: [Draft | null, Draft | null] };
export type DecisionRun = {
  id: string; request: RequestRecord | null; options: Options | null;
  error?: { code: string; message: string };
};
export type DecisionResponse = { ok: boolean; run: DecisionRun };

export function emptyDecision(): Decision { return { status: 'unselected', selected: null, drafts: [null, null] }; }

export function chooseOption(state: Decision, options: Options, selected: OptionIndex): Decision {
  const drafts: Decision['drafts'] = [...state.drafts];
  // 编辑稿独立于模型原文；换选后回来仍保留本页已做的修改。
  drafts[selected] ??= { title: options[selected].title, text: options[selected].text };
  return { status: 'editing', selected, drafts };
}
export function editDraft(state: Decision, field: keyof Draft, value: string): Decision {
  const selected = state.selected!;
  const drafts: Decision['drafts'] = [...state.drafts];
  drafts[selected] = { ...drafts[selected]!, [field]: value };
  return { ...state, drafts };
}
export function clearSelection(state: Decision, rejectBoth: boolean): Decision {
  return { ...state, status: rejectBoth ? 'rejected' : 'unselected', selected: null };
}
