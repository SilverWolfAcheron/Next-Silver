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
    label: "Agent",
    mode: "project",
    autonomy: "decide",
    writePolicy: "code",
    defaultTab: "brief",
  },
  {
    id: "review",
    label: "Plan",
    mode: "single",
    autonomy: "ask",
    writePolicy: "none",
    defaultTab: "artifact",
  },
  {
    id: "explain",
    label: "Explain",
    mode: "single",
    autonomy: "decide",
    writePolicy: "docs",
    defaultTab: "artifact",
  },
  {
    id: "academic",
    label: "Discussion",
    mode: "project",
    autonomy: "ask",
    writePolicy: "docs",
    defaultTab: "brief",
    domainId: "pcb",
  },
  {
    id: "patch",
    label: "Patch",
    mode: "single",
    autonomy: "act",
    writePolicy: "code",
    defaultTab: "artifact",
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
