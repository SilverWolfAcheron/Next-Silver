import type { Thread } from "../agent-core/types";

/** Academic / PCB sample thread for first-run validation. */
export const SAMPLE_PCB_THREAD: Thread = {
  id: "sample-pcb",
  title: "四层传感板分区与回流",
  presetId: "academic",
  mode: "project",
  intakeStep: "done",
  modelId: "",
  inspectorTab: "brief",
  inspectorOpen: true,
  messages: [
    {
      id: "m1",
      role: "user",
      text: "帮我讨论一块四层传感板的分区策略和回流路径设计。",
    },
    {
      id: "m2",
      role: "assistant",
      text: "好的，我先按你的描述填入简报，还需要确认几项：",
      choices: [
        "外形和连接器定死了吗？",
        "有没有必须守住的阻抗？",
        "这次停在约束，还是要谈到布局取舍？",
      ],
    },
    {
      id: "m3",
      role: "user",
      text: "外形暂时没定，阻抗要求差分对 100Ω，这次先讨论约束和分区。",
    },
    {
      id: "m4",
      role: "assistant",
      text: "明白，已更新简报。工作项已派发，共两项并行：约束整理和回流分析。",
    },
  ],
  brief: {
    intent: "四层传感板分区与回流讨论",
    outcome: "约束清单和取舍纪要",
    requirements: [
      { id: "R1", text: "四层，信号 / 地 / 电源 / 信号" },
      { id: "R2", text: "模拟采集与开关电源分区" },
      { id: "R3", text: "只写约束和取舍，不产 Gerber" },
    ],
    constraints: "差分对 100Ω 阻抗，外形待定",
    autonomy: "ask",
    outOfScope: ["Gerber 输出", "板图编辑器"],
    domainFields: {
      stackup: "四层：信号 / 地 / 电源 / 信号",
      nets: "差分对 100Ω",
      mechanical: "待定",
      fab: "待定",
    },
  },
  runs: [
    {
      id: "run-1",
      title: "整理阻抗与分区约束",
      dependsOn: ["R1", "R2"],
      status: "completed",
      note: "",
      parallelGroup: "g1",
    },
    {
      id: "run-2",
      title: "分析回流路径取舍",
      dependsOn: ["R2"],
      status: "blocked",
      note: "示例工作项。选定模型后可以重试。",
      parallelGroup: "g1",
    },
  ],
  artifacts: [
    {
      id: "art-1",
      kind: "doc",
      title: "约束清单",
      runId: "run-1",
      body: `叠层：四层，信号（顶）/ 地 / 电源 / 信号（底）。

阻抗：差分对按 100Ω 控制，单端信号线暂无阻抗要求。

分区：模拟采集区域与开关电源区域之间保留至少 3mm 间距，地层在两区之间不开槽。

外形：待定，连接器位置影响回流路径，需在外形确认后复查布局。`,
    },
  ],
};
