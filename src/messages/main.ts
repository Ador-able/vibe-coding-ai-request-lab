import './style.css';
import { MATERIAL } from '../streaming/material.ts';
document.querySelector<HTMLElement>('#app')!.innerHTML = `<header><span class="eyebrow">纪要对话 · 教学虚构</span><h1>围绕同一份纪要继续提问</h1><p>这份纪要包含已确认安排与待确认事项，我们将围绕它保存和恢复对话。</p></header><label for="material">工作纪要，可编辑</label><textarea id="material" rows="8"></textarea><label for="question">第一轮问题，可编辑</label><textarea id="question" rows="2">这份纪要还有哪些事项未确定？</textarea>`;
document.querySelector<HTMLTextAreaElement>('#material')!.value = MATERIAL;
