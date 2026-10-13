# 请求观察室

用《青岚修仙录》的完整教学资料观察请求、模型输出和应用接收。林青是青岚宗外门弟子，当前炼气三层，长远愿望是筑基。

## 首次准备

沿用课程首次准备的 Node.js 24.12 或更高的 24 版本与 pnpm。只需克隆、安装一次：

```powershell
git clone https://github.com/Ador-able/vibe-coding-ai-request-lab.git
cd vibe-coding-ai-request-lab
pnpm install --frozen-lockfile
```

双击“启动实验.cmd”，打开 [请求观察室](http://127.0.0.1:4318)。也可运行 pnpm dev。保持启动窗口打开，结束时按 Ctrl+C；后续章节沿用这个目录，用顶部“实验”切换页面。

在“模型设置”填写 OpenAI 兼容接口地址、API Key 和自选模型，所有页面共用已保存设置。Base URL 不含末尾的 /chat/completions。配置保存在本机用户目录的 .vibe-coding-labs/model.json；已有密钥显示为掩码，留空保存会保留原值。

结构化输出与流式消息可先“查看课堂实录”。查看实录、消息保存与转换、请求状态演练均不调用云模型。其他生成操作会请求真实模型，可能产生费用。

## 实验入口

| 实验 | 页面 | 操作 |
| --- | --- | --- |
| 独立提问 | index.html | 输入问题，发送后展开请求记录。 |
| 上下文对照 | context.html | 查炼丹房收药登记，再追问现场数量，对照三种历史范围。 |
| 材料对照 | quality.html | 比较同一小说事实的六种材料条件与 A/B 表述。 |
| 等待与用量 | latency.html | 比较五种请求条件的等待与实际用量。 |
| 按需读取与记忆 | memory.html | 续写炼丹房片段，比较全文、选读、摘要和新会话。 |
| 场景方案 | decisions.html | 比较《阁前问路》的两份情节方案，选择后自行编辑。 |
| 场景共写 | collaboration.html | 按所选方案和人工修改生成场景，再依据实际草稿继续反馈。 |
| 人物指代 | feedback.html | 比较规则保存前、启用与停用后的判断。 |
| 结构化输出 | structured.html | 提取《药圃早巡》中的待办，核对格式、原文依据和业务保存。 |
| 流式消息 | streaming.html | 观察摘要与问题两阶段的事件、快照和整体结束。 |
| 消息记录 | message-history.html | 保存已有小说消息，重新读回，再比较 P0/P1/P2 输入。 |
| 请求状态 | requests.html | 受控演练停止、超时、401、503 和本机断连，按同一编号核查结果。 |

结构化输出需模型支持严格 JSON Schema，上下文实验需支持工具调用。需要不同型号时，在“其他实验模型”中设置一次。

## 材料与课堂实录

第 3、6、11 章的完整原始记录分别在 records/chapter03、records/chapter06、records/chapter11，来源与原始字节哈希见 records/来源清单.json。教学材料在 materials/，固定输入及来源在 fixtures/message-history/ 与 public/requests-fixtures/。

第十一章云模型实录共 7 次提供方请求。页面实录在 public/records/output，查看时不重新生成。消息页未完成对象的来源类型是 teacher-controlled-reception：教师截取和追加接收事件，对应原云模型已经完整结束。请求状态页用官方 Mock 与真实 SDK、HTTP 演练，正式课堂记录为 8 个任务、9 次内部 Mock 调用；补充截图演练另有 2 个任务、2 次调用，单独保存，均无新增云请求。来源登记与截图说明在 records/chapter11。模型结束、内容正确、业务保存与人的采用分别判断。

## 保存与失败处理

按正文下载需要保留的实际运行 JSON。记录保留本次请求正文和回答，不含认证头或密钥。多数页面的尝试在刷新后清空，上下文内存历史在服务重启后清空。确认过的任务摘要在 artifacts/memory-task-note.json，人物规则在 .local-data/novel-feedback-rule.json，消息数据库在 .data/messages.sqlite。

真实模型实验失败后显示错误并保留已取得的片段，不自动重试。请求状态页的 503 条件用于观察 SDK 的受控重试。写锁期间保存失败，释放锁后再明确保存。停止服务不会恢复正在生成的任务；请求状态页按编号核查只针对当前服务进程。

端口占用时先关闭另一个请求观察室。需要独立端口时，在 PowerShell 设置 $env:LAB_PORT='4349'，再运行 .\启动实验.cmd。

<details>
<summary>修改源码与独立检查</summary>

源码在 src/，运行入口在 scripts/，锁文件固定依赖。按改动运行 pnpm check 与对应测试；需要构建后运行时执行 pnpm build、pnpm start。构建产物和个人运行数据不提交 Git。

独立读回消息：

```powershell
node scripts/messages-inspect.mjs --db .data/messages.sqlite --conversation <会话ID> --out 独立读回.json
```

其他 OpenAI 兼容接口实验可通过已有模型配置入口运行：

```powershell
node scripts/run-lab.mjs "D:/练习/动作审批" dist/approval-cli.js
```

目标项目按自身 README 完成准备，当前入口复用已保存的模型设置。source-version.json 保留课堂程序的源码标识；实际新运行结果以本次完整记录为准。

</details>
