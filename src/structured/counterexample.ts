import { MATERIAL } from '../output-material.ts';
import { inspectResponse } from './inspect.ts';
const evidence = MATERIAL.split(/\r?\n/).find(line => line.includes('别乱跑啊，镇子里人太多'))!.trim();
// 人工反例检查结构与语义的区别，不作为模型返回。
export const COUNTEREXAMPLE = { material: evidence, output: { items: [{ task: '不要离开院子', owner: '韩立的三叔', dueText: null, evidence }] } };
export const COUNTEREXAMPLE_CHECK = inspectResponse({ content: JSON.stringify(COUNTEREXAMPLE.output) }, 'stop', evidence);
