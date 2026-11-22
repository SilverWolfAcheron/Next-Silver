# Silver 前端设计文档

工作名 Silver。它是装在本机上的桌面 Vibe IDE，窗口是一个 EXE，不是浏览器里打开的网页。全部功能见 [features.md](features.md)，桌面程序和 CLI 见 [desktop.md](desktop.md)。本文是界面实现的依据：用 React 与 Tailwind CSS 做一套桌面密度的协作界面。壳层对齐 Claude Desktop，颜色对齐 Claude Code 的表面色阶，字号和圆角仍按文档里的规格。复杂需求进入一份可改的简报；新场景是一条预设，新方向是一个领域包。

## 1. 产品表面

窗口只有三块区域。

| 区域 | 职责 |
| --- | --- |
| 侧栏 | 项目与最近对话 |
| 对话 | 主表面。助手是正文，用户是浅底圆角块。底部输入框一直在 |
| 检查器 | 有内容才从右侧出现，一次只开一页：简报、进度、产物 |

输入框上两个胶囊：模式，以及当前模型（例如 `New API · sonnet`）。项目进行中可以直接发送，不必先停止。

两种使用方式共用这三块区域。

- **Project**：先把已经说清的写进简报，没说清的用假设补上，只问还会改变计划的空项。确认后按需求编号派发，界面是一条总进度加一份短清单。
- **Single**：一句修改变成一次运行和一份差异。范围写清了就不再问。做大了可以升成项目。

学术讨论挂在 Project 上，是一条预设。PCB 设计是这条预设的第一个领域包，出现在简报字段和文稿型产物里。

## 2. 技术选型

| 项 | 选择 |
| --- | --- |
| 产品形态 | Windows 桌面 EXE。界面装在本机窗口里 |
| 窗口壳 | Tauri 2。现有 React 界面放进系统 WebView，不把任务放在浏览器页面里 |
| 代理运行时 | 本机 CLI `silver`。EXE 启动它，长任务、读改文件和允许的命令都由它执行 |
| 界面 | React + TypeScript |
| 样式 | Tailwind CSS v4 |
| 界面工程 | Vite，由 Tauri 加载 |
| 组件库 | 不引入。按钮、胶囊、列表行、进度条放在 `src/ui` |
| 状态 | 壳层一个 React context + reducer。第一版不另加状态库。持久状态由 CLI 写在本机应用数据目录 |
| 模型访问 | CLI 内的 `ModelClient`，按协议适配 OpenAI、Anthropic、Gemini |

Tailwind 只消费语义 token。组件里不写死十六进制颜色，不用阴影区分层级。亮色和暗色各一套 token，跟随系统，并允许在侧栏里手动切换。

密钥由 CLI 保存到本机应用数据目录。窗口只收到密钥是否已配置的状态。

## 3. 界面结构

桌面宽度使用三列，对齐 Cursor 的文件、编辑器和对话，也对齐 OpenCode、Claude Desktop 那种对着当前项目说话的用法。

```text
侧栏 240px | 编辑器 1fr | 对话 400px
```

侧栏上面是当前文件夹和文件树，下面是会话。预设留在输入框胶囊里，不占侧栏首页。中间显示点开的文件，带行号。右侧是对话，顶上可切到简报、进度、改动。供应商设置占用右侧这一列。

文件搜索使用可以用方向键和 Enter 操作的临时对话框。编辑器内查找留在标签栏下方。已启动会话的草稿由本机 CLI 保存，按同一会话的工作区校验附件。

宽度低于 960px 时，编辑器留在中间，侧栏和对话改为盖在上面的面板。

对话列内部：

```text
[对话] [简报] [进度] [改动]
消息列表（可滚动）
输入框（贴底）
  占位句
  [模式] [供应商 · 模型]
```

预设决定这一次怎么做。没有打开文件夹时，编辑器提示选择本地文件夹。切到简报或改动时，预设对应的默认页是：

| 预设 | 默认页 |
| --- | --- |
| 开发项目 | 简报 |
| 小补丁 | 产物 |
| 只读审查 | 产物 |
| 写说明 | 产物 |
| 学术讨论 | 简报 |

没有打开文件时，编辑器用项目名或「打开项目」作为标题。对话里的正文保持 17px。

## 4. 对象

五个对象。界面状态从它们派生。

```ts
type Mode = "project" | "single";
type Autonomy = "ask" | "decide" | "act";
type WritePolicy = "code" | "docs" | "none";
type InspectorTab = "brief" | "progress" | "artifact";
type Intent = "steer" | "revise" | "patch";
type RunStatus = "pending" | "in_progress" | "completed" | "blocked" | "paused";
type Protocol = "openai" | "anthropic" | "gemini";
type ArtifactKind = "diff" | "doc" | "findings";

interface Requirement {
  id: string;
  text: string;
}

interface Brief {
  intent: string;
  outcome: string;
  requirements: Requirement[];
  constraints: string;
  autonomy: Autonomy;
  outOfScope: string[];
  domainFields: Record<string, string>;
}

interface Run {
  id: string;
  title: string;
  dependsOn: string[];
  status: RunStatus;
  note: string;
  parallelGroup?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  choices?: string[];
  confirm?: { intent: Intent; summary: string };
}

interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  body: string;
  runId?: string;
}

interface Thread {
  id: string;
  title: string;
  presetId: string;
  mode: Mode;
  messages: ChatMessage[];
  brief: Brief | null;
  runs: Run[];
  artifacts: Artifact[];
  modelId: string;
  inspectorTab: InspectorTab;
  inspectorOpen: boolean;
}
```

用户能直接改的结构化状态是简报。工作项记下依赖的需求编号。某个编号的文字变了，依赖它且尚未完成的工作项立即变为 `paused`。已完成的工作项和它的产物保留。新的工作项等模型按差额补上，界面不先猜测。

同一 `parallelGroup` 的工作项在进度清单里连在一起，标题下写「同时进行」。

## 5. 预设与领域包

预设是数据，放在 `src/model/presets.ts`。

| id | 名称 | 模式 | 自主度 | 写文件 | 默认页 |
| --- | --- | --- | --- | --- | --- |
| develop | 开发项目 | project | decide | code | brief |
| patch | 小补丁 | single | act | code | artifact |
| review | 只读审查 | single | ask | none | artifact |
| explain | 写说明 | single | decide | docs | artifact |
| academic | 学术讨论 | project | ask | docs | brief |

自主度的界面文案：`ask` 先问，`decide` 自己定，`act` 直接做。

领域包挂在预设上，只增加三样数据：简报字段、还空着才问的种子问题、文稿型产物。第一包是 PCB 设计，挂在 `academic`。

| 字段 key | 标签 |
| --- | --- |
| stackup | 层数与叠层 |
| nets | 关键网络 |
| mechanical | 外形与连接器 |
| fab | 加工工艺 |

种子问题，对应字段还空着才出现，并且和通用空项合在一起，一轮最多四个：

- 外形和连接器定死了吗？
- 有没有必须守住的阻抗？
- 这次停在约束，还是要谈到布局取舍？

产物种类是 `doc`，标题用「约束清单」或「取舍纪要」。渲染走文稿组件。板图编辑器和 Gerber 不进第一版；制造文件若以后要看，是 `ArtifactKind` 增加一种，仍画在产物页。

学术讨论的示例简报：

| 项 | 内容 |
| --- | --- |
| 方向 | PCB 设计 |
| 目标 | 讨论四层传感板的分区与回流 |
| 完成 | 约束清单和取舍纪要 |
| R1 | 四层，信号 / 地 / 电源 / 信号 |
| R2 | 模拟采集与开关电源分区 |
| R3 | 只写约束和取舍，不产 Gerber |
| 自主度 | 先问 |

## 6. 交互

### 6.1 询问

用户的第一句话写入对话。客户端根据预设的必填项和领域包字段，把已经提到的填进简报，其余写成假设，显示为可点的短行。仍空着的项收成问题，附在助手消息下，用胶囊选择，也可以直接打字。

开发项目的必填项是目标、完成标准、约束、自主度。学术讨论再加领域包里还空着的字段。Single 在一句话已经写清范围时不建简报，检查器停在产物。

### 6.2 派发与进度

简报确认后生成工作项。进度条是一条 4px 高的圆角条，宽度等于已完成数除以总数，颜色用强调色。清单状态：

| 状态 | 表现 |
| --- | --- |
| pending | 次要文字 |
| in_progress | 强调色，下面一行 `note` |
| completed | 完成色 |
| blocked | 橙色，说明需要人 |
| paused | 次要文字，标题后写「已暂停」 |

Single 的清单固定三步：看相关代码、修改、确认没有多余改动。

### 6.3 进行中改想法

发送后先分类，再决定要不要让用户确认。

| 意图 | 条件 | 界面 |
| --- | --- | --- |
| steer 补充 | 不改简报 | 写入当前进行中的工作项，不弹确认 |
| revise 修订 | 简报字段或需求编号要变 | 助手给出一行确认，点明将暂停哪些项。确认后改简报并对账 |
| patch 旁路 | 当前是 Project，这句话只要求一处小改 | 另开一条 Single 对话，原项目的工作项继续 |

分类结果先由本地规则处理能确定的情况：消息明确点名某个需求编号，或领域字段（层数、外形）发生变化，视为修订。其余交给模型返回 `intent`，界面仍按上表呈现。用户可以在确认行把「修订」改成「补充」。

### 6.4 产物

产物页按 `kind` 选择组件。

| kind | 组件 | 内容 |
| --- | --- | --- |
| diff | `DiffArtifact` | 文件名、增删统计、逐行差异 |
| doc | `DocArtifact` | 标题加正文。约束清单、取舍纪要、说明都走这里 |
| findings | `DocArtifact` | 审查发现，结构与文稿相同，标题不同 |

## 7. 视觉规格与 Tailwind

布局密度学 Claude Desktop。颜色用 Claude 能读的那套暖色：暗色对话是 `#30302e`，侧栏是 `#262624`，正文是暖白 `#faf9f5`，强调色是陶土色 `#d97757`。亮色是暖纸色，正文是 `#141413`。

在 `src/index.css` 里用 Tailwind v4 的 `@theme` 声明 token。暗色用 `.dark` 覆盖同一组变量。

| Token | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| canvas | `#f9f9f7` | `#262624` | 窗口底、侧栏 |
| surface | `#fcfcfb` | `#30302e` | 对话底 |
| group | `#ffffff` | `#3d3d3a` | 输入框、简报、列表组 |
| fill | `#f0f4f8` | `#454540` | 用户气泡、选中行 |
| label | `#141413` | `#faf9f5` | 正文 |
| secondary | `#5e5d59` | `#b0aea5` | 说明、占位 |
| tertiary | `#87867f` | `#8a887f` | 字段名 |
| separator | `rgba(20,20,19,0.10)` | `rgba(250,249,245,0.12)` | 分割线、描边 |
| accent | `#c6613f` | `#d97757` | 强调 |
| on-accent | `#ffffff` | `#ffffff` | 强调色上的字 |
| success | `#34C759` | `#30D158` | 完成 |
| warning | `#FF9500` | `#FF9F0A` | 阻塞 |
| danger | `#b53333` | `#e05252` | 失败、差异删除 |

对应工具类：`bg-canvas`、`bg-surface`、`bg-group`、`bg-fill`、`text-label`、`text-secondary`、`text-tertiary`、`border-separator`、`bg-accent`、`text-on-accent`、`text-success`、`text-warning`、`text-danger`。

字体：

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
```

苹果平台走到 SF Pro，其他平台走到系统无衬线。字号全应用共用一套：

| 样式 | 大小 | 字重 | 用途 |
| --- | --- | --- | --- |
| large | 34px | 600 | 仅空状态标题 |
| body | 17px / 22px 行高 | 400 | 对话正文 |
| footnote | 13px / 18px 行高 | 400 | 说明、字段名、进度 |
| caption | 12px | 600 | 侧栏分组标题 |

圆角：列表组与侧栏行 `10px`，检查器内卡片 `12px`，多行输入框 `22px`，进度条全圆。可点击目标最小高度 `44px`。分割只用 `border-separator` 的 1px 线。

动效只保留两处：检查器宽度展开，进度条宽度变化。二者都包在 `motion-safe:` 里，时长 200ms。系统开启减少动态效果时，这两处瞬时完成。

## 8. 目录与组件

```text
src/
  main.tsx
  App.tsx                      # 三列壳
  index.css                    # Tailwind 与 iOS token
  ui/
    Button.tsx
    Pill.tsx
    ProgressBar.tsx
    SideRow.tsx
  shell/
    Sidebar.tsx
    ThreadView.tsx
    Composer.tsx
    Inspector.tsx
  inspector/
    BriefView.tsx
    ProgressView.tsx
    ArtifactView.tsx
    DiffArtifact.tsx
    DocArtifact.tsx
  model/
    types.ts
    presets.ts
    domains/pcb.ts
    intake.ts                  # 假设、空项、最多四个问题
    reconcile.ts               # 按需求编号暂停
  provider/
    client.ts                  # ModelClient
    openai.ts
    anthropic.ts
    gemini.ts
    presets.ts
  state/
    SilverContext.tsx
```

组件职责：

| 组件 | 行为 |
| --- | --- |
| `App` | 读取当前对话，排列文件侧栏、编辑器和对话列 |
| `Sidebar` | 上面是文件夹和文件树，下面是会话。当前项用 `bg-fill`。底部放外观和供应商入口 |
| `Editor` | 显示当前文件。没有文件夹时提供打开文件夹 |
| `AgentPane` | 右侧对话，以及简报、进度、改动 |
| `ThreadView` | 渲染消息、假设行、选择胶囊、修订确认 |
| `Composer` | 多行输入，Enter 发送，Shift+Enter 换行。胶囊切换预设和模型 |
| `Inspector` | 分段控件加当前页 |
| `BriefView` | 展示和编辑简报字段。已有工作项时通过修订确认更新。领域字段有值才在阅读模式显示 |
| `ProgressView` | 总进度和 `Run` 清单 |
| `ArtifactView` | 按 `kind` 分发 |
| `Pill` | 未选中是描边，选中是 `bg-fill`。高度至少 44px 的可点区域可以靠外层补齐，胶囊视觉高度可以更矮 |

供应商设置用同一套分组列表，从侧栏进入，盖住检查器的位置，关闭后回到原来的页。这是检查器里的一个视图，不是第四块区域。

## 9. 状态流

`SilverContext` 保存对话列表、当前对话 id、供应商列表和外观。消息流式返回时，对当前助手消息做文本追加，这是唯一的高频更新。

发送一条用户消息的顺序：

1. 追加用户消息。
2. 本地 `intake` 或 `reconcile` 能确定结果时，先改简报和工作项，再请求模型组织回复。
3. 不能确定时，请求模型给出 `intent` 和回复正文。
4. `revise` 先显示确认，用户点「就这样」后才写入简报并调用 `reconcile`。
5. `patch` 创建一条 `presetId = patch` 的新对话，原对话保持运行。
6. 需要派发时，模型返回工作项和产物增量，reducer 按 id 合并。

`reconcile(briefBefore, briefAfter, runs)` 的规则写死在客户端：

- 需求编号被删除，或正文发生变化：依赖它且状态不是 `completed` 的项改为 `paused`。
- `completed` 保持完成。
- 领域字段变化视同该字段所绑定的需求编号变化。PCB 包里 `stackup` 绑定 R1，`nets` 绑定 R2，`mechanical` 与 `fab` 绑定 R3。绑定关系写在领域包数据里。

## 10. 模型供应商

协议只有三种。New API、One API、OpenRouter 以及其他 OpenAI 兼容网关，都使用 `openai` 协议，差别只是预设里的 Base URL。

| 预设 | 协议 | 字段 |
| --- | --- | --- |
| New API | openai | 地址、密钥、模型 |
| OpenAI | openai | 密钥、模型 |
| Anthropic | anthropic | 密钥、模型 |
| Gemini | gemini | 密钥、模型 |
| 自定义兼容 | 三选一 | 地址、密钥、模型 |

`ModelClient` 的界面：

```ts
interface ModelClient {
  listModels(): Promise<string[]>;
  streamChat(input: {
    model: string;
    messages: { role: "user" | "assistant" | "system"; content: string }[];
  }): AsyncIterable<string>;
}
```

New API 的调用：

- `GET {baseUrl}/v1/models`，`Authorization: Bearer {key}`
- `POST {baseUrl}/v1/chat/completions`，`stream: true`

对话选择的模型存在 `Thread.modelId`。单个工作项第一版不单独换模型，避免设置项扩散。以后若要改钉，在 `Run` 上增加可选 `modelId`，界面仍用现在的模型胶囊。

## 11. 第一版范围

第一版做出可操作的壳，并用一条写死的学术讨论样例验证 PCB 领域包。模型可以用真实的 New API，也可以在没有密钥时走本地样例回复。

包含：

- 三列壳、空状态、亮色与暗色
- 五条预设的切换，以及输入框上的模式胶囊
- 开发项目的询问样例，和学术讨论的 PCB 简报样例
- 进度条、暂停对账、修订确认、Single 的差异产物、PCB 的文稿产物
- New API 预设的地址、密钥和模型列表

不包含：

- 板图编辑器、Gerber 预览
- 真实写文件到磁盘
- 账号系统和云端同步
- 第四块常驻区域，或按场景分叉的页面

## 12. 维护边界

| 要加的东西 | 做法 |
| --- | --- |
| 新场景 | 在 `presets.ts` 加一条预设 |
| 新方向 | 在 `src/model/domains` 加一个领域包，挂到学术讨论 |
| 新供应商 | 协议已有则只加预设；否则只加一个协议文件 |
| 新界面 | 放进侧栏、对话或检查器 |
| 新状态 | 放进简报。进度从工作项派生 |
| 新产物 | 增加 `ArtifactKind` 和产物页里的一个组件 |

## 13. 桌面运行方式

- 打开文件夹后可以点开文件，并在右侧对话里发送第一句。真实对话选择一个已配置的供应商和模型后发起请求。预设从输入框胶囊切换。
- Project 确认简报后生成工作项，按模型给出的并行分组派发。修订按稳定需求编号暂停受影响的工作项。Single 的回复可以生成差异、文稿或审查发现。
- 本机保存对话、配置、外观和工作区关联。JSON 备份带对话数据，供应商配置与密钥保留在本机。
- Tauri 打开系统的文件夹选择窗口。CLI 负责预览、搜索、附加文件、应用文本 unified diff 和导出 Markdown 到 `silver/`。迁移到另一台电脑时需要重新选择文件夹。
- 长任务里的删除、锁文件、项目脚本配置或超过二十个文件的写入在对话确认。手动接受差异时在产物页确认。
- CLI 在工作区运行 `npm test`、类型检查和 `npm run build`。检查结果跟随工作项，进入下一轮提示词。窗口关闭后 CLI 继续执行。 [桌面运行契约](desktop.md)
