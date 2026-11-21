import type { Mode, Autonomy, WritePolicy, InspectorTab } from "./types";

export interface Preset {
  id: string;
  label: string;
  mode: Mode;
  autonomy: Autonomy;
  writePolicy: WritePolicy;
  defaultTab: InspectorTab;
  domainId?: string;
}

export const PRESETS: Preset[] = [
  {
    id: "develop",
    label: "开发项目",
    mode: "project",
    autonomy: "decide",
    writePolicy: "code",
    defaultTab: "brief",
  },
  {
    id: "patch",
    label: "小补丁",
    mode: "single",
    autonomy: "act",
    writePolicy: "code",
    defaultTab: "artifact",
  },
  {
    id: "review",
    label: "只读审查",
    mode: "single",
    autonomy: "ask",
    writePolicy: "none",
    defaultTab: "artifact",
  },
  {
    id: "explain",
    label: "写说明",
    mode: "single",
    autonomy: "decide",
    writePolicy: "docs",
    defaultTab: "artifact",
  },
  {
    id: "academic",
    label: "学术讨论",
    mode: "project",
    autonomy: "ask",
    writePolicy: "docs",
    defaultTab: "brief",
    domainId: "pcb",
  },
];

export const AUTONOMY_LABELS: Record<string, string> = {
  ask: "先问",
  decide: "自己定",
  act: "直接做",
};

export function getPreset(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
