# 请求观察室

用一个问题走完“浏览器 → 本地后端 → 模型服务 → 浏览器”。首页每次独立提问，不保存聊天记录；上下文实验页用于对比同一首轮历史的不同保留范围。

发送后展开“查看这次请求”，可以对照页面实际发送的 JSON、后端阶段、请求编号和累计耗时。缺配置时不会出现“请求模型”与“收到模型回复”。浏览器看到后端的 HTTP 状态；模型服务的状态由后端记录，两者不一定相同。

## 从 GitHub 开始

```powershell
git clone https://github.com/Ador-able/vibe-coding-ai-request-lab.git
cd vibe-coding-ai-request-lab
git switch -c my-lesson-01 vcm-01-01-end
```

按课程指定的标签建立练习分支，避免把持续更新的 `main` 当成固定教材版本。

## 从源码 ZIP 开始

解压源码 ZIP，进入包含 `package.json` 的目录，按下方“运行”步骤启动。源码 ZIP 不含 Git 历史；需要通过课程标签恢复时，请先从 GitHub 克隆仓库，再切换到指定标签。

## 运行

使用 Node.js 24.12.0、pnpm 11.20.0。在项目目录执行：

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm dev
```

打开 `http://127.0.0.1:4318`。在 `.env` 填写 `API_BASE_URL`、`MODEL`、`API_KEY` 后重启服务。Base URL 从百炼模型 API 控制台复制，同地域、同业务空间的密钥配套使用；不含末尾 `/chat/completions`。本项目使用模型 API，不使用 Coding Plan 的专用端点。型号选择支持非思考文本问答的 Qwen 型号，例如 `qwen-flash` 或 `qwen-plus`。缺配置时会显示错误，不会生成演示答案。

`.env` 仅由后端读取，不加 `VITE_` 前缀、不提交到 Git，也不放进网页。一次调用可能产生模型费用。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 收集问题、请求后端、显示回答 |
| `src/server.ts` | 校验问题、读取配置、组织返回结果 |
| `src/model.ts` | 带密钥请求模型服务、读取完整文本 |
| `src/contract.ts` | 约定前后端之间的数据形状 |

## 检查

```powershell
pnpm check
pnpm test
pnpm build
pnpm start
```

测试会启动本地 HTTP 测试桩，不调用真实模型。真实模型是否可用，须填入自己的配置后从页面发送问题确认。

## 课程存档

开始练习前，从指定标签新建自己的分支：

```powershell
git switch -c my-lesson-01 vcm-01-01-end
```

`vcm-01-01-start` 是可运行的问答模板，`vcm-01-01-end` 包含本节请求观察面板。第一节直接使用 `end` 版本观察请求，`start` 用于比较。

| 课程 | 起点 | 完成点 |
| --- | --- | --- |
| 看懂 AI 应用的请求与结果 | `vcm-01-01-start` · `39b4a51497c4` | `vcm-01-01-end` · `020e4fd763dc` |

需要重来时，先在自己的分支提交实验，再从课程存档新开分支：

```powershell
git add .
git commit -m "保存我的实验"
git switch -c my-lesson-01-retry vcm-01-01-start
```

原分支及实验提交仍然保留。Git 只恢复仓库文件，不恢复 `.env`、依赖、模型费用或外部服务状态。

接口依据：[百炼兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。

## 一次请求里实际装了什么

入口：`http://127.0.0.1:4318/context.html`。沿用上方 Node、pnpm 和模型 API 配置，使用支持 Function Calling 的非思考文本模型，例如 `qwen-flash`。

1. 点击“查询发布时间”。模型先请求 `get_release_info`，本机函数返回一份虚构版本记录，模型再回答发布时间。首轮共两次模型请求。
2. 分别选择“仅本轮问题”“保留聊天文字”“保留完整历史”，发送同一句负责人追问。所有条件使用同一份首轮历史，每次追问只调用模型一次。
3. 展开记录，比较消息、工具定义、工具调用及结果。检查器来自实际发送的请求体；下载的 JSON 保留其原始字符串及实际返回的 `usage`、`finish_reason` 和消息。

三种追问的系统规则、工具定义和参数相同，只改变历史消息。`tool_choice: none` 禁止重新查询；追问结果不会追加到首轮历史。温度固定为 0，不能据此保证模型回答完全一致。若模型猜测、答错或首轮没有遵守“只回答时间”，页面会保留原文，需结合请求记录判断对照是否成立。

工具调用以实际返回的 `tool_calls` 为准；首轮工具阶段接受 `stop` 或 `tool_calls` 结束标记，同时要求一个完整的有效调用。长度截断等未完成结果不会执行工具，原始结束标记仍保存在记录中。

版本资料是本地合成数据，模型返回来自实际 API。本实验不提供模拟成功回退，也不代表模型具有跨请求的长期记忆。历史由本机服务内存持有，浏览器不能回传改写；刷新页面需重新建立首轮，关闭服务后历史清空。每轮最多等待 90 秒，失败会留下已有请求和工具记录；页面不显示请求头、密钥、服务地址或上游原始错误。

### 一次真实运行

[实际请求记录](evidence/上下文实验-实际请求记录.json)来自 `qwen-flash`，非思考模式、温度 0。首轮经过一次本地工具查询，只回答“2026年9月28日 14:30（北京时间）”。三次追问共用这份历史，每次均携带相同工具定义，并设置 `tool_choice: none`。

| 追问保留范围 | API 返回的输入 token | 本次回答 |
| --- | ---: | --- |
| 仅本轮问题 | 65 | 要求补充版本信息或相关上下文，说明无法确定负责人 |
| 保留聊天文字 | 115 | 缺少相关信息，无法确定负责人 |
| 保留完整历史 | 217 | 林晓禾 |

这里观察的是请求中是否带上所需信息：聊天文字保留了版本编号，工具结果才保留了负责人。输入 token 数取自本次 API 返回的 `usage.prompt_tokens`，包括服务处理的完整输入，不是只数页面上的问题文字。这是一组虚构资料的一次实测，不能证明模型每次都答对，也不能据此比较不同模型的记忆能力或费用；服务和模型更新后，措辞及 token 用量可能不同。

| 文件 | 职责 |
| --- | --- |
| `src/context/main.ts` | 切换条件、比较真实回答、查看及下载请求记录 |
| `src/context/routes.ts` | 保存首轮会话、执行工具、发起独立追问 |
| `src/context/scenario.ts` | 虚构版本资料、工具定义、三种历史投影 |
| `src/context/model.ts` | 序列化并记录同一个请求体，调用模型 API |

本课起点为 `vcm-03-01-start`（`81a685749108`），完成点为 `vcm-03-01-end-r2`。在 Git 克隆目录中，从完成点进入可运行的实验：

```powershell
git switch -c my-context-lab vcm-03-01-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

需要恢复时，先在自己的分支提交实验，再从完成点新建分支；起点只包含原问答页。Git 不恢复密钥、费用、服务内存或外部状态。

```powershell
git add .
git commit -m "保存我的上下文实验"
git switch -c my-context-lab-retry vcm-03-01-end-r2
```

定向检查：`pnpm exec tsx --test test/context.test.ts`。测试桩验证协议和历史投影，不是实际模型输出。工具调用协议依据：[百炼 Function Calling](https://help.aliyun.com/zh/model-studio/qwen-function-calling)。

## 上下文装得下，不等于用得好

入口：`http://127.0.0.1:4318/quality.html`。本课固定使用 `qwen-flash`，`.env` 中的 `MODEL` 应设为该值；其余模型 API 配置和启动步骤同上。

点击“运行 12 个样例”后，页面串行请求 6 种条件的 A、B 两份合成资料，每次独立请求，不携带此前回答。任务始终是按项目名称与版本号查负责人、冻结日期并引用记录编号。使用相同输出规则、非思考模式、温度 0、`max_tokens: 512` 和 `response_format: json_object`，不提供工具，`tool_choice: none`。JSON Object 的支持范围与提示词要求依据[百炼结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

| 条件 | 固定变化 |
| --- | --- |
| 短材料 | 16 条，目标记录在第 8 条 |
| 长材料，关键项居中 | 160 条，目标记录在第 80 条；保留短材料全部记录，只增加无关事务 |
| 长材料，关键项首位 / 末位 | 与居中组的文档集合完全相同，只移动目标记录 |
| 相似干扰 | 在居中组中替换 4 条无关记录，换成相近项目名或相邻版本；总条数不变 |
| 真实冲突 | 在居中组中替换 1 条无关记录；同项目、同版本、同确认日期，负责人不同，冻结日期一致 |

每条资料有稳定编号，长度约 121–127 个字符。背景材料由 20 种办公事务模板按地点和批次组合，文档结构相近；实验只观察这个受控提取任务。条件标签与期望结果不进入模型输入。资料数量不是 token 阈值，页面仅显示实际 API 返回的 `usage.prompt_tokens`，没有用其他分词器估算。

评分分别检查状态、负责人、日期与引用。冲突组需要 `status: conflict`、`owner: null`，保留一致日期，并引用双方记录。字段缺失、输出截断和错误引用不判通过；页面始终保留模型原文与实际请求体。表格每行只有两份样例，不把 12 次结果合并为模型准确率。全部通过同样是有效观察；少量合成资料的一次差异不能单独证明原因，也不能代表模型处理所有长材料的能力。

一次完整运行发起 12 次 API 请求，可能收费。请求失败立即停止、保留已有结果，不自动重试，失败项不计入效果判定。每个样例最多等待 90 秒。再次点击“新开始一次”会保留本页旧记录，可从下拉框切换并分别下载；刷新页面会丢失未下载的记录。材料预览不调用模型，也不是模型生成结果。

实现位于 `src/quality/`：`materials.ts` 固定资料和输入，`routes.ts` 执行独立请求，`assess.ts` 解析评分，`main.ts` 串行运行并显示结果。`src/recorded-model.ts` 与上下文保留实验共用请求记录传输逻辑。

本课起点 `vcm-03-02-start` 指向 `c73d22209d47`，包含上一课完成版；完成点为 `vcm-03-02-end`。在 Git 克隆目录中从完成点新建练习分支：

```powershell
git switch -c my-quality-lab vcm-03-02-end
pnpm install --frozen-lockfile
pnpm dev
```

要恢复材料或代码，先提交自己的实验，再从完成点新开分支；这不会恢复模型费用或页面运行记录。

```powershell
git add .
git commit -m "保存我的材料对照实验"
git switch -c my-quality-lab-retry vcm-03-02-end
```

定向检查：`pnpm exec tsx --test test/quality.test.ts`。HTTP 测试桩只验证协议、受控材料和评分逻辑，不提供模型能力的实测结论。
