import './style.css';
import { MATERIALS } from './materials.ts';

document.querySelector<HTMLElement>('#app')!.innerHTML = `<header><span class="eyebrow">会议纪要 · 教学虚构</span><h1>待办提取材料</h1><p>先区分明确任务、信息缺失、完成状态与撤销任务，再确定需要提取哪些字段。</p></header>
  <label for="material">选择材料</label><select id="material"></select>
  <label for="minutes">会议纪要</label><textarea id="minutes" rows="6"></textarea>
  <p class="note">本起点提供材料工作台，不调用模型。可在此加入三种输出方式和程序检查。</p>`;
const select = document.getElementById('material') as HTMLSelectElement;
const minutes = document.getElementById('minutes') as HTMLTextAreaElement;
MATERIALS.forEach((item) => select.add(new Option(item.label, item.id)));
minutes.value = MATERIALS[0].text;
select.addEventListener('change', () => { minutes.value = MATERIALS.find((item) => item.id === select.value)!.text; });
