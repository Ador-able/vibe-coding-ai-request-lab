import"./lab-shell-Dhrs_Dar.js";/* empty css            */document.querySelector(`#app`).innerHTML=`
  <header><span class="eyebrow">AI 实验</span><h1>请求观察室</h1><p>提一个问题，看看回答从哪里来。</p></header>
  <section class="workspace">
    <form id="question-form">
      <label for="question">问题</label>
      <textarea id="question" rows="4" maxlength="2000" required placeholder="例如：用两句话解释，为什么浏览器页面里不应该放 API 密钥？"></textarea>
      <div class="actions"><span id="status" role="status">每次发送都是一次独立提问。</span><button type="submit">发送问题 <span aria-hidden="true">↗</span></button></div>
    </form>
    <section class="response" aria-labelledby="answer-heading"><h2 id="answer-heading">模型的回答</h2><p id="answer" class="empty">发送后，回答会显示在这里。</p></section>
  </section>
  <details id="request-details" hidden>
    <summary>查看这次请求</summary>
    <div class="trace-content">
      <div class="request-payload"><h2>页面实际发送的数据</h2><p class="endpoint">POST /api/ask</p><pre id="request-body"></pre></div>
      <div class="server-trace"><h2>后端实际经过的步骤</h2><p id="trace-description" class="trace-description"></p><ol id="stages"></ol><dl id="trace-meta"></dl></div>
    </div>
  </details>`;var e=document.querySelector(`#question-form`),t=document.querySelector(`#question`),n=e.querySelector(`button`),r=document.querySelector(`#status`),i=document.querySelector(`#answer`),a=document.querySelector(`#request-details`),o=document.querySelector(`#request-body`),s=document.querySelector(`#stages`),c=document.querySelector(`#trace-meta`),l=document.querySelector(`#trace-description`);function u(e,t,n){l.textContent=`时间从后端收到请求起累计；只列出实际发生的步骤。`,s.replaceChildren(...e.stages.map(e=>{let t=document.createElement(`li`),n=document.createElement(`strong`);n.textContent=e.name;let r=document.createElement(`span`);r.className=`stage-time`,r.textContent=`${e.elapsedMs} ms`;let i=document.createElement(`p`);return i.textContent=e.detail,t.append(n,r,i),t}));let r=[[`请求编号`,e.requestId],[`请求的模型`,e.model??`尚未调用`],[`后端返回`,`HTTP ${t}`],[`页面等待`,`${n} ms`]];e.modelDurationMs!==void 0&&r.push([`模型调用耗时`,`${e.modelDurationMs} ms`]),c.replaceChildren(...r.flatMap(([e,t])=>{let n=document.createElement(`dt`);n.textContent=e;let r=document.createElement(`dd`);return r.textContent=t,[n,r]}))}e.addEventListener(`submit`,async e=>{e.preventDefault();let d=t.value.trim();if(!d||n.disabled)return;n.disabled=!0,t.disabled=!0,i.textContent=``,i.className=``,r.textContent=`正在等待模型回复……`,r.className=``;let f=JSON.stringify({question:d});a.hidden=!1,o.textContent=JSON.stringify(JSON.parse(f),null,2),l.textContent=`等待后端返回记录……`,s.replaceChildren(),c.replaceChildren();let p=performance.now();try{let e=await fetch(`/api/ask`,{method:`POST`,headers:{"Content-Type":`application/json`},body:f}),t=await e.json();if(u(t.trace,e.status,Math.round(performance.now()-p)),!t.ok){r.textContent=t.error.message,r.className=`error`,i.textContent=`本次没有生成回答。`,i.className=`empty`;return}i.textContent=t.answer,r.textContent=`已收到模型回答。`}catch{r.textContent=`未收到后端的有效回复，请确认本地服务正在运行。`,r.className=`error`,i.textContent=`本次没有生成回答。`,i.className=`empty`,l.textContent=`没有收到有效的后端记录，无法判断模型是否完成调用。`}finally{n.disabled=!1,t.disabled=!1}});