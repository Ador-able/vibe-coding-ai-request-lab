import './style.css';
import { MATERIAL } from './material.ts';
document.querySelector<HTMLElement>('#app')!.innerHTML = `<header><span class="eyebrow">文档助手 · 教学虚构</span><h1>从一份工作纪要开始</h1><p>这份材料包含已确定的安排与尚待确认的事项。我们将用它观察摘要和问题两段输出。</p></header><label for="material">工作纪要，可直接修改</label><textarea id="material" rows="9"></textarea>`;
document.querySelector<HTMLTextAreaElement>('#material')!.value = MATERIAL;
