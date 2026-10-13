import { inspectResponse } from './inspect.ts';

// 人工构造的反例，不加入真实模型请求记录。
export const COUNTEREXAMPLE = {
  "material": "叶师姐让林青明日辰时前带着量水记录到值房，和她一起核对昨日的开闸簿。",
  "output": {
    "items": [
      {
        "task": "带着量水记录到值房",
        "owner": "叶师姐",
        "dueText": "明日辰时前",
        "evidence": "叶师姐让林青明日辰时前带着量水记录到值房，和她一起核对昨日的开闸簿。"
      }
    ]
  }
};
export const COUNTEREXAMPLE_CHECK = inspectResponse({ content: JSON.stringify(COUNTEREXAMPLE.output) }, 'stop', COUNTEREXAMPLE.material);
