# 请求观察室

本项目用可操作的 TypeScript 实验观察 AI 请求、上下文、人工反馈、结构化输出和流式消息。材料均为教学虚构，页面调用真实模型 API；不会用预设答案冒充调用结果。

## 首次准备

使用 Node.js 24.12.0、pnpm 11.20.0。仓库只需克隆一次：

```powershell
git clone https://github.com/Ador-able/vibe-coding-ai-request-lab.git
cd vibe-coding-ai-request-lab
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

在 `.env` 填写以下三项，保存后按本节的三条命令启动。配置变更需要重启服务。

| 配置 | 内容 |
| --- | --- |
| `API_BASE_URL` | 百炼模型 API 控制台给出的完整 Base URL，不含末尾 `/chat/completions` |
| `API_KEY` | 与 Base URL 同地域、同业务空间的模型 API 密钥 |
| `MODEL` | 本组实验使用 `qwen-flash`；须支持非思考文字生成和工具调用 |

使用模型 API 端点，不使用 Coding Plan 专用端点。`.env` 仅由后端读取，不加 `VITE_` 前缀、不提交 Git。缺配置时页面报错；实际调用可能产生费用。结构化输出页独立使用支持严格 Schema 的型号，见该节说明。

源码 ZIP 解压后可安装运行，但不含 Git 历史；要按固定标签切换或恢复，请使用克隆的仓库。所有服务只监听 `127.0.0.1`。

## 入口与固定完成存档

每个完成存档都包含完整实验集合；它们用于固定各课的可运行代码，不表示仅保留该节或之前页面。下列各节均提供“建立练习分支 → 安装锁定依赖 → 启动”三条命令。先停止占用同一端口的旧服务，再运行所需入口。

| 课程 | 页面 | 端口 | 固定完成标签 |
| --- | --- | ---: | --- |
| 一次请求里实际装了什么 | `/context.html` | 4318 | `vcm-03-01-end-r3` |
| 上下文装得下，不等于用得好 | `/quality.html` | 4318 | `vcm-03-02-end-r2` |
| 按需读取、压缩和记忆各管什么 | `/memory.html` | 4318 | `vcm-03-03-end-r2` |
| 长输入为什么影响等待和费用 | `/latency.html` | 4318 | `vcm-03-04-end-r2` |
| 活动文字共写 | `/collaboration.html` | 4318 | `vcm-12-02-end-r2` |
| 让人看得懂，才能作出决定 | `/decisions.html` | 4318 | `vcm-12-03-end-r2` |
| 人纠正以后，AI要沿新方向继续 | `/collaboration.html` | 4318 | `vcm-12-04-end-r2` |
| 人的反馈怎样改进 AI 的工作 | `/feedback.html` | 4318 | `vcm-12-05-end-r2` |
| 结构化输出还需要程序检查 | `/structured.html` | 4319 | `vcm-04-01-end-r2` |
| 流式输出是一串有顺序的事件 | `/streaming.html` | 4320 | `vcm-04-02-end-r2` |

首页 `http://127.0.0.1:4318/` 是独立问答与请求观察面板，随上述存档提供。展开记录可看浏览器输入、后端阶段和实际模型 HTTP 状态；浏览器与模型服务的 HTTP 状态不一定相同。

## 模型调用与取证

所有模型调用使用同一套 AI SDK：`ai@7.0.122` 的 Core `generateText` 生成非流式回答，`streamText` 生成流式回答；官方 `@ai-sdk/openai-compatible@3.0.59` 将 Core 消息和参数适配到百炼兼容端点。文档助手另用 AI SDK UI 构造和读取页面消息。项目运行于本地 Node.js，不依赖 Next.js 或 Vercel 托管。

`src/ai-provider.ts` 集中创建 provider 并转换当前实验的文字与工具消息。工具调用 ID、参数和结果保持配对；工具是否执行由场景流程决定，SDK 不会自行执行本地业务工具。所有模型调用关闭自动重试。

`src/recorded-model.ts` 保存 provider 真正发送的请求体及原始响应消息、结束原因、用量。页面检查器不另拼请求，也不把失败结果修成合法空值。HTTP 成功但正文无法解析与 HTTP 失败分别显示；认证头、私密端点和供应商错误原文不进入公开记录。缺失用量保持未知。

等待实验需要观察原始 SSE 分隔及 `[DONE]`，因此在 provider 的 `fetch` 钩子内，用已有 `eventsource-parser@4.1.1` 被动观察同一响应字节。原字节继续交给 SDK，正文由 Core 驱动，没有第二次请求或自造结束标记。它是传输测量工具，不是另一套模型 SDK。文档助手无需字节测量，使用 Core 的 `includeRawChunks` 记录供应商 JSON；这些 JSON 不含 SSE 分隔符或 `[DONE]`。

相关接口：[AI SDK Core](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)、[兼容 provider](https://ai-sdk.dev/providers/openai-compatible-providers)、[UI 协议](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)、[百炼兼容 API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。

## 保存实验与恢复

需要重来时，先保留自己的改动，再从相应完成标签建立新分支。例如：

```powershell
git add .
git commit -m "保存我的上下文实验"
git switch -c my-context-retry vcm-03-01-end-r3
```

原分支及提交仍保留。切换后重新执行 `pnpm install --frozen-lockfile` 和该节启动命令。Git 只恢复追踪的源码，不恢复 `.env`、依赖、页面记录、模型费用、缓存或其他外部状态，也不会清除被忽略的本地便笺与规则。

页面中的尝试记录通常只保存在当前页面，刷新前请下载；有本地持久化的实验在各节单独说明。下载包含材料和输出，分享前应确认所输入的内容可以公开。

## 一次请求里实际装了什么

```powershell
git switch -c my-context-lab vcm-03-01-end-r3
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/context.html`。先查询一次发布时间：模型请求 `get_release_info`，本地工具返回虚构资料，模型再回答。首轮共两次模型请求。

三个追问条件共用该次首轮记录，系统规则、工具定义和参数相同，只改变历史保留范围。每次追问一次调用，`tool_choice: none` 禁止重新查询，追问结果不追加到首轮。检查器保留实际工具调用与结果；页面不替模型修正猜测或多说的信息。

首轮只接受一个结构完整且名称、参数有效的调用，允许实际 `stop` 或 `tool_calls` 结束标记；截断时不执行工具。历史由服务端内存持有，刷新需要重新开始，服务重启后清空。

[原始实测](evidence/上下文实验-实际请求记录.json)中，仅问题、聊天文字、完整工具历史三种输入分别为65、115、217 token；前两项说明信息不足，完整历史答出林晓禾。这是一次受控观察，不保证再次运行的措辞或用量相同。

## 上下文装得下，不等于用得好

```powershell
git switch -c my-quality-lab vcm-03-02-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/quality.html`。一次运行串行调用12次：短材料、长材料居中/首位/末位、相似干扰、真实冲突各有两份样例。任务固定查负责人、冻结日期及来源编号。背景是20种事务模板组合的合成记录，不是160份独立真实文档。

三种位置条件使用完全相同的文档集合。干扰替换4条无关记录，冲突替换1条；预期结果及条件标签不进入请求。评分检查状态、事实和引用，保留原文；失败立即停止并保留已有结果，不自动重试，不把12次混为模型准确率。新开始会保留本页旧记录。

[十二例原始结果](evidence/材料对照-真实请求记录.json)与[核对摘要](evidence/材料对照-实测摘要.json)中，短材料和三种位置各2/2，干扰1/2；冲突事实0/2、引用1/2。接入时的HTTP失败不计入效果样本。这些结果只描述该轮合成任务。

## 按需读取、压缩和记忆各管什么

```powershell
git switch -c my-memory-lab vcm-03-03-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/memory.html`。同一社区活动问题分别使用全文、按目录选原文、先摘要再回答，完整比较共5次调用。各流程独立；选读只读选中编号，摘要回答只带实际摘要。选择空编号、重复或不存在的编号会停止，不自动补选。

表格同时列最后一次输入及整链输入、输出。任一步缺用量，合计保持未知；最后一次输入更短不等于整体更省。读者自行核查答案语义，页面不自动宣布内容正确。

人工教学便笺在确认后存于被忽略的 `artifacts/memory-task-note.json`。刷新或重启可读回；用便笺新建会话另调用一次，只带便笺、其来源原文及问题，无旧消息，也不改变模型权重。来源编号可以打开原文。便笺包含人工核对，不与前三流程作同成本比较。

[三流程原始请求](evidence/三流程-真实请求记录.json)、[新会话请求](evidence/新会话-真实请求记录.json)与[核对摘要](evidence/材料选择与便笺-实测摘要.json)保留一次六调用观察。选读漏选C05，摘要漏16:20清场时限；两者总token都比全文多。全文也补造原文未规定的改期或取消办法，不能称其完美。新会话保留关键时限，但依赖人工便笺和原文回查。

## 长输入为什么影响等待和费用

```powershell
git switch -c my-latency-lab vcm-03-04-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/latency.html`，依次运行五个条件，每项一次调用：短材料、完整长材料、完全相同请求再发、只改最前版本前缀、同一长材料要求详细解释。前四项输出上限96，第五项改回答要求且改上限为512，不能把差异全归因于上限。

首正文从后端发起上游请求到第一个非空 `delta.content` 到达；流结束到真实 `[DONE]` 或正常EOF。空文本、角色和用量块不计首正文；一个流块可能有多个token，测量包含网络和调度，不是GPU计算时间。SDK负责生成，被动取证方式见前文。

只显示真实API用量。缺失 `cached_tokens` 不等于0，它也是输入token的子集，不能重复相加。原样再发不保证缓存命中；价格应按具体模型、地域、缓存和输出分别核算。连接关闭取消上游，错误或截断保留实际片段。下载保留本页所有尝试。

[五条件原始记录及核验](evidence/vcm-03-04/说明.md)中，相同长请求再发命中4352 token；改前缀及详细请求该轮未命中。这不保证固定提速或下一次命中，单轮结果不是性能排名。

## 活动文字共写

```powershell
git switch -c my-collaboration-lab vcm-12-02-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/collaboration.html`。先生成两种宣传方向，再自由输入选择、补充或纠正。页面不预选方向、不评分、不发布；每次提交只调用一次模型。

后续请求携带完整成功对话与本轮输入。失败、截断的尝试保留记录但不加入成功历史；输入保留，可自行修改后重发。没有摘要或静默丢消息。输入限6000字符，请求超过128KB明确拒绝；输出上限1536 token，超时90秒。刷新清空对话，需先下载；重启服务不清除仍开着的页面历史。

[三轮原始对话与人工定稿](evidence/vcm-12-01/说明.md)分别含2、4、6条消息。第二轮擅补“先到先得”，第三轮又把未提供报名方式写成“不设报名链接”。定稿由人编辑，明确与模型原文分开；反馈改变方向不等于全部事实正确。

## 让人看得懂，才能作出决定

```powershell
git switch -c my-decisions-lab vcm-12-03-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/decisions.html`。一次调用生成两份文案及模型理由、取舍、待确认项。共同事实和目标独立给定，不由模型补写；模型理由未经核验，未知项也不是穷尽清单。

不默认选择。以某版为基础只载入本地编辑区，直接编辑不调用模型、不发布；放弃选择后再选回可继续人工稿，原两方案保留。结构错误或截断保留原始响应并报错，不自动修补。导出包含选择状态与当前编辑内容，刷新前保存。

[原始请求与人工编辑](evidence/vcm-12-03/说明.md)中，两版存在未提供报名方式、时间楼层、带书数量等错误；人选择后直接改稿，没有再次请求模型。这是一次示范，不作效果统计。

## 人纠正以后，AI要沿新方向继续

```powershell
git switch -c my-correction-lab vcm-12-04-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开同一 `http://127.0.0.1:4318/collaboration.html`。第一轮交付人工稿并请模型写家庭提醒；第二轮明确交回新事实、新当前稿，并改为志愿者交接。第二轮保留旧回复作为历史，核查实际答案是否采用新方向。

[两轮原始请求与人工当前稿](evidence/vcm-12-04/说明.md)中，模型采用15:00—16:00、二层和志愿者用途，但仍推断报名流程并擅加引导、维持秩序要求，须继续人工修改。人工当前稿不是模型输出；这里没有中途终止工具、撤销业务动作或外部发送。

## 人的反馈怎样改进 AI 的工作

```powershell
git switch -c my-feedback-lab vcm-12-05-end-r2
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:4318/feedback.html`。三张虚构订单各自独立请求，同一目录和订单仅改变是否附加人工确认规则。三个客户范围条件都由模型判断，代码不按客户硬编码答案。

规则编辑后须确认保存才能生效，保存于被忽略的 `.local-data/feedback-rule.json`，重启可读取；可停用。停用后仍选择带规则会明确拒绝，不静默改条件。每次运行保留规则快照，后续编辑不改旧记录。这是应用加载的文本，不是训练模型；没有写入真实订单系统。

[七次实际请求与规则](evidence/vcm-12-05/说明.md)中，不带规则为 `null / null / BL01`，带规则为 `BL07 / null / BL01`，停用后不带规则再次查询A为 `null`。所有请求仅两条消息，不含旧对话；仅代表这轮教学任务。

## 结构化输出还需要程序检查

```powershell
git switch -c my-structured-lab vcm-04-01-end-r2
pnpm install --frozen-lockfile
pnpm structured:dev
```

打开 `http://127.0.0.1:4319/structured.html`。四份可改的纪要包含明确待办、未知字段、只有状态、撤销或否定任务。三种输出方式共用输入和参数，仅改变 `response_format`：不设置、JSON Object、严格JSON Schema。

默认独立型号是 `qwen3.7-flash-2026-07-15`，可通过 `STRUCTURED_MODEL` 指定其他支持严格Schema的型号；不改变其他页的 `MODEL`。密钥与Base URL共用 `.env`。支持范围以[百炼官方文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)为准。文本、非思考、温度0，输出上限1024 token，90秒超时。

同一Zod定义生成JSON Schema并做 `safeParse`。对象拒绝额外字段，负责人和日期必填但可null，空items合法。检查顺序是结束/拒绝/正文、JSON解析、Schema、原句定位；失败不变成空列表。原句存在不代表语义正确或没有漏提，人工错误负责人反例明确不是实测。

[六次浏览器记录](evidence/vcm-04-01/说明.md)中，明确待办三方式均为2项；严格方式的未知字段为null，状态和撤销任务为空列表。该轮没出现格式失败，不能认定某方式必然失败或永远正确。

## 流式输出是一串有顺序的事件

```powershell
git switch -c my-streaming-lab vcm-04-02-end-r2
pnpm install --frozen-lockfile
pnpm streaming:dev
```

打开 `http://127.0.0.1:4320/streaming.html`。一次操作先摘要，再根据原文和真实摘要生成2至3条待确认问题，共两次真实调用。温度0、非思考，输出上限分别256和384 token，任务总超时90秒。

两段文字属于一条助手消息，文字ID独立，进度使用固定 `workflow-progress`。进度来自应用阶段，不是模型内部推理。每阶段须正常stop且有正文，问题完整返回后检查数量和连续编号。整个任务只发一次start；两阶段及检查完成才发总finish，子流结束不冒充任务完成。

停止按当前请求ID取消上游，保留片段并标未完成。关闭页面或断开连接也取消，这是本实验策略，不提供后台持续执行、会话持久化或断流恢复。截断、异常和问题数量不符不显示完成；异常退出会释放SDK内部上游流。页面不自动滚动。

“本次记录”是已收到的事件，不是假装正在生成的回放。导出包含SDK真实请求、供应商JSON片段、原始及SDK结束原因、用量、UI事件和最终消息。历史进度快照保留各阶段；最终消息同ID进度只留当前值。后台记录仅在进程内存，重启清除。完成只表明阶段和格式检查通过，不验证答案内容质量。

## 检查与生产运行

`pnpm check` 检查类型，`pnpm test` 运行本地受控HTTP测试，不调用真实模型；针对某项修改可只运行对应测试文件。`pnpm build` 构建所有页面。

| 入口组 | 开发 | 构建后运行 |
| --- | --- | --- |
| 4318 | `pnpm dev` | `pnpm start` |
| 4319 | `pnpm structured:dev` | `pnpm structured:start` |
| 4320 | `pnpm streaming:dev` | `pnpm streaming:start` |

## 实测记录对应的固定源码

`evidence/` 中的原始记录只说明其记录时的输入和输出，不预灌进页面。下表供逐字核对原始实测；再次调用的措辞、用量和缓存可能不同。当前完整实验使用前文的完成标签。

| 原始记录 | 对应固定源码标签 |
| --- | --- |
| 首课请求面板 | `vcm-01-01-end` |
| 上下文三条件 | `vcm-03-01-end-r2` |
| 十二份材料对照 | `vcm-03-02-end` |
| 三流程与人工便笺 | `vcm-03-03-end` |
| 五种等待条件 | `vcm-03-04-end` |
| 三轮活动共写 | `vcm-12-01-end` |
| 文案选择与人工编辑 | `vcm-12-03-end` |
| 两轮任务交回 | `vcm-12-04-end` |
| 七次订单规则请求 | `vcm-12-05-end` |
| 六次结构化输出 | `vcm-04-01-end` |
| UI协议完整与停止 | `vcm-04-02-end` |

原课程的 `*-start` 标签也保留在Git中，用于从当时的可运行起点自行实现；例如 `vcm-04-01-start` 和 `vcm-04-02-start` 是可编辑材料工作台。完整观察练习直接使用对应完成标签，不必先编写功能。
