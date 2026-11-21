# Todo Agent 实现契约

这是第三阶段。第一阶段是基础功能，第二阶段是多代理并发和同时审计，契约在 [multi-agent.md](multi-agent.md)。基础功能没过关、并发开发席位不能超过 8 且审计不能同时在跑时，不要实现本文。

本文定义过关之后的自迭代：一项工作交完产物之后，自己对照简报判断还缺什么，并在同一项下面继续做下一轮。

先读 [features.md](features.md)、[design.md](design.md) 和当前的 `src/state/useConversation.ts`、`src/model/types.ts`、`src/model/session.ts`、`src/model/reconcile.ts`、`src/model/localData.ts`、`src/inspector/ProgressView.tsx`。实现必须接在现有的工作项上。不要另起一套对话，不要加第四块界面，不要用「再调用一次模型看看」代替下面的状态机。

## 1. 现在缺什么

长任务要求：产物写完之后先跑允许的检查，再对照简报判断。没盖住需求就在同一项下继续。读取次数和「已经有一份差异」都不是完成条件。

桌面版在 CLI 的 `cli/conversation.ts` 和 `cli/iterations.ts` 执行轮次。进度页订阅 CLI 状态，关闭窗口不改变执行状态。

## 2. 对象

工作项仍是进度清单上的一条。自迭代是这条下面的轮次，不是新的平级工作项，也不是另一条对话。

```ts
type IterationVerdict = "continue" | "done" | "blocked";

interface IterationGap {
  requirementId: string;
  missing: string;
}

interface Iteration {
  id: string;
  index: number;
  title: string;
  status: "in_progress" | "completed" | "blocked" | "paused";
  gaps: IterationGap[];
  evidence: string[];
  verdict?: IterationVerdict;
  artifactIds: string[];
  note: string;
}
```

`Run` 增加 `iterations: Iteration[]`。旧数据没有这个字段时当成空数组。父项状态由轮次派生，不另存一套会互相打架的完成标记：

| 轮次情况 | 父项状态 |
| --- | --- |
| 有一轮 `in_progress` | `in_progress` |
| 最新一轮 `verdict === "done"` | `completed` |
| 最新一轮 `blocked`，或连续两轮缺口相同 | `blocked` |
| 修订对账暂停了父项 | 未完成轮次改为 `paused`，父项 `paused` |
| 还没有任何轮次 | 保持原来的 `pending` / `in_progress` |

轮次数量不封顶。第 1 轮就是第一次产出加上这一轮的检查命令。之后每一轮都可以再改、再跑 `npm test`、类型检查或 `npm run build`。父项改为 `blocked` 只在这几种情况：判断需要人、连续两轮缺口相同、用户停止。禁止把第 4 轮写成隐藏上限。

每一轮可以多次列出目录、读文件和搜索，不设 4 次上限。检查命令的输出另计，写入该轮产物，并原样进入下一轮提示词。交完差异之后先跑命令，再做第 3 节的判断。

## 3. 一轮结束时必须做的判断

产物写入之后、父项被标完成之前，用同一次模型连接再请求一次判断。判断的输入只能是这些材料：

- 该工作项 `dependsOn` 对应的需求原文
- 简报里的约束、不做、自主度、领域字段
- 这一轮的产物正文
- 这一轮 `npm test`、类型检查、`npm run build` 的退出码和输出；还没跑时在 evidence 里写明缺哪一条
- 之前各轮的 `gaps` 和 `evidence`

判断只返回 JSON：

```json
{
  "verdict": "continue",
  "gaps": [{ "requirementId": "R1", "missing": "结账页仍分成地址和配送两步" }],
  "evidence": ["R1 要求一步提交；当前差异里地址和配送仍是两个路由"],
  "nextTitle": "把地址和配送收成同一次提交"
}
```

客户端拒绝不合法的判断，并把父项标为 `blocked`，说明「判断结果无法读取，可以重试」：

- `done` 时 `gaps` 必须是空数组。`evidence` 至少一条，且 `dependsOn` 里每个编号都在某条 evidence 里出现。缺编号就不算完成。
- `continue` 时 `gaps` 至少一条。每条 `requirementId` 必须属于该工作项的 `dependsOn`；工作项没有编号时，用简报目标的字面，`requirementId` 写 `goal`。`missing` 和 `nextTitle` 必须是非空字符串。
- `blocked` 时 `evidence` 至少一条，说明缺的是人才能提供的材料，或这一步会删除文件、改锁文件、一次差异超过 20 个文件、写出工作区外的路径。
- 学术讨论和 `docs` 策略只对照约束、取舍和领域字段。判断不得要求 Gerber、板图或未读到的文件。
- `none` 策略的审查发现只判断发现是否覆盖了用户点名的问题。不得为了自迭代去改文件。

`done` 以外的任何路径都不得把父项标成 `completed`。有产物但判断缺失，状态是 `blocked`，不是完成。

## 4. 什么时候自己开下一轮

`continue` 之后：

1. 把本轮标为 `completed`，记下 `verdict`、`gaps`、`evidence`、产物 id。
2. 若本轮 `gaps` 与上一轮 `gaps` 的 `requirementId + missing` 完全相同，不开新轮。父项 `blocked`，说明「连续两轮缺口相同」。
3. 轮次可以继续增加。剩余缺口本身不构成封顶。
4. 自主度是「先问」：在对话里确认。「继续下一轮」才创建下一轮并执行。「停在这里」则父项 `blocked`，说明「用户停止自迭代」。
5. 自主度是「自己定」或「直接做」：直接创建下一轮并执行。删除文件、锁文件、超过 20 个文件、工作区外路径，仍先问，即使自主度是「直接做」。
6. 下一轮的提示词必须带上上一轮的 `gaps`、`nextTitle`、已有产物，以及检查命令的退出码和输出。这一轮只补这些缺口，不重做已经满足的需求。

下一轮仍走同一父项上的产出。新产物按现有规则合并：同一路径未接受的差异被新版本替换，已接受的保留。

用户在轮次中途发来的补充，写入当前轮，并让当前轮带着补充重跑。这不是新的平级工作项。修订确认后，父项按现有编号规则暂停，其未完成轮次一并暂停。

## 5. 界面

进度页在工作项下面列出轮次。每一轮一行：序号、标题、状态、一句 `note`。父项的 `note` 用最新一轮的 `note`。总进度仍按父项计算，轮次不重复计入总数。

对话里只在需要人时说话：判断成 `blocked`、自主度要求确认下一轮、或破坏性改动。自己进入下一轮时，不另发一条「我再试试」。进度行已经说明。

检查器仍是简报、进度、产物。轮次点开后，产物页滚到该轮的产物。

## 6. 要改的文件

| 文件 | 改动 |
| --- | --- |
| `src/model/types.ts` | 增加 `Iteration`，`Run.iterations` |
| `src/model/session.ts` | 解析判断 JSON；`resultInstruction` 写明产物不是完成 |
| `src/model/iterate.ts` | 新建。校验判断、比较相邻缺口、决定下一轮或阻塞 |
| `cli/conversation.ts`、`cli/iterations.ts` | 产出后应用差异、跑检查，再判断并按第 4 节转移状态 |
| `src/model/reconcile.ts` | 暂停父项时暂停未完成轮次 |
| `src/model/localData.ts` | 保存和读出 `iterations`，缺字段时用空数组 |
| `src/inspector/ProgressView.tsx` | 父项下渲染轮次 |
| `src/model/iterate.test.ts` | 第 7 节的判定 |

可以改上述文件里直接相关的调用。不要改颜色、预设名单、供应商协议和三块布局。

## 7. 验收

下面每条都要有测试或一条能重复的界面路径。少一条就不算做完。

1. 产物存在，但判断的 evidence 没提到 `dependsOn` 里的某个编号。父项不是 `completed`。
2. 第一轮 `continue` 且缺口是 R1。第二轮 evidence 覆盖 R1 且 `gaps` 为空。父项变为 `completed`。进度总数仍是父项数。
3. 连续两轮 `requirementId` 和 `missing` 相同。第二轮之后父项 `blocked`，不出现第三轮。
4. 第 5 轮及以后仍可以 `continue`。父项保持 `in_progress`，轮次数量与实际执行次数一致。只有连续两轮缺口相同、需要人，或用户停止时才 `blocked`。
5. 自主度 `ask` 时，`continue` 先出现确认。点「停在这里」后没有新轮次。点「继续下一轮」后才有第 2 轮。
6. 自主度 `decide` 时，普通 `continue` 不经确认直接进入下一轮。差异超过 20 个文件时仍先确认。
7. 判断 JSON 损坏。父项 `blocked`，说明可以重试。
8. 修订把父项暂停。进行中的轮次变为 `paused`，不再请求模型。
9. 旧的无 `iterations` 对话能打开，进度不报错。
10. `npm run build` 通过。`src/model/diff.ts` 里 `\r\n` 与 `\n` 的类型错误要一起修好，因为下一轮要在 Windows 文件上合并差异。

禁止把这些验收收成一个布尔值 `looksGood`。禁止在判断函数里写死「有产物即完成」。禁止只在提示词里写「请你自己检查」，而客户端仍然在 `output()` 末尾直接标 `completed`。
